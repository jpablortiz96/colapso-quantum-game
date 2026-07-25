import {
  ENTRY_COORDINATE,
  EXIT_COORDINATE,
} from "./constants";
import {
  coordinatesEqual,
  validateCoordinate,
} from "./coordinates";
import { sampleDistribution } from "./distribution";
import { requestValidatedUint32, wordToQuantile } from "./entropy";
import type {
  ActionExecutionError,
  EngineActionResult,
  EntropyError,
  InvalidActionError,
  InvalidStateError,
  StateValidationError,
} from "./errors";
import { validateGameState } from "./invariants";
import type {
  CollapseCause,
  CollapsedCell,
  Coordinate,
  EngineEvent,
  EntropyContext,
  EntropyRecord,
  EntropySource,
  GameState,
  Outcome,
  UnresolvedCell,
} from "./types";

export type CollapseEntropySource = EntropySource<EntropyError>;
export type CollapseResult = EngineActionResult;

export type ValidatedCollapseTarget = Readonly<{
  coordinate: Coordinate;
  cell: UnresolvedCell;
  boardIndex: number;
}>;

const invalidAction = (
  reason: InvalidActionError["reason"],
  message: string,
): InvalidActionError => ({ kind: "INVALID_ACTION", reason, message });

export const pairStateError = (message: string): InvalidStateError => ({
  kind: "INVALID_STATE",
  reason: "PAIR_MEMBER",
  path: "pairs",
  message,
});

const distributionStateError = (message: string): InvalidStateError => ({
  kind: "INVALID_STATE",
  reason: "CELL_DISTRIBUTION",
  path: "board",
  message,
});

export const collapseFailure = (
  state: GameState,
  error: ActionExecutionError,
): CollapseResult => ({
  ok: false,
  state,
  events: [],
  error,
});

const coordinateToBoardIndex = (coordinate: Coordinate): number =>
  coordinate.row * 7 + coordinate.col;

const isEndpoint = (coordinate: Coordinate): boolean =>
  coordinatesEqual(coordinate, ENTRY_COORDINATE) ||
  coordinatesEqual(coordinate, EXIT_COORDINATE);

export const validateCollapseTarget = (
  state: GameState,
  target: Coordinate,
  cause: CollapseCause,
):
  | Readonly<{ ok: true; value: ValidatedCollapseTarget }>
  | Readonly<{ ok: false; error: ActionExecutionError }> => {
  const stateValidation = validateGameState(state);
  if (!stateValidation.ok) {
    return stateValidation;
  }

  if (state.status === "VICTORY" || state.status === "DEFEAT") {
    return {
      ok: false,
      error: invalidAction(
        "TERMINAL_STATE",
        "Collapse is unavailable after the game has ended.",
      ),
    };
  }

  if (cause !== "OBSERVATION" && cause !== "DECOHERENCE") {
    return {
      ok: false,
      error: invalidAction("MALFORMED_ACTION", "Collapse cause is unsupported."),
    };
  }

  const coordinateValidation = validateCoordinate(target);
  if (!coordinateValidation.ok) {
    return {
      ok: false,
      error: invalidAction(
        "TARGET_OUT_OF_BOUNDS",
        "Collapse target must be a canonical in-bounds coordinate.",
      ),
    };
  }
  const coordinate = coordinateValidation.value;

  if (isEndpoint(coordinate)) {
    return {
      ok: false,
      error: invalidAction(
        "ENDPOINT_PROHIBITED",
        "Entry and exit endpoints cannot collapse.",
      ),
    };
  }

  const boardIndex = coordinateToBoardIndex(coordinate);
  const cell = state.board[boardIndex];
  if (cell === undefined) {
    return {
      ok: false,
      error: invalidAction(
        "TARGET_OUT_OF_BOUNDS",
        "Collapse target does not identify a board cell.",
      ),
    };
  }
  if (cell.kind === "COLLAPSED") {
    return {
      ok: false,
      error: invalidAction(
        "TARGET_COLLAPSED",
        "A collapsed cell cannot collapse again.",
      ),
    };
  }

  if (cause === "OBSERVATION" && state.observations === 0) {
    return {
      ok: false,
      error: invalidAction(
        "NO_OBSERVATIONS",
        "No observations remain for this collapse.",
      ),
    };
  }

  return {
    ok: true,
    value: Object.freeze({
      coordinate: cell.coordinate,
      cell,
      boardIndex,
    }),
  };
};

