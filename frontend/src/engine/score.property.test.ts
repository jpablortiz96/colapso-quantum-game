import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { generateInitialState } from "./generation";
import { calculateScore } from "./score";
import type { GameState } from "./types";

const PROPERTY_RUNS = 100;

const baseState = (): GameState => {
  const result = generateInitialState("score-property-base");
  if (!result.ok) {
    throw new Error(result.error.message);
  }
  return result.value;
};

describe("score properties", () => {
  it("equals the exact formula and preserves negative results", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 10 }),
        fc.integer({ min: 0, max: 20 }),
        fc.integer({ min: 0, max: 10_000 }),
        (observations, crystalCount, turn) => {
          const state = {
            ...baseState(),
            observations,
            turn,
            collectedCrystals: Array.from(
              { length: crystalCount },
              (_, index) => ({ row: Math.floor(index / 7), col: index % 7 }),
            ),
          } as GameState;

          expect(calculateScore(state)).toBe(
            observations * 100 + crystalCount * 50 - turn * 5,
          );
        },
      ),
      { numRuns: PROPERTY_RUNS, seed: 0x8101 },
    );
  });

  it("is invariant under every unrelated state field", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 10 }),
        fc.integer({ min: 0, max: 10 }),
        fc.integer({ min: 0, max: 1_000 }),
        fc.boolean(),
        fc.string(),
        (observations, crystalCount, turn, toggle, text) => {
          const crystals = Array.from(
            { length: crystalCount },
            (_, index) => ({ row: Math.floor(index / 7), col: index % 7 }),
          );
          const first = {
            ...baseState(),
            observations,
            turn,
            collectedCrystals: crystals,
          } as GameState;
          const second = {
            ...first,
            status: toggle ? "VICTORY" : "DEFEAT",
            terminalReason: toggle ? "EXIT_REACHED" : "RESOURCE_DEAD_END",
            energy: toggle ? 1 : 0,
            inventory: toggle ? ["X"] : ["H"],
            player: toggle ? { row: 0, col: 6 } : { row: 6, col: 0 },
            pairs: text.length === 0 ? [] : first.pairs,
            collectedBatteries: toggle ? [{ row: 3, col: 3 }] : [],
          } as unknown as GameState;

          expect(calculateScore(second)).toBe(calculateScore(first));
        },
      ),
      { numRuns: PROPERTY_RUNS, seed: 0x8102 },
    );
  });
});
