import { describe, expect, it } from "vitest";

import {
  ENTRY_COORDINATE,
  EXIT_COORDINATE,
  INITIAL_INVENTORY,
} from "./constants";
import { allCoordinatesRowMajor, coordinatesEqual } from "./coordinates";
import { validateGameState } from "./invariants";
import type {
  Cell,
  Coordinate,
  EntangledPair,
  GameState,
} from "./types";

const UNIFORM_DISTRIBUTION = [0.2, 0.2, 0.2, 0.2, 0.2] as const;

const createBoard = (): readonly Cell[] =>
  allCoordinatesRowMajor().map((coordinate) =>
    coordinatesEqual(coordinate, ENTRY_COORDINATE) ||
    coordinatesEqual(coordinate, EXIT_COORDINATE)
      ? { kind: "COLLAPSED", coordinate, outcome: "FLOOR" }
      : { kind: "UNRESOLVED", coordinate, distribution: UNIFORM_DISTRIBUTION },
  );

const createPairs = (): readonly EntangledPair[] => [
  {
    id: "pair-0",
    memberA: { row: 0, col: 0 },
    memberB: { row: 0, col: 1 },
    policy: "CORRELATED",
  },
  {
    id: "pair-1",
    memberA: { row: 1, col: 0 },
    memberB: { row: 1, col: 1 },
    policy: "ANTI_CORRELATED",
  },
  {
    id: "pair-2",
    memberA: { row: 2, col: 0 },
    memberB: { row: 2, col: 1 },
    policy: "CORRELATED",
  },
];

const createValidStart = (): GameState => ({
  schemaVersion: 1,
  rulesVersion: 1,
  status: "START",
  terminalReason: null,
  turn: 0,
  board: createBoard(),
  player: ENTRY_COORDINATE,
  observations: 10,
  energy: 1,
  inventory: INITIAL_INVENTORY,
  pairs: createPairs(),
  collectedCrystals: [],
  collectedBatteries: [],
});

const asPlaying = (
  state: GameState,
  overrides: Partial<GameState> = {},
): GameState => ({
  ...state,
  status: "PLAYING",
  turn: 1,
  ...overrides,
});

const replaceCell = (
  state: GameState,
  coordinate: Coordinate,
  replacement: Cell,
): GameState => {
  const index = coordinate.row * 7 + coordinate.col;
  const board = [...state.board];
  board[index] = replacement;
  return { ...state, board };
};

const expectInvalidState = (
  value: unknown,
  reason: string,
  path?: string,
): void => {
  const result = validateGameState(value);
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.error.kind).toBe("INVALID_STATE");
    if (result.error.kind === "INVALID_STATE") {
      expect(result.error.reason).toBe(reason);
      if (path !== undefined) {
        expect(result.error.path).toBe(path);
      }
    }
  }
};

