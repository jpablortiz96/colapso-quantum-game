import { collapseUnpairedCell } from "./collapse";
import {
  DECOHERENCE_INTERVAL,
  ENTRY_COORDINATE,
  EXIT_COORDINATE,
} from "./constants";
import { coordinatesEqual } from "./coordinates";
import {
  RecordingEntropySource,
  drawUnbiasedBoundedInteger,
} from "./entropy";
import { collapseEntangledPair, findEntangledPair } from "./entanglement";
import type {
  ActionExecutionError,
  EngineActionResult,
  EntropyError,
} from "./errors";
import { validateGameState } from "./invariants";
import type {
  Coordinate,
  EngineEvent,
  EntropyContext,
  EntropyRecord,
  EntropySource,
  GameState,
} from "./types";

export type DecoherenceEntropySource = EntropySource<EntropyError>;
export type DecoherenceResult = EngineActionResult;

const decoherenceFailure = (
  state: GameState,
  error: ActionExecutionError,
): DecoherenceResult => ({
  ok: false,
  state,
  events: [],
  error,
});

const decoherenceSuccess = (
  state: GameState,
  events: readonly EngineEvent[] = [],
  entropyDelta: readonly EntropyRecord[] = [],
): DecoherenceResult =>
  Object.freeze({
    ok: true,
    state,
    events: Object.freeze([...events]),
    entropyDelta: Object.freeze([...entropyDelta]),
  });

const isEndpoint = (coordinate: Coordinate): boolean =>
  coordinatesEqual(coordinate, ENTRY_COORDINATE) ||
  coordinatesEqual(coordinate, EXIT_COORDINATE);

export const isDecoherenceTurn = (turn: number): boolean =>
  turn > 0 && turn % DECOHERENCE_INTERVAL === 0;

export const enumerateDecoherenceCandidates = (
  state: GameState,
): readonly Coordinate[] =>
  Object.freeze(
    state.board
      .filter(
        (cell) =>
          cell.kind === "UNRESOLVED" && !isEndpoint(cell.coordinate),
      )
      .map((cell) => cell.coordinate),
  );

export const processScheduledDecoherence = (
  state: GameState,
  source: DecoherenceEntropySource,
): DecoherenceResult => {
  const stateValidation = validateGameState(state);
  if (!stateValidation.ok) {
    return decoherenceFailure(state, stateValidation.error);
  }

  if (!isDecoherenceTurn(state.turn)) {
    return decoherenceSuccess(state);
  }

  const candidates = enumerateDecoherenceCandidates(state);
  if (candidates.length === 0) {
    return decoherenceSuccess(state);
  }

  const selectionContext = Object.freeze({
    operation: "DECOHERENCE_SELECT" as const,
    turn: state.turn,
    candidateCount: candidates.length,
  }) satisfies EntropyContext;
  const selectionSource = new RecordingEntropySource(source);
  const selection = drawUnbiasedBoundedInteger(
    selectionSource,
    selectionContext,
    candidates.length,
  );
  if (!selection.ok) {
    return decoherenceFailure(state, selection.error);
  }

  const coordinate = candidates[selection.value];
  if (coordinate === undefined) {
    throw new RangeError("Decoherence selection produced an invalid index.");
  }
  const pair = findEntangledPair(state, coordinate);
  const collapse =
    pair === null
      ? collapseUnpairedCell(state, coordinate, "DECOHERENCE", source)
      : collapseEntangledPair(state, coordinate, "DECOHERENCE", source);
  if (!collapse.ok) {
    return decoherenceFailure(state, collapse.error);
  }

  const candidateValidation = validateGameState(collapse.state);
  if (!candidateValidation.ok) {
    return decoherenceFailure(state, candidateValidation.error);
  }

  const selectedEvent = Object.freeze({
    kind: "DECOHERENCE_SELECTED" as const,
    turn: state.turn,
    coordinate,
    pairId: pair?.id ?? null,
  });

  return decoherenceSuccess(
    collapse.state,
    [selectedEvent, ...collapse.events],
    [...selectionSource.records, ...collapse.entropyDelta],
  );
};
