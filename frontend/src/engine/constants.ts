import type {
  Coordinate,
  GateKind,
  GameStatus,
  Outcome,
  PairPolicy,
  RuleConfig,
  TerminalReason,
} from "./types";

export const SCHEMA_VERSION = 1 as const;
export const RULES_VERSION = 1 as const;
export const REPLAY_SCHEMA_VERSION = 1 as const;

export const BOARD_SIZE = 7 as const;
export const BOARD_CELL_COUNT = 49 as const;

export const ENTRY_COORDINATE: Coordinate = Object.freeze({ row: 6, col: 0 });
export const EXIT_COORDINATE: Coordinate = Object.freeze({ row: 0, col: 6 });

export const OUTCOME_ORDER: readonly Outcome[] = Object.freeze([
  "FLOOR",
  "WALL",
  "VOID",
  "CRYSTAL",
  "BATTERY",
]);

export const GAME_STATUS_ORDER: readonly GameStatus[] = Object.freeze([
  "START",
  "PLAYING",
  "VICTORY",
  "DEFEAT",
]);

export const GATE_ORDER: readonly GateKind[] = Object.freeze(["X", "H"]);

export const PAIR_POLICY_ORDER: readonly PairPolicy[] = Object.freeze([
  "CORRELATED",
  "ANTI_CORRELATED",
]);

export const TERMINAL_REASON_ORDER: readonly TerminalReason[] = Object.freeze([
  "EXIT_REACHED",
  "INSUFFICIENT_VOID_ENERGY",
  "IRREVERSIBLE_BLOCKAGE",
  "RESOURCE_DEAD_END",
]);

export const PASSABLE_OUTCOMES: readonly Outcome[] = Object.freeze([
  "FLOOR",
  "CRYSTAL",
  "BATTERY",
]);

export const DISTRIBUTION_SUM_TOLERANCE = 1e-12;
export const INITIAL_OBSERVATIONS = 10 as const;
export const MAX_OBSERVATIONS = 13 as const;
export const INITIAL_ENERGY = 1 as const;
export const VOID_ENERGY_PENALTY = 1 as const;
export const INVENTORY_CAPACITY = 2 as const;
export const DECOHERENCE_INTERVAL = 4 as const;

export const INITIAL_INVENTORY: readonly GateKind[] = Object.freeze(["X", "H"]);

export const V1_RULE_CONFIG: RuleConfig = Object.freeze({
  rulesVersion: RULES_VERSION,
  boardSize: BOARD_SIZE,
  initialObservations: INITIAL_OBSERVATIONS,
  maxObservations: MAX_OBSERVATIONS,
  initialEnergy: INITIAL_ENERGY,
  voidEnergyPenalty: VOID_ENERGY_PENALTY,
  inventoryCapacity: INVENTORY_CAPACITY,
  decoherenceInterval: DECOHERENCE_INTERVAL,
});
