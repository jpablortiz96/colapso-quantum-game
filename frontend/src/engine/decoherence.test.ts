import { describe, expect, it } from "vitest";

import { ENTRY_COORDINATE, EXIT_COORDINATE } from "./constants";
import { coordinateKey, coordinatesEqual } from "./coordinates";
import {
  enumerateDecoherenceCandidates,
  isDecoherenceTurn,
  processScheduledDecoherence,
} from "./decoherence";
import {
  UINT32_MAX,
  UINT32_RANGE,
  TranscriptEntropySource,
} from "./entropy";
import type { EntropyError } from "./errors";
import { generateInitialState } from "./generation";
import { validateGameState } from "./invariants";
import type {
  Coordinate,
  EntangledPair,
  EntropyContext,
  EntropySource,
  GameState,
  Result,
} from "./types";

const generatedPlayingState = (seed: string, turn: number): GameState => {
  const generated = generateInitialState(seed);
  if (!generated.ok) {
    throw new Error(generated.error.message);
  }
  const state: GameState = Object.freeze({
    ...generated.value,
    status: "PLAYING",
    turn,
  });
  if (!validateGameState(state).ok) {
    throw new Error("Decoherence fixture must be valid.");
  }
  return state;
};

const queueSource = (
  results: readonly Result<number, EntropyError>[],
): Readonly<{
  source: EntropySource<EntropyError>;
  contexts: EntropyContext[];
}> => {
  let cursor = 0;
  const contexts: EntropyContext[] = [];
  return {
    contexts,
    source: {
      nextUint32: (context) => {
        contexts.push(context);
        const result = results[cursor];
        cursor += 1;
        return result ?? {
          ok: false,
          error: {
            kind: "ENTROPY_EXHAUSTED",
            message: "Script exhausted.",
          },
        };
      },
    },
  };
};

const successfulWords = (...words: number[]) =>
  queueSource(words.map((value) => ({ ok: true as const, value })));

const withOnlyUnresolved = (
  state: GameState,
  coordinates: readonly Coordinate[],
  observations = state.observations,
): GameState => {
  const unresolved = new Set(coordinates.map(coordinateKey));
  const board = state.board.map((cell) => {
    if (
      coordinatesEqual(cell.coordinate, ENTRY_COORDINATE) ||
      coordinatesEqual(cell.coordinate, EXIT_COORDINATE) ||
      unresolved.has(coordinateKey(cell.coordinate))
    ) {
      return cell;
    }
    return Object.freeze({
      kind: "COLLAPSED" as const,
      coordinate: cell.coordinate,
      outcome: "FLOOR" as const,
    });
  });
  const candidate: GameState = Object.freeze({
    ...state,
    observations,
    board: Object.freeze(board),
  });
  if (!validateGameState(candidate).ok) {
    throw new Error("Reduced decoherence fixture must be valid.");
  }
  return candidate;
};

const findUnpairedCoordinate = (state: GameState): Coordinate => {
  const paired = new Set(
    state.pairs.flatMap(({ memberA, memberB }) => [
      coordinateKey(memberA),
      coordinateKey(memberB),
    ]),
  );
  const coordinate = state.board.find(
    (cell) =>
      cell.kind === "UNRESOLVED" &&
      !paired.has(coordinateKey(cell.coordinate)),
  )?.coordinate;
  if (coordinate === undefined) {
    throw new Error("Fixture did not contain an unpaired coordinate.");
  }
  return coordinate;
};

const firstPair = (state: GameState): EntangledPair => {
  const pair = state.pairs[0];
  if (pair === undefined) {
    throw new Error("Fixture did not contain a pair.");
  }
  return pair;
};

const expectAtomicFailure = (result: ReturnType<typeof processScheduledDecoherence>, state: GameState) => {
  expect(result.ok).toBe(false);
  expect(result.state).toBe(state);
  expect(result.events).toEqual([]);
  expect("entropyDelta" in result).toBe(false);
};

