import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { RecordingEntropySource } from "./entropy";
import { generateInitialState } from "./generation";
import { replayGame } from "./replay";
import { calculateScore } from "./score";
import { serializeGameStateToDto } from "./serialization";
import { processAction } from "./turn";
import type {
  Action,
  GameState,
  GameStateDto,
  ReplayDto,
} from "./types";

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

const dtoOf = (state: GameState): GameStateDto => {
  const result = serializeGameStateToDto(state);
  if (!result.ok) {
    throw new Error(result.error.message);
  }
  return result.value;
};

const validHistoryReplay = (seed: string, universe: boolean): ReplayDto => {
  const initial = generatedState(seed);
  let state = initial;
  const actions: Action[] = [];
  const entropy = new RecordingEntropySource({
    nextUint32: () => ({ ok: true as const, value: 0 }),
  });
  const entryNeighbor = Object.freeze({ row: 5, col: 0 });

  const run = (action: Action): void => {
    const result = processAction(state, action, entropy);
    if (!result.ok) {
      throw new Error(result.error.message);
    }
    actions.push(action);
    state = result.state;
  };

  const xTarget = state.board.find((cell) => cell.kind === "UNRESOLVED")
    ?.coordinate;
  if (xTarget === undefined) {
    throw new Error("Replay history requires an X target.");
  }
  run(Object.freeze({ kind: "APPLY_GATE", gate: "X", target: xTarget }));
  run(Object.freeze({ kind: "OBSERVE", target: entryNeighbor }));
  run(Object.freeze({ kind: "MOVE", target: entryNeighbor }));
  const hTarget = state.board.find((cell) => cell.kind === "UNRESOLVED")
    ?.coordinate;
  if (hTarget === undefined) {
    throw new Error("Replay history requires an H target.");
  }
  run(Object.freeze({ kind: "APPLY_GATE", gate: "H", target: hTarget }));

  return Object.freeze({
    replaySchemaVersion: 1,
    rulesVersion: 1,
    initial: universe
      ? Object.freeze({ kind: "UNIVERSE" as const, universe: dtoOf(initial) })
      : Object.freeze({ kind: "SEED" as const, seed }),
    actions: Object.freeze(actions),
    entropyTranscript: entropy.records,
    expectedFinalState: dtoOf(state),
    expectedFinalScore: calculateScore(state),
  });
};

describe("strict replay properties", () => {
  it("replays generated multi-action histories to byte-identical output", () => {
    fc.assert(
      fc.property(seedArbitrary, fc.boolean(), (seed, universe) => {
        const replay = validHistoryReplay(seed, universe);
        const first = replayGame(replay);
        const second = replayGame(replay);

        expect(replay.actions.map(({ kind }) => kind)).toEqual([
          "APPLY_GATE",
          "OBSERVE",
          "MOVE",
          "APPLY_GATE",
        ]);
        expect(replay.entropyTranscript.map(({ context }) => context.operation))
          .toEqual([
            "OBSERVE_COLLAPSE",
            "DECOHERENCE_SELECT",
            "DECOHERENCE_COLLAPSE",
          ]);
        expect(first.ok).toBe(true);
        expect(second.ok).toBe(true);
        expect(JSON.stringify(second)).toBe(JSON.stringify(first));
        if (first.ok) {
          expect(first.value.consumedEntropy).toBe(3);
          expect(first.value.finalScore).toBe(replay.expectedFinalScore);
        }
      }),
      { numRuns: PROPERTY_RUNS, seed: 0x8301 },
    );
  });

  it("rejects every surplus gameplay entropy entry deterministically", () => {
    fc.assert(
      fc.property(seedArbitrary, (seed) => {
        const replay = validHistoryReplay(seed, false);
        const extra = replay.entropyTranscript[0];
        if (extra === undefined) {
          throw new Error("Replay property transcript is empty.");
        }
        const result = replayGame({
          ...replay,
          entropyTranscript: [...replay.entropyTranscript, extra],
        });

        expect(result).toMatchObject({
          ok: false,
          error: { kind: "REPLAY_UNUSED_ENTROPY", remainingEntries: 1 },
        });
      }),
      { numRuns: PROPERTY_RUNS, seed: 0x8302 },
    );
  });
});
