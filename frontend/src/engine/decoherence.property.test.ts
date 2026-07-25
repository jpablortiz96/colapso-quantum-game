import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { ENTRY_COORDINATE, EXIT_COORDINATE } from "./constants";
import { coordinateKey, coordinatesEqual } from "./coordinates";
import {
  enumerateDecoherenceCandidates,
  processScheduledDecoherence,
} from "./decoherence";
import { UINT32_MAX, UINT32_RANGE } from "./entropy";
import type { EntropyError } from "./errors";
import { generateInitialState } from "./generation";
import { validateGameState } from "./invariants";
import type {
  Coordinate,
  EntropyContext,
  EntropySource,
  GameState,
  Result,
} from "./types";

const PROPERTY_RUNS = 100;

const generatedPlayingState = (turn: number): GameState => {
  const generated = generateInitialState("decoherence-property-fixture");
  if (!generated.ok) {
    throw new Error(generated.error.message);
  }
  const state: GameState = Object.freeze({
    ...generated.value,
    status: "PLAYING",
    turn,
  });
  if (!validateGameState(state).ok) {
    throw new Error("Decoherence property fixture must be valid.");
  }
  return state;
};

const queueSource = (
  results: readonly Result<number, EntropyError>[],
): Readonly<{
  source: EntropySource<EntropyError>;
  contexts: EntropyContext[];
}> => {
  let cursor = 0;
  const contexts: EntropyContext[] = [];
  return {
    contexts,
    source: {
      nextUint32: (context) => {
        contexts.push(context);
        const result = results[cursor];
        cursor += 1;
        return result ?? {
          ok: false,
          error: {
            kind: "ENTROPY_EXHAUSTED",
            message: "Property script exhausted.",
          },
        };
      },
    },
  };
};

const successfulWords = (...words: number[]) =>
  queueSource(words.map((value) => ({ ok: true as const, value })));

const reducedState = (
  state: GameState,
  unresolvedCoordinates: readonly Coordinate[],
  observations = state.observations,
): GameState => {
  const unresolved = new Set(unresolvedCoordinates.map(coordinateKey));
  const board = state.board.map((cell) => {
    if (
      coordinatesEqual(cell.coordinate, ENTRY_COORDINATE) ||
      coordinatesEqual(cell.coordinate, EXIT_COORDINATE) ||
      unresolved.has(coordinateKey(cell.coordinate))
    ) {
      return cell;
    }
    return Object.freeze({
      kind: "COLLAPSED" as const,
      coordinate: cell.coordinate,
      outcome: "FLOOR" as const,
    });
  });
  const candidate: GameState = Object.freeze({
    ...state,
    observations,
    board: Object.freeze(board),
  });
  if (!validateGameState(candidate).ok) {
    throw new Error("Reduced property fixture must be valid.");
  }
  return candidate;
};

const unpairedCoordinates = (state: GameState): readonly Coordinate[] => {
  const paired = new Set(
    state.pairs.flatMap(({ memberA, memberB }) => [
      coordinateKey(memberA),
      coordinateKey(memberB),
    ]),
  );
  return state.board
    .filter(
      (cell) =>
        cell.kind === "UNRESOLVED" &&
        !paired.has(coordinateKey(cell.coordinate)),
    )
    .map((cell) => cell.coordinate);
};