describe("structural state invariants", () => {
  it("accepts a complete valid START state without replacing it", () => {
    const state = createValidStart();
    const result = validateGameState(state);
    expect(result).toEqual({ ok: true, value: state });
    expect(result.ok && result.value).toBe(state);
  });

  it("rejects missing and unknown top-level fields", () => {
    const state = createValidStart();
    const missing: Record<string, unknown> = { ...state };
    delete missing.energy;
    expectInvalidState(missing, "MALFORMED_STATE", "$");
    expectInvalidState({ ...state, mode: "FUTURE" }, "MALFORMED_STATE", "$");
  });

  it("reports unsupported schema and rules versions distinctly", () => {
    const state = createValidStart();
    expect(validateGameState({ ...state, schemaVersion: 2 })).toMatchObject({
      ok: false,
      error: { kind: "UNSUPPORTED_SCHEMA_VERSION", received: 2 },
    });
    expect(validateGameState({ ...state, rulesVersion: 2 })).toMatchObject({
      ok: false,
      error: { kind: "UNSUPPORTED_RULES_VERSION", received: 2 },
    });
  });

  it("rejects malformed version field types", () => {
    const state = createValidStart();
    expectInvalidState(
      { ...state, schemaVersion: "1" },
      "MALFORMED_STATE",
      "schemaVersion",
    );
    expectInvalidState(
      { ...state, rulesVersion: null },
      "MALFORMED_STATE",
      "rulesVersion",
    );
  });

  it("requires exactly 49 board cells", () => {
    const state = createValidStart();
    expectInvalidState({ ...state, board: state.board.slice(0, 48) }, "BOARD_SIZE");
    expectInvalidState({ ...state, board: [...state.board, state.board[0]] }, "BOARD_SIZE");
  });

  it("requires unique row-major board coordinates", () => {
    const state = createValidStart();
    const board = [...state.board];
    board[1] = { ...board[1]!, coordinate: { row: 0, col: 0 } } as Cell;
    expectInvalidState({ ...state, board }, "BOARD_COORDINATE", "board[1].coordinate");
  });

  it("requires exact supported cell variants", () => {
    const state = createValidStart();
    const board = [...state.board];
    board[0] = { ...board[0]!, unsupported: true } as unknown as Cell;
    expectInvalidState({ ...state, board }, "CELL_VARIANT", "board[0]");
    board[0] = { kind: "FUTURE", coordinate: { row: 0, col: 0 } } as unknown as Cell;
    expectInvalidState({ ...state, board }, "CELL_VARIANT", "board[0]");
  });

  it("requires every unresolved distribution to be valid", () => {
    const state = createValidStart();
    const board = [...state.board];
    board[0] = {
      kind: "UNRESOLVED",
      coordinate: { row: 0, col: 0 },
      distribution: [0.1, 0.1, 0.1, 0.1, 0.1],
    };
    expectInvalidState({ ...state, board }, "CELL_DISTRIBUTION", "board[0].distribution");
  });

  it("rejects negative zero in stored distributions", () => {
    const state = createValidStart();
    const board = [...state.board];
    board[0] = {
      kind: "UNRESOLVED",
      coordinate: { row: 0, col: 0 },
      distribution: [-0, 0, 0, 0, 1],
    };
    expectInvalidState({ ...state, board }, "NEGATIVE_ZERO", "board[0].distribution[0]");
  });

  it("requires canonical collapsed FLOOR endpoints", () => {
    const state = createValidStart();
    for (const coordinate of [ENTRY_COORDINATE, EXIT_COORDINATE]) {
      const invalid = replaceCell(state, coordinate, {
        kind: "COLLAPSED",
        coordinate,
        outcome: "WALL",
      });
      expectInvalidState(invalid, "ENDPOINT", "board");
    }
  });

  it("requires the player to occupy an in-bounds collapsed passable cell", () => {
    const state = asPlaying(createValidStart());
    expectInvalidState({ ...state, player: { row: 7, col: 0 } }, "PLAYER", "player");
    expectInvalidState({ ...state, player: { row: 3, col: 3 } }, "PLAYER", "player");

    const wallCoordinate = { row: 3, col: 3 };
    const wallState = replaceCell(state, wallCoordinate, {
      kind: "COLLAPSED",
      coordinate: wallCoordinate,
      outcome: "WALL",
    });
    expectInvalidState({ ...wallState, player: wallCoordinate }, "PLAYER", "player");
  });

  it("requires an occupied collectible to be marked collected", () => {
    const state = asPlaying(createValidStart());
    const coordinate = { row: 3, col: 3 };
    const crystalState = replaceCell(state, coordinate, {
      kind: "COLLAPSED",
      coordinate,
      outcome: "CRYSTAL",
    });
    expectInvalidState({ ...crystalState, player: coordinate }, "PLAYER", "player");
  });
});

