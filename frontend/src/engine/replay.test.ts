import { describe, expect, it } from "vitest";

import { coordinateKey } from "./coordinates";
import { TranscriptEntropySource, UINT32_RANGE } from "./entropy";
import { generateInitialState } from "./generation";
import { replayGame } from "./replay";
import { calculateScore } from "./score";
import { serializeGameStateToDto } from "./serialization";
import { processAction } from "./turn";
import type {
  Action,
  EntropyRecord,
  GameState,
  GameStateDto,
  ReplayDto,
} from "./types";

const generatedState = (seed: string): GameState => {
  const result = generateInitialState(seed);
  if (!result.ok) {
    throw new Error(result.error.message);
  }
  return result.value;
};

const dtoOf = (state: GameState): GameStateDto => {
  const result = serializeGameStateToDto(state);
  if (!result.ok) {
    throw new Error(result.error.message);
  }
  return result.value;
};

const emptySeedReplay = (seed: string): ReplayDto => {
  const state = generatedState(seed);
  return Object.freeze({
    replaySchemaVersion: 1,
    rulesVersion: 1,
    initial: Object.freeze({ kind: "SEED", seed }),
    actions: Object.freeze([]),
    entropyTranscript: Object.freeze([]),
    expectedFinalState: dtoOf(state),
    expectedFinalScore: calculateScore(state),
  });
};

const observeReplay = (seed: string): ReplayDto => {
  const initial = generatedState(seed);
  const paired = new Set(
    initial.pairs.flatMap(({ memberA, memberB }) => [
      coordinateKey(memberA),
      coordinateKey(memberB),
    ]),
  );
  const target = initial.board.find(
    (cell) =>
      cell.kind === "UNRESOLVED" &&
      !paired.has(coordinateKey(cell.coordinate)),
  )?.coordinate;
  if (target === undefined) {
    throw new Error("Replay fixture requires an unpaired observation target.");
  }
  const action = Object.freeze({ kind: "OBSERVE" as const, target });
  const record: EntropyRecord = Object.freeze({
    context: Object.freeze({
      operation: "OBSERVE_COLLAPSE",
      coordinate: target,
      pairId: null,
    }),
    word: 0,
  });
  const entropy = new TranscriptEntropySource([record]);
  const processed = processAction(initial, action, entropy);
  if (!processed.ok) {
    throw new Error(processed.error.message);
  }
  return Object.freeze({
    replaySchemaVersion: 1,
    rulesVersion: 1,
    initial: Object.freeze({ kind: "SEED", seed }),
    actions: Object.freeze([action]),
    entropyTranscript: Object.freeze([record]),
    expectedFinalState: dtoOf(processed.state),
    expectedFinalScore: calculateScore(processed.state),
  });
};

const expectInvalidDto = (input: unknown, path: string, label: string): void => {
  expect(replayGame(input), label).toMatchObject({
    ok: false,
    error: { kind: "INVALID_DTO", path },
  });
};

