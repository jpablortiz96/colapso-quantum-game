import { describe, expect, it } from "vitest";

import { ENTRY_COORDINATE, EXIT_COORDINATE } from "./constants";
import { coordinateKey, orthogonalNeighbors } from "./coordinates";
import { generateInitialState } from "./generation";
import { validateGameState } from "./invariants";
import { calculateScore } from "./score";
import { serializeGameState } from "./serialization";
import { processAction } from "./turn";
import type {
  Coordinate,
  EntropyContext,
  EntropySource,
  GameState,
  Outcome,
  Result,
} from "./types";
import type { EntropyError } from "./errors";

const generatedState = (seed: string): GameState => {
  const result = generateInitialState(seed);
  if (!result.ok) {
    throw new Error(result.error.message);
  }
  return result.value;
};

const bytesOf = (state: GameState): string => {
  const result = serializeGameState(state);
  if (!result.ok) {
    throw new Error(result.error.message);
  }
  return result.value;
};

const trackingEntropy = (): Readonly<{
  source: EntropySource<EntropyError>;
  contexts: EntropyContext[];
}> => {
  const contexts: EntropyContext[] = [];
  return {
    contexts,
    source: {
      nextUint32: (context): Result<number, EntropyError> => {
        contexts.push(context);
        return { ok: true, value: 0 };
      },
    },
  };
};

const adjacentUnpairedFixture = (outcome: Outcome): Readonly<{
  state: GameState;
  target: Coordinate;
}> => {
  const initial = generatedState(`invalid-adjacent-${outcome}`);
  const paired = new Set(
    initial.pairs.flatMap(({ memberA, memberB }) => [
      coordinateKey(memberA),
      coordinateKey(memberB),
    ]),
  );
  const origin = initial.board.find(
    (cell) =>
      cell.kind === "UNRESOLVED" &&
      !paired.has(coordinateKey(cell.coordinate)) &&
      orthogonalNeighbors(cell.coordinate).some((neighbor) => {
        const candidate = initial.board[neighbor.row * 7 + neighbor.col];
        return (
          candidate?.kind === "UNRESOLVED" &&
          !paired.has(coordinateKey(candidate.coordinate))
        );
      }),
  )?.coordinate;
  const target = origin === undefined
    ? undefined
    : orthogonalNeighbors(origin).find((neighbor) => {
        const candidate = initial.board[neighbor.row * 7 + neighbor.col];
        return (
          candidate?.kind === "UNRESOLVED" &&
          !paired.has(coordinateKey(candidate.coordinate))
        );
      });
  if (origin === undefined || target === undefined) {
    throw new Error("Invalid-action fixture requires adjacent unpaired cells.");
  }
  const board = [...initial.board];
  board[origin.row * 7 + origin.col] = Object.freeze({
    kind: "COLLAPSED",
    coordinate: origin,
    outcome: "FLOOR",
  });
  board[target.row * 7 + target.col] = Object.freeze({
    kind: "COLLAPSED",
    coordinate: target,
    outcome,
  });
  const state: GameState = Object.freeze({
    ...initial,
    status: "PLAYING",
    turn: 2,
    player: origin,
    board: Object.freeze(board),
  });
  if (!validateGameState(state).ok) {
    throw new Error("Invalid-action fixture must be valid.");
  }
  return Object.freeze({ state, target });
};

const assertAtomicInvalidAction = (
  state: GameState,
  action: unknown,
  reason: string,
): void => {
  const entropy = trackingEntropy();
  const beforeBytes = bytesOf(state);
  const beforeResources = {
    observations: state.observations,
    energy: state.energy,
    inventory: state.inventory,
    turn: state.turn,
    score: calculateScore(state),
  };

  const result = processAction(state, action, entropy.source);

  expect(result).toMatchObject({
    ok: false,
    state,
    events: [],
    error: { kind: "INVALID_ACTION", reason },
  });
  expect(result.state).toBe(state);
  expect(result.events).toEqual([]);
  expect("entropyDelta" in result).toBe(false);
  expect(entropy.contexts).toEqual([]);
  expect(bytesOf(state)).toBe(beforeBytes);
  expect({
    observations: result.state.observations,
    energy: result.state.energy,
    inventory: result.state.inventory,
    turn: result.state.turn,
    score: calculateScore(result.state),
  }).toEqual(beforeResources);
};

