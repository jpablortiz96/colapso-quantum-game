import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  DISTRIBUTION_SUM_TOLERANCE,
  ENTRY_COORDINATE,
  EXIT_COORDINATE,
  INITIAL_ENERGY,
  INITIAL_INVENTORY,
  INITIAL_OBSERVATIONS,
} from "./constants";
import {
  compareCoordinates,
  coordinateKey,
  coordinatesEqual,
} from "./coordinates";
import { generateInitialState } from "./generation";
import { validateGameState } from "./invariants";
import type { GameState } from "./types";

const unicodeScalarArbitrary = fc.oneof(
  fc.integer({ min: 0, max: 0xd7ff }),
  fc.integer({ min: 0xe000, max: 0x10ffff }),
);

const nonEmptyUtf8SeedArbitrary = fc
  .array(unicodeScalarArbitrary, { minLength: 1, maxLength: 24 })
  .map((codePoints) => String.fromCodePoint(...codePoints));

const generatedState = (seed: string): GameState => {
  const result = generateInitialState(seed);
  if (!result.ok) {
    throw new Error(result.error.message);
  }
  return result.value;
};

const PROPERTY_RUNS = 100;

describe("deterministic generation properties", () => {
  it("produces deep and JSON-byte-ready equality for identical seeds", () => {
    fc.assert(
      fc.property(nonEmptyUtf8SeedArbitrary, (seed) => {
        const first = generatedState(seed);
        const second = generatedState(seed);
        expect(second).toEqual(first);
        expect(JSON.stringify(second)).toBe(JSON.stringify(first));
      }),
      { numRuns: PROPERTY_RUNS, seed: 0x2a01 },
    );
  });

  it("always produces the fixed row-major board and endpoints", () => {
    fc.assert(
      fc.property(nonEmptyUtf8SeedArbitrary, (seed) => {
        const state = generatedState(seed);
        expect(state.board).toHaveLength(49);
        for (let index = 0; index < state.board.length; index += 1) {
          expect(state.board[index]?.coordinate).toEqual({
            row: Math.floor(index / 7),
            col: index % 7,
          });
        }
        expect(state.board[6]).toEqual({
          kind: "COLLAPSED",
          coordinate: EXIT_COORDINATE,
          outcome: "FLOOR",
        });
        expect(state.board[42]).toEqual({
          kind: "COLLAPSED",
          coordinate: ENTRY_COORDINATE,
          outcome: "FLOOR",
        });
      }),
      { numRuns: PROPERTY_RUNS, seed: 0x2a02 },
    );
  });

  it("always produces 47 positive normalized five-outcome distributions", () => {
    fc.assert(
      fc.property(nonEmptyUtf8SeedArbitrary, (seed) => {
        const unresolved = generatedState(seed).board.filter(
          (cell) => cell.kind === "UNRESOLVED",
        );
        expect(unresolved).toHaveLength(47);
        for (const cell of unresolved) {
          expect(cell.distribution).toHaveLength(5);
          expect(
            cell.distribution.every(
              (probability) =>
                Number.isFinite(probability) && probability > 0,
            ),
          ).toBe(true);
          const sum = cell.distribution.reduce(
            (total, probability) => total + probability,
            0,
          );
          expect(Math.abs(sum - 1)).toBeLessThanOrEqual(
            DISTRIBUTION_SUM_TOLERANCE,
          );
        }
      }),
      { numRuns: PROPERTY_RUNS, seed: 0x2a03 },
    );
  });

  it("always produces three to five canonical disjoint non-endpoint pairs", () => {
    fc.assert(
      fc.property(nonEmptyUtf8SeedArbitrary, (seed) => {
        const pairs = generatedState(seed).pairs;
        expect(pairs.length).toBeGreaterThanOrEqual(3);
        expect(pairs.length).toBeLessThanOrEqual(5);
        const members = new Set<string>();
        for (let index = 0; index < pairs.length; index += 1) {
          const pair = pairs[index];
          expect(pair).toBeDefined();
          if (pair === undefined) {
            continue;
          }
          expect(pair.id).toBe(`pair-${index}`);
          expect(compareCoordinates(pair.memberA, pair.memberB)).toBeLessThan(0);
          expect(coordinatesEqual(pair.memberA, ENTRY_COORDINATE)).toBe(false);
          expect(coordinatesEqual(pair.memberA, EXIT_COORDINATE)).toBe(false);
          expect(coordinatesEqual(pair.memberB, ENTRY_COORDINATE)).toBe(false);
          expect(coordinatesEqual(pair.memberB, EXIT_COORDINATE)).toBe(false);
          expect(["CORRELATED", "ANTI_CORRELATED"]).toContain(pair.policy);
          const memberAKey = coordinateKey(pair.memberA);
          const memberBKey = coordinateKey(pair.memberB);
          expect(members.has(memberAKey)).toBe(false);
          expect(members.has(memberBKey)).toBe(false);
          members.add(memberAKey);
          members.add(memberBKey);
        }
      }),
      { numRuns: PROPERTY_RUNS, seed: 0x2a04 },
    );
  });

  it("always returns valid immutable initial resources and inventory", () => {
    fc.assert(
      fc.property(nonEmptyUtf8SeedArbitrary, (seed) => {
        const state = generatedState(seed);
        expect(state.status).toBe("START");
        expect(state.terminalReason).toBeNull();
        expect(state.turn).toBe(0);
        expect(state.player).toEqual(ENTRY_COORDINATE);
        expect(state.observations).toBe(INITIAL_OBSERVATIONS);
        expect(state.energy).toBe(INITIAL_ENERGY);
        expect(state.inventory).toEqual(INITIAL_INVENTORY);
        expect(state.inventory.length).toBeLessThanOrEqual(2);
        expect(state.collectedCrystals).toEqual([]);
        expect(state.collectedBatteries).toEqual([]);
        expect(validateGameState(state).ok).toBe(true);
        expect(Object.isFrozen(state)).toBe(true);
        expect(Object.isFrozen(state.board)).toBe(true);
        expect(Object.isFrozen(state.inventory)).toBe(true);
        for (const cell of state.board) {
          expect(Object.isFrozen(cell)).toBe(true);
          expect(Object.isFrozen(cell.coordinate)).toBe(true);
          if (cell.kind === "UNRESOLVED") {
            expect(Object.isFrozen(cell.distribution)).toBe(true);
          }
        }
      }),
      { numRuns: PROPERTY_RUNS, seed: 0x2a05 },
    );
  });
});