describe("strict deterministic replay", () => {
  it("rejects malformed replay shape, keys, collections, and numeric primitives", () => {
    const replay = emptySeedReplay("replay-top-level-validation");
    const cases: readonly (readonly [string, unknown, string])[] = [
      ["null replay", null, "$"],
      ["array replay", [], "$"],
      ["missing replay fields", { replaySchemaVersion: 1 }, "$"],
      ["unknown replay field", { ...replay, unknown: true }, "$"],
      ["string schema version", { ...replay, replaySchemaVersion: "1" }, "replaySchemaVersion"],
      ["non-finite rules version", { ...replay, rulesVersion: Number.NaN }, "rulesVersion"],
      ["object actions", { ...replay, actions: {} }, "actions"],
      ["null transcript", { ...replay, entropyTranscript: null }, "entropyTranscript"],
      ["non-finite score", { ...replay, expectedFinalScore: Number.POSITIVE_INFINITY }, "expectedFinalScore"],
    ];

    for (const [label, input, path] of cases) {
      expectInvalidDto(input, path, label);
    }
  });

  it("rejects invalid initial variants before replay execution", () => {
    const replay = emptySeedReplay("replay-initial-validation");
    const cases: readonly (readonly [string, unknown, string])[] = [
      ["primitive initial", { ...replay, initial: 1 }, "initial"],
      ["unsupported initial kind", { ...replay, initial: { kind: "SNAPSHOT" } }, "initial.kind"],
      ["seed unknown field", { ...replay, initial: { kind: "SEED", seed: "valid", extra: true } }, "initial"],
      ["invalid seed primitive", { ...replay, initial: { kind: "SEED", seed: 1 } }, "initial.seed"],
      ["universe unknown field", { ...replay, initial: { kind: "UNIVERSE", universe: replay.expectedFinalState, extra: true } }, "initial"],
      ["invalid universe DTO", { ...replay, initial: { kind: "UNIVERSE", universe: null } }, "$"],
      ["invalid expected state DTO", { ...replay, expectedFinalState: null }, "$"],
    ];

    for (const [label, input, path] of cases) {
      expectInvalidDto(input, path, label);
    }
  });

  it("rejects malformed action variants with precise paths", () => {
    const replay = emptySeedReplay("replay-action-validation");
    const cases: readonly (readonly [string, unknown, string])[] = [
      ["primitive action", null, "actions[0]"],
      ["unsupported action", { kind: "TELEPORT", target: { row: 0, col: 0 } }, "actions[0].kind"],
      ["gate missing target", { kind: "APPLY_GATE", gate: "X" }, "actions[0]"],
      ["unsupported gate", { kind: "APPLY_GATE", gate: "Z", target: { row: 0, col: 0 } }, "actions[0].gate"],
      ["gate target shape", { kind: "APPLY_GATE", gate: "H", target: null }, "actions[0].target"],
      ["observation row primitive", { kind: "OBSERVE", target: { row: "0", col: 0 } }, "actions[0].target.row"],
      ["move col non-finite", { kind: "MOVE", target: { row: 0, col: Number.NaN } }, "actions[0].target.col"],
      ["simple action unknown field", { kind: "OBSERVE", target: { row: 0, col: 0 }, gate: "X" }, "actions[0]"],
    ];

    for (const [label, action, path] of cases) {
      expectInvalidDto({ ...replay, actions: [action] }, path, label);
    }
  });

  it("rejects malformed entropy records and every context variant precisely", () => {
    const replay = emptySeedReplay("replay-entropy-validation");
    const observe = {
      operation: "OBSERVE_COLLAPSE",
      coordinate: { row: 0, col: 0 },
      pairId: null,
    };
    const cases: readonly (readonly [string, unknown, string])[] = [
      ["primitive record", null, "entropyTranscript[0]"],
      ["record keys", { context: observe }, "entropyTranscript[0]"],
      ["primitive context", { context: null, word: 0 }, "entropyTranscript[0].context"],
      ["observation keys", { context: { operation: "OBSERVE_COLLAPSE", coordinate: { row: 0, col: 0 } }, word: 0 }, "entropyTranscript[0].context"],
      ["coordinate keys", { context: { ...observe, coordinate: { row: 0 } }, word: 0 }, "entropyTranscript[0].context.coordinate"],
      ["negative-zero coordinate", { context: { ...observe, coordinate: { row: -0, col: 0 } }, word: 0 }, "entropyTranscript[0].context.coordinate"],
      ["pair ID primitive", { context: { ...observe, pairId: 1 }, word: 0 }, "entropyTranscript[0].context.pairId"],
      ["unsupported operation", { context: { operation: "RANDOM" }, word: 0 }, "entropyTranscript[0].context.operation"],
      ["selection keys", { context: { operation: "DECOHERENCE_SELECT", turn: 4 }, word: 0 }, "entropyTranscript[0].context"],
      ["selection turn primitive", { context: { operation: "DECOHERENCE_SELECT", turn: "4", candidateCount: 1 }, word: 0 }, "entropyTranscript[0].context.turn"],
      ["selection count non-finite", { context: { operation: "DECOHERENCE_SELECT", turn: 4, candidateCount: Number.POSITIVE_INFINITY }, word: 0 }, "entropyTranscript[0].context.candidateCount"],
      ["decoherence keys", { context: { operation: "DECOHERENCE_COLLAPSE", turn: 4, coordinate: { row: 0, col: 0 } }, word: 0 }, "entropyTranscript[0].context"],
      ["decoherence turn schedule", { context: { operation: "DECOHERENCE_COLLAPSE", turn: 3, coordinate: { row: 0, col: 0 }, pairId: null }, word: 0 }, "entropyTranscript[0].context.turn"],
      ["decoherence coordinate bounds", { context: { operation: "DECOHERENCE_COLLAPSE", turn: 4, coordinate: { row: 7, col: 0 }, pairId: null }, word: 0 }, "entropyTranscript[0].context.coordinate"],
      ["decoherence pair ID", { context: { operation: "DECOHERENCE_COLLAPSE", turn: 4, coordinate: { row: 0, col: 0 }, pairId: false }, word: 0 }, "entropyTranscript[0].context.pairId"],
      ["word primitive", { context: observe, word: "0" }, "entropyTranscript[0].word"],
    ];

    for (const [label, record, path] of cases) {
      expectInvalidDto({ ...replay, entropyTranscript: [record] }, path, label);
    }
  });

  it("accepts exact entropy context shapes at semantic boundaries", () => {
    const replay = emptySeedReplay("replay-entropy-boundaries");
    const entropyTranscript = [
      {
        context: {
          operation: "OBSERVE_COLLAPSE",
          coordinate: { row: 0, col: 0 },
          pairId: "pair-boundary",
        },
        word: 0,
      },
      {
        context: {
          operation: "DECOHERENCE_SELECT",
          turn: 4,
          candidateCount: 47,
        },
        word: UINT32_RANGE - 1,
      },
      {
        context: {
          operation: "DECOHERENCE_COLLAPSE",
          turn: 4,
          coordinate: { row: 6, col: 6 },
          pairId: null,
        },
        word: 0,
      },
    ];

    expect(replayGame({ ...replay, entropyTranscript })).toMatchObject({
      ok: false,
      error: { kind: "REPLAY_UNUSED_ENTROPY", remainingEntries: 3 },
    });
  });
  it("replays both exact initial variants and returns fixed-order canonical output", () => {
    const seedReplay = emptySeedReplay("replay-seed-initial");
    const seedResult = replayGame(seedReplay);
    expect(seedResult.ok).toBe(true);
    if (!seedResult.ok) {
      return;
    }
    expect(Object.keys(seedResult.value)).toEqual([
      "replaySchemaVersion",
      "rulesVersion",
      "finalState",
      "finalScore",
      "consumedEntropy",
    ]);
    expect(seedResult.value.consumedEntropy).toBe(0);
    expect(Object.isFrozen(seedResult.value)).toBe(true);
    expect(Object.isFrozen(seedResult.value.finalState)).toBe(true);

    const initial = generatedState("replay-universe-initial");
    const universeReplay: ReplayDto = {
      replaySchemaVersion: 1,
      rulesVersion: 1,
      initial: { kind: "UNIVERSE", universe: dtoOf(initial) },
      actions: [],
      entropyTranscript: [],
      expectedFinalState: dtoOf(initial),
      expectedFinalScore: calculateScore(initial),
    };
    expect(replayGame(universeReplay)).toMatchObject({
      ok: true,
      value: { consumedEntropy: 0, finalScore: 1000 },
    });
  });

  it("uses only gameplay transcript entries for seed replay", () => {
    const replay = observeReplay("replay-gameplay-only");
    const result = replayGame(replay);

    expect(replay.entropyTranscript).toHaveLength(1);
    expect(replay.entropyTranscript[0]?.context.operation).toBe(
      "OBSERVE_COLLAPSE",
    );
    expect(result).toMatchObject({
      ok: true,
      value: { consumedEntropy: 1 },
    });
  });

  it("reports exhausted and context-mismatched action entropy with index and cause", () => {
    const replay = observeReplay("replay-transcript-errors");
    expect(replayGame({ ...replay, entropyTranscript: [] })).toMatchObject({
      ok: false,
      error: {
        kind: "REPLAY_ACTION_FAILED",
        actionIndex: 0,
        cause: { kind: "ENTROPY_EXHAUSTED" },
      },
    });

    const record = replay.entropyTranscript[0];
    if (record === undefined || record.context.operation !== "OBSERVE_COLLAPSE") {
      throw new Error("Expected an observation entropy record.");
    }
    const mismatched: EntropyRecord = {
      context: {
        ...record.context,
        coordinate: { row: 6, col: 0 },
      },
      word: record.word,
    };
    expect(
      replayGame({ ...replay, entropyTranscript: [mismatched] }),
    ).toMatchObject({
      ok: false,
      error: {
        kind: "REPLAY_ACTION_FAILED",
        actionIndex: 0,
        cause: { kind: "ENTROPY_CONTEXT_MISMATCH" },
      },
    });
  });

  it("rejects range failures and unused transcript entries distinctly", () => {
    const replay = observeReplay("replay-range-unused");
    const invalidWord = {
      ...replay.entropyTranscript[0],
      word: UINT32_RANGE,
    };
    expect(
      replayGame({ ...replay, entropyTranscript: [invalidWord] }),
    ).toMatchObject({
      ok: false,
      error: {
        kind: "REPLAY_ACTION_FAILED",
        actionIndex: 0,
        cause: { kind: "ENTROPY_RANGE" },
      },
    });

    const empty = emptySeedReplay("replay-unused");
    const unused: EntropyRecord = {
      context: {
        operation: "OBSERVE_COLLAPSE",
        coordinate: { row: 0, col: 0 },
        pairId: null,
      },
      word: 0,
    };
    expect(replayGame({ ...empty, entropyTranscript: [unused] })).toMatchObject({
      ok: false,
      error: { kind: "REPLAY_UNUSED_ENTROPY", remainingEntries: 1 },
    });
  });

  it.each([
    -1,
    UINT32_RANGE,
    1.5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
  ])("rejects out-of-range words even when the entry is unused: %s", (word) => {
    const replay = emptySeedReplay("replay-unused-invalid-word");
    expect(
      replayGame({
        ...replay,
        entropyTranscript: [
          {
            context: {
              operation: "OBSERVE_COLLAPSE",
              coordinate: { row: 0, col: 0 },
              pairId: null,
            },
            word,
          },
        ],
      }),
    ).toMatchObject({
      ok: false,
      error: { kind: "ENTROPY_RANGE" },
    });
  });

  it("rejects malformed semantic fields in entropy contexts", () => {
    const replay = emptySeedReplay("replay-invalid-context-fields");
    expect(
      replayGame({
        ...replay,
        entropyTranscript: [
          {
            context: {
              operation: "OBSERVE_COLLAPSE",
              coordinate: { row: 1.5, col: 0 },
              pairId: null,
            },
            word: 0,
          },
        ],
      }),
    ).toMatchObject({
      ok: false,
      error: {
        kind: "INVALID_DTO",
        path: "entropyTranscript[0].context.coordinate",
      },
    });
    expect(
      replayGame({
        ...replay,
        entropyTranscript: [
          {
            context: {
              operation: "DECOHERENCE_SELECT",
              turn: 3,
              candidateCount: 1,
            },
            word: 0,
          },
        ],
      }),
    ).toMatchObject({
      ok: false,
      error: {
        kind: "INVALID_DTO",
        path: "entropyTranscript[0].context.turn",
      },
    });
    expect(
      replayGame({
        ...replay,
        entropyTranscript: [
          {
            context: {
              operation: "DECOHERENCE_SELECT",
              turn: 4,
              candidateCount: 0,
            },
            word: 0,
          },
        ],
      }),
    ).toMatchObject({
      ok: false,
      error: {
        kind: "INVALID_DTO",
        path: "entropyTranscript[0].context.candidateCount",
      },
    });
  });

  it("stops at the first failed action and reports its zero-based index", () => {
    const replay = emptySeedReplay("replay-action-failure");
    const actions: readonly Action[] = [
      { kind: "APPLY_GATE", gate: "X", target: { row: 0, col: 0 } },
      { kind: "MOVE", target: { row: 0, col: 6 } },
      { kind: "APPLY_GATE", gate: "H", target: { row: 0, col: 1 } },
    ];

    expect(replayGame({ ...replay, actions })).toMatchObject({
      ok: false,
      error: {
        kind: "REPLAY_ACTION_FAILED",
        actionIndex: 1,
        cause: { kind: "INVALID_ACTION", reason: "NON_ORTHOGONAL_MOVE" },
      },
    });
  });

  it("rejects unsupported versions and non-exclusive initial DTOs", () => {
    const replay = emptySeedReplay("replay-version-errors");
    expect(replayGame({ ...replay, replaySchemaVersion: 2 })).toMatchObject({
      ok: false,
      error: { kind: "UNSUPPORTED_SCHEMA_VERSION", received: 2 },
    });
    expect(replayGame({ ...replay, rulesVersion: 2 })).toMatchObject({
      ok: false,
      error: { kind: "UNSUPPORTED_RULES_VERSION", received: 2 },
    });
    expect(
      replayGame({
        ...replay,
        initial: {
          kind: "SEED",
          seed: "replay-version-errors",
          universe: replay.expectedFinalState,
        },
      }),
    ).toMatchObject({
      ok: false,
      error: { kind: "INVALID_DTO", path: "initial" },
    });
  });

  it("distinguishes final canonical state and exact score mismatches", () => {
    const replay = emptySeedReplay("replay-mismatch");
    expect(
      replayGame({
        ...replay,
        expectedFinalState: dtoOf(generatedState("other-state")),
      }),
    ).toMatchObject({
      ok: false,
      error: { kind: "REPLAY_MISMATCH", field: "FINAL_STATE" },
    });
    expect(
      replayGame({ ...replay, expectedFinalScore: replay.expectedFinalScore + 1 }),
    ).toMatchObject({
      ok: false,
      error: { kind: "REPLAY_MISMATCH", field: "FINAL_SCORE" },
    });
  });

  it("produces byte-identical output for repeated valid replay", () => {
    const replay = observeReplay("replay-byte-identity");
    const first = replayGame(replay);
    const second = replayGame(replay);

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });
});