describe("invalid action atomicity categories", () => {
  it.each([
    { action: null, reason: "MALFORMED_ACTION" },
    { action: {}, reason: "MALFORMED_ACTION" },
    {
      action: { kind: "TELEPORT", target: ENTRY_COORDINATE },
      reason: "UNSUPPORTED_ACTION",
    },
    { action: { kind: "MOVE" }, reason: "MALFORMED_ACTION" },
    {
      action: { kind: "MOVE", target: ENTRY_COORDINATE, extra: true },
      reason: "MALFORMED_ACTION",
    },
    {
      action: { kind: "APPLY_GATE", gate: "Z", target: { row: 0, col: 0 } },
      reason: "MALFORMED_ACTION",
    },
  ])("rejects malformed or unsupported payload %#", ({ action, reason }) => {
    assertAtomicInvalidAction(
      generatedState("invalid-payload-categories"),
      action,
      reason,
    );
  });

  it.each([
    null,
    { row: -1, col: 0 },
    { row: 7, col: 0 },
    { row: 1.5, col: 0 },
    { row: -0, col: 0 },
    { row: 0, col: 0, extra: true },
  ])("rejects malformed coordinate %#", (target) => {
    assertAtomicInvalidAction(
      generatedState("invalid-coordinate-categories"),
      { kind: "OBSERVE", target },
      "TARGET_OUT_OF_BOUNDS",
    );
  });

  it("rejects endpoints, collapsed targets, unavailable gates, and no observations", () => {
    const generated = generatedState("invalid-resource-targets");
    assertAtomicInvalidAction(
      generated,
      { kind: "OBSERVE", target: EXIT_COORDINATE },
      "ENDPOINT_PROHIBITED",
    );
    assertAtomicInvalidAction(
      generated,
      { kind: "APPLY_GATE", gate: "X", target: ENTRY_COORDINATE },
      "ENDPOINT_PROHIBITED",
    );

    const collapsed = adjacentUnpairedFixture("FLOOR");
    assertAtomicInvalidAction(
      collapsed.state,
      { kind: "OBSERVE", target: collapsed.target },
      "TARGET_COLLAPSED",
    );

    const noGate: GameState = Object.freeze({
      ...generated,
      status: "PLAYING",
      turn: 1,
      inventory: Object.freeze(["H"] as const),
    });
    const gateTarget = noGate.board.find((cell) => cell.kind === "UNRESOLVED")
      ?.coordinate;
    if (gateTarget === undefined || !validateGameState(noGate).ok) {
      throw new Error("Unavailable-gate fixture must be valid.");
    }
    assertAtomicInvalidAction(
      noGate,
      { kind: "APPLY_GATE", gate: "X", target: gateTarget },
      "GATE_UNAVAILABLE",
    );

    const noObservations: GameState = Object.freeze({
      ...generated,
      status: "PLAYING",
      turn: 1,
      observations: 0,
    });
    const observeTarget = noObservations.board.find(
      (cell) => cell.kind === "UNRESOLVED",
    )?.coordinate;
    if (observeTarget === undefined || !validateGameState(noObservations).ok) {
      throw new Error("No-observations fixture must be valid.");
    }
    assertAtomicInvalidAction(
      noObservations,
      { kind: "OBSERVE", target: observeTarget },
      "NO_OBSERVATIONS",
    );
  });

  it("rejects movement geometry, unresolved cells, and walls before entropy", () => {
    const generated = generatedState("invalid-movement-categories");
    assertAtomicInvalidAction(
      generated,
      { kind: "MOVE", target: EXIT_COORDINATE },
      "NON_ORTHOGONAL_MOVE",
    );
    assertAtomicInvalidAction(
      generated,
      { kind: "MOVE", target: { row: 5, col: 0 } },
      "TARGET_UNRESOLVED",
    );
    const wall = adjacentUnpairedFixture("WALL");
    assertAtomicInvalidAction(
      wall.state,
      { kind: "MOVE", target: wall.target },
      "TARGET_WALL",
    );
  });

  it.each(["VICTORY", "DEFEAT"] as const)(
    "rejects every action against %s before payload validation",
    (status) => {
      const base = generatedState(`invalid-terminal-${status}`);
      const terminal: GameState = Object.freeze({
        ...base,
        status,
        turn: 1,
        player: status === "VICTORY" ? EXIT_COORDINATE : ENTRY_COORDINATE,
        terminalReason:
          status === "VICTORY" ? "EXIT_REACHED" : "INSUFFICIENT_VOID_ENERGY",
        energy: status === "VICTORY" ? 1 : 0,
      });
      if (!validateGameState(terminal).ok) {
        throw new Error("Terminal invalid-action fixture must be valid.");
      }
      assertAtomicInvalidAction(terminal, null, "TERMINAL_STATE");
    },
  );
});
