import { describe, expect, it } from "vitest";

import { ENTRY_COORDINATE, EXIT_COORDINATE } from "./constants";
import { allCoordinatesRowMajor, coordinateKey } from "./coordinates";
import {
  analyzeRoutes,
  findReachableUncollectedBatteries,
  hasCurrentRoute,
  hasLegalPotentialRoute,
  hasReachableUncollectedBattery,
  hasStructuralPotentialRoute,
  type RouteState,
} from "./routes";
import type { Cell, Coordinate, Distribution, Outcome } from "./types";

const FLOOR_SUPPORT = [1, 0, 0, 0, 0] as const;
const CRYSTAL_SUPPORT = [0, 0, 0, 1, 0] as const;
const BATTERY_SUPPORT = [0, 0, 0, 0, 1] as const;
const BLOCKED_SUPPORT = [0, 0.5, 0.5, 0, 0] as const;

const coordinate = (row: number, col: number): Coordinate => ({ row, col });
const route = Object.freeze([
  ...Array.from({ length: 7 }, (_, col) => coordinate(6, col)),
  ...Array.from({ length: 6 }, (_, offset) => coordinate(5 - offset, 6)),
]);

const collapsed = (coordinateValue: Coordinate, outcome: Outcome): Cell => ({
  kind: "COLLAPSED",
  coordinate: coordinateValue,
  outcome,
});

const unresolved = (
  coordinateValue: Coordinate,
  distribution: Distribution,
): Cell => ({ kind: "UNRESOLVED", coordinate: coordinateValue, distribution });

const createState = (
  replacements: readonly Cell[],
  options: Readonly<{
    observations?: number;
    collectedBatteries?: readonly Coordinate[];
    player?: Coordinate;
  }> = {},
): RouteState => {
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
  return {
    board,
    player: options.player ?? ENTRY_COORDINATE,
    observations: options.observations ?? 1,
    collectedBatteries: options.collectedBatteries ?? [],
  };
};

const collapsedRoute = (outcomeAtBridge: Outcome = "FLOOR"): readonly Cell[] =>
  route.map((cellCoordinate) =>
    collapsed(
      cellCoordinate,
      cellCoordinate.row === 6 && cellCoordinate.col === 3
        ? outcomeAtBridge
        : "FLOOR",
    ),
  );

const structuralRoute = (distribution: Distribution): readonly Cell[] =>
  route.map((cellCoordinate) =>
    cellCoordinate.row === 6 && cellCoordinate.col === 3
      ? unresolved(cellCoordinate, distribution)
      : collapsed(cellCoordinate, "FLOOR"),
  );

