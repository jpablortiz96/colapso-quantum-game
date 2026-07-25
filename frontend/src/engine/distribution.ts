import {
  DISTRIBUTION_SUM_TOLERANCE,
  OUTCOME_ORDER,
} from "./constants";
import type {
  DistributionSampleResult,
  DistributionValidationResult,
  InvalidDistributionError,
} from "./errors";
import type { Distribution } from "./types";

const invalidDistribution = (
  reason: InvalidDistributionError["reason"],
  message: string,
): DistributionValidationResult => ({
  ok: false,
  error: { kind: "INVALID_DISTRIBUTION", reason, message },
});

const invalidSample = (
  reason: InvalidDistributionError["reason"],
  message: string,
): DistributionSampleResult => ({
  ok: false,
  error: { kind: "INVALID_DISTRIBUTION", reason, message },
});

export const validateDistribution = (
  value: unknown,
): DistributionValidationResult => {
  if (!Array.isArray(value) || value.length !== OUTCOME_ORDER.length) {
    return invalidDistribution(
      "WRONG_ARITY",
      `Distribution must contain exactly ${OUTCOME_ORDER.length} probabilities.`,
    );
  }

  let sum = 0;
  for (let index = 0; index < value.length; index += 1) {
    const probability: unknown = value[index];
    if (typeof probability !== "number" || !Number.isFinite(probability)) {
      return invalidDistribution(
        "NON_FINITE_PROBABILITY",
        `Distribution probability at index ${index} must be finite.`,
      );
    }
    if (probability < 0) {
      return invalidDistribution(
        "NEGATIVE_PROBABILITY",
        `Distribution probability at index ${index} must be non-negative.`,
      );
    }
    sum += probability;
  }

  if (Math.abs(sum - 1) > DISTRIBUTION_SUM_TOLERANCE) {
    return invalidDistribution(
      "SUM_OUT_OF_TOLERANCE",
      `Distribution sum must differ from 1 by no more than ${DISTRIBUTION_SUM_TOLERANCE}.`,
    );
  }

  const distribution = Object.freeze([...value]) as unknown as Distribution;
  return { ok: true, value: distribution };
};

export const sampleDistribution = (
  value: unknown,
  quantile: unknown,
): DistributionSampleResult => {
  const validation = validateDistribution(value);
  if (!validation.ok) {
    return validation;
  }

  if (
    typeof quantile !== "number" ||
    !Number.isFinite(quantile) ||
    quantile < 0 ||
    quantile >= 1
  ) {
    return invalidSample(
      "INVALID_QUANTILE",
      "Sampling quantile must be a finite number in [0, 1).",
    );
  }

  let cumulative = 0;
  let lastActiveIndex = -1;
  for (let index = 0; index < validation.value.length; index += 1) {
    const probability = validation.value[index];
    if (probability === undefined || probability <= 0) {
      continue;
    }

    lastActiveIndex = index;
    cumulative += probability;
    if (quantile < cumulative) {
      const outcome = OUTCOME_ORDER[index];
      if (outcome !== undefined) {
        return { ok: true, value: outcome };
      }
    }
  }

  if (lastActiveIndex >= 0) {
    const outcome = OUTCOME_ORDER[lastActiveIndex];
    if (outcome !== undefined) {
      return { ok: true, value: outcome };
    }
  }

  return invalidSample(
    "NO_ACTIVE_OUTCOME",
    "A valid distribution must contain an active outcome.",
  );
};