describe("scheduled decoherence", () => {
  it("schedules only positive turns divisible by four", () => {
    for (const turn of [0, 1, 2, 3, 5, 6, 7, 9, 10, 11]) {
      expect(isDecoherenceTurn(turn)).toBe(false);
    }
    for (const turn of [4, 8, 12, 40]) {
      expect(isDecoherenceTurn(turn)).toBe(true);
    }
  });

  it("enumerates every unresolved non-endpoint cell in row-major order", () => {
    const initial = generatedPlayingState("decoherence-row-major", 4);
    const pair = firstPair(initial);
    const retained = [pair.memberA, pair.memberB, findUnpairedCoordinate(initial)];
    const state = withOnlyUnresolved(initial, retained);

    const candidates = enumerateDecoherenceCandidates(state);

    expect(candidates).toEqual(
      state.board
        .filter((cell) => cell.kind === "UNRESOLVED")
        .map((cell) => cell.coordinate),
    );
    expect(candidates).toHaveLength(3);
    expect(candidates).not.toContainEqual(ENTRY_COORDINATE);
    expect(candidates).not.toContainEqual(EXIT_COORDINATE);
    expect(candidates).toContainEqual(pair.memberA);
    expect(candidates).toContainEqual(pair.memberB);
  });

  it("does nothing and consumes no entropy on unscheduled turns", () => {
    for (const turn of [1, 2, 3, 5, 6, 7, 9]) {
      const state = generatedPlayingState(`decoherence-unscheduled-${turn}`, turn);
      const entropy = successfulWords(0, 0);

      const result = processScheduledDecoherence(state, entropy.source);

      expect(result).toEqual({
        ok: true,
        state,
        events: [],
        entropyDelta: [],
      });
      expect(result.state).toBe(state);
      expect(entropy.contexts).toEqual([]);
    }
  });

  it("does nothing and consumes no entropy when a scheduled turn has no candidates", () => {
    const state = withOnlyUnresolved(
      generatedPlayingState("decoherence-empty", 4),
      [],
    );
    const entropy = successfulWords(0, 0);

    const result = processScheduledDecoherence(state, entropy.source);

    expect(result).toEqual({
      ok: true,
      state,
      events: [],
      entropyDelta: [],
    });
    expect(result.state).toBe(state);
    expect(entropy.contexts).toEqual([]);
  });

  it("selects and collapses one unpaired candidate without charging an observation", () => {
    const initial = generatedPlayingState("decoherence-unpaired", 4);
    const target = findUnpairedCoordinate(initial);
    const state = withOnlyUnresolved(initial, [target], 6);
    const entropy = successfulWords(0, UINT32_MAX);

    const result = processScheduledDecoherence(state, entropy.source);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.state.observations).toBe(6);
    expect(result.state.board[target.row * 7 + target.col]?.kind).toBe(
      "COLLAPSED",
    );
    expect(result.events).toEqual([
      {
        kind: "DECOHERENCE_SELECTED",
        turn: 4,
        coordinate: target,
        pairId: null,
      },
      expect.objectContaining({
        kind: "CELL_COLLAPSED",
        coordinate: target,
        cause: "DECOHERENCE",
        pairId: null,
      }),
    ]);
    expect(result.entropyDelta).toEqual([
      {
        context: {
          operation: "DECOHERENCE_SELECT",
          turn: 4,
          candidateCount: 1,
        },
        word: 0,
      },
      {
        context: {
          operation: "DECOHERENCE_COLLAPSE",
          turn: 4,
          coordinate: target,
          pairId: null,
        },
        word: UINT32_MAX,
      },
    ]);
    expect(JSON.stringify(state)).toBe(JSON.stringify(withOnlyUnresolved(initial, [target], 6)));
  });

  it("treats pair members as individual candidates and resolves canonical A/B for free", () => {
    const initial = generatedPlayingState("decoherence-pair", 8);
    const pair = firstPair(initial);
    const state = withOnlyUnresolved(initial, [pair.memberA, pair.memberB], 3);
    const entropy = successfulWords(1, 0);

    const result = processScheduledDecoherence(state, entropy.source);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.state.observations).toBe(3);
    expect(result.events).toEqual([
      {
        kind: "DECOHERENCE_SELECTED",
        turn: 8,
        coordinate: pair.memberB,
        pairId: pair.id,
      },
      expect.objectContaining({
        kind: "CELL_COLLAPSED",
        coordinate: pair.memberA,
        cause: "DECOHERENCE",
        pairId: pair.id,
      }),
      expect.objectContaining({
        kind: "CELL_COLLAPSED",
        coordinate: pair.memberB,
        cause: "DECOHERENCE",
        pairId: pair.id,
      }),
    ]);
    expect(result.entropyDelta).toEqual([
      {
        context: {
          operation: "DECOHERENCE_SELECT",
          turn: 8,
          candidateCount: 2,
        },
        word: 1,
      },
      {
        context: {
          operation: "DECOHERENCE_COLLAPSE",
          turn: 8,
          coordinate: pair.memberA,
          pairId: pair.id,
        },
        word: 0,
      },
    ]);
  });

  it("records every rejected selection word before the accepted word and collapse", () => {
    const state = generatedPlayingState("decoherence-retry", 4);
    const candidates = enumerateDecoherenceCandidates(state);
    const entropy = successfulWords(UINT32_MAX, 46, 0);

    const result = processScheduledDecoherence(state, entropy.source);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(candidates).toHaveLength(47);
    expect(result.events[0]).toMatchObject({
      kind: "DECOHERENCE_SELECTED",
      coordinate: candidates[46],
    });
    expect(result.entropyDelta.map(({ word }) => word)).toEqual([
      UINT32_MAX,
      46,
      0,
    ]);
    expect(result.entropyDelta.map(({ context }) => context.operation)).toEqual([
      "DECOHERENCE_SELECT",
      "DECOHERENCE_SELECT",
      "DECOHERENCE_COLLAPSE",
    ]);
    expect(entropy.contexts.slice(0, 2)).toEqual([
      {
        operation: "DECOHERENCE_SELECT",
        turn: 4,
        candidateCount: 47,
      },
      {
        operation: "DECOHERENCE_SELECT",
        turn: 4,
        candidateCount: 47,
      },
    ]);
  });

  it.each([
    {
      name: "selection exhaustion",
      words: [] as const,
      errorKind: "ENTROPY_EXHAUSTED",
      requests: 1,
    },
    {
      name: "selection range failure",
      words: [UINT32_RANGE] as const,
      errorKind: "ENTROPY_RANGE",
      requests: 1,
    },
    {
      name: "collapse exhaustion",
      words: [0] as const,
      errorKind: "ENTROPY_EXHAUSTED",
      requests: 2,
    },
    {
      name: "collapse range failure",
      words: [0, UINT32_RANGE] as const,
      errorKind: "ENTROPY_RANGE",
      requests: 2,
    },
  ])("rolls back atomically on $name", ({ words, errorKind, requests }) => {
    const initial = generatedPlayingState(`decoherence-failure-${name}`, 4);
    const target = findUnpairedCoordinate(initial);
    const state = withOnlyUnresolved(initial, [target]);
    const before = JSON.stringify(state);
    const entropy = successfulWords(...words);

    const result = processScheduledDecoherence(state, entropy.source);

    expectAtomicFailure(result, state);
    expect(result).toMatchObject({ error: { kind: errorKind } });
    expect(entropy.contexts).toHaveLength(requests);
    expect(JSON.stringify(state)).toBe(before);
  });

  it("rolls back selection and collapse context mismatches without exposing entropy", () => {
    const initial = generatedPlayingState("decoherence-context-failure", 4);
    const target = findUnpairedCoordinate(initial);
    const state = withOnlyUnresolved(initial, [target]);
    const selectionMismatch = new TranscriptEntropySource([
      {
        context: {
          operation: "DECOHERENCE_SELECT",
          turn: 4,
          candidateCount: 2,
        },
        word: 0,
      },
    ]);

    const selectionResult = processScheduledDecoherence(
      state,
      selectionMismatch,
    );

    expectAtomicFailure(selectionResult, state);
    expect(selectionResult).toMatchObject({
      error: { kind: "ENTROPY_CONTEXT_MISMATCH" },
    });
    expect(selectionMismatch.consumedEntries).toBe(0);

    const collapseMismatch = new TranscriptEntropySource([
      {
        context: {
          operation: "DECOHERENCE_SELECT",
          turn: 4,
          candidateCount: 1,
        },
        word: 0,
      },
      {
        context: {
          operation: "DECOHERENCE_COLLAPSE",
          turn: 4,
          coordinate: { row: target.row, col: (target.col + 1) % 7 },
          pairId: null,
        },
        word: 0,
      },
    ]);

    const collapseResult = processScheduledDecoherence(state, collapseMismatch);

    expectAtomicFailure(collapseResult, state);
    expect(collapseResult).toMatchObject({
      error: { kind: "ENTROPY_CONTEXT_MISMATCH" },
    });
    expect(collapseMismatch.consumedEntries).toBe(1);
  });
});
