import { describe, expect, it } from "vitest";

import {
  ENTRY_COORDINATE,
  EXIT_COORDINATE,
  INITIAL_ENERGY,
  INITIAL_INVENTORY,
  INITIAL_OBSERVATIONS,
} from "./constants";
import { allCoordinatesRowMajor } from "./coordinates";
import { generateInitialState } from "./generation";
import { validateGameState } from "./invariants";
import type { GameState } from "./types";

const generate = (seed: string): GameState => {
  const result = generateInitialState(seed);
  if (!result.ok) {
    throw new Error(result.error.message);
  }
  return result.value;
};

describe("version 1 generation", () => {
  it("is deterministic for the same seed and sensitive to Unicode bytes", () => {
    const first = generate("same-seed");
    const second = generate("same-seed");

    expect(second).toEqual(first);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
    expect(second).not.toBe(first);
    expect(generate("é")).not.toEqual(generate("e\u0301"));
  });

  it("creates the exact row-major board and fixed endpoints", () => {
    const state = generate("milestone-2-vector");

    expect(state.board).toHaveLength(49);
    expect(state.board.map(({ coordinate }) => coordinate)).toEqual(
      allCoordinatesRowMajor(),
    );
    expect(state.board[6]).toEqual({
      kind: "COLLAPSED",
      coordinate: EXIT_COORDINATE,
      outcome: "FLOOR",
    });
    expect(state.board[42]).toEqual({
      kind: "COLLAPSED",
      coordinate: ENTRY_COORDINATE,
      outcome: "FLOOR",
    });
    expect(
      state.board.filter(({ kind }) => kind === "UNRESOLVED"),
    ).toHaveLength(47);
  });

  it("matches independently calculated distributions in generation order", () => {
    const state = generate("milestone-2-vector");

    expect(state.board[0]).toMatchObject({
      coordinate: { row: 0, col: 0 },
      distribution: [
        0.31666666666666665, 0.3233333333333333, 0.02,
        0.14333333333333334, 0.19666666666666677,
      ],
    });
    expect(state.board[1]).toMatchObject({
      coordinate: { row: 0, col: 1 },
      distribution: [0.2734375, 0.015625, 0.390625, 0.1953125, 0.125],
    });
    expect(state.board[23]).toMatchObject({
      coordinate: { row: 3, col: 2 },
      distribution: [
        0.23008849557522124, 0.25958702064896755,
        0.19469026548672566, 0.25663716814159293,
        0.05899705014749257,
      ],
    });
    expect(state.board[47]).toMatchObject({
      coordinate: { row: 6, col: 5 },
      distribution: [
        0.21074380165289255, 0.012396694214876033, 0.3347107438016529,
        0.30578512396694213, 0.13636363636363635,
      ],
    });
    expect(state.board[48]).toMatchObject({
      coordinate: { row: 6, col: 6 },
      distribution: [
        0.023923444976076555, 0.03349282296650718, 0.44976076555023925,
        0.3253588516746411, 0.16746411483253598,
      ],
    });

    for (const cell of state.board) {
      if (cell.kind === "UNRESOLVED") {
        expect(cell.distribution.every((value) => value > 0)).toBe(true);
        expect(
          Math.abs(
            cell.distribution.reduce((sum, value) => sum + value, 0) - 1,
          ),
        ).toBeLessThanOrEqual(1e-12);
      }
    }
  });

  it("matches the exact Fisher-Yates pairs, IDs, and policy draw order", () => {
    expect(generate("milestone-2-vector").pairs).toEqual([
      {
        id: "pair-0",
        memberA: { row: 3, col: 3 },
        memberB: { row: 4, col: 2 },
        policy: "ANTI_CORRELATED",
      },
      {
        id: "pair-1",
        memberA: { row: 2, col: 4 },
        memberB: { row: 6, col: 2 },
        policy: "ANTI_CORRELATED",
      },
      {
        id: "pair-2",
        memberA: { row: 4, col: 6 },
        memberB: { row: 5, col: 0 },
        policy: "CORRELATED",
      },
      {
        id: "pair-3",
        memberA: { row: 3, col: 6 },
        memberB: { row: 5, col: 4 },
        policy: "ANTI_CORRELATED",
      },
      {
        id: "pair-4",
        memberA: { row: 4, col: 0 },
        memberB: { row: 5, col: 1 },
        policy: "CORRELATED",
      },
    ]);
  });

  it("sets exact inventory, resources, status, and collections", () => {
    const state = generate("resources");

    expect(state).toMatchObject({
      schemaVersion: 1,
      rulesVersion: 1,
      status: "START",
      terminalReason: null,
      turn: 0,
      player: ENTRY_COORDINATE,
      observations: INITIAL_OBSERVATIONS,
      energy: INITIAL_ENERGY,
      inventory: INITIAL_INVENTORY,
      collectedCrystals: [],
      collectedBatteries: [],
    });
    expect(validateGameState(state)).toEqual({ ok: true, value: state });
    expect(Object.isFrozen(state)).toBe(true);
    expect(Object.isFrozen(state.board)).toBe(true);
    expect(Object.isFrozen(state.pairs)).toBe(true);
  });

  it("returns typed errors for all invalid generation inputs", () => {
    expect(generateInitialState("")).toMatchObject({
      ok: false,
      error: { kind: "INVALID_SEED", reason: "EMPTY_SEED" },
    });
    expect(generateInitialState(37)).toMatchObject({
      ok: false,
      error: { kind: "INVALID_SEED", reason: "MALFORMED_SEED" },
    });
    expect(generateInitialState("\ud800")).toMatchObject({
      ok: false,
      error: { kind: "INVALID_SEED", reason: "MALFORMED_SEED" },
    });
    expect(generateInitialState("valid", 2)).toMatchObject({
      ok: false,
      error: { kind: "UNSUPPORTED_RULES_VERSION", received: 2 },
    });
  });
});