export const collapseEntropyContext = (
  cause: CollapseCause,
  coordinate: Coordinate,
  pairId: string | null,
  turn: number,
): EntropyContext =>
  cause === "OBSERVATION"
    ? Object.freeze({
        operation: "OBSERVE_COLLAPSE",
        coordinate,
        pairId,
      })
    : Object.freeze({
        operation: "DECOHERENCE_COLLAPSE",
        turn,
        coordinate,
        pairId,
      });

export const requestCollapseWord = (
  source: CollapseEntropySource,
  context: EntropyContext,
):
  | Readonly<{ ok: true; word: number; record: EntropyRecord }>
  | Readonly<{ ok: false; error: EntropyError }> => {
  const wordResult = requestValidatedUint32(source, context);
  if (!wordResult.ok) {
    return wordResult;
  }

  return {
    ok: true,
    word: wordResult.value,
    record: Object.freeze({ context, word: wordResult.value }),
  };
};

export const sampleCollapsedOutcome = (
  cell: UnresolvedCell,
  quantile: number,
):
  | Readonly<{ ok: true; value: Outcome }>
  | Readonly<{ ok: false; error: InvalidStateError }> => {
  const sample = sampleDistribution(cell.distribution, quantile);
  return sample.ok
    ? sample
    : {
        ok: false,
        error: distributionStateError(sample.error.message),
      };
};

export const createCollapsedCell = (
  cell: UnresolvedCell,
  outcome: Outcome,
): CollapsedCell =>
  Object.freeze({
    kind: "COLLAPSED",
    coordinate: cell.coordinate,
    outcome,
  });

export const createCollapseEvent = (
  coordinate: Coordinate,
  outcome: Outcome,
  cause: CollapseCause,
  pairId: string | null,
): EngineEvent =>
  Object.freeze({
    kind: "CELL_COLLAPSED",
    coordinate,
    outcome,
    cause,
    pairId,
  });

export const createObservationEvent = (
  coordinate: Coordinate,
  remainingObservations: number,
): EngineEvent =>
  Object.freeze({
    kind: "OBSERVATION_SPENT",
    target: coordinate,
    remainingObservations,
  });

export const validateCandidateState = (
  state: GameState,
): StateValidationError | null => {
  const validation = validateGameState(state);
  return validation.ok ? null : validation.error;
};

export const collapseUnpairedCell = (
  state: GameState,
  target: Coordinate,
  cause: CollapseCause,
  source: CollapseEntropySource,
): CollapseResult => {
  const targetValidation = validateCollapseTarget(state, target, cause);
  if (!targetValidation.ok) {
    return collapseFailure(state, targetValidation.error);
  }

  const belongsToPair = state.pairs.some(
    ({ memberA, memberB }) =>
      coordinatesEqual(memberA, targetValidation.value.coordinate) ||
      coordinatesEqual(memberB, targetValidation.value.coordinate),
  );
  if (belongsToPair) {
    return collapseFailure(
      state,
      pairStateError(
        "An entangled member must be resolved through the pair operation.",
      ),
    );
  }

  const context = collapseEntropyContext(
    cause,
    targetValidation.value.coordinate,
    null,
    state.turn,
  );
  const entropy = requestCollapseWord(source, context);
  if (!entropy.ok) {
    return collapseFailure(state, entropy.error);
  }

  const sampled = sampleCollapsedOutcome(
    targetValidation.value.cell,
    wordToQuantile(entropy.word),
  );
  if (!sampled.ok) {
    return collapseFailure(state, sampled.error);
  }

  const board = [...state.board];
  board[targetValidation.value.boardIndex] = createCollapsedCell(
    targetValidation.value.cell,
    sampled.value,
  );
  const remainingObservations =
    cause === "OBSERVATION" ? state.observations - 1 : state.observations;
  const candidate: GameState = Object.freeze({
    ...state,
    board: Object.freeze(board),
    observations: remainingObservations,
  });

  const candidateError = validateCandidateState(candidate);
  if (candidateError !== null) {
    return collapseFailure(state, candidateError);
  }

  const events: EngineEvent[] = [];
  if (cause === "OBSERVATION") {
    events.push(
      createObservationEvent(
        targetValidation.value.coordinate,
        remainingObservations,
      ),
    );
  }
  events.push(
    createCollapseEvent(
      targetValidation.value.coordinate,
      sampled.value,
      cause,
      null,
    ),
  );

  return Object.freeze({
    ok: true,
    state: candidate,
    events: Object.freeze(events),
    entropyDelta: Object.freeze([entropy.record]),
  });
};

export const resolveUnpairedCollapse = collapseUnpairedCell;
