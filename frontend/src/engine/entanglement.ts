import {
  collapseEntropyContext,
  collapseFailure,
  createCollapseEvent,
  createCollapsedCell,
  createObservationEvent,
  pairStateError,
  requestCollapseWord,
  sampleCollapsedOutcome,
  validateCandidateState,
  validateCollapseTarget,
} from "./collapse";
import type {
  CollapseEntropySource,
  CollapseResult,
} from "./collapse";
import { coordinatesEqual } from "./coordinates";
import {
  complementaryWordToQuantile,
  wordToQuantile,
} from "./entropy";
import type {
  CollapseCause,
  Coordinate,
  EngineEvent,
  EntangledPair,
  GameState,
  UnresolvedCell,
} from "./types";

export const findEntangledPair = (
  state: GameState,
  coordinate: Coordinate,
): EntangledPair | null =>
  state.pairs.find(
    ({ memberA, memberB }) =>
      coordinatesEqual(memberA, coordinate) ||
      coordinatesEqual(memberB, coordinate),
  ) ?? null;

const boardIndex = (coordinate: Coordinate): number =>
  coordinate.row * 7 + coordinate.col;

const unresolvedPairCells = (
  state: GameState,
  pair: EntangledPair,
):
  | Readonly<{
      memberA: UnresolvedCell;
      memberB: UnresolvedCell;
      memberAIndex: number;
      memberBIndex: number;
    }>
  | null => {
  const memberAIndex = boardIndex(pair.memberA);
  const memberBIndex = boardIndex(pair.memberB);
  const memberA = state.board[memberAIndex];
  const memberB = state.board[memberBIndex];
  if (memberA?.kind !== "UNRESOLVED" || memberB?.kind !== "UNRESOLVED") {
    return null;
  }

  return Object.freeze({ memberA, memberB, memberAIndex, memberBIndex });
};

export const collapseEntangledPair = (
  state: GameState,
  initiator: Coordinate,
  cause: CollapseCause,
  source: CollapseEntropySource,
): CollapseResult => {
  const targetValidation = validateCollapseTarget(state, initiator, cause);
  if (!targetValidation.ok) {
    return collapseFailure(state, targetValidation.error);
  }

  const pair = findEntangledPair(state, targetValidation.value.coordinate);
  if (pair === null) {
    return collapseFailure(
      state,
      pairStateError(
        "Pair resolution requires the initiating coordinate to belong to a pair.",
      ),
    );
  }

  const cells = unresolvedPairCells(state, pair);
  if (cells === null) {
    return collapseFailure(
      state,
      pairStateError(
        "Pair members must both be unresolved before pair resolution.",
      ),
    );
  }

  const context = collapseEntropyContext(
    cause,
    pair.memberA,
    pair.id,
    state.turn,
  );
  const entropy = requestCollapseWord(source, context);
  if (!entropy.ok) {
    return collapseFailure(state, entropy.error);
  }

  const memberAQuantile = wordToQuantile(entropy.word);
  const memberBQuantile =
    pair.policy === "CORRELATED"
      ? memberAQuantile
      : complementaryWordToQuantile(entropy.word);
  const memberAOutcome = sampleCollapsedOutcome(
    cells.memberA,
    memberAQuantile,
  );
  if (!memberAOutcome.ok) {
    return collapseFailure(state, memberAOutcome.error);
  }
  const memberBOutcome = sampleCollapsedOutcome(
    cells.memberB,
    memberBQuantile,
  );
  if (!memberBOutcome.ok) {
    return collapseFailure(state, memberBOutcome.error);
  }

  const board = [...state.board];
  board[cells.memberAIndex] = createCollapsedCell(
    cells.memberA,
    memberAOutcome.value,
  );
  board[cells.memberBIndex] = createCollapsedCell(
    cells.memberB,
    memberBOutcome.value,
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
        pair.memberA,
        remainingObservations,
      ),
    );
  }
  events.push(
    createCollapseEvent(
      pair.memberA,
      memberAOutcome.value,
      cause,
      pair.id,
    ),
    createCollapseEvent(
      pair.memberB,
      memberBOutcome.value,
      cause,
      pair.id,
    ),
  );

  return Object.freeze({
    ok: true,
    state: candidate,
    events: Object.freeze(events),
    entropyDelta: Object.freeze([entropy.record]),
  });
};

export const resolveEntangledPair = collapseEntangledPair;
