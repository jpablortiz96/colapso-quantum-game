import { describe, expect, it } from "vitest";

import { UINT32_MAX, UINT32_RANGE } from "./entropy";
import {
  collapseEntangledPair,
  findEntangledPair,
} from "./entanglement";
import type { EntropyError } from "./errors";
import { generateInitialState } from "./generation";
import { validateGameState } from "./invariants";
import type {
  Coordinate,
  Distribution,
  EntangledPair,
  EntropyContext,
  EntropySource,
  GameState,
  PairPolicy,
  Result,
} from "./types";

const generatedState = (seed: string): GameState => {
  const result = generateInitialState(seed);
  if (!result.ok) {
    throw new Error(result.error.message);
  }
  return result.value;
};

const boardIndex = ({ row, col }: Coordinate): number => row * 7 + col;

const playingPairState = (
  policy: PairPolicy,
  memberADistribution: Distribution = [0.5, 0.5, 0, 0, 0],
  memberBDistribution: Distribution = [0, 0, 0.25, 0.75, 0],
  observations = 10,
  turn = 1,
): Readonly<{ state: GameState; pair: EntangledPair }> => {
  const initial = generatedState("milestone-2-vector");
  const originalPair = initial.pairs[0];
  if (originalPair === undefined) {
    throw new Error("Fixture did not contain a pair.");
  }
  const pair = Object.freeze({ ...originalPair, policy });
  const pairs = [pair, ...initial.pairs.slice(1)];
  const memberAIndex = boardIndex(pair.memberA);
  const memberBIndex = boardIndex(pair.memberB);
  const memberA = initial.board[memberAIndex];
  const memberB = initial.board[memberBIndex];
  if (memberA?.kind !== "UNRESOLVED" || memberB?.kind !== "UNRESOLVED") {
    throw new Error("Fixture pair was not unresolved.");
  }
  const board = [...initial.board];
  board[memberAIndex] = Object.freeze({
    kind: "UNRESOLVED",
    coordinate: memberA.coordinate,
    distribution: Object.freeze([...memberADistribution]) as Distribution,
  });
  board[memberBIndex] = Object.freeze({
    kind: "UNRESOLVED",
    coordinate: memberB.coordinate,
    distribution: Object.freeze([...memberBDistribution]) as Distribution,
  });
  const state: GameState = Object.freeze({
    ...initial,
    status: "PLAYING",
    turn,
    observations,
    board: Object.freeze(board),
    pairs: Object.freeze(pairs),
  });
  if (!validateGameState(state).ok) {
    throw new Error("Pair fixture must be a valid playing state.");
  }
  return Object.freeze({ state, pair });
};

const scriptedSource = (result: Result<number, EntropyError>) => {
  const contexts: EntropyContext[] = [];
  const source: EntropySource<EntropyError> = {
    nextUint32: (context) => {
      contexts.push(context);
      return result;
    },
  };
  return { source, contexts };
};

const collapseEvents = (events: readonly { kind: string }[]) =>
  events.filter(({ kind }) => kind === "CELL_COLLAPSED");

