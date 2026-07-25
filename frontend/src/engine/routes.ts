import { BOARD_CELL_COUNT, BOARD_SIZE, PASSABLE_OUTCOMES } from "./constants";
import { coordinateKey } from "./coordinates";
import type { Cell, Coordinate, GameState, Outcome } from "./types";

export type RouteState = Pick<
  GameState,
  "board" | "player" | "observations" | "collectedBatteries"
>;

export type RouteAnalysis = Readonly<{
  currentRoute: boolean;
  structuralPotentialRoute: boolean;
  legalPotentialRoute: boolean;
  reachableUncollectedBattery: boolean;
  reachableUncollectedBatteries: readonly Coordinate[];
}>;

type Traversal = Readonly<{
  reachesExit: boolean;
  visited: Uint8Array;
}>;

const boardIndex = (coordinate: Coordinate): number =>
  coordinate.row * BOARD_SIZE + coordinate.col;

const isCollapsedPassable = (cell: Cell | undefined): boolean =>
  cell?.kind === "COLLAPSED" &&
  (PASSABLE_OUTCOMES as readonly Outcome[]).includes(cell.outcome);

const hasPassableSupport = (cell: Cell | undefined): boolean =>
  cell?.kind === "UNRESOLVED" &&
  (cell.distribution[0] > 0 ||
    cell.distribution[3] > 0 ||
    cell.distribution[4] > 0);

const traverse = (
  state: RouteState,
  canEnter: (cell: Cell | undefined) => boolean,
): Traversal => {
  const visited = new Uint8Array(BOARD_CELL_COUNT);
  const queue = new Int8Array(BOARD_CELL_COUNT);
  const startIndex = boardIndex(state.player);
  let head = 0;
  let tail = 0;

  visited[startIndex] = 1;
  queue[tail] = startIndex;
  tail += 1;

  while (head < tail) {
    const current = queue[head];
    head += 1;
    if (current === undefined) {
      break;
    }

    const row = Math.floor(current / BOARD_SIZE);
    const col = current % BOARD_SIZE;
    const neighborIndexes = [
      row > 0 ? current - BOARD_SIZE : -1,
      col > 0 ? current - 1 : -1,
      col + 1 < BOARD_SIZE ? current + 1 : -1,
      row + 1 < BOARD_SIZE ? current + BOARD_SIZE : -1,
    ];

    for (const neighborIndex of neighborIndexes) {
      if (neighborIndex < 0 || visited[neighborIndex] === 1) {
        continue;
      }
      if (!canEnter(state.board[neighborIndex])) {
        continue;
      }
      visited[neighborIndex] = 1;
      queue[tail] = neighborIndex;
      tail += 1;
    }
  }

  return Object.freeze({
    reachesExit: visited[BOARD_SIZE - 1] === 1,
    visited,
  });
};

const currentTraversal = (state: RouteState): Traversal =>
  traverse(state, isCollapsedPassable);

const structuralTraversal = (state: RouteState): Traversal =>
  traverse(
    state,
    (cell) => isCollapsedPassable(cell) || hasPassableSupport(cell),
  );

const reachableUncollectedBatteries = (
  state: RouteState,
  visited: Uint8Array,
): readonly Coordinate[] => {
  const collected = new Set(state.collectedBatteries.map(coordinateKey));
  const reachable = state.board
    .filter(
      (cell, index) =>
        visited[index] === 1 &&
        cell.kind === "COLLAPSED" &&
        cell.outcome === "BATTERY" &&
        !collected.has(coordinateKey(cell.coordinate)),
    )
    .map((cell) => cell.coordinate);
  return Object.freeze(reachable);
};

/**
 * Computes all route facts with two bounded orthogonal BFS traversals. The
 * current traversal also supplies battery reachability, avoiding a third BFS.
 */
export const analyzeRoutes = (state: RouteState): RouteAnalysis => {
  const current = currentTraversal(state);
  const structural = structuralTraversal(state);
  const batteries = reachableUncollectedBatteries(state, current.visited);
  const reachableUncollectedBattery = batteries.length > 0;
  const legalPotentialRoute =
    structural.reachesExit &&
    (state.observations > 0 ||
      current.reachesExit ||
      reachableUncollectedBattery);

  return Object.freeze({
    currentRoute: current.reachesExit,
    structuralPotentialRoute: structural.reachesExit,
    legalPotentialRoute,
    reachableUncollectedBattery,
    reachableUncollectedBatteries: batteries,
  });
};

export const hasCurrentRoute = (state: RouteState): boolean =>
  currentTraversal(state).reachesExit;

export const hasStructuralPotentialRoute = (state: RouteState): boolean =>
  structuralTraversal(state).reachesExit;

export const findReachableUncollectedBatteries = (
  state: RouteState,
): readonly Coordinate[] => {
  const current = currentTraversal(state);
  return reachableUncollectedBatteries(state, current.visited);
};

export const hasReachableUncollectedBattery = (state: RouteState): boolean =>
  findReachableUncollectedBatteries(state).length > 0;

export const hasLegalPotentialRoute = (state: RouteState): boolean =>
  analyzeRoutes(state).legalPotentialRoute;