describe("decoherence properties", () => {
  it("runs exactly on positive multiples of four and preserves retained input", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 64 }), (turn) => {
        const state = generatedPlayingState(turn);
        const before = JSON.stringify(state);
        const entropy = successfulWords(0, 0);

        const result = processScheduledDecoherence(state, entropy.source);

        expect(result.ok).toBe(true);
        if (!result.ok) {
          return;
        }
        if (turn % 4 === 0) {
          expect(result.state).not.toBe(state);
          expect(result.entropyDelta).toHaveLength(2);
          expect(result.events[0]).toMatchObject({
            kind: "DECOHERENCE_SELECTED",
            turn,
          });
          expect(entropy.contexts).toHaveLength(2);
        } else {
          expect(result.state).toBe(state);
          expect(result.events).toEqual([]);
          expect(result.entropyDelta).toEqual([]);
          expect(entropy.contexts).toEqual([]);
        }
        expect(JSON.stringify(state)).toBe(before);
        expect(Object.isFrozen(state)).toBe(true);
        expect(validateGameState(result.state).ok).toBe(true);
      }),
      { numRuns: PROPERTY_RUNS, seed: 0x6d01 },
    );
  });

  it("enumerates only retained unresolved cells row-major, including both pair members", () => {
    const base = generatedPlayingState(4);
    const unpaired = unpairedCoordinates(base);
    const pairFlagsArbitrary = fc.array(fc.boolean(), {
      minLength: base.pairs.length,
      maxLength: base.pairs.length,
    });
    const unpairedFlagsArbitrary = fc.array(fc.boolean(), {
      minLength: unpaired.length,
      maxLength: unpaired.length,
    });

    fc.assert(
      fc.property(
        pairFlagsArbitrary,
        unpairedFlagsArbitrary,
        (pairFlags, unpairedFlags) => {
          const unresolved: Coordinate[] = [];
          for (let index = 0; index < base.pairs.length; index += 1) {
            const pair = base.pairs[index];
            if (pair !== undefined && pairFlags[index]) {
              unresolved.push(pair.memberA, pair.memberB);
            }
          }
          for (let index = 0; index < unpaired.length; index += 1) {
            const coordinate = unpaired[index];
            if (coordinate !== undefined && unpairedFlags[index]) {
              unresolved.push(coordinate);
            }
          }
          const state = reducedState(base, unresolved);

          const candidates = enumerateDecoherenceCandidates(state);

          const expected = state.board
            .filter((cell) => cell.kind === "UNRESOLVED")
            .map((cell) => cell.coordinate);
          expect(candidates).toEqual(expected);
          expect(candidates).not.toContainEqual(ENTRY_COORDINATE);
          expect(candidates).not.toContainEqual(EXIT_COORDINATE);
          for (let index = 1; index < candidates.length; index += 1) {
            const previous = candidates[index - 1];
            const current = candidates[index];
            if (previous !== undefined && current !== undefined) {
              expect(previous.row * 7 + previous.col).toBeLessThan(
                current.row * 7 + current.col,
              );
            }
          }
          for (let index = 0; index < base.pairs.length; index += 1) {
            const pair = base.pairs[index];
            if (pair !== undefined && pairFlags[index]) {
              expect(candidates).toContainEqual(pair.memberA);
              expect(candidates).toContainEqual(pair.memberB);
            }
          }
        },
      ),
      { numRuns: PROPERTY_RUNS, seed: 0x6d02 },
    );
  });

  it("resolves either selected pair member canonically with one free collapse word", () => {
    const base = generatedPlayingState(8);

    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: base.pairs.length - 1 }),
        fc.boolean(),
        fc.integer({ min: 0, max: 10 }),
        fc.integer({ min: 0, max: UINT32_MAX }),
        (pairIndex, selectMemberB, observations, collapseWord) => {
          const pair = base.pairs[pairIndex];
          if (pair === undefined) {
            throw new Error("Generated pair index must exist.");
          }
          const state = reducedState(
            base,
            [pair.memberA, pair.memberB],
            observations,
          );
          const before = JSON.stringify(state);
          const entropy = successfulWords(selectMemberB ? 1 : 0, collapseWord);

          const result = processScheduledDecoherence(state, entropy.source);

          expect(result.ok).toBe(true);
          if (!result.ok) {
            return;
          }
          expect(result.state.observations).toBe(observations);
          expect(result.state.board[pair.memberA.row * 7 + pair.memberA.col]?.kind)
            .toBe("COLLAPSED");
          expect(result.state.board[pair.memberB.row * 7 + pair.memberB.col]?.kind)
            .toBe("COLLAPSED");
          expect(result.events.map(({ kind }) => kind)).toEqual([
            "DECOHERENCE_SELECTED",
            "CELL_COLLAPSED",
            "CELL_COLLAPSED",
          ]);
          expect(result.events[0]).toMatchObject({
            coordinate: selectMemberB ? pair.memberB : pair.memberA,
            pairId: pair.id,
          });
          expect(result.events.slice(1).map((event) =>
            "coordinate" in event ? event.coordinate : null,
          )).toEqual([pair.memberA, pair.memberB]);
          expect(result.entropyDelta).toHaveLength(2);
          expect(result.entropyDelta[1]?.context).toEqual({
            operation: "DECOHERENCE_COLLAPSE",
            turn: 8,
            coordinate: pair.memberA,
            pairId: pair.id,
          });
          expect(JSON.stringify(state)).toBe(before);
        },
      ),
      { numRuns: PROPERTY_RUNS, seed: 0x6d03 },
    );
  });

  it("accounts for every unbiased retry before the accepted selection and collapse", () => {
    const state = generatedPlayingState(12);
    const candidates = enumerateDecoherenceCandidates(state);

    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 5 }),
        fc.integer({ min: 0, max: candidates.length - 1 }),
        fc.integer({ min: 0, max: UINT32_MAX }),
        (retryCount, acceptedIndex, collapseWord) => {
          const words = [
            ...Array.from({ length: retryCount }, () => UINT32_MAX),
            acceptedIndex,
            collapseWord,
          ];
          const entropy = successfulWords(...words);
          const before = JSON.stringify(state);

          const result = processScheduledDecoherence(state, entropy.source);

          expect(result.ok).toBe(true);
          if (!result.ok) {
            return;
          }
          expect(result.entropyDelta.map(({ word }) => word)).toEqual(words);
          expect(
            result.entropyDelta
              .slice(0, retryCount + 1)
              .every(
                ({ context }) =>
                  context.operation === "DECOHERENCE_SELECT" &&
                  context.turn === 12 &&
                  context.candidateCount === candidates.length,
              ),
          ).toBe(true);
          expect(result.entropyDelta.at(-1)?.context.operation).toBe(
            "DECOHERENCE_COLLAPSE",
          );
          expect(result.events[0]).toMatchObject({
            coordinate: candidates[acceptedIndex],
          });
          expect(entropy.contexts).toHaveLength(retryCount + 2);
          expect(JSON.stringify(state)).toBe(before);
        },
      ),
      { numRuns: PROPERTY_RUNS, seed: 0x6d04 },
    );
  });

  it("consumes nothing for every empty scheduled state", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 32 }),
        fc.integer({ min: 0, max: 10 }),
        (multiple, observations) => {
          const state = reducedState(
            generatedPlayingState(multiple * 4),
            [],
            observations,
          );
          const before = JSON.stringify(state);
          const entropy = successfulWords(0, 0);

          const result = processScheduledDecoherence(state, entropy.source);

          expect(result).toEqual({
            ok: true,
            state,
            events: [],
            entropyDelta: [],
          });
          expect(result.state).toBe(state);
          expect(entropy.contexts).toEqual([]);
          expect(JSON.stringify(state)).toBe(before);
        },
      ),
      { numRuns: PROPERTY_RUNS, seed: 0x6d05 },
    );
  });

  it("rolls range and exhaustion failures back without exposed transcript deltas", () => {
    const base = generatedPlayingState(4);
    const target = unpairedCoordinates(base)[0];
    if (target === undefined) {
      throw new Error("Property fixture must contain an unpaired coordinate.");
    }
    const state = reducedState(base, [target]);

    fc.assert(
      fc.property(
        fc.constantFrom("SELECTION", "COLLAPSE" as const),
        fc.constantFrom("RANGE", "EXHAUSTED" as const),
        (stage, failure) => {
          const failingResult: Result<number, EntropyError> =
            failure === "RANGE"
              ? { ok: true, value: UINT32_RANGE }
              : {
                  ok: false,
                  error: {
                    kind: "ENTROPY_EXHAUSTED",
                    message: "Property exhaustion.",
                  },
                };
          const script =
            stage === "SELECTION"
              ? [failingResult]
              : [{ ok: true as const, value: 0 }, failingResult];
          const entropy = queueSource(script);
          const before = JSON.stringify(state);

          const result = processScheduledDecoherence(state, entropy.source);

          expect(result.ok).toBe(false);
          expect(result.state).toBe(state);
          expect(result.events).toEqual([]);
          expect("entropyDelta" in result).toBe(false);
          expect(result).toMatchObject({
            error: {
              kind: failure === "RANGE" ? "ENTROPY_RANGE" : "ENTROPY_EXHAUSTED",
            },
          });
          expect(JSON.stringify(state)).toBe(before);
        },
      ),
      { numRuns: PROPERTY_RUNS, seed: 0x6d06 },
    );
  });
});
