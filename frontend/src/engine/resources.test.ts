import { describe, expect, it } from "vitest";

import { coordinateKey, orthogonalNeighbors } from "./coordinates";
import { generateInitialState } from "./generation";
import { validateGameState } from "./invariants";
import { movePlayer } from "./movement";
import type { Coordinate, GameState } from "./types";

const generatedState = (): GameState => {
  const result = generateInitialState("resource-unit-fixture");
  if (!result.ok) {
    throw new Error(result.error.message);
  }
  return result.value;
};

const resourceFixture = (
  outcome: "CRYSTAL" | "BATTERY",
  observations: number,
): Readonly<{ state: GameState; origin: Coordinate; target: Coordinate }> => {
  const initial = generatedState();
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
        const target = initial.board[neighbor.row * 7 + neighbor.col];
        return (
          target?.kind === "UNRESOLVED" &&
          !paired.has(coordinateKey(neighbor))
        );
      }),
  );
  const target = originCell === undefined
    ? undefined
    : orthogonalNeighbors(originCell.coordinate).find((neighbor) => {
        const cell = initial.board[neighbor.row * 7 + neighbor.col];
        return (
          cell?.kind === "UNRESOLVED" &&
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
    outcome,
  });
  const state: GameState = Object.freeze({
    ...initial,
    status: "PLAYING",
    turn: 1,
    player: originCell.coordinate,
    observations,
    board: Object.freeze(board),
  });
  if (!validateGameState(state).ok) {
    throw new Error("Resource fixture must be valid.");
  }
  return Object.freeze({ state, origin: originCell.coordinate, target });
};

const move = (target: Coordinate) => Object.freeze({ kind: "MOVE", target });

const expectSuccessfulMove = (state: GameState, target: Coordinate): GameState => {
  const result = movePlayer(state, move(target));
  expect(result.ok).toBe(true);
  if (!result.ok) {
    throw new Error(result.error.message);
  }
  return result.state;
};

describe("one-time collectible effects", () => {
  it("collects a crystal once and preserves unrelated resources", () => {
    const fixture = resourceFixture("CRYSTAL", 4);
    const first = movePlayer(fixture.state, move(fixture.target));

    expect(first.ok).toBe(true);
    if (!first.ok) {
      return;
    }
    expect(first.state.collectedCrystals).toEqual([fixture.target]);
    expect(first.state.observations).toBe(4);
    expect(first.state.energy).toBe(fixture.state.energy);
    expect(first.state.inventory).toBe(fixture.state.inventory);
    expect(first.state.collectedBatteries).toBe(
      fixture.state.collectedBatteries,
    );
    expect(first.state.board).toBe(fixture.state.board);
    expect(first.events).toEqual([
      { kind: "PLAYER_MOVED", from: fixture.origin, to: fixture.target },
      {
        kind: "CRYSTAL_COLLECTED",
        coordinate: fixture.target,
        collectedCrystals: 1,
      },
    ]);

    const back = expectSuccessfulMove(first.state, fixture.origin);
    const repeated = movePlayer(back, move(fixture.target));
    expect(repeated.ok).toBe(true);
    if (repeated.ok) {
      expect(repeated.state.collectedCrystals).toBe(
        first.state.collectedCrystals,
      );
      expect(repeated.state.observations).toBe(4);
      expect(repeated.events.map(({ kind }) => kind)).toEqual(["PLAYER_MOVED"]);
    }
  });

  it("restores one observation on first battery entry and never again", () => {
    const fixture = resourceFixture("BATTERY", 3);
    const first = movePlayer(fixture.state, move(fixture.target));

    expect(first.ok).toBe(true);
    if (!first.ok) {
      return;
    }
    expect(first.state.collectedBatteries).toEqual([fixture.target]);
    expect(first.state.observations).toBe(4);
    expect(first.state.energy).toBe(fixture.state.energy);
    expect(first.state.inventory).toBe(fixture.state.inventory);
    expect(first.state.collectedCrystals).toBe(
      fixture.state.collectedCrystals,
    );
    expect(first.events[1]).toEqual({
      kind: "BATTERY_COLLECTED",
      coordinate: fixture.target,
      observationsBefore: 3,
      observationsAfter: 4,
    });

    const back = expectSuccessfulMove(first.state, fixture.origin);
    const repeated = movePlayer(back, move(fixture.target));
    expect(repeated.ok).toBe(true);
    if (repeated.ok) {
      expect(repeated.state.observations).toBe(4);
      expect(repeated.state.collectedBatteries).toBe(
        first.state.collectedBatteries,
      );
      expect(repeated.events).toHaveLength(1);
    }
  });

  it("collects a battery at the observation cap without exceeding thirteen", () => {
    const fixture = resourceFixture("BATTERY", 13);

    const result = movePlayer(fixture.state, move(fixture.target));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.state.observations).toBe(13);
      expect(result.state.collectedBatteries).toEqual([fixture.target]);
      expect(result.events[1]).toEqual({
        kind: "BATTERY_COLLECTED",
        coordinate: fixture.target,
        observationsBefore: 13,
        observationsAfter: 13,
      });
      expect(validateGameState(result.state).ok).toBe(true);
    }
  });

  it("uses a new sorted collection while structurally sharing unrelated branches", () => {
    const fixture = resourceFixture("CRYSTAL", 6);

    const result = movePlayer(fixture.state, move(fixture.target));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.state.collectedCrystals).not.toBe(
        fixture.state.collectedCrystals,
      );
      expect(result.state.collectedBatteries).toBe(
        fixture.state.collectedBatteries,
      );
      expect(result.state.board).toBe(fixture.state.board);
      expect(result.state.pairs).toBe(fixture.state.pairs);
      expect(Object.isFrozen(result.state.collectedCrystals)).toBe(true);
    }
  });
});