describe("pair and inventory invariants", () => {
  it.each([2, 6])("rejects a pair count of %i", (count) => {
    const state = createValidStart();
    const pairs = Array.from({ length: count }, (_, index) => ({
      id: `pair-${index}`,
      memberA: { row: index, col: 0 },
      memberB: { row: index, col: 1 },
      policy: "CORRELATED" as const,
    }));
    expectInvalidState({ ...state, pairs }, "PAIR_COUNT", "pairs");
  });

  it("requires non-empty unique pair IDs in sorted order", () => {
    const state = createValidStart();
    const pairs = [...state.pairs];
    pairs[0] = { ...pairs[0]!, id: "" };
    expectInvalidState({ ...state, pairs }, "PAIR_ID", "pairs[0].id");

    pairs[0] = { ...state.pairs[0]!, id: "pair-1" };
    expectInvalidState({ ...state, pairs }, "PAIR_ID", "pairs[1].id");

    const reversed = [state.pairs[1]!, state.pairs[0]!, state.pairs[2]!];
    expectInvalidState({ ...state, pairs: reversed }, "PAIR_ORDER", "pairs[1].id");
  });

  it("requires exact pair fields and a supported policy", () => {
    const state = createValidStart();
    const pairs = [...state.pairs];
    pairs[0] = { ...pairs[0]!, future: true } as EntangledPair;
    expectInvalidState({ ...state, pairs }, "PAIR_MEMBER", "pairs[0]");

    pairs[0] = { ...state.pairs[0]!, policy: "FUTURE" } as unknown as EntangledPair;
    expectInvalidState({ ...state, pairs }, "PAIR_MEMBER", "pairs[0].policy");
  });

  it("requires canonical distinct non-endpoint pair members", () => {
    const state = createValidStart();
    const cases: readonly EntangledPair[] = [
      { ...state.pairs[0]!, memberA: { row: 0, col: 1 }, memberB: { row: 0, col: 0 } },
      { ...state.pairs[0]!, memberB: { row: 0, col: 0 } },
      { ...state.pairs[0]!, memberB: EXIT_COORDINATE },
    ];
    for (const pair of cases) {
      expectInvalidState({ ...state, pairs: [pair, ...state.pairs.slice(1)] }, "PAIR_MEMBER");
    }
  });

  it("requires globally disjoint pair membership", () => {
    const state = createValidStart();
    const pairs = [...state.pairs];
    pairs[1] = { ...pairs[1]!, memberA: state.pairs[0]!.memberB };
    expectInvalidState({ ...state, pairs }, "PAIR_MEMBER", "pairs[1]");
  });

  it("requires pair members to share resolution state", () => {
    const start = createValidStart();
    const coordinate = start.pairs[0]!.memberA;
    const state = replaceCell(asPlaying(start), coordinate, {
      kind: "COLLAPSED",
      coordinate,
      outcome: "FLOOR",
    });
    expectInvalidState(state, "PAIR_RESOLUTION", "pairs[0]");
  });

  it.each([
    ["H", "X"],
    ["X", "X"],
    ["H", "H"],
    ["X", "H", "X"],
    ["FUTURE"],
  ])("rejects invalid inventory %#", (...inventory) => {
    const state = asPlaying(createValidStart(), {
      inventory: inventory as readonly ("X" | "H")[],
    });
    expectInvalidState(state, "INVENTORY", "inventory");
  });

  it.each([
    { inventory: [] },
    { inventory: ["X"] },
    { inventory: ["H"] },
    { inventory: ["X", "H"] },
  ] as const)(
    "accepts reachable stable inventory %#",
    ({ inventory }) => {
      const state = asPlaying(createValidStart(), { inventory });
      expect(validateGameState(state).ok).toBe(true);
    },
  );
});

