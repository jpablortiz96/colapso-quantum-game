import type {
  ActionResult,
  Distribution,
  GameState,
  Outcome,
  ReplayOutputDto,
  Result,
} from "./types";

export type InvalidCoordinateReason =
  | "MALFORMED_COORDINATE"
  | "NON_INTEGER_COORDINATE"
  | "COORDINATE_OUT_OF_BOUNDS"
  | "NEGATIVE_ZERO_COORDINATE";

export type InvalidCoordinateError = Readonly<{
  kind: "INVALID_COORDINATE";
  reason: InvalidCoordinateReason;
  message: string;
}>;

export type InvalidDistributionReason =
  | "WRONG_ARITY"
  | "NON_FINITE_PROBABILITY"
  | "NEGATIVE_PROBABILITY"
  | "SUM_OUT_OF_TOLERANCE"
  | "INVALID_QUANTILE"
  | "NO_ACTIVE_OUTCOME";

export type InvalidDistributionError = Readonly<{
  kind: "INVALID_DISTRIBUTION";
  reason: InvalidDistributionReason;
  message: string;
}>;

export type InvalidStateReason =
  | "MALFORMED_STATE"
  | "BOARD_SIZE"
  | "BOARD_COORDINATE"
  | "CELL_VARIANT"
  | "CELL_DISTRIBUTION"
  | "ENDPOINT"
  | "PLAYER"
  | "PAIR_COUNT"
  | "PAIR_ID"
  | "PAIR_ORDER"
  | "PAIR_MEMBER"
  | "PAIR_RESOLUTION"
  | "INVENTORY"
  | "OBSERVATIONS"
  | "TURN"
  | "ENERGY"
  | "COLLECTION"
  | "STATUS"
  | "TERMINAL_REASON"
  | "NEGATIVE_ZERO";

export type InvalidStateError = Readonly<{
  kind: "INVALID_STATE";
  reason: InvalidStateReason;
  path: string;
  message: string;
}>;

export type InvalidActionReason =
  | "MALFORMED_ACTION"
  | "UNSUPPORTED_ACTION"
  | "TERMINAL_STATE"
  | "TARGET_OUT_OF_BOUNDS"
  | "ENDPOINT_PROHIBITED"
  | "TARGET_COLLAPSED"
  | "TARGET_UNRESOLVED"
  | "TARGET_WALL"
  | "NON_ORTHOGONAL_MOVE"
  | "NO_OBSERVATIONS"
  | "GATE_UNAVAILABLE";

export type InvalidActionError = Readonly<{
  kind: "INVALID_ACTION";
  reason: InvalidActionReason;
  message: string;
}>;

export type EntropyRangeError = Readonly<{
  kind: "ENTROPY_RANGE";
  message: string;
}>;

export type EntropyExhaustedError = Readonly<{
  kind: "ENTROPY_EXHAUSTED";
  message: string;
}>;

export type EntropyContextMismatchError = Readonly<{
  kind: "ENTROPY_CONTEXT_MISMATCH";
  message: string;
}>;

export type EntropyError =
  | EntropyRangeError
  | EntropyExhaustedError
  | EntropyContextMismatchError;

export type MalformedJsonError = Readonly<{
  kind: "MALFORMED_JSON";
  message: string;
}>;

export type InvalidDtoError = Readonly<{
  kind: "INVALID_DTO";
  path: string;
  message: string;
}>;

export type UnsupportedSchemaVersionError = Readonly<{
  kind: "UNSUPPORTED_SCHEMA_VERSION";
  received: number;
  message: string;
}>;

export type UnsupportedRulesVersionError = Readonly<{
  kind: "UNSUPPORTED_RULES_VERSION";
  received: number;
  message: string;
}>;

export type InvalidSeedError = Readonly<{
  kind: "INVALID_SEED";
  reason: "EMPTY_SEED" | "MALFORMED_SEED";
  message: string;
}>;

export type ReplayUnusedEntropyError = Readonly<{
  kind: "REPLAY_UNUSED_ENTROPY";
  remainingEntries: number;
  message: string;
}>;

export type ReplayMismatchError = Readonly<{
  kind: "REPLAY_MISMATCH";
  field: "FINAL_STATE" | "FINAL_SCORE";
  message: string;
}>;

export type ActionExecutionError =
  | InvalidActionError
  | InvalidStateError
  | EntropyError
  | UnsupportedSchemaVersionError
  | UnsupportedRulesVersionError;

export type ReplayActionFailedError = Readonly<{
  kind: "REPLAY_ACTION_FAILED";
  actionIndex: number;
  cause: ActionExecutionError;
  message: string;
}>;

export type StateValidationError =
  | InvalidStateError
  | UnsupportedSchemaVersionError
  | UnsupportedRulesVersionError;

export type GenerationError =
  | InvalidSeedError
  | UnsupportedRulesVersionError
  | InvalidDistributionError
  | InvalidStateError;

export type SerializationError =
  | MalformedJsonError
  | InvalidDtoError
  | UnsupportedSchemaVersionError
  | UnsupportedRulesVersionError
  | InvalidStateError;

export type ReplayError =
  | SerializationError
  | EntropyError
  | ReplayUnusedEntropyError
  | ReplayActionFailedError
  | ReplayMismatchError;

export type EngineError =
  | InvalidCoordinateError
  | InvalidDistributionError
  | InvalidActionError
  | InvalidStateError
  | InvalidSeedError
  | EntropyError
  | MalformedJsonError
  | InvalidDtoError
  | UnsupportedSchemaVersionError
  | UnsupportedRulesVersionError
  | ReplayUnusedEntropyError
  | ReplayActionFailedError
  | ReplayMismatchError;

export type CoordinateValidationResult<T> = Result<T, InvalidCoordinateError>;
export type DistributionValidationResult = Result<
  Distribution,
  InvalidDistributionError
>;
export type DistributionSampleResult = Result<Outcome, InvalidDistributionError>;
export type StateValidationResult = Result<GameState, StateValidationError>;
export type EngineActionResult = ActionResult<ActionExecutionError>;
export type GenerationResult = Result<GameState, GenerationError>;
export type SerializationResult = Result<string, SerializationError>;
export type DeserializationResult = Result<GameState, SerializationError>;
export type ReplayResult = Result<ReplayOutputDto, ReplayError>;
