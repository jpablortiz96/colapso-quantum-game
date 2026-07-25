import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { ENTRY_COORDINATE } from "./constants";
import { allCoordinatesRowMajor, coordinateKey } from "./coordinates";
import { analyzeRoutes, type RouteState } from "./routes";
import type { Cell, Coordinate } from "./types";

const PROPERTY_RUNS = 100;
const MODES = [
  "FLOOR",
  "WALL",
  "VOID",
  "CRYSTAL",
  "BATTERY",
  "POTENTIAL",
  "BLOCKED_UNRESOLVED",
] as const;
type CellMode = (typeof MODES)[number];

const modeArbitrary = fc.constantFrom(...MODES);
const boardArbitrary = fc.array(modeArbitrary, { minLength: 47, maxLength: 47 });

const makeCell = (coordinate: Coordinate, mode: CellMode): Cell => {
  if (mode === "POTENTIAL") {
    return {
      kind: "UNRESOLVED",
      coordinate,
      distribution: [0.5, 0.5, 0, 0, 0],
    };
  }
  if (mode === "BLOCKED_UNRESOLVED") {
    return {
      kind: "UNRESOLVED",
      coordinate,
      distribution: [0, 0.5, 0.5, 0, 0],
    };
  }
  return { kind: "COLLAPSED", coordinate, outcome: mode };
};

const createState = (
  modes: readonly CellMode[],
  observations: number,
  collectBatteries: boolean,
): RouteState => {
  let modeIndex = 0;
  const board = allCoordinatesRowMajor().map((coordinate) => {
    const isEndpoint =
      (coordinate.row === 6 && coordinate.col === 0) ||
      (coordinate.row === 0 && coordinate.col === 6);
    if (isEndpoint) {
      return {
        kind: "COLLAPSED" as const,
        coordinate,
        outcome: "FLOOR" as const,
      };
    }
    const mode = modes[modeIndex];
    modeIndex += 1;
    if (mode === undefined) {
      throw new Error("Property board mode must exist.");
    }
    return makeCell(coordinate, mode);
  });
  const collectedBatteries = collectBatteries
    ? board
        .filter(
          (cell) =>
            cell.kind === "COLLAPSED" && cell.outcome === "BATTERY",
        )
        .map((cell) => cell.coordinate)
    : [];
  return {
    board,
    player: ENTRY_COORDINATE,
    observations,
    collectedBatteries,
  };
};

type Directions = readonly (readonly [number, number])[];
const FORWARD: Directions = [
  [-1, 0],
  [0, -1],
  [0, 1],
  [1, 0],
];
const REVERSED: Directions = [...FORWARD].reverse();

const referenceReachability = (
  state: RouteState,
  structural: boolean,
  directions: Directions,
): Readonly<{ exit: boolean; battery: boolean }> => {
  const visited = new Set<string>([coordinateKey(state.player)]);
  const queue: Coordinate[] = [state.player];
  const collected = new Set(state.collectedBatteries.map(coordinateKey));
  let battery = false;

  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const current = queue[cursor];
    if (current === undefined) {
      continue;
    }
    const currentCell = state.board[current.row * 7 + current.col];
    if (
      currentCell?.kind === "COLLAPSED" &&
      currentCell.outcome === "BATTERY" &&
      !collected.has(coordinateKey(current))
    ) {
      battery = true;
    }

    for (const [rowDelta, colDelta] of directions) {
      const next = {
        row: current.row + rowDelta,
        col: current.col + colDelta,
      };
      if (next.row < 0 || next.row >= 7 || next.col < 0 || next.col >= 7) {
        continue;
      }
      const key = coordinateKey(next);
      if (visited.has(key)) {
        continue;
      }
      const cell = state.board[next.row * 7 + next.col];
      const passable =
        cell?.kind === "COLLAPSED"
          ? cell.outcome === "FLOOR" ||
            cell.outcome === "CRYSTAL" ||
            cell.outcome === "BATTERY"
          : structural &&
            cell !== undefined &&
            (cell.distribution[0] > 0 ||
              cell.distribution[3] > 0 ||
              cell.distribution[4] > 0);
      if (passable) {
        visited.add(key);
        queue.push(next);
      }
    }
  }

  return {
    exit: visited.has("0,6"),
    battery,
  };
};

describe("route properties", () => {
  it("proves every current route is also a structural-potential route", () => {
    fc.assert(
      fc.property(boardArbitrary, (modes) => {
        const analysis = analyzeRoutes(createState(modes, 1, false));
        expect(!analysis.currentRoute || analysis.structuralPotentialRoute).toBe(
          true,
        );
      }),
      { numRuns: PROPERTY_RUNS, seed: 0x7101 },
    );
  });

  it("produces the same route booleans for opposite traversal tie orders", () => {
    fc.assert(
      fc.property(
        boardArbitrary,
        fc.integer({ min: 0, max: 10 }),
        fc.boolean(),
        (modes, observations, collectBatteries) => {
          const state = createState(modes, observations, collectBatteries);
          const analysis = analyzeRoutes(state);
          const currentForward = referenceReachability(state, false, FORWARD);
          const currentReverse = referenceReachability(state, false, REVERSED);
          const structuralForward = referenceReachability(state, true, FORWARD);
          const structuralReverse = referenceReachability(
            state,
            true,
            REVERSED,
          );

          expect(currentReverse).toEqual(currentForward);
          expect(structuralReverse.exit).toBe(structuralForward.exit);
          expect(analysis.currentRoute).toBe(currentForward.exit);
          expect(analysis.structuralPotentialRoute).toBe(
            structuralForward.exit,
          );
          expect(analysis.reachableUncollectedBattery).toBe(
            currentForward.battery,
          );
        },
      ),
      { numRuns: PROPERTY_RUNS, seed: 0x7102 },
    );
  });

  it("implements exact zero-observation battery semantics", () => {
    fc.assert(
      fc.property(boardArbitrary, fc.boolean(), (modes, collectBatteries) => {
        const analysis = analyzeRoutes(createState(modes, 0, collectBatteries));
        expect(analysis.legalPotentialRoute).toBe(
          analysis.structuralPotentialRoute &&
            (analysis.currentRoute ||
              analysis.reachableUncollectedBattery),
        );
      }),
      { numRuns: PROPERTY_RUNS, seed: 0x7103 },
    );
  });

  it("is pure over retained generated route states", () => {
    fc.assert(
      fc.property(
        boardArbitrary,
        fc.integer({ min: 0, max: 10 }),
        fc.boolean(),
        (modes, observations, collectBatteries) => {
          const state = createState(modes, observations, collectBatteries);
          const before = JSON.stringify(state);
          const board = state.board;
          const collections = state.collectedBatteries;

          analyzeRoutes(state);

          expect(JSON.stringify(state)).toBe(before);
          expect(state.board).toBe(board);
          expect(state.collectedBatteries).toBe(collections);
        },
      ),
      { numRuns: PROPERTY_RUNS, seed: 0x7104 },
    );
  });
});
