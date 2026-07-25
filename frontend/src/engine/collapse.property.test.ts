import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { OUTCOME_ORDER } from "./constants";
import { collapseUnpairedCell } from "./collapse";
import { UINT32_RANGE } from "./entropy";
import type { EntropyError } from "./errors";
import { generateInitialState } from "./generation";
import { validateGameState } from "./invariants";
import type {
  Coordinate,
  Distribution,
  EntropyContext,
  EntropySource,
  GameState,
  Result,
} from "./types";

const PROPERTY_RUNS = 100;

const uint32Arbitrary = fc.integer({ min: 0, max: 0xffff_ffff });
const distributionArbitrary: fc.Arbitrary<Distribution> = fc
  .array(fc.integer({ min: 0, max: 1_000 }), {
    minLength: 5,
    maxLength: 5,
  })
  .filter((weights) => weights.some((weight) => weight > 0))
  .map((weights) => {
    const total = weights.reduce((sum, weight) => sum + weight, 0);
    const distribution = weights.map((weight) => weight / total);
    return Object.freeze(distribution) as unknown as Distribution;
  });

const generatedState = (): GameState => {
  const result = generateInitialState("collapse-property-fixture");
  if (!result.ok) {
    throw new Error(result.error.message);
  }
  return result.value;
};

const coordinateKey = ({ row, col }: Coordinate): string => `${row},${col}`;

const stateWithDistribution = (
  distribution: Distribution,
  observations: number,
  turn = 1,
): Readonly<{
  initial: GameState;
  state: GameState;
  target: Coordinate;
  boardIndex: number;
}> => {
  const initial = generatedState();
  const paired = new Set(
    initial.pairs.flatMap(({ memberA, memberB }) => [
      coordinateKey(memberA),
      coordinateKey(memberB),
    ]),
  );
  const boardIndex = initial.board.findIndex(
    (cell) =>
      cell.kind === "UNRESOLVED" && !paired.has(coordinateKey(cell.coordinate)),
  );
  const cell = initial.board[boardIndex];
  if (cell?.kind !== "UNRESOLVED") {
    throw new Error("Property fixture did not contain an unpaired cell.");
  }
  const board = [...initial.board];
  board[boardIndex] = Object.freeze({
    kind: "UNRESOLVED",
    coordinate: cell.coordinate,
    distribution,
  });
  const state: GameState = Object.freeze({
    ...initial,
    status: "PLAYING",
    turn,
    observations,
    board: Object.freeze(board),
  });
  if (!validateGameState(state).ok) {
    throw new Error("Property fixture must be valid.");
  }
  return Object.freeze({
    initial,
    state,
    target: cell.coordinate,
    boardIndex,
  });
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

describe("unpaired collapse properties", () => {
  it("always selects positive support, spends one observation, and preserves history", () => {
    fc.assert(
      fc.property(
        distributionArbitrary,
        uint32Arbitrary,
        fc.integer({ min: 1, max: 10 }),
        (distribution, word, observations) => {
          const fixture = stateWithDistribution(distribution, observations);
          const initialBefore = JSON.stringify(fixture.initial);
          const stateBefore = JSON.stringify(fixture.state);
          const entropy = countingSource({ ok: true, value: word });

          const result = collapseUnpairedCell(
            fixture.state,
            fixture.target,
            "OBSERVATION",
            entropy.source,
          );

          expect(result.ok).toBe(true);
          if (!result.ok) {
            return;
          }
          const collapsed = result.state.board[fixture.boardIndex];
          expect(collapsed?.kind).toBe("COLLAPSED");
          if (collapsed?.kind === "COLLAPSED") {
            const supportIndex = OUTCOME_ORDER.indexOf(collapsed.outcome);
            expect(distribution[supportIndex]).toBeGreaterThan(0);
          }
          expect(result.state.observations).toBe(observations - 1);
          expect(result.entropyDelta).toHaveLength(1);
          expect(entropy.contexts).toHaveLength(1);
          expect(validateGameState(result.state).ok).toBe(true);
          expect(JSON.stringify(fixture.state)).toBe(stateBefore);
          expect(JSON.stringify(fixture.initial)).toBe(initialBefore);
          expect(Object.isFrozen(fixture.initial)).toBe(true);
          expect(Object.isFrozen(fixture.state)).toBe(true);
        },
      ),
      { numRuns: PROPERTY_RUNS, seed: 0x3c01 },
    );
  });

  it("decoherence preserves observations for every valid distribution and word", () => {
    fc.assert(
      fc.property(
        distributionArbitrary,
        uint32Arbitrary,
        fc.integer({ min: 0, max: 10 }),
        (distribution, word, observations) => {
          const fixture = stateWithDistribution(distribution, observations, 4);
          const entropy = countingSource({ ok: true, value: word });

          const result = collapseUnpairedCell(
            fixture.state,
            fixture.target,
            "DECOHERENCE",
            entropy.source,
          );

          expect(result.ok).toBe(true);
          if (result.ok) {
            expect(result.state.observations).toBe(observations);
            expect(
              result.events.some(({ kind }) => kind === "OBSERVATION_SPENT"),
            ).toBe(false);
            expect(result.entropyDelta).toHaveLength(1);
          }
          expect(entropy.contexts).toHaveLength(1);
        },
      ),
      { numRuns: PROPERTY_RUNS, seed: 0x3c02 },
    );
  });

  it("atomically rolls back every invalid entropy word without mutating state", () => {
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
        distributionArbitrary,
        invalidWordArbitrary,
        (distribution, invalidWord) => {
          const fixture = stateWithDistribution(distribution, 1);
          const before = JSON.stringify(fixture.state);
          const entropy = countingSource({ ok: true, value: invalidWord });

          const result = collapseUnpairedCell(
            fixture.state,
            fixture.target,
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
      { numRuns: PROPERTY_RUNS, seed: 0x3c03 },
    );
  });
});
