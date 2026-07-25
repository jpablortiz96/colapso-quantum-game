import { describe, expect, it } from "vitest";

import { generateInitialState } from "./generation";
import { calculateScore } from "./score";
import type { GameState, GameStatus } from "./types";

const generatedState = (): GameState => {
  const result = generateInitialState("score-unit");
  if (!result.ok) {
    throw new Error(result.error.message);
  }
  return result.value;
};

describe("exact score projection", () => {
  it.each(["START", "PLAYING", "VICTORY", "DEFEAT"] as const)(
    "uses only observations, collected crystals, and turns at %s",
    (status: GameStatus) => {
      const state = {
        ...generatedState(),
        status,
        observations: 7,
        turn: 13,
        collectedCrystals: [{ row: 1, col: 1 }, { row: 2, col: 2 }],
      } as GameState;

      expect(calculateScore(state)).toBe(7 * 100 + 2 * 50 - 13 * 5);
    },
  );

  it("retains negative scores without a clamp or terminal adjustment", () => {
    const state = {
      ...generatedState(),
      status: "DEFEAT",
      observations: 0,
      turn: 31,
      collectedCrystals: [],
    } as GameState;

    expect(calculateScore(state)).toBe(-155);
  });

  it("does not include energy, inventory, pairs, board, or terminal reason", () => {
    const base = {
      ...generatedState(),
      status: "PLAYING",
      observations: 4,
      turn: 9,
      collectedCrystals: [{ row: 1, col: 1 }],
    } as GameState;
    const changed = {
      ...base,
      energy: 0,
      inventory: [],
      pairs: [],
      board: [],
      player: { row: 0, col: 6 },
      terminalReason: "EXIT_REACHED",
      collectedBatteries: [{ row: 5, col: 5 }],
    } as unknown as GameState;

    expect(calculateScore(changed)).toBe(calculateScore(base));
  });
});
