import { describe, expect, it } from "vitest";

import { coordinateKey, orthogonalNeighbors } from "./coordinates";
import { generateInitialState } from "./generation";
import { validateGameState } from "./invariants";
import { movePlayer } from "./movement";
import type { Coordinate, GameState, Outcome } from "./types";

const generatedState = (seed: string): GameState => {
  const result = generateInitialState(seed);
  if (!result.ok) {
    throw new Error(result.error.message);
  }
  return result.value;
};

const movementFixture = (
  targetKind: Outcome | "UNRESOLVED",
  observations = 5,
): Readonly<{
  state: GameState;
  origin: Coordinate;
  target: Coordinate;
}> => {
  const initial = generatedState("movement-unit-fixture");
  const paired = new Set(
    initial.pairs.flatMap(({ memberA, memberB }) => [
      coordinateKey(memberA),
      coordinateKey(memberB),
    ]),
  );
  let origin: Coordinate | undefined;
  let target: Coordinate | undefined;
  for (const cell of initial.board) {
    if (paired.has(coordinateKey(cell.coordinate))) {
      continue;
    }
    const neighbor = orthogonalNeighbors(cell.coordinate).find((coordinate) => {
      const candidate = initial.board[coordinate.row * 7 + coordinate.col];
      return (
        candidate?.kind === "UNRESOLVED" &&
        !paired.has(coordinateKey(coordinate))
      );
    });
    if (neighbor !== undefined && cell.kind === "UNRESOLVED") {
      origin = cell.coordinate;
      target = neighbor;
      break;
    }
  }
  if (origin === undefined || target === undefined) {
    throw new Error("Fixture did not contain adjacent unpaired cells.");
  }

  const board = [...initial.board];
  board[origin.row * 7 + origin.col] = Object.freeze({
    kind: "COLLAPSED",
    coordinate: origin,
    outcome: "FLOOR",
  });
  if (targetKind !== "UNRESOLVED") {
    board[target.row * 7 + target.col] = Object.freeze({
      kind: "COLLAPSED",
      coordinate: target,
      outcome: targetKind,
    });
  }
  const state: GameState = Object.freeze({
    ...initial,
    status: "PLAYING",
    turn: 2,
    player: origin,
    observations,
    board: Object.freeze(board),
  });
  if (!validateGameState(state).ok) {
    throw new Error("Movement fixture must be valid.");
  }
  return Object.freeze({ state, origin, target });
};

const move = (target: Coordinate) => Object.freeze({ kind: "MOVE", target });

describe("direct orthogonal movement", () => {
  it.each(["FLOOR", "CRYSTAL", "BATTERY"] as const)(
    "occupies an adjacent collapsed %s without advancing the turn",
    (outcome) => {
      const fixture = movementFixture(outcome);
      const before = JSON.stringify(fixture.state);

      const result = movePlayer(fixture.state, move(fixture.target));

      expect(result.ok).toBe(true);
      if (!result.ok) {
        return;
      }
      expect(result.state).not.toBe(fixture.state);
      expect(result.state.player).toBe(
        fixture.state.board[fixture.target.row * 7 + fixture.target.col]
          ?.coordinate,
      );
      expect(result.state.turn).toBe(fixture.state.turn);
      expect(result.state.status).toBe(fixture.state.status);
      expect(result.state.board).toBe(fixture.state.board);
      expect(result.state.pairs).toBe(fixture.state.pairs);
      expect(result.state.inventory).toBe(fixture.state.inventory);
      expect(result.state.energy).toBe(fixture.state.energy);
      expect(result.entropyDelta).toEqual([]);
      expect(Object.keys(result).sort()).toEqual([
        "entropyDelta",
        "events",
        "ok",
        "state",
      ]);
      expect(result.events[0]).toEqual({
        kind: "PLAYER_MOVED",
        from: fixture.origin,
        to: fixture.target,
      });
      expect(result.events.map(({ kind }) => kind)).toEqual(
        outcome === "FLOOR"
          ? ["PLAYER_MOVED"]
          : [
              "PLAYER_MOVED",
              outcome === "CRYSTAL"
                ? "CRYSTAL_COLLECTED"
                : "BATTERY_COLLECTED",
            ],
      );
      expect(validateGameState(result.state).ok).toBe(true);
      expect(JSON.stringify(fixture.state)).toBe(before);
    },
  );

  it.each([
    { name: "stationary", target: (origin: Coordinate) => origin },
    {
      name: "diagonal",
      target: (origin: Coordinate) => ({
        row: origin.row === 6 ? 5 : origin.row + 1,
        col: origin.col === 6 ? 5 : origin.col + 1,
      }),
    },
    {
      name: "remote",
      target: (origin: Coordinate) => ({
        row: origin.row >= 2 ? origin.row - 2 : origin.row + 2,
        col: origin.col,
      }),
    },
  ])("rejects $name geometry atomically", ({ target }) => {
    const fixture = movementFixture("FLOOR");
    const before = JSON.stringify(fixture.state);

    const result = movePlayer(fixture.state, move(target(fixture.origin)));

    expect(result).toMatchObject({
      ok: false,
      state: fixture.state,
      events: [],
      error: { kind: "INVALID_ACTION", reason: "NON_ORTHOGONAL_MOVE" },
    });
    expect(result.state).toBe(fixture.state);
    expect(JSON.stringify(fixture.state)).toBe(before);
  });

  it.each([
    null,
    { row: -1, col: 0 },
    { row: 7, col: 0 },
    { row: 1.5, col: 0 },
    { row: -0, col: 0 },
    { row: 0, col: 0, extra: true },
  ])("rejects malformed or out-of-bounds target %# atomically", (target) => {
    const fixture = movementFixture("FLOOR");

    const result = movePlayer(fixture.state, { kind: "MOVE", target });

    expect(result).toMatchObject({
      ok: false,
      state: fixture.state,
      events: [],
      error: { kind: "INVALID_ACTION", reason: "TARGET_OUT_OF_BOUNDS" },
    });
  });

  it.each([
    { targetKind: "UNRESOLVED", reason: "TARGET_UNRESOLVED" },
    { targetKind: "WALL", reason: "TARGET_WALL" },
  ] as const)(
    "rejects an adjacent $targetKind target without effects",
    ({ targetKind, reason }) => {
      const fixture = movementFixture(targetKind);

      const result = movePlayer(fixture.state, move(fixture.target));

      expect(result).toMatchObject({
        ok: false,
        state: fixture.state,
        events: [],
        error: { kind: "INVALID_ACTION", reason },
      });
      expect(result.state).toBe(fixture.state);
    },
  );

  it("rejects malformed and unsupported action kinds", () => {
    const fixture = movementFixture("FLOOR");

    expect(movePlayer(fixture.state, { kind: "MOVE" })).toMatchObject({
      ok: false,
      error: { kind: "INVALID_ACTION", reason: "MALFORMED_ACTION" },
    });
    expect(
      movePlayer(fixture.state, {
        kind: "OBSERVE",
        target: fixture.target,
      }),
    ).toMatchObject({
      ok: false,
      error: { kind: "INVALID_ACTION", reason: "UNSUPPORTED_ACTION" },
    });
  });

  it("validates the complete input state before movement", () => {
    const fixture = movementFixture("FLOOR");
    const state = { ...fixture.state, observations: 14 } as GameState;

    const result = movePlayer(state, move(fixture.target));

    expect(result).toMatchObject({
      ok: false,
      state,
      events: [],
      error: { kind: "INVALID_STATE", reason: "OBSERVATIONS" },
    });
  });
});