describe("route analysis", () => {
  it.each(["FLOOR", "CRYSTAL", "BATTERY"] as const)(
    "treats collapsed %s as current-passable",
    (outcome) => {
      const state = createState(collapsedRoute(outcome));
      const analysis = analyzeRoutes(state);

      expect(analysis.currentRoute).toBe(true);
      expect(analysis.structuralPotentialRoute).toBe(true);
      expect(analysis.legalPotentialRoute).toBe(true);
      expect(hasCurrentRoute(state)).toBe(true);
    },
  );

  it.each(["WALL", "VOID"] as const)(
    "treats collapsed %s as impassable",
    (outcome) => {
      const analysis = analyzeRoutes(createState(collapsedRoute(outcome)));
      expect(analysis.currentRoute).toBe(false);
      expect(analysis.structuralPotentialRoute).toBe(false);
      expect(analysis.legalPotentialRoute).toBe(false);
    },
  );

  it.each([
    ["FLOOR", FLOOR_SUPPORT],
    ["CRYSTAL", CRYSTAL_SUPPORT],
    ["BATTERY", BATTERY_SUPPORT],
  ] as const)(
    "admits unresolved positive %s support only to structural potential",
    (_name, distribution) => {
      const state = createState(structuralRoute(distribution));
      expect(hasCurrentRoute(state)).toBe(false);
      expect(hasStructuralPotentialRoute(state)).toBe(true);
      expect(hasLegalPotentialRoute(state)).toBe(true);
    },
  );

  it("blocks unresolved support containing only WALL and VOID", () => {
    const state = createState(structuralRoute(BLOCKED_SUPPORT));
    expect(analyzeRoutes(state)).toMatchObject({
      currentRoute: false,
      structuralPotentialRoute: false,
      legalPotentialRoute: false,
    });
  });

  it("requires structural potential before any legal resource rule", () => {
    const battery = coordinate(6, 1);
    const state = createState(
      [
        collapsed(ENTRY_COORDINATE, "FLOOR"),
        collapsed(battery, "BATTERY"),
      ],
      { observations: 0 },
    );
    expect(analyzeRoutes(state)).toMatchObject({
      structuralPotentialRoute: false,
      reachableUncollectedBattery: true,
      legalPotentialRoute: false,
    });
  });

  it("keeps a structural route legal while an observation remains", () => {
    const state = createState(structuralRoute(FLOOR_SUPPORT), {
      observations: 1,
    });
    expect(analyzeRoutes(state)).toMatchObject({
      currentRoute: false,
      structuralPotentialRoute: true,
      legalPotentialRoute: true,
    });
  });

  it("keeps a current exit route legal at exactly zero observations", () => {
    const state = createState(collapsedRoute(), { observations: 0 });
    expect(analyzeRoutes(state)).toMatchObject({
      currentRoute: true,
      structuralPotentialRoute: true,
      legalPotentialRoute: true,
    });
  });

  it("uses only currently reachable collapsed uncollected batteries at zero observations", () => {
    const battery = coordinate(6, 1);
    const bridge = coordinate(6, 3);
    const state = createState(
      route.map((cellCoordinate) => {
        if (coordinateKey(cellCoordinate) === coordinateKey(battery)) {
          return collapsed(cellCoordinate, "BATTERY");
        }
        if (coordinateKey(cellCoordinate) === coordinateKey(bridge)) {
          return unresolved(cellCoordinate, FLOOR_SUPPORT);
        }
        return collapsed(cellCoordinate, "FLOOR");
      }),
      { observations: 0 },
    );

    expect(analyzeRoutes(state)).toMatchObject({
      currentRoute: false,
      structuralPotentialRoute: true,
      reachableUncollectedBattery: true,
      reachableUncollectedBatteries: [battery],
      legalPotentialRoute: true,
    });
    expect(findReachableUncollectedBatteries(state)).toEqual([battery]);
    expect(hasReachableUncollectedBattery(state)).toBe(true);

    const collected = { ...state, collectedBatteries: [battery] };
    expect(analyzeRoutes(collected)).toMatchObject({
      reachableUncollectedBattery: false,
      legalPotentialRoute: false,
    });
  });

  it("does not count an unresolved or current-inaccessible battery", () => {
    const unresolvedBattery = coordinate(6, 1);
    const isolatedBattery = coordinate(4, 4);
    const state = createState(
      [
        ...structuralRoute(FLOOR_SUPPORT),
        unresolved(unresolvedBattery, BATTERY_SUPPORT),
        collapsed(isolatedBattery, "BATTERY"),
      ],
      { observations: 0 },
    );
    expect(analyzeRoutes(state)).toMatchObject({
      currentRoute: false,
      structuralPotentialRoute: true,
      reachableUncollectedBattery: false,
      legalPotentialRoute: false,
    });
  });

  it("leaves input state and collections unchanged", () => {
    const state = createState(structuralRoute(FLOOR_SUPPORT));
    const before = JSON.stringify(state);
    const board = state.board;
    const collected = state.collectedBatteries;

    analyzeRoutes(state);

    expect(JSON.stringify(state)).toBe(before);
    expect(state.board).toBe(board);
    expect(state.collectedBatteries).toBe(collected);
  });
});
