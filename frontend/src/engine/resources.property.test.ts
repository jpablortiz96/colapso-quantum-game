import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { coordinateKey, orthogonalNeighbors } from "./coordinates";
import type { EntropyError } from "./errors";
import { generateInitialState } from "./generation";
import { validateGameState } from "./invariants";
import { movePlayer } from "./movement";
import { processAction } from "./turn";
import type { Coordinate, EntropySource, GameState } from "./types";

const PROPERTY_RUNS = 100;

const baseFixture = (
  outcome: "FLOOR" | "CRYSTAL" | "BATTERY",
  observations: number,
): Readonly<{ state: GameState; origin: Coordinate; target: Coordinate }> => {
  const generated = generateInitialState(`resource-property-${outcome}`);
  if (!generated.ok) {
    throw new Error(generated.error.message);
  }
  const initial = generated.value;
  const paired = new Set(
    initial.pairs.flatMap(({ memberA, memberB }) => [
      coordinateKey(memberA),
      coordinateKey(memberB),
    ]),
  );
  const originCell = initial.board.find(
    (cell) =>
      cell.kind === "UNRESOLVED" &&
      !paired.has(coordinateKey(cell.coordinate)) &&
      orthogonalNeighbors(cell.coordinate).some((neighbor) => {
        const targetCell = initial.board[neighbor.row * 7 + neighbor.col];
        return (
          targetCell?.kind === "UNRESOLVED" &&
          !paired.has(coordinateKey(neighbor))
        );
      }),
  );
  const target = originCell === undefined
    ? undefined
    : orthogonalNeighbors(originCell.coordinate).find((neighbor) => {
        const targetCell = initial.board[neighbor.row * 7 + neighbor.col];
        return (
          targetCell?.kind === "UNRESOLVED" &&
          !paired.has(coordinateKey(neighbor))
        );
      });
  if (originCell === undefined || target === undefined) {
    throw new Error("Property fixture did not contain adjacent unpaired cells.");
  }
  const board = [...initial.board];
  board[originCell.coordinate.row * 7 + originCell.coordinate.col] =
    Object.freeze({
      kind: "COLLAPSED",
      coordinate: originCell.coordinate,
      outcome: "FLOOR",
    });
  board[target.row * 7 + target.col] = Object.freeze({
    kind: "COLLAPSED",
    coordinate: target,
    outcome,
  });
  const state: GameState = Object.freeze({
    ...initial,
    status: "PLAYING",
    turn: 1,
    player: originCell.coordinate,
    observations,
    board: Object.freeze(board),
  });
  return Object.freeze({ state, origin: originCell.coordinate, target });
};

const transition = (state: GameState, target: Coordinate): GameState => {
  const result = movePlayer(state, { kind: "MOVE", target });
  if (!result.ok) {
    throw new Error(result.error.message);
  }
  return result.state;
};

describe("resource sequence properties", () => {
  it("collects crystals exactly once across arbitrary re-entry counts", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 12 }),
        fc.integer({ min: 0, max: 10 }),
        (entries, observations) => {
          const fixture = baseFixture("CRYSTAL", observations);
          const originalBytes = JSON.stringify(fixture.state);
          let current = fixture.state;
          for (let entry = 0; entry < entries; entry += 1) {
            const retained = current;
            const retainedBytes = JSON.stringify(retained);
            current = transition(current, fixture.target);
            expect(JSON.stringify(retained)).toBe(retainedBytes);
            if (entry < entries - 1) {
              current = transition(current, fixture.origin);
            }
          }
          expect(current.collectedCrystals).toEqual([fixture.target]);
          expect(new Set(current.collectedCrystals.map(coordinateKey)).size).toBe(1);
          expect(current.collectedBatteries).toEqual([]);
          expect(current.observations).toBe(observations);
          expect(current.board).toBe(fixture.state.board);
          expect(validateGameState(current).ok).toBe(true);
          expect(JSON.stringify(fixture.state)).toBe(originalBytes);
        },
      ),
      { numRuns: PROPERTY_RUNS, seed: 0x5a21 },
    );
  });

  it("collects batteries once and caps the single restoration at thirteen", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 12 }),
        fc.integer({ min: 0, max: 13 }),
        (entries, observations) => {
          const fixture = baseFixture("BATTERY", observations);
          const originalBytes = JSON.stringify(fixture.state);
          let current = fixture.state;
          for (let entry = 0; entry < entries; entry += 1) {
            const retained = current;
            const retainedBytes = JSON.stringify(retained);
            current = transition(current, fixture.target);
            expect(JSON.stringify(retained)).toBe(retainedBytes);
            if (entry < entries - 1) {
              current = transition(current, fixture.origin);
            }
          }
          expect(current.collectedBatteries).toEqual([fixture.target]);
          expect(new Set(current.collectedBatteries.map(coordinateKey)).size).toBe(1);
          expect(current.collectedCrystals).toEqual([]);
          expect(current.observations).toBe(Math.min(13, observations + 1));
          expect(current.board).toBe(fixture.state.board);
          expect(validateGameState(current).ok).toBe(true);
          expect(JSON.stringify(fixture.state)).toBe(originalBytes);
        },
      ),
      { numRuns: PROPERTY_RUNS, seed: 0x5a22 },
    );
  });
});

