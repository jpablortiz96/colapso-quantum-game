import { describe, expect, it } from "vitest";

import { coordinateKey, orthogonalNeighbors } from "./coordinates";
import { generateInitialState } from "./generation";
import { validateGameState } from "./invariants";
import { applyMovementDirect } from "./movement";
import type { Coordinate, GameState } from "./types";

const voidFixture = (
  energy: 0 | 1,
): Readonly<{ state: GameState; origin: Coordinate; target: Coordinate }> => {
  const generated = generateInitialState("void-unit-fixture");
  if (!generated.ok) {
    throw new Error(generated.error.message);
  }
  const initial = generated.value;
  const paired = new Set(
    initial.pairs.flatMap(({ memberA, memberB }) => [
      coordinateKey(memberA),
      coordinateKey(memberB),
    ]),
  );
  const originCell = initial.board.find(
    (cell) =>
      cell.kind === "UNRESOLVED" &&
      !paired.has(coordinateKey(cell.coordinate)) &&
      orthogonalNeighbors(cell.coordinate).some((neighbor) => {
        const targetCell = initial.board[neighbor.row * 7 + neighbor.col];
        return (
          targetCell?.kind === "UNRESOLVED" &&
          !paired.has(coordinateKey(neighbor))
        );
      }),
  );
  const target = originCell === undefined
    ? undefined
    : orthogonalNeighbors(originCell.coordinate).find((neighbor) => {
        const targetCell = initial.board[neighbor.row * 7 + neighbor.col];
        return (
          targetCell?.kind === "UNRESOLVED" &&
          !paired.has(coordinateKey(neighbor))
        );
      });
  if (originCell === undefined || target === undefined) {
    throw new Error("Fixture did not contain adjacent unpaired cells.");
  }
  const board = [...initial.board];
  board[originCell.coordinate.row * 7 + originCell.coordinate.col] =
    Object.freeze({
      kind: "COLLAPSED",
      coordinate: originCell.coordinate,
      outcome: "FLOOR",
    });
  board[target.row * 7 + target.col] = Object.freeze({
    kind: "COLLAPSED",
    coordinate: target,
    outcome: "VOID",
  });
  const state: GameState = Object.freeze({
    ...initial,
    status: "PLAYING",
    turn: 3,
    player: originCell.coordinate,
    observations: 4,
    energy,
    board: Object.freeze(board),
  });
  if (!validateGameState(state).ok) {
    throw new Error("VOID fixture must be valid.");
  }
  return Object.freeze({ state, origin: originCell.coordinate, target });
};

describe("direct VOID_ENTRY effects", () => {
  it("subtracts an affordable configured penalty without occupying the void", () => {
    const fixture = voidFixture(1);
    const before = JSON.stringify(fixture.state);

    const result = applyMovementDirect(fixture.state, {
      kind: "MOVE",
      target: fixture.target,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.state.player).toBe(fixture.state.player);
    expect(result.state.energy).toBe(0);
    expect(result.state.observations).toBe(fixture.state.observations);
    expect(result.state.turn).toBe(fixture.state.turn);
    expect(result.state.board).toBe(fixture.state.board);
    expect(result.state.collectedCrystals).toBe(
      fixture.state.collectedCrystals,
    );
    expect(result.state.collectedBatteries).toBe(
      fixture.state.collectedBatteries,
    );
    expect(result.voidEntryInsufficient).toBe(false);
    expect(result.entropyDelta).toEqual([]);
    expect(result.events).toEqual([
      {
        kind: "VOID_ENTRY",
        from: fixture.origin,
        target: fixture.target,
        energyBefore: 1,
        energyAfter: 0,
        sufficientEnergy: true,
      },
    ]);
    expect(validateGameState(result.state).ok).toBe(true);
    expect(JSON.stringify(fixture.state)).toBe(before);
  });

  it("sets energy to zero and exposes an ephemeral insufficiency signal", () => {
    const fixture = voidFixture(0);

    const result = applyMovementDirect(fixture.state, {
      kind: "MOVE",
      target: fixture.target,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.state.player).toBe(fixture.state.player);
      expect(result.state.energy).toBe(0);
      expect(result.state.status).toBe("PLAYING");
      expect(result.state.terminalReason).toBeNull();
      expect(result.voidEntryInsufficient).toBe(true);
      expect(result.events).toEqual([
        {
          kind: "VOID_ENTRY",
          from: fixture.origin,
          target: fixture.target,
          energyBefore: 0,
          energyAfter: 0,
          sufficientEnergy: false,
        },
      ]);
    }
  });

  it("does not route non-adjacent geometry to VOID_ENTRY", () => {
    const fixture = voidFixture(1);
    const remote = {
      row: fixture.origin.row >= 2
        ? fixture.origin.row - 2
        : fixture.origin.row + 2,
      col: fixture.origin.col,
    };

    const result = applyMovementDirect(fixture.state, { kind: "MOVE", target: remote });

    expect(result).toMatchObject({
      ok: false,
      state: fixture.state,
      events: [],
      error: { kind: "INVALID_ACTION", reason: "NON_ORTHOGONAL_MOVE" },
    });
    expect(result.state).toBe(fixture.state);
  });
});
