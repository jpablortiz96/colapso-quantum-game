import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { coordinateKey } from "./coordinates";
import {
  RecordingEntropySource,
  TranscriptEntropySource,
} from "./entropy";
import { generateInitialState } from "./generation";
import { serializeGameState } from "./serialization";
import { processAction } from "./turn";
import type { EntropyRecord, GameState } from "./types";

const PROPERTY_RUNS = 100;
const seedArbitrary = fc
  .array(fc.integer({ min: 0x20, max: 0x7e }), {
    minLength: 1,
    maxLength: 24,
  })
  .map((codes) => String.fromCharCode(...codes));

const generatedState = (seed: string): GameState => {
  const result = generateInitialState(seed);
  if (!result.ok) {
    throw new Error(result.error.message);
  }
  return result.value;
};

const bytesOf = (state: GameState): string => {
  const result = serializeGameState(state);
  if (!result.ok) {
    throw new Error(result.error.message);
  }
  return result.value;
};

const unpairedTargetIndex = (state: GameState): number => {
  const paired = new Set(
    state.pairs.flatMap(({ memberA, memberB }) => [
      coordinateKey(memberA),
      coordinateKey(memberB),
    ]),
  );
  const index = state.board.findIndex(
    (cell) =>
      cell.kind === "UNRESOLVED" &&
      !paired.has(coordinateKey(cell.coordinate)),
  );
  if (index < 0) {
    throw new Error("Immutability fixture requires an unpaired target.");
  }
  return index;
};

describe("persistent immutable histories", () => {
  it("retains frozen prior canonical bytes across arbitrary successful gates", () => {
    fc.assert(
      fc.property(seedArbitrary, fc.constantFrom("X", "H"), (seed, gate) => {
        const prior = generatedState(seed);
        const before = bytesOf(prior);
        const targetIndex = prior.board.findIndex(
          (cell) => cell.kind === "UNRESOLVED",
        );
        const target = prior.board[targetIndex]?.coordinate;
        if (targetIndex < 0 || target === undefined) {
          throw new Error("Gate property requires an unresolved target.");
        }

        const result = processAction(
          prior,
          { kind: "APPLY_GATE", gate, target },
          new TranscriptEntropySource([]),
        );

        expect(result.ok).toBe(true);
        expect(bytesOf(prior)).toBe(before);
        expect(Object.isFrozen(prior)).toBe(true);
        if (result.ok) {
          expect(result.state).not.toBe(prior);
          expect(result.state.board).not.toBe(prior.board);
          expect(result.state.pairs).toBe(prior.pairs);
          expect(result.state.collectedCrystals).toBe(prior.collectedCrystals);
          expect(result.state.collectedBatteries).toBe(prior.collectedBatteries);
          for (let index = 0; index < prior.board.length; index += 1) {
            if (index !== targetIndex) {
              expect(result.state.board[index]).toBe(prior.board[index]);
            }
          }
        }
      }),
      { numRuns: PROPERTY_RUNS, seed: 0x8401 },
    );
  });

  it("shares all unchanged branches after observation while preserving history", () => {
    fc.assert(
      fc.property(seedArbitrary, fc.nat(0xffff_ffff), (seed, word) => {
        const prior = generatedState(seed);
        const before = bytesOf(prior);
        const targetIndex = unpairedTargetIndex(prior);
        const target = prior.board[targetIndex]?.coordinate;
        if (target === undefined) {
          throw new Error("Observation property target is missing.");
        }
        const record: EntropyRecord = {
          context: {
            operation: "OBSERVE_COLLAPSE",
            coordinate: target,
            pairId: null,
          },
          word,
        };

        const result = processAction(
          prior,
          { kind: "OBSERVE", target },
          new TranscriptEntropySource([record]),
        );

        expect(result.ok).toBe(true);
        expect(bytesOf(prior)).toBe(before);
        if (result.ok) {
          expect(result.state.inventory).toBe(prior.inventory);
          expect(result.state.pairs).toBe(prior.pairs);
          expect(result.state.collectedCrystals).toBe(prior.collectedCrystals);
          expect(result.state.collectedBatteries).toBe(prior.collectedBatteries);
          for (let index = 0; index < prior.board.length; index += 1) {
            if (index !== targetIndex) {
              expect(result.state.board[index]).toBe(prior.board[index]);
            }
          }
        }
      }),
      { numRuns: PROPERTY_RUNS, seed: 0x8402 },
    );
  });

  it("keeps every retained snapshot byte-identical through a valid action sequence", () => {
    fc.assert(
      fc.property(seedArbitrary, (seed) => {
        let current = generatedState(seed);
        const retained: GameState[] = [current];
        const retainedBytes: string[] = [bytesOf(current)];
        const entropy = new RecordingEntropySource({
          nextUint32: () => ({ ok: true as const, value: 0 }),
        });
        const entryNeighbor = Object.freeze({ row: 5, col: 0 });
        const run = (action: Readonly<Record<string, unknown>>): void => {
          const result = processAction(current, action, entropy);
          if (!result.ok) {
            throw new Error(result.error.message);
          }
          current = result.state;
          retained.push(current);
          retainedBytes.push(bytesOf(current));
        };

        const xTarget = current.board.find(
          (cell) => cell.kind === "UNRESOLVED",
        )?.coordinate;
        if (xTarget === undefined) {
          throw new Error("History property requires an X target.");
        }
        run(Object.freeze({ kind: "APPLY_GATE", gate: "X", target: xTarget }));
        run(Object.freeze({ kind: "OBSERVE", target: entryNeighbor }));
        run(Object.freeze({ kind: "MOVE", target: entryNeighbor }));
        const hTarget = current.board.find(
          (cell) => cell.kind === "UNRESOLVED",
        )?.coordinate;
        if (hTarget === undefined) {
          throw new Error("History property requires an H target.");
        }
        run(Object.freeze({ kind: "APPLY_GATE", gate: "H", target: hTarget }));

        expect(retained).toHaveLength(5);
        retained.forEach((state, index) => {
          expect(Object.isFrozen(state)).toBe(true);
          expect(bytesOf(state)).toBe(retainedBytes[index]);
        });
      }),
      { numRuns: PROPERTY_RUNS, seed: 0x8403 },
    );
  });

  it("returns the original reference and bytes for arbitrary malformed actions", () => {
    fc.assert(
      fc.property(seedArbitrary, fc.jsonValue(), (seed, action) => {
        const prior = generatedState(seed);
        const before = bytesOf(prior);
        const result = processAction(
          prior,
          action,
          new TranscriptEntropySource([]),
        );

        if (!result.ok) {
          expect(result.state).toBe(prior);
          expect(result.events).toEqual([]);
          expect(bytesOf(prior)).toBe(before);
        }
      }),
      { numRuns: PROPERTY_RUNS, seed: 0x8404 },
    );
  });
});