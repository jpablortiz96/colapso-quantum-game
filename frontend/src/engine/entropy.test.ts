import { describe, expect, it } from "vitest";

import {
  UINT32_MAX,
  UINT32_RANGE,
  RecordingEntropySource,
  TranscriptEntropySource,
  complementaryWordToQuantile,
  drawUnbiasedBoundedInteger,
  validateUint32,
  wordToQuantile,
} from "./entropy";
import type { EntropyError } from "./errors";
import type {
  EntropyContext,
  EntropyRecord,
  EntropySource,
  Result,
} from "./types";

const OBSERVE_CONTEXT = Object.freeze({
  operation: "OBSERVE_COLLAPSE",
  coordinate: Object.freeze({ row: 2, col: 3 }),
  pairId: null,
}) satisfies EntropyContext;

const SELECT_CONTEXT = Object.freeze({
  operation: "DECOHERENCE_SELECT",
  turn: 4,
  candidateCount: 17,
}) satisfies EntropyContext;

const queueSource = (
  words: readonly number[],
): EntropySource<EntropyError> => {
  let cursor = 0;
  return {
    nextUint32: (): Result<number, EntropyError> => {
      const word = words[cursor];
      if (word === undefined) {
        return {
          ok: false,
          error: {
            kind: "ENTROPY_EXHAUSTED",
            message: "Script exhausted.",
          },
        };
      }
      cursor += 1;
      return { ok: true, value: word };
    },
  };
};

describe("entropy words and quantiles", () => {
  it("accepts both uint32 boundaries and rejects every range violation", () => {
    expect(validateUint32(0)).toEqual({ ok: true, value: 0 });
    expect(validateUint32(UINT32_MAX)).toEqual({
      ok: true,
      value: UINT32_MAX,
    });

    for (const invalid of [-1, UINT32_RANGE, 1.5, Number.NaN, Infinity, "1"]) {
      const result = validateUint32(invalid);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.kind).toBe("ENTROPY_RANGE");
      }
    }
  });

  it("maps boundary words to exact quantiles in [0, 1)", () => {
    expect(wordToQuantile(0)).toBe(0);
    expect(wordToQuantile(UINT32_MAX)).toBe(UINT32_MAX / UINT32_RANGE);
    expect(wordToQuantile(UINT32_MAX)).toBeLessThan(1);
    expect(complementaryWordToQuantile(0)).toBe(
      UINT32_MAX / UINT32_RANGE,
    );
    expect(complementaryWordToQuantile(UINT32_MAX)).toBe(0);
    expect(() => wordToQuantile(UINT32_RANGE)).toThrow(RangeError);
  });
});

describe("entropy transcript adapters", () => {
  it("records successful validated words with immutable semantic contexts", () => {
    const source = new RecordingEntropySource(queueSource([0, UINT32_MAX]));

    expect(source.nextUint32(OBSERVE_CONTEXT)).toEqual({ ok: true, value: 0 });
    expect(source.nextUint32(SELECT_CONTEXT)).toEqual({
      ok: true,
      value: UINT32_MAX,
    });

    expect(source.records).toEqual([
      { context: OBSERVE_CONTEXT, word: 0 },
      { context: SELECT_CONTEXT, word: UINT32_MAX },
    ]);
    expect(source.consumedEntries).toBe(2);
    expect(Object.keys(source.records[0] ?? {})).toEqual(["context", "word"]);
    expect(Object.isFrozen(source.records)).toBe(true);
    expect(Object.isFrozen(source.records[0])).toBe(true);
    expect(Object.isFrozen(source.records[0]?.context)).toBe(true);
  });

  it("does not record an out-of-range source value", () => {
    const source = new RecordingEntropySource(queueSource([UINT32_RANGE]));
    const result = source.nextUint32(OBSERVE_CONTEXT);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("ENTROPY_RANGE");
    }
    expect(source.records).toEqual([]);
  });

  it("replays structurally equal contexts in strict order", () => {
    const records: readonly EntropyRecord[] = [
      { context: OBSERVE_CONTEXT, word: 19 },
      { context: SELECT_CONTEXT, word: 23 },
    ];
    const source = new TranscriptEntropySource(records);

    expect(
      source.nextUint32({
        operation: "OBSERVE_COLLAPSE",
        coordinate: { row: 2, col: 3 },
        pairId: null,
      }),
    ).toEqual({ ok: true, value: 19 });
    expect(source.consumedEntries).toBe(1);
    expect(source.remainingEntries).toBe(1);
    expect(source.nextUint32(SELECT_CONTEXT)).toEqual({ ok: true, value: 23 });
    expect(source.remainingEntries).toBe(0);
  });

  it("reports context mismatch without consuming the entry", () => {
    const source = new TranscriptEntropySource([
      { context: OBSERVE_CONTEXT, word: 29 },
    ]);

    const mismatch = source.nextUint32({
      operation: "OBSERVE_COLLAPSE",
      coordinate: { row: 2, col: 4 },
      pairId: null,
    });
    expect(mismatch.ok).toBe(false);
    if (!mismatch.ok) {
      expect(mismatch.error.kind).toBe("ENTROPY_CONTEXT_MISMATCH");
    }
    expect(source.consumedEntries).toBe(0);
    expect(source.nextUint32(OBSERVE_CONTEXT)).toEqual({ ok: true, value: 29 });
  });

  it("reports exhausted and out-of-range transcript entries without consuming", () => {
    const exhausted = new TranscriptEntropySource([]);
    const exhaustedResult = exhausted.nextUint32(OBSERVE_CONTEXT);
    expect(exhaustedResult.ok).toBe(false);
    if (!exhaustedResult.ok) {
      expect(exhaustedResult.error.kind).toBe("ENTROPY_EXHAUSTED");
    }

    const invalid = new TranscriptEntropySource([
      { context: OBSERVE_CONTEXT, word: UINT32_RANGE },
    ]);
    const invalidResult = invalid.nextUint32(OBSERVE_CONTEXT);
    expect(invalidResult.ok).toBe(false);
    if (!invalidResult.ok) {
      expect(invalidResult.error.kind).toBe("ENTROPY_RANGE");
    }
    expect(invalid.consumedEntries).toBe(0);
  });
});

describe("unbiased bounded integer selection", () => {
  it("consumes and records rejected words before accepting a value", () => {
    const transcript = new TranscriptEntropySource([
      { context: SELECT_CONTEXT, word: UINT32_MAX },
      { context: SELECT_CONTEXT, word: 17 },
    ]);
    const recording = new RecordingEntropySource(transcript);

    const result = drawUnbiasedBoundedInteger(recording, SELECT_CONTEXT, 10);

    expect(result).toEqual({ ok: true, value: 7 });
    expect(recording.records.map(({ word }) => word)).toEqual([
      UINT32_MAX,
      17,
    ]);
    expect(transcript.consumedEntries).toBe(2);
  });

  it("supports the full uint32 range as an exclusive bound", () => {
    const source = queueSource([UINT32_MAX]);
    expect(
      drawUnbiasedBoundedInteger(source, SELECT_CONTEXT, UINT32_RANGE),
    ).toEqual({ ok: true, value: UINT32_MAX });
  });

  it("treats invalid bounds as programming errors", () => {
    const source = queueSource([0]);
    for (const bound of [0, -1, 1.5, UINT32_RANGE + 1]) {
      expect(() =>
        drawUnbiasedBoundedInteger(source, SELECT_CONTEXT, bound),
      ).toThrow(RangeError);
    }
  });
});
