import type { GameState } from "./types";

/** The exact version 1 score projection, available at every game status. */
export const calculateScore = (state: GameState): number =>
  state.observations * 100 + state.collectedCrystals.length * 50 - state.turn * 5;