describe("integrated Milestone 5 sequence properties", () => {
  it("advances exactly one turn for every generated passable-move sequence", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 20 }),
        fc.integer({ min: 1, max: 10 }),
        (actionCount, observations) => {
          const fixture = baseFixture("FLOOR", observations);
          let entropyRequests = 0;
          const source: EntropySource<EntropyError> = {
            nextUint32: () => {
              entropyRequests += 1;
              return { ok: true, value: 0 };
            },
          };
          let current = fixture.state;
          for (let index = 0; index < actionCount; index += 1) {
            const retained = current;
            const retainedBytes = JSON.stringify(retained);
            const target = index % 2 === 0 ? fixture.target : fixture.origin;
            const result = processAction(
              current,
              { kind: "MOVE", target },
              source,
            );
            expect(result.ok).toBe(true);
            if (!result.ok) {
              return;
            }
            expect(result.state.turn).toBe(retained.turn + 1);
            const turnEventIndex = result.events.findIndex(
              ({ kind }) => kind === "TURN_ADVANCED",
            );
            expect(result.events[turnEventIndex]).toEqual({
              kind: "TURN_ADVANCED",
              turn: retained.turn + 1,
            });
            const scheduled = (retained.turn + 1) % 4 === 0;
            expect(result.entropyDelta).toHaveLength(scheduled ? 2 : 0);
            if (scheduled) {
              expect(
                result.events.slice(turnEventIndex + 1).map(({ kind }) => kind),
              ).toContain("DECOHERENCE_SELECTED");
            } else {
              expect(turnEventIndex).toBe(result.events.length - 1);
            }
            expect(JSON.stringify(retained)).toBe(retainedBytes);
            current = result.state;
          }
          expect(current.turn).toBe(fixture.state.turn + actionCount);
          const scheduledTurns = Math.floor(
            (fixture.state.turn + actionCount) / 4,
          );
          expect(entropyRequests).toBe(scheduledTurns * 2);
          expect(validateGameState(current).ok).toBe(true);
        },
      ),
      { numRuns: PROPERTY_RUNS, seed: 0x5a23 },
    );
  });

  it("keeps generated terminal-state action sequences absorbing", () => {
    const actionArbitrary = fc.constantFrom<unknown>(
      { kind: "MOVE", target: { row: 6, col: 0 } },
      { kind: "OBSERVE", target: { row: 1, col: 1 } },
      { kind: "APPLY_GATE", gate: "X", target: { row: 1, col: 1 } },
      { kind: "UNSUPPORTED", target: { row: 0, col: 0 } },
      null,
    );
    fc.assert(
      fc.property(
        fc.constantFrom("VICTORY" as const, "DEFEAT" as const),
        fc.array(actionArbitrary, { minLength: 1, maxLength: 12 }),
        (status, actions) => {
          const fixture = baseFixture("FLOOR", 5);
          const terminal: GameState = Object.freeze({
            ...fixture.state,
            status,
            terminalReason:
              status === "VICTORY"
                ? "EXIT_REACHED"
                : "INSUFFICIENT_VOID_ENERGY",
            player:
              status === "VICTORY"
                ? Object.freeze({ row: 0, col: 6 })
                : fixture.state.player,
            energy: status === "DEFEAT" ? 0 : fixture.state.energy,
          });
          expect(validateGameState(terminal).ok).toBe(true);
          const terminalBytes = JSON.stringify(terminal);
          let entropyRequests = 0;
          const source: EntropySource<EntropyError> = {
            nextUint32: () => {
              entropyRequests += 1;
              return { ok: true, value: 0 };
            },
          };

          for (const action of actions) {
            const result = processAction(terminal, action, source);
            expect(result).toMatchObject({
              ok: false,
              state: terminal,
              events: [],
              error: { kind: "INVALID_ACTION", reason: "TERMINAL_STATE" },
            });
            expect(result.state).toBe(terminal);
          }
          expect(entropyRequests).toBe(0);
          expect(JSON.stringify(terminal)).toBe(terminalBytes);
        },
      ),
      { numRuns: PROPERTY_RUNS, seed: 0x5a24 },
    );
  });
});