import { describe, expect, it } from "vitest";

import { collapseUnpairedCell } from "./collapse";
import { UINT32_MAX, UINT32_RANGE } from "./entropy";
import type { EntropyError } from "./errors";
import { generateInitialState } from "./generation";
import { validateGameState } from "./invariants";
import type {
  Coordinate,
  Distribution,
  EntropyContext,
  EntropySource,
  GameState,
  Result,
} from "./types";

const generatedState = (seed: string): GameState => {
  const result = generateInitialState(seed);
  if (!result.ok) {
    throw new Error(result.error.message);
  }
  return result.value;
};

const coordinateKey = ({ row, col }: Coordinate): string => `${row},${col}`;

const playingUnpairedState = (
  distribution: Distribution = [0.5, 0.5, 0, 0, 0],
  observations = 10,
): Readonly<{ state: GameState; target: Coordinate; boardIndex: number }> => {
  const initial = generatedState("collapse-unit-fixture");
  const paired = new Set(
    initial.pairs.flatMap(({ memberA, memberB }) => [
      coordinateKey(memberA),
      coordinateKey(memberB),
    ]),
  );
  const boardIndex = initial.board.findIndex(
    (cell) =>
      cell.kind === "UNRESOLVED" && !paired.has(coordinateKey(cell.coordinate)),
  );
  const originalCell = initial.board[boardIndex];
  if (originalCell?.kind !== "UNRESOLVED") {
    throw new Error("Fixture did not contain an unpaired unresolved cell.");
  }

  const board = [...initial.board];
  board[boardIndex] = Object.freeze({
    kind: "UNRESOLVED",
    coordinate: originalCell.coordinate,
    distribution: Object.freeze([...distribution]) as Distribution,
  });
  const state: GameState = Object.freeze({
    ...initial,
    status: "PLAYING",
    turn: 1,
    observations,
    board: Object.freeze(board),
  });
  if (!validateGameState(state).ok) {
    throw new Error("Collapse fixture must be a valid playing state.");
  }
  return Object.freeze({ state, target: originalCell.coordinate, boardIndex });
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

const exhaustedResult: Result<number, EntropyError> = {
  ok: false,
  error: {
    kind: "ENTROPY_EXHAUSTED",
    message: "Script exhausted.",
  },
};

describe("atomic unpaired collapse", () => {
  it.each([
    { word: 0, outcome: "FLOOR" },
    { word: UINT32_MAX, outcome: "WALL" },
  ] as const)(
    "samples the current distribution with boundary word $word",
    ({ word, outcome }) => {
      const { state, target, boardIndex } = playingUnpairedState();
      const before = JSON.stringify(state);
      const entropy = scriptedSource({ ok: true, value: word });

      const result = collapseUnpairedCell(
        state,
        target,
        "OBSERVATION",
        entropy.source,
      );

      expect(result.ok).toBe(true);
      if (!result.ok) {
        return;
      }
      expect(result.state).not.toBe(state);
      expect(result.state.board).not.toBe(state.board);
      expect(result.state.board[boardIndex]).toEqual({
        kind: "COLLAPSED",
        coordinate: target,
        outcome,
      });
      expect(result.state.observations).toBe(state.observations - 1);
      expect(result.events).toEqual([
        {
          kind: "OBSERVATION_SPENT",
          target,
          remainingObservations: state.observations - 1,
        },
        {
          kind: "CELL_COLLAPSED",
          coordinate: target,
          outcome,
          cause: "OBSERVATION",
          pairId: null,
        },
      ]);
      expect(result.entropyDelta).toEqual([
        {
          context: {
            operation: "OBSERVE_COLLAPSE",
            coordinate: target,
            pairId: null,
          },
          word,
        },
      ]);
      expect(entropy.contexts).toHaveLength(1);
      expect(JSON.stringify(state)).toBe(before);
      expect(validateGameState(result.state).ok).toBe(true);
      expect(Object.isFrozen(result.state)).toBe(true);
      expect(Object.isFrozen(result.state.board)).toBe(true);
      expect(Object.isFrozen(result.events)).toBe(true);
      expect(Object.isFrozen(result.entropyDelta)).toBe(true);
    },
  );

  it("uses decoherence context without spending an observation", () => {
    const fixture = playingUnpairedState([0, 0, 1, 0, 0], 0);
    const state = Object.freeze({ ...fixture.state, turn: 4 });
    const entropy = scriptedSource({ ok: true, value: 123 });

    const result = collapseUnpairedCell(
      state,
      fixture.target,
      "DECOHERENCE",
      entropy.source,
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.state.observations).toBe(0);
      expect(result.events).toEqual([
        {
          kind: "CELL_COLLAPSED",
          coordinate: fixture.target,
          outcome: "VOID",
          cause: "DECOHERENCE",
          pairId: null,
        },
      ]);
      expect(result.entropyDelta[0]?.context).toEqual({
        operation: "DECOHERENCE_COLLAPSE",
        turn: 4,
        coordinate: fixture.target,
        pairId: null,
      });
    }
  });

  it.each([
    {
      name: "an endpoint",
      target: { row: 6, col: 0 },
      reason: "ENDPOINT_PROHIBITED",
    },
    {
      name: "an out-of-bounds coordinate",
      target: { row: -1, col: 0 },
      reason: "TARGET_OUT_OF_BOUNDS",
    },
  ] as const)("rejects $name before entropy", ({ target, reason }) => {
    const { state } = playingUnpairedState();
    const entropy = scriptedSource({ ok: true, value: 0 });

    const result = collapseUnpairedCell(
      state,
      target,
      "OBSERVATION",
      entropy.source,
    );

    expect(result).toMatchObject({
      ok: false,
      state,
      events: [],
      error: { kind: "INVALID_ACTION", reason },
    });
    expect(entropy.contexts).toEqual([]);
  });

  it("rejects an already collapsed target before entropy", () => {
    const fixture = playingUnpairedState();
    const board = [...fixture.state.board];
    board[fixture.boardIndex] = Object.freeze({
      kind: "COLLAPSED",
      coordinate: fixture.target,
      outcome: "WALL",
    });
    const state: GameState = Object.freeze({
      ...fixture.state,
      board: Object.freeze(board),
    });
    const entropy = scriptedSource({ ok: true, value: 0 });

    const result = collapseUnpairedCell(
      state,
      fixture.target,
      "OBSERVATION",
      entropy.source,
    );

    expect(result).toMatchObject({
      ok: false,
      state,
      events: [],
      error: { kind: "INVALID_ACTION", reason: "TARGET_COLLAPSED" },
    });
    expect(entropy.contexts).toEqual([]);
  });

  it("rejects a missing observation before entropy", () => {
    const { state, target } = playingUnpairedState([1, 0, 0, 0, 0], 0);
    const entropy = scriptedSource({ ok: true, value: 0 });

    const result = collapseUnpairedCell(
      state,
      target,
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

  it("rejects paired targets through the unpaired API before entropy", () => {
    const state = Object.freeze({
      ...generatedState("collapse-unit-fixture"),
      status: "PLAYING" as const,
      turn: 1,
    });
    const target = state.pairs[0]?.memberA;
    if (target === undefined) {
      throw new Error("Fixture did not contain a pair.");
    }
    const entropy = scriptedSource({ ok: true, value: 0 });

    const result = collapseUnpairedCell(
      state,
      target,
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

  it.each([
    { name: "exhausted entropy", result: exhaustedResult, kind: "ENTROPY_EXHAUSTED" },
    { name: "out-of-range entropy", result: { ok: true, value: UINT32_RANGE } as const, kind: "ENTROPY_RANGE" },
  ])("rolls back on $name", ({ result: entropyResult, kind }) => {
    const { state, target } = playingUnpairedState();
    const before = JSON.stringify(state);
    const entropy = scriptedSource(entropyResult);

    const result = collapseUnpairedCell(
      state,
      target,
      "OBSERVATION",
      entropy.source,
    );

    expect(result).toMatchObject({
      ok: false,
      state,
      events: [],
      error: { kind },
    });
    expect(result.state).toBe(state);
    expect(entropy.contexts).toHaveLength(1);
    expect(JSON.stringify(state)).toBe(before);
  });

  it("rejects an invalid input invariant before entropy", () => {
    const fixture = playingUnpairedState();
    const board = [...fixture.state.board];
    board[fixture.boardIndex] = {
      kind: "UNRESOLVED",
      coordinate: fixture.target,
      distribution: [0.5, 0.5, 0, 0, Number.NaN],
    };
    const state = { ...fixture.state, board } as GameState;
    const entropy = scriptedSource({ ok: true, value: 0 });

    const result = collapseUnpairedCell(
      state,
      fixture.target,
      "OBSERVATION",
      entropy.source,
    );

    expect(result).toMatchObject({
      ok: false,
      state,
      events: [],
      error: { kind: "INVALID_STATE", reason: "CELL_DISTRIBUTION" },
    });
    expect(entropy.contexts).toEqual([]);
  });

  it("does not expose a partial direct effect when post-state validation fails", () => {
    const state = generatedState("generated-state-rollback");
    const paired = new Set(
      state.pairs.flatMap(({ memberA, memberB }) => [
        coordinateKey(memberA),
        coordinateKey(memberB),
      ]),
    );
    const target = state.board.find(
      (cell) =>
        cell.kind === "UNRESOLVED" &&
        !paired.has(coordinateKey(cell.coordinate)),
    )?.coordinate;
    if (target === undefined) {
      throw new Error("Fixture did not contain an unpaired target.");
    }
    const before = JSON.stringify(state);
    const entropy = scriptedSource({ ok: true, value: 0 });

    const result = collapseUnpairedCell(
      state,
      target,
      "OBSERVATION",
      entropy.source,
    );

    expect(result).toMatchObject({
      ok: false,
      state,
      events: [],
      error: { kind: "INVALID_STATE", reason: "STATUS" },
    });
    expect(result.state).toBe(state);
    expect(entropy.contexts).toHaveLength(1);
    expect(JSON.stringify(state)).toBe(before);
    expect(Object.isFrozen(state)).toBe(true);
  });
});
