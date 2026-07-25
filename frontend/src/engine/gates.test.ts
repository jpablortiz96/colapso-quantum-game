import { describe, expect, it } from "vitest";

import {
  ENTRY_COORDINATE,
  EXIT_COORDINATE,
} from "./constants";
import {
  applyGate,
  applyHGate,
  applyXGate,
} from "./gates";
import { generateInitialState } from "./generation";
import { validateDistribution } from "./distribution";
import { validateGameState } from "./invariants";
import type {
  ApplyGateAction,
  Coordinate,
  Distribution,
  GameState,
  GateKind,
} from "./types";

const generatedState = (seed: string): GameState => {
  const result = generateInitialState(seed);
  if (!result.ok) {
    throw new Error(result.error.message);
  }
  return result.value;
};

const coordinateKey = ({ row, col }: Coordinate): string => `${row},${col}`;

const playingGateState = (
  distribution: Distribution = [0.7, 0, 0.3, 0, 0],
  inventory: readonly GateKind[] = ["X", "H"],
): Readonly<{ state: GameState; target: Coordinate; boardIndex: number }> => {
  const initial = generatedState("gate-unit-fixture");
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
  const targetCell = initial.board[boardIndex];
  if (targetCell?.kind !== "UNRESOLVED") {
    throw new Error("Gate fixture did not contain an unpaired unresolved cell.");
  }

  const board = [...initial.board];
  board[boardIndex] = Object.freeze({
    kind: "UNRESOLVED",
    coordinate: targetCell.coordinate,
    distribution: Object.freeze([...distribution]) as Distribution,
  });
  const state: GameState = Object.freeze({
    ...initial,
    status: "PLAYING",
    turn: 1,
    board: Object.freeze(board),
    inventory: Object.freeze([...inventory]),
  });
  if (!validateGameState(state).ok) {
    throw new Error("Gate fixture must be a valid playing state.");
  }

  return Object.freeze({
    state,
    target: targetCell.coordinate,
    boardIndex,
  });
};

const gateAction = (
  gate: GateKind,
  target: Coordinate,
): ApplyGateAction => Object.freeze({ kind: "APPLY_GATE", gate, target });

describe("gate probability transforms", () => {
  it("reverses sparse binary support without activating other outcomes", () => {
    const transformed = applyXGate([0, 0.7, 0, 0, 0.3]);

    expect(transformed).toEqual([0, 0.3, 0, 0, 0.7]);
    expect(Object.isFrozen(transformed)).toBe(true);
  });

  it("reverses all active values of a dense multistate distribution", () => {
    expect(applyXGate([0.1, 0.2, 0.3, 0.15, 0.25])).toEqual([
      0.25, 0.15, 0.3, 0.2, 0.1,
    ]);
  });

  it("restores every stored component when X is applied twice", () => {
    const distribution: Distribution = [0.1, 0, 0.2, 0.3, 0.4];

    expect(applyXGate(applyXGate(distribution))).toEqual(distribution);
  });

  it("equalizes binary support to exactly one half each", () => {
    expect(applyHGate([0.7, 0, 0, 0.3, 0])).toEqual([
      0.5, 0, 0, 0.5, 0,
    ]);
  });

  it("equalizes multistate participants with the remainder on the last", () => {
    const transformed = applyHGate([0.1, 0, 0.2, 0, 0.7]);

    expect(transformed).toEqual([
      1 / 3,
      0,
      1 / 3,
      0,
      1 - (1 / 3 + 1 / 3),
    ]);
    expect(transformed.reduce((sum, probability) => sum + probability, 0)).toBe(1);
    expect(validateDistribution(transformed).ok).toBe(true);
  });

  it("uses strict p > 1e-12 participation and zeros threshold residue", () => {
    const transformed = applyHGate([
      1e-12,
      2e-12,
      0,
      0,
      1 - 3e-12,
    ]);

    expect(transformed).toEqual([0, 0.5, 0, 0, 0.5]);
  });
});

