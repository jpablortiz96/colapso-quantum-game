import { describe, expect, it } from "vitest";

import { ENTRY_COORDINATE, EXIT_COORDINATE } from "./constants";
import { allCoordinatesRowMajor, coordinateKey } from "./coordinates";
import { evaluateTerminalState } from "./endings";
import { generateInitialState } from "./generation";
import { validateGameState } from "./invariants";
import type {
  Cell,
  Coordinate,
  EntangledPair,
  GameState,
  Outcome,
} from "./types";

const coordinate = (row: number, col: number): Coordinate => ({ row, col });
const route = Object.freeze([
  ...Array.from({ length: 7 }, (_, col) => coordinate(6, col)),
  ...Array.from({ length: 6 }, (_, offset) => coordinate(5 - offset, 6)),
]);
const bridge = coordinate(5, 6);

const PAIRS: readonly EntangledPair[] = [
  {
    id: "pair-0",
    memberA: coordinate(1, 1),
    memberB: coordinate(1, 2),
    policy: "CORRELATED",
  },
  {
    id: "pair-1",
    memberA: coordinate(2, 1),
    memberB: coordinate(2, 2),
    policy: "ANTI_CORRELATED",
  },
  {
    id: "pair-2",
    memberA: coordinate(3, 1),
    memberB: coordinate(3, 2),
    policy: "CORRELATED",
  },
];

const collapsed = (cellCoordinate: Coordinate, outcome: Outcome): Cell => ({
  kind: "COLLAPSED",
  coordinate: cellCoordinate,
  outcome,
});

const createState = (
  replacements: readonly Cell[],
  overrides: Partial<GameState> = {},
): GameState => {
  const byCoordinate = new Map(
    replacements.map((cell) => [coordinateKey(cell.coordinate), cell]),
  );
  const board = allCoordinatesRowMajor().map((cellCoordinate) => {
    const replacement = byCoordinate.get(coordinateKey(cellCoordinate));
    if (replacement !== undefined) {
      return replacement;
    }
    const endpoint =
      coordinateKey(cellCoordinate) === coordinateKey(ENTRY_COORDINATE) ||
      coordinateKey(cellCoordinate) === coordinateKey(EXIT_COORDINATE);
    return collapsed(cellCoordinate, endpoint ? "FLOOR" : "WALL");
  });
  const state: GameState = {
    schemaVersion: 1,
    rulesVersion: 1,
    status: "PLAYING",
    terminalReason: null,
    turn: 3,
    board,
    player: ENTRY_COORDINATE,
    observations: 1,
    energy: 1,
    inventory: ["X", "H"],
    pairs: PAIRS,
    collectedCrystals: [],
    collectedBatteries: [],
    ...overrides,
  };
  const validation = validateGameState(state);
  if (!validation.ok) {
    throw new Error(validation.error.message);
  }
  return state;
};

const currentRouteState = (overrides: Partial<GameState> = {}): GameState =>
  createState(
    route.map((cellCoordinate) => collapsed(cellCoordinate, "FLOOR")),
    overrides,
  );

const structuralRouteState = (
  overrides: Partial<GameState> = {},
): GameState =>
  createState(
    route.map((cellCoordinate) =>
      coordinateKey(cellCoordinate) === coordinateKey(bridge)
        ? {
            kind: "UNRESOLVED",
            coordinate: cellCoordinate,
            distribution: [1, 0, 0, 0, 0],
          }
        : collapsed(cellCoordinate, "FLOOR"),
    ),
    overrides,
  );

const evaluate = (
  state: GameState,
  voidEntryInsufficient = false,
): ReturnType<typeof evaluateTerminalState> =>
  evaluateTerminalState({ state, voidEntryInsufficient });

