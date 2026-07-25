import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { ENTRY_COORDINATE, EXIT_COORDINATE } from "./constants";
import { allCoordinatesRowMajor, coordinateKey } from "./coordinates";
import { evaluateTerminalState } from "./endings";
import type { EntropyError } from "./errors";
import { validateGameState } from "./invariants";
import { processAction } from "./turn";
import type {
  Cell,
  Coordinate,
  EntangledPair,
  EntropySource,
  GameState,
} from "./types";

const PROPERTY_RUNS = 100;
const coordinate = (row: number, col: number): Coordinate => ({ row, col });
const route = [
  ...Array.from({ length: 7 }, (_, col) => coordinate(6, col)),
  ...Array.from({ length: 6 }, (_, offset) => coordinate(5 - offset, 6)),
];
const bridge = coordinate(5, 6);
const pairs: readonly EntangledPair[] = [
  { id: "pair-0", memberA: coordinate(1, 1), memberB: coordinate(1, 2), policy: "CORRELATED" },
  { id: "pair-1", memberA: coordinate(2, 1), memberB: coordinate(2, 2), policy: "ANTI_CORRELATED" },
  { id: "pair-2", memberA: coordinate(3, 1), memberB: coordinate(3, 2), policy: "CORRELATED" },
];

const createState = (
  kind: "CURRENT" | "STRUCTURAL" | "BLOCKED",
  overrides: Partial<GameState> = {},
): GameState => {
  const routeKeys = new Set(route.map(coordinateKey));
  const board = allCoordinatesRowMajor().map((cellCoordinate): Cell => {
    const key = coordinateKey(cellCoordinate);
    const endpoint = key === "6,0" || key === "0,6";
    if (endpoint) {
      return { kind: "COLLAPSED", coordinate: cellCoordinate, outcome: "FLOOR" };
    }
    if (kind !== "BLOCKED" && routeKeys.has(key)) {
      if (kind === "STRUCTURAL" && key === coordinateKey(bridge)) {
        return {
          kind: "UNRESOLVED",
          coordinate: cellCoordinate,
          distribution: [1, 0, 0, 0, 0],
        };
      }
      return { kind: "COLLAPSED", coordinate: cellCoordinate, outcome: "FLOOR" };
    }
    return { kind: "COLLAPSED", coordinate: cellCoordinate, outcome: "WALL" };
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
    pairs,
    collectedCrystals: [],
    collectedBatteries: [],
    ...overrides,
  };
  if (!validateGameState(state).ok) {
    throw new Error("Ending property fixture must be valid.");
  }
  return state;
};

const terminalState = (
  reason:
    | "EXIT_REACHED"
    | "INSUFFICIENT_VOID_ENERGY"
    | "IRREVERSIBLE_BLOCKAGE"
    | "RESOURCE_DEAD_END",
): GameState => {
  const context =
    reason === "EXIT_REACHED"
      ? { state: createState("CURRENT", { player: EXIT_COORDINATE }), voidEntryInsufficient: false }
      : reason === "INSUFFICIENT_VOID_ENERGY"
        ? { state: createState("BLOCKED", { energy: 0 }), voidEntryInsufficient: true }
        : reason === "IRREVERSIBLE_BLOCKAGE"
          ? { state: createState("BLOCKED"), voidEntryInsufficient: false }
          : { state: createState("STRUCTURAL", { observations: 0 }), voidEntryInsufficient: false };
  return evaluateTerminalState(context).state;
};

describe("terminal sequence properties", () => {
  it("reaches each defeat reason independently under its first ordered predicate", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(
          "INSUFFICIENT_VOID_ENERGY" as const,
          "IRREVERSIBLE_BLOCKAGE" as const,
          "RESOURCE_DEAD_END" as const,
        ),
        fc.integer({ min: 0, max: 10 }),
        (reason, observations) => {
          const context =
            reason === "INSUFFICIENT_VOID_ENERGY"
              ? {
                  state: createState("BLOCKED", { energy: 0, observations }),
                  voidEntryInsufficient: true,
                }
              : reason === "IRREVERSIBLE_BLOCKAGE"
                ? {
                    state: createState("BLOCKED", { observations }),
                    voidEntryInsufficient: false,
                  }
                : {
                    state: createState("STRUCTURAL", { observations: 0 }),
                    voidEntryInsufficient: false,
                  };

          const result = evaluateTerminalState(context);

          expect(result.state.status).toBe("DEFEAT");
          expect(result.state.terminalReason).toBe(reason);
          expect(result.events).toEqual([
            { kind: "STATUS_CHANGED", status: "DEFEAT", reason },
          ]);
        },
      ),
      { numRuns: PROPERTY_RUNS, seed: 0x7301 },
    );
  });

  it("gives exit victory precedence over the ephemeral VOID signal", () => {
    fc.assert(
      fc.property(fc.boolean(), (voidEntryInsufficient) => {
        const result = evaluateTerminalState({
          state: createState("CURRENT", {
            player: EXIT_COORDINATE,
            energy: voidEntryInsufficient ? 0 : 1,
          }),
          voidEntryInsufficient,
        });
        expect(result.state.status).toBe("VICTORY");
        expect(result.state.terminalReason).toBe("EXIT_REACHED");
      }),
      { numRuns: PROPERTY_RUNS, seed: 0x7302 },
    );
  });

  it("keeps every terminal reason absorbing before action parsing or entropy", () => {
    const actionArbitrary = fc.oneof(
      fc.constant(null),
      fc.constant({ kind: "MOVE", target: ENTRY_COORDINATE }),
      fc.constant({ kind: "OBSERVE", target: coordinate(4, 4) }),
      fc.constant({ kind: "UNSUPPORTED" }),
    );
    fc.assert(
      fc.property(
        fc.constantFrom(
          "EXIT_REACHED" as const,
          "INSUFFICIENT_VOID_ENERGY" as const,
          "IRREVERSIBLE_BLOCKAGE" as const,
          "RESOURCE_DEAD_END" as const,
        ),
        actionArbitrary,
        (reason, action) => {
          const state = terminalState(reason);
          const before = JSON.stringify(state);
          let entropyRequests = 0;
          const source: EntropySource<EntropyError> = {
            nextUint32: () => {
              entropyRequests += 1;
              return { ok: true, value: 0 };
            },
          };

          const result = processAction(state, action, source);

          expect(result).toMatchObject({
            ok: false,
            state,
            events: [],
            error: { kind: "INVALID_ACTION", reason: "TERMINAL_STATE" },
          });
          expect(result.state).toBe(state);
          expect(entropyRequests).toBe(0);
          expect(JSON.stringify(state)).toBe(before);
        },
      ),
      { numRuns: PROPERTY_RUNS, seed: 0x7303 },
    );
  });

  it("preserves retained states across every terminal decision", () => {
    fc.assert(
      fc.property(
        fc.constantFrom("CURRENT" as const, "STRUCTURAL" as const, "BLOCKED" as const),
        fc.integer({ min: 0, max: 10 }),
        fc.boolean(),
        (kind, observations, voidEntryInsufficient) => {
          const state = createState(kind, {
            observations,
            energy: voidEntryInsufficient ? 0 : 1,
          });
          const before = JSON.stringify(state);
          const board = state.board;

          evaluateTerminalState({ state, voidEntryInsufficient });

          expect(JSON.stringify(state)).toBe(before);
          expect(state.board).toBe(board);
        },
      ),
      { numRuns: PROPERTY_RUNS, seed: 0x7304 },
    );
  });
});

