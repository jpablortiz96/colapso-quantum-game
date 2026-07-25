import { describe, expect, expectTypeOf, it } from "vitest";

import {
  BOARD_CELL_COUNT,
  BOARD_SIZE,
  DECOHERENCE_INTERVAL,
  ENTRY_COORDINATE,
  EXIT_COORDINATE,
  GAME_STATUS_ORDER,
  GATE_ORDER,
  INITIAL_ENERGY,
  INITIAL_INVENTORY,
  INITIAL_OBSERVATIONS,
  INVENTORY_CAPACITY,
  MAX_OBSERVATIONS,
  OUTCOME_ORDER,
  PAIR_POLICY_ORDER,
  PASSABLE_OUTCOMES,
  REPLAY_SCHEMA_VERSION,
  RULES_VERSION,
  SCHEMA_VERSION,
  TERMINAL_REASON_ORDER,
  V1_RULE_CONFIG,
  VOID_ENERGY_PENALTY,
} from "./constants";
import type {
  EngineError,
  InvalidActionError,
  InvalidDistributionError,
  InvalidStateError,
} from "./errors";
import type {
  Action,
  Coordinate,
  EngineEvent,
  GameStateDto,
  Result,
} from "./types";

describe("version 1 domain", () => {
  it("publishes the exact closed domain orders", () => {
    expect(OUTCOME_ORDER).toEqual([
      "FLOOR",
      "WALL",
      "VOID",
      "CRYSTAL",
      "BATTERY",
    ]);
    expect(GAME_STATUS_ORDER).toEqual([
      "START",
      "PLAYING",
      "VICTORY",
      "DEFEAT",
    ]);
    expect(GATE_ORDER).toEqual(["X", "H"]);
    expect(PAIR_POLICY_ORDER).toEqual([
      "CORRELATED",
      "ANTI_CORRELATED",
    ]);
    expect(TERMINAL_REASON_ORDER).toEqual([
      "EXIT_REACHED",
      "INSUFFICIENT_VOID_ENERGY",
      "IRREVERSIBLE_BLOCKAGE",
      "RESOURCE_DEAD_END",
    ]);
    expect(PASSABLE_OUTCOMES).toEqual(["FLOOR", "CRYSTAL", "BATTERY"]);
  });

  it("publishes the exact v1 versions and board constants", () => {
    expect({ SCHEMA_VERSION, RULES_VERSION, REPLAY_SCHEMA_VERSION }).toEqual({
      SCHEMA_VERSION: 1,
      RULES_VERSION: 1,
      REPLAY_SCHEMA_VERSION: 1,
    });
    expect({ BOARD_SIZE, BOARD_CELL_COUNT }).toEqual({
      BOARD_SIZE: 7,
      BOARD_CELL_COUNT: 49,
    });
    expect(ENTRY_COORDINATE).toEqual({ row: 6, col: 0 });
    expect(EXIT_COORDINATE).toEqual({ row: 0, col: 6 });
  });

  it("publishes the exact v1 resource policy", () => {
    expect(V1_RULE_CONFIG).toEqual({
      rulesVersion: 1,
      boardSize: 7,
      initialObservations: 10,
      maxObservations: 13,
      initialEnergy: 1,
      voidEnergyPenalty: 1,
      inventoryCapacity: 2,
      decoherenceInterval: 4,
    });
    expect({
      INITIAL_OBSERVATIONS,
      MAX_OBSERVATIONS,
      INITIAL_ENERGY,
      VOID_ENERGY_PENALTY,
      INVENTORY_CAPACITY,
      DECOHERENCE_INTERVAL,
    }).toEqual({
      INITIAL_OBSERVATIONS: 10,
      MAX_OBSERVATIONS: 13,
      INITIAL_ENERGY: 1,
      VOID_ENERGY_PENALTY: 1,
      INVENTORY_CAPACITY: 2,
      DECOHERENCE_INTERVAL: 4,
    });
    expect(INITIAL_INVENTORY).toEqual(["X", "H"]);
  });

  it("exposes immutable constant collections", () => {
    for (const value of [
      OUTCOME_ORDER,
      GAME_STATUS_ORDER,
      GATE_ORDER,
      PAIR_POLICY_ORDER,
      TERMINAL_REASON_ORDER,
      PASSABLE_OUTCOMES,
      INITIAL_INVENTORY,
      ENTRY_COORDINATE,
      EXIT_COORDINATE,
      V1_RULE_CONFIG,
    ]) {
      expect(Object.isFrozen(value)).toBe(true);
    }
  });

  it("models only observation, gate, and movement actions", () => {
    const target: Coordinate = { row: 3, col: 4 };
    const actions = [
      { kind: "OBSERVE", target },
      { kind: "APPLY_GATE", gate: "X", target },
      { kind: "MOVE", target },
    ] as const satisfies readonly Action[];

    expect(actions.map((action) => action.kind)).toEqual([
      "OBSERVE",
      "APPLY_GATE",
      "MOVE",
    ]);
    expectTypeOf(actions).toMatchTypeOf<readonly Action[]>();
  });

  it("models serializable discriminated engine events", () => {
    const events = [
      { kind: "GAME_STARTED", status: "PLAYING" },
      { kind: "TURN_ADVANCED", turn: 1 },
      {
        kind: "STATUS_CHANGED",
        status: "VICTORY",
        reason: "EXIT_REACHED",
      },
    ] as const satisfies readonly EngineEvent[];

    expect(JSON.parse(JSON.stringify(events))).toEqual(events);
  });

  it("keeps principal error category discriminants non-overlapping", () => {
    const errors = [
      { kind: "INVALID_ACTION", reason: "TARGET_WALL", message: "invalid" },
      {
        kind: "INVALID_DISTRIBUTION",
        reason: "WRONG_ARITY",
        message: "invalid",
      },
      {
        kind: "INVALID_STATE",
        reason: "BOARD_SIZE",
        path: "board",
        message: "invalid",
      },
    ] as const satisfies readonly [
      InvalidActionError,
      InvalidDistributionError,
      InvalidStateError,
    ];

    expect(new Set(errors.map((error) => error.kind)).size).toBe(errors.length);
    expectTypeOf<(typeof errors)[number]>().toMatchTypeOf<EngineError>();
  });

  it("provides discriminated success and error results", () => {
    const success: Result<number, InvalidActionError> = { ok: true, value: 7 };
    const failure: Result<number, InvalidActionError> = {
      ok: false,
      error: {
        kind: "INVALID_ACTION",
        reason: "NO_OBSERVATIONS",
        message: "No observations remain.",
      },
    };

    expect(success.ok && success.value).toBe(7);
    expect(!failure.ok && failure.error.kind).toBe("INVALID_ACTION");
  });

  it("keeps state DTO contracts JSON-compatible", () => {
    const dto: GameStateDto = {
      schemaVersion: 1,
      rulesVersion: 1,
      status: "START",
      terminalReason: null,
      turn: 0,
      board: [],
      player: ENTRY_COORDINATE,
      observations: 10,
      energy: 1,
      inventory: INITIAL_INVENTORY,
      pairs: [],
      collectedCrystals: [],
      collectedBatteries: [],
    };

    expect(JSON.parse(JSON.stringify(dto))).toEqual(dto);
  });
});