describe("terminal evaluation", () => {
  it("retains PLAYING with no event when continuation is legal", () => {
    const state = structuralRouteState();
    const result = evaluate(state);

    expect(result).toEqual({
      ok: true,
      state,
      events: [],
      entropyDelta: [],
    });
    expect(result.state).toBe(state);
  });

  it("assigns VICTORY at the exit before every defeat predicate", () => {
    const state = currentRouteState({ player: EXIT_COORDINATE, energy: 0 });
    const result = evaluate(state, true);

    expect(result.state).toMatchObject({
      status: "VICTORY",
      terminalReason: "EXIT_REACHED",
    });
    expect(result.events).toEqual([
      {
        kind: "STATUS_CHANGED",
        status: "VICTORY",
        reason: "EXIT_REACHED",
      },
    ]);
  });

  it("assigns insufficient VOID defeat before route defeats", () => {
    const state = createState([], { energy: 0 });
    const result = evaluate(state, true);

    expect(result.state).toMatchObject({
      status: "DEFEAT",
      terminalReason: "INSUFFICIENT_VOID_ENERGY",
    });
    expect(result.events).toEqual([
      {
        kind: "STATUS_CHANGED",
        status: "DEFEAT",
        reason: "INSUFFICIENT_VOID_ENERGY",
      },
    ]);
  });

  it("assigns irreversible blockage before resource dead-end", () => {
    const state = createState([], { observations: 0 });
    const result = evaluate(state);

    expect(result.state).toMatchObject({
      status: "DEFEAT",
      terminalReason: "IRREVERSIBLE_BLOCKAGE",
    });
  });

  it("assigns resource dead-end only after structural potential survives", () => {
    const state = structuralRouteState({ observations: 0 });
    const result = evaluate(state);

    expect(result.state).toMatchObject({
      status: "DEFEAT",
      terminalReason: "RESOURCE_DEAD_END",
    });
  });

  it("does not assign resource dead-end with a current exit route", () => {
    const state = currentRouteState({ observations: 0 });
    const result = evaluate(state);

    expect(result.state).toBe(state);
    expect(result.events).toEqual([]);
  });

  it("does not assign resource dead-end with a reachable uncollected battery", () => {
    const battery = coordinate(6, 1);
    const state = structuralRouteState({ observations: 0 });
    const board = state.board.map((cell) =>
      coordinateKey(cell.coordinate) === coordinateKey(battery)
        ? collapsed(cell.coordinate, "BATTERY")
        : cell,
    );
    const withBattery = createState(board, { observations: 0 });

    const result = evaluate(withBattery);

    expect(result.state).toBe(withBattery);
    expect(result.events).toEqual([]);
  });

  it("emits STATUS_CHANGED exactly once and leaves terminal input absorbing", () => {
    const state = structuralRouteState({ observations: 0 });
    const first = evaluate(state);
    const second = evaluate(first.state, true);

    expect(first.events).toHaveLength(1);
    expect(second.state).toBe(first.state);
    expect(second.events).toEqual([]);
  });

  it("does not mutate retained state while creating a terminal successor", () => {
    const state = structuralRouteState({ observations: 0 });
    const before = JSON.stringify(state);
    const board = state.board;

    const result = evaluate(state);

    expect(JSON.stringify(state)).toBe(before);
    expect(state.board).toBe(board);
    expect(result.state).not.toBe(state);
    expect(result.state.board).toBe(board);
    expect(validateGameState(result.state).ok).toBe(true);
  });
});

describe("terminal evaluation phase boundary", () => {
  it("retains a valid START state rather than manufacturing turn-zero PLAYING", () => {
    const generated = generateInitialState("ending-start-phase-boundary");
    if (!generated.ok) {
      throw new Error(generated.error.message);
    }

    const result = evaluateTerminalState({
      state: generated.value,
      voidEntryInsufficient: true,
    });

    expect(result.state).toBe(generated.value);
    expect(result.state.status).toBe("START");
    expect(result.events).toEqual([]);
    expect(validateGameState(result.state).ok).toBe(true);
  });
});