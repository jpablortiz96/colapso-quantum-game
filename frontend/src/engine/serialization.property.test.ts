import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { RecordingEntropySource } from "./entropy";
import { generateInitialState } from "./generation";
import {
  deserializeGameState,
  deserializeGameStateDto,
  serializeGameState,
} from "./serialization";
import { processAction } from "./turn";
import type { Action, GameState } from "./types";

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

const evolvedState = (seed: string, actionCount: number): GameState => {
  let state = generatedState(seed);
  const entropy = new RecordingEntropySource({
    nextUint32: () => ({ ok: true as const, value: 0 }),
  });
  const entryNeighbor = Object.freeze({ row: 5, col: 0 });

  for (let index = 0; index < actionCount; index += 1) {
    let action: Action;
    if (index === 0) {
      const target = state.board.find((cell) => cell.kind === "UNRESOLVED")
        ?.coordinate;
      if (target === undefined) {
        throw new Error("Serialization history requires an X target.");
      }
      action = Object.freeze({ kind: "APPLY_GATE", gate: "X", target });
    } else if (index === 1) {
      action = Object.freeze({ kind: "OBSERVE", target: entryNeighbor });
    } else if (index === 2) {
      action = Object.freeze({ kind: "MOVE", target: entryNeighbor });
    } else {
      const target = state.board.find((cell) => cell.kind === "UNRESOLVED")
        ?.coordinate;
      if (target === undefined) {
        throw new Error("Serialization history requires an H target.");
      }
      action = Object.freeze({ kind: "APPLY_GATE", gate: "H", target });
    }
    const result = processAction(state, action, entropy);
    if (!result.ok) {
      throw new Error(result.error.message);
    }
    state = result.state;
  }
  return state;
};

describe("canonical serialization properties", () => {
  it("preserves canonical bytes for generated valid state histories", () => {
    fc.assert(
      fc.property(
        seedArbitrary,
        fc.integer({ min: 0, max: 4 }),
        (seed, actionCount) => {
          const first = bytesOf(evolvedState(seed, actionCount));
          const restored = deserializeGameState(first);
          expect(restored.ok).toBe(true);
          if (restored.ok) {
            expect(bytesOf(restored.value)).toBe(first);
            expect(bytesOf(restored.value)).toBe(bytesOf(restored.value));
          }
        },
      ),
      { numRuns: PROPERTY_RUNS, seed: 0x8201 },
    );
  });

  it("rejects arbitrary one-field invariant mutations without partial state", () => {
    fc.assert(
      fc.property(
        seedArbitrary,
        fc.integer({ min: 0, max: 4 }),
        fc.constantFrom("observations", "turn", "energy"),
        (seed, actionCount, field) => {
          const dto = JSON.parse(
            bytesOf(evolvedState(seed, actionCount)),
          ) as Record<string, unknown>;
          if (field === "observations") {
            dto.observations = 14;
          } else if (field === "turn") {
            dto.turn = -1;
          } else {
            dto.energy = 2;
          }

          const result = deserializeGameStateDto(dto);
          expect(result.ok).toBe(false);
          if (!result.ok) {
            expect(result.error.kind).toBe("INVALID_STATE");
          }
        },
      ),
      { numRuns: PROPERTY_RUNS, seed: 0x8202 },
    );
  });
});
