import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { validateDistribution } from "./distribution";
import { applyHGate, applyXGate } from "./gates";
import type { Distribution } from "./types";

const PROPERTY_RUNS = 100;
const PARTICIPATION_THRESHOLD = 1e-12;

const distributionArbitrary: fc.Arbitrary<Distribution> = fc
  .array(fc.integer({ min: 0, max: 1_000_000 }), {
    minLength: 5,
    maxLength: 5,
  })
  .filter((weights) => weights.some((weight) => weight > 0))
  .map((weights) => {
    const total = weights.reduce((sum, weight) => sum + weight, 0);
    return Object.freeze(
      weights.map((weight) => weight / total),
    ) as unknown as Distribution;
  });

const sumDistribution = (distribution: Distribution): number =>
  distribution.reduce((sum, probability) => sum + probability, 0);

describe("gate algebra properties", () => {
  it("X preserves support, mass, validity, and is exactly involutive", () => {
    fc.assert(
      fc.property(distributionArbitrary, (distribution) => {
        const transformed = applyXGate(distribution);
        const restored = applyXGate(transformed);

        expect(validateDistribution(transformed).ok).toBe(true);
        expect(
          transformed.every(
            (probability) => Number.isFinite(probability) && probability >= 0,
          ),
        ).toBe(true);
        expect(
          transformed.map((probability) => probability > 0),
        ).toEqual(distribution.map((probability) => probability > 0));
        expect(
          Math.abs(sumDistribution(transformed) - sumDistribution(distribution)),
        ).toBeLessThanOrEqual(1e-12);
        expect(restored).toEqual(distribution);
      }),
      { numRuns: PROPERTY_RUNS, seed: 0x4a01 },
    );
  });

  it("H equalizes exactly p > 1e-12 participants and produces total mass one", () => {
    fc.assert(
      fc.property(distributionArbitrary, (distribution) => {
        const transformed = applyHGate(distribution);
        const participants = distribution
          .map((probability, index) =>
            probability > PARTICIPATION_THRESHOLD ? index : -1,
          )
          .filter((index) => index >= 0);
        const participantSet = new Set(participants);
        let assignedMass = 0;

        participants.forEach((index, participantIndex) => {
          const expected = participantIndex === participants.length - 1
            ? 1 - assignedMass
            : 1 / participants.length;
          expect(transformed[index]).toBe(expected);
          assignedMass += expected;
        });
        transformed.forEach((probability, index) => {
          if (!participantSet.has(index)) {
            expect(probability).toBe(0);
          }
        });
        expect(sumDistribution(transformed)).toBe(1);
        expect(validateDistribution(transformed).ok).toBe(true);
        expect(
          transformed.every(
            (probability) => Number.isFinite(probability) && probability >= 0,
          ),
        ).toBe(true);
      }),
      { numRuns: PROPERTY_RUNS, seed: 0x4a02 },
    );
  });
});