describe("canonical entangled pair resolution", () => {
  it.each([
    {
      word: 0,
      expectedA: "FLOOR",
      expectedB: "VOID",
    },
    {
      word: UINT32_MAX,
      expectedA: "WALL",
      expectedB: "CRYSTAL",
    },
  ] as const)(
    "uses one correlated quantile for both members at word $word",
    ({ word, expectedA, expectedB }) => {
      const { state, pair } = playingPairState("CORRELATED");
      const before = JSON.stringify(state);
      const entropy = scriptedSource({ ok: true, value: word });

      const result = collapseEntangledPair(
        state,
        pair.memberB,
        "OBSERVATION",
        entropy.source,
      );

      expect(result.ok).toBe(true);
      if (!result.ok) {
        return;
      }
      expect(result.state.board[boardIndex(pair.memberA)]).toMatchObject({
        kind: "COLLAPSED",
        outcome: expectedA,
      });
      expect(result.state.board[boardIndex(pair.memberB)]).toMatchObject({
        kind: "COLLAPSED",
        outcome: expectedB,
      });
      expect(result.state.observations).toBe(state.observations - 1);
      expect(entropy.contexts).toHaveLength(1);
      expect(result.entropyDelta).toEqual([
        {
          context: {
            operation: "OBSERVE_COLLAPSE",
            coordinate: pair.memberA,
            pairId: pair.id,
          },
          word,
        },
      ]);
      expect(result.events).toEqual([
        {
          kind: "OBSERVATION_SPENT",
          target: pair.memberA,
          remainingObservations: state.observations - 1,
        },
        {
          kind: "CELL_COLLAPSED",
          coordinate: pair.memberA,
          outcome: expectedA,
          cause: "OBSERVATION",
          pairId: pair.id,
        },
        {
          kind: "CELL_COLLAPSED",
          coordinate: pair.memberB,
          outcome: expectedB,
          cause: "OBSERVATION",
          pairId: pair.id,
        },
      ]);
      expect(JSON.stringify(state)).toBe(before);
      expect(validateGameState(result.state).ok).toBe(true);
    },
  );

  it.each([
    {
      word: 0,
      expectedA: "FLOOR",
      expectedB: "CRYSTAL",
    },
    {
      word: UINT32_MAX,
      expectedA: "WALL",
      expectedB: "VOID",
    },
  ] as const)(
    "uses A quantile and B complementary quantile at word $word",
    ({ word, expectedA, expectedB }) => {
      const { state, pair } = playingPairState("ANTI_CORRELATED");
      const entropy = scriptedSource({ ok: true, value: word });

      const result = collapseEntangledPair(
        state,
        pair.memberA,
        "OBSERVATION",
        entropy.source,
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.state.board[boardIndex(pair.memberA)]).toMatchObject({
          kind: "COLLAPSED",
          outcome: expectedA,
        });
        expect(result.state.board[boardIndex(pair.memberB)]).toMatchObject({
          kind: "COLLAPSED",
          outcome: expectedB,
        });
        expect(collapseEvents(result.events).map((event) => event)).toEqual([
          {
            kind: "CELL_COLLAPSED",
            coordinate: pair.memberA,
            outcome: expectedA,
            cause: "OBSERVATION",
            pairId: pair.id,
          },
          {
            kind: "CELL_COLLAPSED",
            coordinate: pair.memberB,
            outcome: expectedB,
            cause: "OBSERVATION",
            pairId: pair.id,
          },
        ]);
      }
      expect(entropy.contexts).toHaveLength(1);
    },
  );

  it("resolves canonical outcomes identically through member A or B", () => {
    const { state, pair } = playingPairState(
      "ANTI_CORRELATED",
      [0.1, 0.2, 0.3, 0.15, 0.25],
      [0.3, 0.1, 0.2, 0.25, 0.15],
    );
    const sourceA = scriptedSource({ ok: true, value: 0x9345_7812 });
    const sourceB = scriptedSource({ ok: true, value: 0x9345_7812 });

    const throughA = collapseEntangledPair(
      state,
      pair.memberA,
      "OBSERVATION",
      sourceA.source,
    );
    const throughB = collapseEntangledPair(
      state,
      pair.memberB,
      "OBSERVATION",
      sourceB.source,
    );

    expect(throughA.ok).toBe(true);
    expect(throughB.ok).toBe(true);
    if (throughA.ok && throughB.ok) {
      expect(throughB.state).toEqual(throughA.state);
      expect(throughB.events).toEqual(throughA.events);
      expect(throughB.entropyDelta).toEqual(throughA.entropyDelta);
      expect(throughA.state.observations).toBe(state.observations - 1);
      expect(throughB.state.observations).toBe(state.observations - 1);
    }
    expect(sourceA.contexts).toHaveLength(1);
    expect(sourceB.contexts).toHaveLength(1);
    expect(findEntangledPair(state, pair.memberA)).toBe(pair);
    expect(findEntangledPair(state, pair.memberB)).toBe(pair);
  });

  it("resolves a pair for decoherence without spending observations", () => {
    const { state, pair } = playingPairState(
      "CORRELATED",
      [1, 0, 0, 0, 0],
      [0, 1, 0, 0, 0],
      0,
      4,
    );
    const entropy = scriptedSource({ ok: true, value: 99 });

    const result = collapseEntangledPair(
      state,
      pair.memberB,
      "DECOHERENCE",
      entropy.source,
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.state.observations).toBe(0);
      expect(result.events).toHaveLength(2);
      expect(result.events.every(({ kind }) => kind === "CELL_COLLAPSED")).toBe(
        true,
      );
      expect(result.entropyDelta[0]?.context).toEqual({
        operation: "DECOHERENCE_COLLAPSE",
        turn: 4,
        coordinate: pair.memberA,
        pairId: pair.id,
      });
    }
    expect(entropy.contexts).toHaveLength(1);
  });

  it("rejects a missing pair lookup before entropy", () => {
    const initial = generatedState("milestone-2-vector");
    const removedPair = initial.pairs[0];
    if (removedPair === undefined) {
      throw new Error("Fixture did not contain a pair.");
    }
    const state: GameState = Object.freeze({
      ...initial,
      status: "PLAYING",
      turn: 1,
      pairs: Object.freeze(initial.pairs.slice(1)),
    });
    expect(validateGameState(state).ok).toBe(true);
    const entropy = scriptedSource({ ok: true, value: 0 });

    const result = collapseEntangledPair(
      state,
      removedPair.memberA,
      "OBSERVATION",
      entropy.source,
    );

    expect(result).toMatchObject({
      ok: false,
      state,
      events: [],
      error: { kind: "INVALID_STATE", reason: "PAIR_MEMBER" },
    });
    expect(entropy.contexts).toEqual([]);
  });

  it("rejects inconsistent pair resolution state before entropy", () => {
    const fixture = playingPairState("CORRELATED");
    const board = [...fixture.state.board];
    board[boardIndex(fixture.pair.memberA)] = Object.freeze({
      kind: "COLLAPSED",
      coordinate: fixture.pair.memberA,
      outcome: "FLOOR",
    });
    const state = { ...fixture.state, board } as GameState;
    const entropy = scriptedSource({ ok: true, value: 0 });

    const result = collapseEntangledPair(
      state,
      fixture.pair.memberB,
      "OBSERVATION",
      entropy.source,
    );

    expect(result).toMatchObject({
      ok: false,
      state,
      events: [],
      error: { kind: "INVALID_STATE", reason: "PAIR_RESOLUTION" },
    });
    expect(entropy.contexts).toEqual([]);
  });

  it("rejects an already collapsed pair once with no entropy or events", () => {
    const fixture = playingPairState("CORRELATED");
    const board = [...fixture.state.board];
    board[boardIndex(fixture.pair.memberA)] = Object.freeze({
      kind: "COLLAPSED",
      coordinate: fixture.pair.memberA,
      outcome: "FLOOR",
    });
    board[boardIndex(fixture.pair.memberB)] = Object.freeze({
      kind: "COLLAPSED",
      coordinate: fixture.pair.memberB,
      outcome: "WALL",
    });
    const state: GameState = Object.freeze({
      ...fixture.state,
      board: Object.freeze(board),
    });
    expect(validateGameState(state).ok).toBe(true);
    const entropy = scriptedSource({ ok: true, value: 0 });

    const result = collapseEntangledPair(
      state,
      fixture.pair.memberB,
      "OBSERVATION",
      entropy.source,
    );

    expect(result).toMatchObject({
      ok: false,
      state,
      events: [],
      error: { kind: "INVALID_ACTION", reason: "TARGET_COLLAPSED" },
    });
    expect(result.state).toBe(state);
    expect(entropy.contexts).toEqual([]);
  });

  it("rejects a missing observation before requesting the shared word", () => {
    const { state, pair } = playingPairState("CORRELATED", undefined, undefined, 0);
    const entropy = scriptedSource({ ok: true, value: 0 });

    const result = collapseEntangledPair(
      state,
      pair.memberA,
      "OBSERVATION",
      entropy.source,
    );

    expect(result).toMatchObject({
      ok: false,
      state,
      events: [],
      error: { kind: "INVALID_ACTION", reason: "NO_OBSERVATIONS" },
    });
    expect(entropy.contexts).toEqual([]);
  });

  it.each([
    {
      name: "entropy exhaustion",
      entropyResult: {
        ok: false,
        error: { kind: "ENTROPY_EXHAUSTED", message: "Script exhausted." },
      } as const,
      errorKind: "ENTROPY_EXHAUSTED",
    },
    {
      name: "an out-of-range word",
      entropyResult: { ok: true, value: UINT32_RANGE } as const,
      errorKind: "ENTROPY_RANGE",
    },
  ])("rolls back both members on $name", ({ entropyResult, errorKind }) => {
    const { state, pair } = playingPairState("ANTI_CORRELATED");
    const before = JSON.stringify(state);
    const entropy = scriptedSource(entropyResult);

    const result = collapseEntangledPair(
      state,
      pair.memberA,
      "OBSERVATION",
      entropy.source,
    );

    expect(result).toMatchObject({
      ok: false,
      state,
      events: [],
      error: { kind: errorKind },
    });
    expect(result.state).toBe(state);
    expect(entropy.contexts).toHaveLength(1);
    expect(JSON.stringify(state)).toBe(before);
  });
});
