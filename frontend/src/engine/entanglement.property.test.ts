import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { OUTCOME_ORDER } from "./constants";
import { UINT32_RANGE } from "./entropy";
import { collapseEntangledPair } from "./entanglement";
import type { EntropyError } from "./errors";
import { generateInitialState } from "./generation";
import { validateGameState } from "./invariants";
import type {
  Coordinate,
  Distribution,
  EntangledPair,
  EntropyContext,
  EntropySource,
  GameState,
  PairPolicy,
  Result,
} from "./types";

const PROPERTY_RUNS = 100;

const uint32Arbitrary = fc.integer({ min: 0, max: 0xffff_ffff });
const policyArbitrary = fc.constantFrom<PairPolicy>(
  "CORRELATED",
  "ANTI_CORRELATED",
);
const distributionArbitrary: fc.Arbitrary<Distribution> = fc
  .array(fc.integer({ min: 0, max: 1_000 }), {
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

const generatedState = (): GameState => {
  const result = generateInitialState("milestone-2-vector");
  if (!result.ok) {
    throw new Error(result.error.message);
  }
  return result.value;
};

const boardIndex = ({ row, col }: Coordinate): number => row * 7 + col;

const stateWithPairDistributions = (
  policy: PairPolicy,
  memberADistribution: Distribution,
  memberBDistribution: Distribution,
  observations: number,
  turn = 1,
): Readonly<{
  initial: GameState;
  state: GameState;
  pair: EntangledPair;
}> => {
  const initial = generatedState();
  const originalPair = initial.pairs[0];
  if (originalPair === undefined) {
    throw new Error("Property fixture did not contain a pair.");
  }
  const pair = Object.freeze({ ...originalPair, policy });
  const memberAIndex = boardIndex(pair.memberA);
  const memberBIndex = boardIndex(pair.memberB);
  const memberA = initial.board[memberAIndex];
  const memberB = initial.board[memberBIndex];
  if (memberA?.kind !== "UNRESOLVED" || memberB?.kind !== "UNRESOLVED") {
    throw new Error("Property fixture pair was not unresolved.");
  }
  const board = [...initial.board];
  board[memberAIndex] = Object.freeze({
    kind: "UNRESOLVED",
    coordinate: memberA.coordinate,
    distribution: memberADistribution,
  });
  board[memberBIndex] = Object.freeze({
    kind: "UNRESOLVED",
    coordinate: memberB.coordinate,
    distribution: memberBDistribution,
  });
  const state: GameState = Object.freeze({
    ...initial,
    status: "PLAYING",
    turn,
    observations,
    board: Object.freeze(board),
    pairs: Object.freeze([pair, ...initial.pairs.slice(1)]),
  });
  if (!validateGameState(state).ok) {
    throw new Error("Property pair fixture must be valid.");
  }
  return Object.freeze({ initial, state, pair });
};

const countingSource = (result: Result<number, EntropyError>) => {
  const contexts: EntropyContext[] = [];
  const source: EntropySource<EntropyError> = {
    nextUint32: (context) => {
      contexts.push(context);
      return result;
    },
  };
  return { source, contexts };
};

const collapsedOutcomeAt = (state: GameState, coordinate: Coordinate) => {
  const cell = state.board[boardIndex(coordinate)];
  if (cell?.kind !== "COLLAPSED") {
    throw new Error("Expected a collapsed property result.");
  }
  return cell.outcome;
};

const collapseEvents = (events: readonly { kind: string }[]) =>
  events.filter(({ kind }) => kind === "CELL_COLLAPSED");

describe("entangled pair properties", () => {
  it("is initiator-independent, support-valid, and charges one shared observation word", () => {
    fc.assert(
      fc.property(
        policyArbitrary,
        distributionArbitrary,
        distributionArbitrary,
        uint32Arbitrary,
        fc.integer({ min: 1, max: 10 }),
        (policy, distributionA, distributionB, word, observations) => {
          const fixture = stateWithPairDistributions(
            policy,
            distributionA,
            distributionB,
            observations,
          );
          const initialBefore = JSON.stringify(fixture.initial);
          const stateBefore = JSON.stringify(fixture.state);
          const entropyA = countingSource({ ok: true, value: word });
          const entropyB = countingSource({ ok: true, value: word });

          const throughA = collapseEntangledPair(
            fixture.state,
            fixture.pair.memberA,
            "OBSERVATION",
            entropyA.source,
          );
          const throughB = collapseEntangledPair(
            fixture.state,
            fixture.pair.memberB,
            "OBSERVATION",
            entropyB.source,
          );

          expect(throughA.ok).toBe(true);
          expect(throughB.ok).toBe(true);
          if (!throughA.ok || !throughB.ok) {
            return;
          }
          expect(throughB.state).toEqual(throughA.state);
          expect(throughB.events).toEqual(throughA.events);
          expect(throughB.entropyDelta).toEqual(throughA.entropyDelta);
          expect(collapseEvents(throughA.events).map((event) => {
            if ("coordinate" in event) {
              return event.coordinate;
            }
            return null;
          })).toEqual([fixture.pair.memberA, fixture.pair.memberB]);

          const outcomeA = collapsedOutcomeAt(
            throughA.state,
            fixture.pair.memberA,
          );
          const outcomeB = collapsedOutcomeAt(
            throughA.state,
            fixture.pair.memberB,
          );
          expect(distributionA[OUTCOME_ORDER.indexOf(outcomeA)]).toBeGreaterThan(0);
          expect(distributionB[OUTCOME_ORDER.indexOf(outcomeB)]).toBeGreaterThan(0);
          expect(throughA.state.observations).toBe(observations - 1);
          expect(throughB.state.observations).toBe(observations - 1);
          expect(throughA.entropyDelta).toHaveLength(1);
          expect(throughB.entropyDelta).toHaveLength(1);
          expect(entropyA.contexts).toHaveLength(1);
          expect(entropyB.contexts).toHaveLength(1);
          expect(validateGameState(throughA.state).ok).toBe(true);
          expect(JSON.stringify(fixture.state)).toBe(stateBefore);
          expect(JSON.stringify(fixture.initial)).toBe(initialBefore);
          expect(Object.isFrozen(fixture.initial)).toBe(true);
          expect(Object.isFrozen(fixture.state)).toBe(true);
        },
      ),
      { numRuns: PROPERTY_RUNS, seed: 0x3e01 },
    );
  });

  it("decoherence resolves both members with one word and no observation cost", () => {
    fc.assert(
      fc.property(
        policyArbitrary,
        distributionArbitrary,
        distributionArbitrary,
        uint32Arbitrary,
        fc.integer({ min: 0, max: 10 }),
        (policy, distributionA, distributionB, word, observations) => {
          const fixture = stateWithPairDistributions(
            policy,
            distributionA,
            distributionB,
            observations,
            4,
          );
          const entropy = countingSource({ ok: true, value: word });

          const result = collapseEntangledPair(
            fixture.state,
            fixture.pair.memberB,
            "DECOHERENCE",
            entropy.source,
          );

          expect(result.ok).toBe(true);
          if (result.ok) {
            expect(result.state.observations).toBe(observations);
            expect(result.events).toHaveLength(2);
            expect(
              result.events.every(({ kind }) => kind === "CELL_COLLAPSED"),
            ).toBe(true);
            expect(result.entropyDelta).toHaveLength(1);
          }
          expect(entropy.contexts).toHaveLength(1);
        },
      ),
      { numRuns: PROPERTY_RUNS, seed: 0x3e02 },
    );
  });

  it("atomically rolls back both members for every invalid shared word", () => {
    const invalidWordArbitrary = fc.oneof(
      fc.integer({ min: -1_000_000, max: -1 }),
      fc.integer({ min: UINT32_RANGE, max: UINT32_RANGE + 1_000_000 }),
      fc.double({ noNaN: true }).filter(
        (value) =>
          Number.isFinite(value) &&
          !Number.isInteger(value) &&
          value >= 0 &&
          value <= 0xffff_ffff,
      ),
    );

    fc.assert(
      fc.property(
        policyArbitrary,
        distributionArbitrary,
        distributionArbitrary,
        invalidWordArbitrary,
        fc.boolean(),
        (policy, distributionA, distributionB, invalidWord, initiateThroughB) => {
          const fixture = stateWithPairDistributions(
            policy,
            distributionA,
            distributionB,
            1,
          );
          const before = JSON.stringify(fixture.state);
          const entropy = countingSource({ ok: true, value: invalidWord });
          const initiator = initiateThroughB
            ? fixture.pair.memberB
            : fixture.pair.memberA;

          const result = collapseEntangledPair(
            fixture.state,
            initiator,
            "OBSERVATION",
            entropy.source,
          );

          expect(result).toMatchObject({
            ok: false,
            state: fixture.state,
            events: [],
            error: { kind: "ENTROPY_RANGE" },
          });
          expect(result.state).toBe(fixture.state);
          expect(entropy.contexts).toHaveLength(1);
          expect(JSON.stringify(fixture.state)).toBe(before);
        },
      ),
      { numRuns: PROPERTY_RUNS, seed: 0x3e03 },
    );
  });
});
