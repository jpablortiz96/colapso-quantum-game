import { describe, expect, it } from "vitest";

import { DISTRIBUTION_SUM_TOLERANCE } from "./constants";
import { sampleDistribution, validateDistribution } from "./distribution";

describe("distribution validation", () => {
  it.each([
    { distribution: [0.2, 0.2, 0.2, 0.2, 0.2] },
    { distribution: [1, 0, 0, 0, 0] },
    { distribution: [0, 0.25, 0, 0.75, 0] },
  ])("accepts valid canonical five-tuples %#", ({ distribution }) => {
    const result = validateDistribution(distribution);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual(distribution);
      expect(result.value).not.toBe(distribution);
      expect(Object.isFrozen(result.value)).toBe(true);
    }
  });

  it.each([
    { distribution: null },
    { distribution: {} },
    { distribution: [1] },
    { distribution: [0.25, 0.25, 0.25, 0.25, 0, 0] },
  ])(
    "rejects wrong arity %#",
    ({ distribution }) => {
      const result = validateDistribution(distribution);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.reason).toBe("WRONG_ARITY");
      }
    },
  );

  it.each([
    { distribution: [Number.NaN, 0, 0, 0, 1] },
    { distribution: [Number.POSITIVE_INFINITY, 0, 0, 0, 0] },
    { distribution: [Number.NEGATIVE_INFINITY, 0, 0, 0, 0] },
    { distribution: ["1", 0, 0, 0, 0] },
  ])("rejects non-finite probability %#", ({ distribution }) => {
    const result = validateDistribution(distribution);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.reason).toBe("NON_FINITE_PROBABILITY");
    }
  });

  it("rejects a negative probability", () => {
    const result = validateDistribution([-0.1, 0.2, 0.3, 0.3, 0.3]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.reason).toBe("NEGATIVE_PROBABILITY");
    }
  });

  it("accepts sums just inside and at the lower tolerance boundary", () => {
    const inside = validateDistribution([
      1 - DISTRIBUTION_SUM_TOLERANCE / 2,
      0,
      0,
      0,
      0,
    ]);
    const boundary = validateDistribution([
      1 - DISTRIBUTION_SUM_TOLERANCE,
      0,
      0,
      0,
      0,
    ]);
    expect(inside.ok).toBe(true);
    expect(boundary.ok).toBe(true);
  });

  it("rejects sums immediately outside either tolerance side", () => {
    const delta = DISTRIBUTION_SUM_TOLERANCE + Number.EPSILON * 4;
    for (const total of [1 - delta, 1 + delta]) {
      const result = validateDistribution([total, 0, 0, 0, 0]);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.reason).toBe("SUM_OUT_OF_TOLERANCE");
      }
    }
  });
});

describe("canonical distribution sampling", () => {
  it.each([
    [0, "FLOOR"],
    [0.49999999999999994, "FLOOR"],
    [0.5, "WALL"],
    [0.9999999999999999, "WALL"],
  ] as const)("samples quantile %s as %s", (quantile, expected) => {
    expect(sampleDistribution([0.5, 0.5, 0, 0, 0], quantile)).toEqual({
      ok: true,
      value: expected,
    });
  });

  it("skips zero-probability outcomes", () => {
    expect(sampleDistribution([0, 0.25, 0, 0.75, 0], 0)).toEqual({
      ok: true,
      value: "WALL",
    });
    expect(sampleDistribution([0, 0.25, 0, 0.75, 0], 0.25)).toEqual({
      ok: true,
      value: "CRYSTAL",
    });
  });

  it("assigns a tolerated cumulative remainder to the last active outcome", () => {
    const distribution = [0.2, 0, 0.7999999999995, 0, 0];
    const quantile = 0.99999999999975;
    expect(sampleDistribution(distribution, quantile)).toEqual({
      ok: true,
      value: "VOID",
    });
  });

  it.each([-0.1, 1, 1.1, Number.NaN, Number.POSITIVE_INFINITY, "0.5"])(
    "rejects invalid quantile %#",
    (quantile) => {
      const result = sampleDistribution([1, 0, 0, 0, 0], quantile);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.reason).toBe("INVALID_QUANTILE");
      }
    },
  );

  it("validates the distribution before validating the quantile", () => {
    const result = sampleDistribution([1, 0], 2);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.reason).toBe("WRONG_ARITY");
    }
  });
});