describe("direct gate application", () => {
  it("applies X, consumes only the matching gate, and emits one canonical event", () => {
    const fixture = playingGateState();
    const action = gateAction("X", fixture.target);
    const stateBefore = JSON.stringify(fixture.state);
    const actionBefore = JSON.stringify(action);
    const originalCell = fixture.state.board[fixture.boardIndex];

    const result = applyGate(fixture.state, action);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    const transformedCell = result.state.board[fixture.boardIndex];
    expect(transformedCell).toEqual({
      kind: "UNRESOLVED",
      coordinate: fixture.target,
      distribution: [0.3, 0, 0.7, 0, 0],
    });
    expect(result.state.inventory).toEqual(["H"]);
    expect(result.state).toMatchObject({
      status: fixture.state.status,
      terminalReason: fixture.state.terminalReason,
      turn: fixture.state.turn,
      player: fixture.state.player,
      observations: fixture.state.observations,
      energy: fixture.state.energy,
    });
    expect(result.state.pairs).toBe(fixture.state.pairs);
    expect(result.state.collectedCrystals).toBe(fixture.state.collectedCrystals);
    expect(result.state.collectedBatteries).toBe(fixture.state.collectedBatteries);
    expect(result.entropyDelta).toEqual([]);
    expect(result.events).toEqual([
      {
        kind: "GATE_APPLIED",
        gate: "X",
        target: fixture.target,
        distributionBefore: [0.7, 0, 0.3, 0, 0],
        distributionAfter: [0.3, 0, 0.7, 0, 0],
        remainingInventory: ["H"],
      },
    ]);
    expect(result.events[0]?.kind).toBe("GATE_APPLIED");
    if (result.events[0]?.kind === "GATE_APPLIED") {
      expect(result.events[0].distributionBefore).toBe(
        originalCell?.kind === "UNRESOLVED"
          ? originalCell.distribution
          : undefined,
      );
      expect(result.events[0].distributionAfter).toBe(
        transformedCell?.kind === "UNRESOLVED"
          ? transformedCell.distribution
          : undefined,
      );
      expect(result.events[0].remainingInventory).toBe(result.state.inventory);
    }
    expect(validateGameState(result.state).ok).toBe(true);
    expect(JSON.stringify(fixture.state)).toBe(stateBefore);
    expect(JSON.stringify(action)).toBe(actionBefore);
    expect(Object.isFrozen(result.state)).toBe(true);
    expect(Object.isFrozen(result.state.board)).toBe(true);
    expect(Object.isFrozen(result.state.inventory)).toBe(true);
    expect(Object.isFrozen(result.events)).toBe(true);
    expect(Object.isFrozen(result.entropyDelta)).toBe(true);
  });

  it("removes H from [X, H] while preserving stable order", () => {
    const fixture = playingGateState([0.1, 0.2, 0.3, 0, 0.4]);

    const result = applyGate(fixture.state, gateAction("H", fixture.target));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.state.inventory).toEqual(["X"]);
      expect(result.state.board[fixture.boardIndex]).toMatchObject({
        distribution: [0.25, 0.25, 0.25, 0, 0.25],
      });
    }
  });

  it("allows X followed by H on the same unresolved cell", () => {
    const fixture = playingGateState([0.7, 0, 0.2, 0.1, 0]);

    const xResult = applyGate(
      fixture.state,
      gateAction("X", fixture.target),
    );
    expect(xResult.ok).toBe(true);
    if (!xResult.ok) {
      return;
    }
    expect(xResult.state.board[fixture.boardIndex]).toMatchObject({
      distribution: [0.1, 0, 0.2, 0.7, 0],
    });

    const hResult = applyGate(
      xResult.state,
      gateAction("H", fixture.target),
    );
    expect(hResult.ok).toBe(true);
    if (hResult.ok) {
      expect(hResult.state.board[fixture.boardIndex]).toMatchObject({
        distribution: [1 / 3, 0, 1 / 3, 1 - (1 / 3 + 1 / 3), 0],
      });
      expect(hResult.state.inventory).toEqual([]);
      expect(hResult.state.turn).toBe(fixture.state.turn);
      expect(hResult.state.observations).toBe(fixture.state.observations);
      expect(hResult.state.energy).toBe(fixture.state.energy);
      expect(hResult.entropyDelta).toEqual([]);
    }
  });

  it("copies only the board, target cell, distribution, and inventory", () => {
    const fixture = playingGateState();

    const result = applyGate(fixture.state, gateAction("X", fixture.target));

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.state).not.toBe(fixture.state);
    expect(result.state.board).not.toBe(fixture.state.board);
    expect(result.state.inventory).not.toBe(fixture.state.inventory);
    fixture.state.board.forEach((cell, index) => {
      if (index === fixture.boardIndex) {
        expect(result.state.board[index]).not.toBe(cell);
      } else {
        expect(result.state.board[index]).toBe(cell);
      }
    });
    expect(result.state.player).toBe(fixture.state.player);
    expect(result.state.pairs).toBe(fixture.state.pairs);
    expect(result.state.collectedCrystals).toBe(fixture.state.collectedCrystals);
    expect(result.state.collectedBatteries).toBe(fixture.state.collectedBatteries);
  });

  it.each([
    { name: "null", target: null },
    { name: "an extra coordinate field", target: { row: 0, col: 0, extra: true } },
    { name: "negative zero", target: { row: -0, col: 0 } },
    { name: "a fractional row", target: { row: 0.5, col: 0 } },
    { name: "an out-of-bounds row", target: { row: 7, col: 0 } },
  ])("rejects malformed target $name atomically", ({ target }) => {
    const fixture = playingGateState();
    const action = {
      kind: "APPLY_GATE",
      gate: "X",
      target,
    } as unknown as ApplyGateAction;

    const result = applyGate(fixture.state, action);

    expect(result).toMatchObject({
      ok: false,
      state: fixture.state,
      events: [],
      error: { kind: "INVALID_ACTION", reason: "TARGET_OUT_OF_BOUNDS" },
    });
    expect(result.state).toBe(fixture.state);
  });

  it.each([ENTRY_COORDINATE, EXIT_COORDINATE])(
    "rejects endpoint $row,$col before inventory consumption",
    (target) => {
      const fixture = playingGateState();

      const result = applyGate(fixture.state, gateAction("X", target));

      expect(result).toMatchObject({
        ok: false,
        state: fixture.state,
        events: [],
        error: { kind: "INVALID_ACTION", reason: "ENDPOINT_PROHIBITED" },
      });
      expect(result.state).toBe(fixture.state);
    },
  );

  it("rejects a collapsed non-endpoint target", () => {
    const fixture = playingGateState();
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
    expect(validateGameState(state).ok).toBe(true);

    const result = applyGate(state, gateAction("X", fixture.target));

    expect(result).toMatchObject({
      ok: false,
      state,
      events: [],
      error: { kind: "INVALID_ACTION", reason: "TARGET_COLLAPSED" },
    });
    expect(result.state).toBe(state);
  });

  it("rejects a missing matching gate without changing any resource", () => {
    const fixture = playingGateState([0.7, 0, 0.3, 0, 0], ["H"]);
    const before = JSON.stringify(fixture.state);

    const result = applyGate(
      fixture.state,
      gateAction("X", fixture.target),
    );

    expect(result).toMatchObject({
      ok: false,
      state: fixture.state,
      events: [],
      error: { kind: "INVALID_ACTION", reason: "GATE_UNAVAILABLE" },
    });
    expect(result.state).toBe(fixture.state);
    expect(JSON.stringify(fixture.state)).toBe(before);
  });

  it("rejects terminal states before examining the target", () => {
    const fixture = playingGateState();
    const state: GameState = Object.freeze({
      ...fixture.state,
      status: "VICTORY",
      terminalReason: "EXIT_REACHED",
      turn: 2,
      player: EXIT_COORDINATE,
    });
    expect(validateGameState(state).ok).toBe(true);

    const result = applyGate(
      state,
      gateAction("X", { row: 99, col: 99 }),
    );

    expect(result).toMatchObject({
      ok: false,
      state,
      events: [],
      error: { kind: "INVALID_ACTION", reason: "TERMINAL_STATE" },
    });
    expect(result.state).toBe(state);
  });

  it("rejects malformed actions without mutation", () => {
    const fixture = playingGateState();
    const action = {
      kind: "APPLY_GATE",
      gate: "Z",
      target: fixture.target,
    } as unknown as ApplyGateAction;

    const result = applyGate(fixture.state, action);

    expect(result).toMatchObject({
      ok: false,
      state: fixture.state,
      events: [],
      error: { kind: "INVALID_ACTION", reason: "MALFORMED_ACTION" },
    });
  });

  it("rejects unsupported action kinds without mutation", () => {
    const fixture = playingGateState();
    const action = {
      kind: "MOVE",
      gate: "X",
      target: fixture.target,
    };

    const result = applyGate(fixture.state, action);

    expect(result).toMatchObject({
      ok: false,
      state: fixture.state,
      events: [],
      error: { kind: "INVALID_ACTION", reason: "UNSUPPORTED_ACTION" },
    });
    expect(result.state).toBe(fixture.state);
  });

  it("validates the complete input state before action conditions", () => {
    const fixture = playingGateState();
    const state = {
      ...fixture.state,
      observations: 14,
    } as GameState;

    const result = applyGate(
      state,
      gateAction("X", { row: 99, col: 99 }),
    );

    expect(result).toMatchObject({
      ok: false,
      state,
      events: [],
      error: { kind: "INVALID_STATE", reason: "OBSERVATIONS" },
    });
    expect(result.state).toBe(state);
  });

  it("rolls back when the direct effect would violate a post-state invariant", () => {
    const state = generatedState("gate-post-validation");
    const target = state.board.find((cell) => cell.kind === "UNRESOLVED")?.coordinate;
    if (target === undefined) {
      throw new Error("Generated fixture did not contain an unresolved cell.");
    }
    const before = JSON.stringify(state);

    const result = applyGate(state, gateAction("X", target));

    expect(result).toMatchObject({
      ok: false,
      state,
      events: [],
      error: { kind: "INVALID_STATE", reason: "STATUS" },
    });
    expect(result.state).toBe(state);
    expect(JSON.stringify(state)).toBe(before);
  });
});