describe("scheduled victory property", () => {
  it("keeps exit victory after scheduled decoherence collapses a wall", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 0xffffffff }),
        (collapseWord) => {
          const approach = coordinate(0, 5);
          const candidate = coordinate(0, 4);
          const base = createState("BLOCKED");
          const board = base.board.map((cell): Cell => {
            const key = coordinateKey(cell.coordinate);
            if (key === coordinateKey(approach)) {
              return {
                kind: "COLLAPSED",
                coordinate: cell.coordinate,
                outcome: "FLOOR",
              };
            }
            if (key === coordinateKey(candidate)) {
              return {
                kind: "UNRESOLVED",
                coordinate: cell.coordinate,
                distribution: [0, 1, 0, 0, 0],
              };
            }
            return cell;
          });
          const state: GameState = {
            ...base,
            turn: 3,
            player: approach,
            observations: 0,
            board,
          };
          if (!validateGameState(state).ok) {
            throw new Error("Scheduled victory property state must be valid.");
          }
          const words = [0, collapseWord];
          let cursor = 0;
          const source: EntropySource<EntropyError> = {
            nextUint32: () => {
              const value = words[cursor];
              cursor += 1;
              return value === undefined
                ? {
                    ok: false,
                    error: {
                      kind: "ENTROPY_EXHAUSTED",
                      message: "Scheduled victory script exhausted.",
                    },
                  }
                : { ok: true, value };
            },
          };

          const result = processAction(
            state,
            { kind: "MOVE", target: EXIT_COORDINATE },
            source,
          );

          expect(result.ok).toBe(true);
          if (!result.ok) {
            return;
          }
          expect(result.state.status).toBe("VICTORY");
          expect(result.state.terminalReason).toBe("EXIT_REACHED");
          expect(result.events.map(({ kind }) => kind)).toEqual([
            "PLAYER_MOVED",
            "TURN_ADVANCED",
            "DECOHERENCE_SELECTED",
            "CELL_COLLAPSED",
            "STATUS_CHANGED",
          ]);
          expect(result.events[3]).toMatchObject({
            kind: "CELL_COLLAPSED",
            coordinate: candidate,
            outcome: "WALL",
            cause: "DECOHERENCE",
          });
          expect(result.events[4]).toEqual({
            kind: "STATUS_CHANGED",
            status: "VICTORY",
            reason: "EXIT_REACHED",
          });
        },
      ),
      { numRuns: PROPERTY_RUNS, seed: 0x7305 },
    );
  });
});