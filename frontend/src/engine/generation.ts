import {
  ENTRY_COORDINATE,
  EXIT_COORDINATE,
  INITIAL_INVENTORY,
  RULES_VERSION,
  SCHEMA_VERSION,
  V1_RULE_CONFIG,
} from "./constants";
import {
  allCoordinatesRowMajor,
  compareCoordinates,
  coordinatesEqual,
} from "./coordinates";
import { validateDistribution } from "./distribution";
import { drawUnbiasedBoundedIntegerFromUint32 } from "./entropy";
import type {
  GenerationError,
  GenerationResult,
  InvalidStateError,
} from "./errors";
import { validateGameState } from "./invariants";
import { createSeedPrng } from "./seed-prng";
import type {
  Cell,
  Coordinate,
  Distribution,
  EntangledPair,
  GameState,
  Result,
} from "./types";

const isEndpoint = (coordinate: Coordinate): boolean =>
  coordinatesEqual(coordinate, ENTRY_COORDINATE) ||
  coordinatesEqual(coordinate, EXIT_COORDINATE);

const impossibleStateError = (message: string): InvalidStateError => ({
  kind: "INVALID_STATE",
  reason: "MALFORMED_STATE",
  path: "$",
  message,
});

const createDistribution = (
  nextBounded: (bound: number) => number,
): Result<Distribution, GenerationError> => {
  const weights: number[] = [];
  for (let index = 0; index < 5; index += 1) {
    weights.push(1 + nextBounded(100));
  }

  const first = weights[0];
  const second = weights[1];
  const third = weights[2];
  const fourth = weights[3];
  const fifth = weights[4];
  if (
    first === undefined ||
    second === undefined ||
    third === undefined ||
    fourth === undefined ||
    fifth === undefined
  ) {
    return {
      ok: false,
      error: impossibleStateError("Generator did not produce five weights."),
    };
  }

  const total = first + second + third + fourth + fifth;
  const firstFour = [
    first / total,
    second / total,
    third / total,
    fourth / total,
  ] as const;
  const firstFourSum = firstFour.reduce(
    (sum, probability) => sum + probability,
    0,
  );
  const probabilities = [...firstFour, 1 - firstFourSum];
  const validation = validateDistribution(probabilities);
  return validation;
};

const shuffleCoordinates = (
  coordinates: readonly Coordinate[],
  nextBounded: (bound: number) => number,
): Coordinate[] => {
  const shuffled = [...coordinates];
  for (let index = shuffled.length - 1; index >= 1; index -= 1) {
    const swapIndex = nextBounded(index + 1);
    const current = shuffled[index];
    const replacement = shuffled[swapIndex];
    if (current === undefined || replacement === undefined) {
      throw new RangeError("Fisher-Yates selected an invalid coordinate index.");
    }
    shuffled[index] = replacement;
    shuffled[swapIndex] = current;
  }
  return shuffled;
};

export const generateInitialState = (
  seed: unknown,
  rulesVersion: number = RULES_VERSION,
): GenerationResult => {
  const prngResult = createSeedPrng(seed, rulesVersion);
  if (!prngResult.ok) {
    return prngResult;
  }

  const nextBounded = (bound: number): number =>
    drawUnbiasedBoundedIntegerFromUint32(bound, () =>
      prngResult.value.nextUint32(),
    );

  const coordinates = allCoordinatesRowMajor();
  const board: Cell[] = [];
  const eligibleCoordinates: Coordinate[] = [];

  for (const coordinate of coordinates) {
    if (isEndpoint(coordinate)) {
      board.push(
        Object.freeze({
          kind: "COLLAPSED",
          coordinate,
          outcome: "FLOOR",
        }),
      );
      continue;
    }

    const distributionResult = createDistribution(nextBounded);
    if (!distributionResult.ok) {
      return distributionResult;
    }
    board.push(
      Object.freeze({
        kind: "UNRESOLVED",
        coordinate,
        distribution: distributionResult.value,
      }),
    );
    eligibleCoordinates.push(coordinate);
  }

  const pairCount = 3 + nextBounded(3);
  const shuffled = shuffleCoordinates(eligibleCoordinates, nextBounded);
  const pairs: EntangledPair[] = [];
  for (let pairIndex = 0; pairIndex < pairCount; pairIndex += 1) {
    const first = shuffled[pairIndex * 2];
    const second = shuffled[pairIndex * 2 + 1];
    if (first === undefined || second === undefined) {
      return {
        ok: false,
        error: impossibleStateError("Generator selected incomplete pair members."),
      };
    }
    const [memberA, memberB] =
      compareCoordinates(first, second) < 0
        ? [first, second]
        : [second, first];
    const policy =
      nextBounded(2) === 0 ? "CORRELATED" : "ANTI_CORRELATED";
    pairs.push(
      Object.freeze({
        id: `pair-${pairIndex}`,
        memberA,
        memberB,
        policy,
      }),
    );
  }

  const state: GameState = Object.freeze({
    schemaVersion: SCHEMA_VERSION,
    rulesVersion: RULES_VERSION,
    status: "START",
    terminalReason: null,
    turn: 0,
    board: Object.freeze(board),
    player: ENTRY_COORDINATE,
    observations: V1_RULE_CONFIG.initialObservations,
    energy: V1_RULE_CONFIG.initialEnergy,
    inventory: Object.freeze([...INITIAL_INVENTORY]),
    pairs: Object.freeze(pairs),
    collectedCrystals: Object.freeze([]),
    collectedBatteries: Object.freeze([]),
  });

  const validation = validateGameState(state);
  if (!validation.ok) {
    if (validation.error.kind === "UNSUPPORTED_SCHEMA_VERSION") {
      return {
        ok: false,
        error: impossibleStateError(validation.error.message),
      };
    }
    return { ok: false, error: validation.error };
  }
  return { ok: true, value: state };
};

export const generateV1InitialState = generateInitialState;