describe("resource, collection, and lifecycle invariants", () => {
  it.each([
    ["observations", -1, "OBSERVATIONS"],
    ["observations", 14, "OBSERVATIONS"],
    ["observations", 0.5, "OBSERVATIONS"],
    ["observations", -0, "NEGATIVE_ZERO"],
    ["turn", -1, "TURN"],
    ["turn", Number.MAX_SAFE_INTEGER + 1, "TURN"],
    ["turn", -0, "NEGATIVE_ZERO"],
    ["energy", 2, "ENERGY"],
    ["energy", -1, "ENERGY"],
    ["energy", -0, "NEGATIVE_ZERO"],
  ] as const)("rejects invalid %s value %s", (field, value, reason) => {
    const state = asPlaying(createValidStart());
    expectInvalidState({ ...state, [field]: value }, reason, field);
  });

  it("requires collected coordinates to be sorted and duplicate-free", () => {
    let state = asPlaying(createValidStart());
    for (const coordinate of [
      { row: 3, col: 3 },
      { row: 3, col: 4 },
    ]) {
      state = replaceCell(state, coordinate, {
        kind: "COLLAPSED",
        coordinate,
        outcome: "CRYSTAL",
      });
    }
    expectInvalidState(
      { ...state, collectedCrystals: [{ row: 3, col: 4 }, { row: 3, col: 3 }] },
      "COLLECTION",
    );
    expectInvalidState(
      { ...state, collectedCrystals: [{ row: 3, col: 3 }, { row: 3, col: 3 }] },
      "COLLECTION",
    );
  });

  it("requires collected coordinates to point to matching collapsed outcomes", () => {
    const state = asPlaying(createValidStart());
    expectInvalidState(
      { ...state, collectedCrystals: [{ row: 3, col: 3 }] },
      "COLLECTION",
      "collectedCrystals[0]",
    );
    expectInvalidState(
      { ...state, collectedBatteries: [{ row: 3, col: 3 }] },
      "COLLECTION",
      "collectedBatteries[0]",
    );
  });

  it("accepts consistent collected crystal and battery states", () => {
    let state = asPlaying(createValidStart());
    const crystal = { row: 3, col: 3 };
    const battery = { row: 3, col: 4 };
    state = replaceCell(state, crystal, {
      kind: "COLLAPSED",
      coordinate: crystal,
      outcome: "CRYSTAL",
    });
    state = replaceCell(state, battery, {
      kind: "COLLAPSED",
      coordinate: battery,
      outcome: "BATTERY",
    });
    state = {
      ...state,
      player: crystal,
      collectedCrystals: [crystal],
      collectedBatteries: [battery],
    };
    expect(validateGameState(state).ok).toBe(true);
  });

  it("enforces every START cross-field condition", () => {
    const state = createValidStart();
    const invalidStates = [
      { ...state, turn: 1 },
      { ...state, terminalReason: "RESOURCE_DEAD_END" },
      { ...state, player: EXIT_COORDINATE },
      { ...state, observations: 9 },
      { ...state, energy: 0 },
      { ...state, inventory: ["X"] },
      { ...state, collectedCrystals: [{ row: 3, col: 3 }] },
    ];
    for (const invalid of invalidStates) {
      expectInvalidState(invalid, invalid === invalidStates[6] ? "COLLECTION" : "STATUS");
    }

    const coordinate = { row: 3, col: 3 };
    const collapsedInterior = replaceCell(state, coordinate, {
      kind: "COLLAPSED",
      coordinate,
      outcome: "FLOOR",
    });
    expectInvalidState(collapsedInterior, "STATUS", "board[24]");
  });

  it("requires PLAYING to have a positive turn and null reason", () => {
    const state = createValidStart();
    expectInvalidState({ ...state, status: "PLAYING" }, "STATUS", "status");
    expectInvalidState(
      { ...state, status: "PLAYING", turn: 1, terminalReason: "RESOURCE_DEAD_END" },
      "STATUS",
      "status",
    );
  });

  it("requires VICTORY to use EXIT_REACHED at the exit", () => {
    const state = createValidStart();
    const victory = {
      ...state,
      status: "VICTORY",
      turn: 1,
      terminalReason: "EXIT_REACHED",
      player: EXIT_COORDINATE,
    };
    expect(validateGameState(victory).ok).toBe(true);
    expectInvalidState({ ...victory, player: ENTRY_COORDINATE }, "TERMINAL_REASON");
    expectInvalidState({ ...victory, terminalReason: "RESOURCE_DEAD_END" }, "TERMINAL_REASON");
  });

  it("requires DEFEAT to use a defeat reason and zero energy for void insufficiency", () => {
    const state = createValidStart();
    const defeat = {
      ...state,
      status: "DEFEAT",
      turn: 1,
      terminalReason: "INSUFFICIENT_VOID_ENERGY",
      energy: 0,
    };
    expect(validateGameState(defeat).ok).toBe(true);
    expectInvalidState({ ...defeat, energy: 1 }, "TERMINAL_REASON");
    expectInvalidState({ ...defeat, terminalReason: "EXIT_REACHED" }, "TERMINAL_REASON");
  });

  it("enforces route-derived defeat reasons and their precedence", () => {
    const start = createValidStart();
    const blockedBoard = start.board.map((cell) =>
      cell.kind === "UNRESOLVED"
        ? {
            kind: "COLLAPSED" as const,
            coordinate: cell.coordinate,
            outcome: "WALL" as const,
          }
        : cell,
    );
    const blocked: GameState = {
      ...start,
      status: "DEFEAT",
      turn: 1,
      terminalReason: "IRREVERSIBLE_BLOCKAGE",
      board: blockedBoard,
    };
    expect(validateGameState(blocked).ok).toBe(true);
    expectInvalidState(
      { ...blocked, terminalReason: "RESOURCE_DEAD_END", observations: 0 },
      "TERMINAL_REASON",
      "terminalReason",
    );

    const resourceDeadEnd: GameState = {
      ...start,
      status: "DEFEAT",
      turn: 1,
      terminalReason: "RESOURCE_DEAD_END",
      observations: 0,
    };
    expect(validateGameState(resourceDeadEnd).ok).toBe(true);
    expectInvalidState(
      { ...resourceDeadEnd, terminalReason: "IRREVERSIBLE_BLOCKAGE" },
      "TERMINAL_REASON",
      "terminalReason",
    );
    expectInvalidState(
      { ...resourceDeadEnd, observations: 1 },
      "TERMINAL_REASON",
      "terminalReason",
    );

    const battery = { row: 5, col: 0 };
    const batteryReachable = replaceCell(resourceDeadEnd, battery, {
      kind: "COLLAPSED",
      coordinate: battery,
      outcome: "BATTERY",
    });
    expectInvalidState(
      batteryReachable,
      "TERMINAL_REASON",
      "terminalReason",
    );

    const currentBoard = start.board.map((cell) =>
      cell.kind === "UNRESOLVED"
        ? {
            kind: "COLLAPSED" as const,
            coordinate: cell.coordinate,
            outcome: "FLOOR" as const,
          }
        : cell,
    );
    expectInvalidState(
      { ...resourceDeadEnd, board: currentBoard },
      "TERMINAL_REASON",
      "terminalReason",
    );
  });

  it("allows route-terminal predicates in valid PLAYING intermediates", () => {
    const start = createValidStart();
    const blockedBoard = start.board.map((cell) =>
      cell.kind === "UNRESOLVED"
        ? {
            kind: "COLLAPSED" as const,
            coordinate: cell.coordinate,
            outcome: "WALL" as const,
          }
        : cell,
    );
    const blockedPlaying = asPlaying(start, { board: blockedBoard });
    const resourcePlaying = asPlaying(start, { observations: 0 });
    const postDirectVictory = asPlaying(start, { player: EXIT_COORDINATE });

    expect(validateGameState(blockedPlaying).ok).toBe(true);
    expect(validateGameState(resourcePlaying).ok).toBe(true);
    expect(validateGameState(postDirectVictory).ok).toBe(true);
  });

  it("rejects every DEFEAT reason at the exit because victory takes precedence", () => {
    const start = createValidStart();
    for (const terminalReason of [
      "INSUFFICIENT_VOID_ENERGY",
      "IRREVERSIBLE_BLOCKAGE",
      "RESOURCE_DEAD_END",
    ] as const) {
      expectInvalidState(
        {
          ...start,
          status: "DEFEAT",
          turn: 1,
          player: EXIT_COORDINATE,
          terminalReason,
          observations: 0,
          energy: 0,
        },
        "TERMINAL_REASON",
        "terminalReason",
      );
    }
  });

  it("rejects unsupported statuses and terminal reasons", () => {
    const state = createValidStart();
    expectInvalidState({ ...state, status: "PAUSED" }, "STATUS", "status");
    expectInvalidState(
      { ...state, terminalReason: "FUTURE_REASON" },
      "TERMINAL_REASON",
      "terminalReason",
    );
  });
});
