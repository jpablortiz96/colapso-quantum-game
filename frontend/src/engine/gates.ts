import {
  BOARD_SIZE,
  DISTRIBUTION_SUM_TOLERANCE,
  ENTRY_COORDINATE,
  EXIT_COORDINATE,
} from "./constants";
import {
  coordinatesEqual,
  validateCoordinate,
} from "./coordinates";
import type {
  ActionExecutionError,
  EngineActionResult,
  InvalidActionError,
} from "./errors";
import { validateGameState } from "./invariants";
import type {
  ApplyGateAction,
  Distribution,
  EngineEvent,
  GameState,
  GateKind,
  UnresolvedCell,
} from "./types";

const APPLY_GATE_ACTION_KEYS = Object.freeze(["kind", "gate", "target"] as const);

const invalidAction = (
  reason: InvalidActionError["reason"],
  message: string,
): InvalidActionError => ({ kind: "INVALID_ACTION", reason, message });

const gateFailure = (
  state: GameState,
  error: ActionExecutionError,
): EngineActionResult => ({
  ok: false,
  state,
  events: [],
  error,
});

const isApplyGateAction = (value: unknown): value is ApplyGateAction => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const keys = Object.keys(value);
  if (
    keys.length !== APPLY_GATE_ACTION_KEYS.length ||
    !APPLY_GATE_ACTION_KEYS.every((key) => Object.hasOwn(value, key))
  ) {
    return false;
  }

  const action = value as Record<string, unknown>;
  return (
    action.kind === "APPLY_GATE" &&
    (action.gate === "X" || action.gate === "H")
  );
};

const boardIndex = (coordinate: Readonly<{ row: number; col: number }>): number =>
  coordinate.row * BOARD_SIZE + coordinate.col;

const isEndpoint = (coordinate: Readonly<{ row: number; col: number }>): boolean =>
  coordinatesEqual(coordinate, ENTRY_COORDINATE) ||
  coordinatesEqual(coordinate, EXIT_COORDINATE);

export const applyXGate = (distribution: Distribution): Distribution => {
  const activeValues = distribution.filter((probability) => probability > 0);
  let nextActiveIndex = activeValues.length - 1;
  const transformed = distribution.map((probability) => {
    if (probability === 0) {
      return 0;
    }
    const reversedProbability = activeValues[nextActiveIndex];
    nextActiveIndex -= 1;
    return reversedProbability ?? 0;
  });

  return Object.freeze(transformed) as unknown as Distribution;
};

export const applyHGate = (distribution: Distribution): Distribution => {
  const participantIndices = distribution
    .map((probability, index) =>
      probability > DISTRIBUTION_SUM_TOLERANCE ? index : -1,
    )
    .filter((index) => index >= 0);
  const transformed = [0, 0, 0, 0, 0];
  const equalProbability = 1 / participantIndices.length;
  let assignedMass = 0;

  participantIndices.forEach((index, participantIndex) => {
    const isLastParticipant = participantIndex === participantIndices.length - 1;
    const probability = isLastParticipant
      ? 1 - assignedMass
      : equalProbability;
    transformed[index] = probability;
    assignedMass += probability;
  });

  return Object.freeze(transformed) as unknown as Distribution;
};

const transformDistribution = (
  gate: GateKind,
  distribution: Distribution,
): Distribution =>
  gate === "X" ? applyXGate(distribution) : applyHGate(distribution);

const createGateEvent = (
  action: ApplyGateAction,
  target: UnresolvedCell,
  distributionAfter: Distribution,
  remainingInventory: readonly GateKind[],
): EngineEvent =>
  Object.freeze({
    kind: "GATE_APPLIED",
    gate: action.gate,
    target: target.coordinate,
    distributionBefore: target.distribution,
    distributionAfter,
    remainingInventory,
  });

export const applyGate = (
  state: GameState,
  action: unknown,
): EngineActionResult => {
  const stateValidation = validateGameState(state);
  if (!stateValidation.ok) {
    return gateFailure(state, stateValidation.error);
  }

  if (state.status === "VICTORY" || state.status === "DEFEAT") {
    return gateFailure(
      state,
      invalidAction(
        "TERMINAL_STATE",
        "Gates are unavailable after the game has ended.",
      ),
    );
  }

  if (
    typeof action === "object" &&
    action !== null &&
    !Array.isArray(action) &&
    Object.hasOwn(action, "kind") &&
    (action as Record<string, unknown>).kind !== "APPLY_GATE"
  ) {
    return gateFailure(
      state,
      invalidAction(
        "UNSUPPORTED_ACTION",
        "Direct gate application supports only APPLY_GATE actions.",
      ),
    );
  }

  if (!isApplyGateAction(action)) {
    return gateFailure(
      state,
      invalidAction(
        "MALFORMED_ACTION",
        "Gate action must contain exactly kind, gate, and target.",
      ),
    );
  }

  const coordinateValidation = validateCoordinate(action.target);
  if (!coordinateValidation.ok) {
    return gateFailure(
      state,
      invalidAction(
        "TARGET_OUT_OF_BOUNDS",
        "Gate target must be a canonical in-bounds coordinate.",
      ),
    );
  }
  const coordinate = coordinateValidation.value;

  if (isEndpoint(coordinate)) {
    return gateFailure(
      state,
      invalidAction(
        "ENDPOINT_PROHIBITED",
        "Entry and exit endpoints cannot receive gates.",
      ),
    );
  }

  const targetIndex = boardIndex(coordinate);
  const target = state.board[targetIndex];
  if (target === undefined) {
    return gateFailure(
      state,
      invalidAction(
        "TARGET_OUT_OF_BOUNDS",
        "Gate target does not identify a board cell.",
      ),
    );
  }
  if (target.kind === "COLLAPSED") {
    return gateFailure(
      state,
      invalidAction(
        "TARGET_COLLAPSED",
        "A collapsed cell cannot receive a gate.",
      ),
    );
  }

  const inventoryIndex = state.inventory.indexOf(action.gate);
  if (inventoryIndex < 0) {
    return gateFailure(
      state,
      invalidAction(
        "GATE_UNAVAILABLE",
        `Gate ${action.gate} is not available in inventory.`,
      ),
    );
  }

  const distributionAfter = transformDistribution(
    action.gate,
    target.distribution,
  );
  const transformedTarget: UnresolvedCell = Object.freeze({
    kind: "UNRESOLVED",
    coordinate: target.coordinate,
    distribution: distributionAfter,
  });
  const board = [...state.board];
  board[targetIndex] = transformedTarget;
  const remainingInventory = Object.freeze([
    ...state.inventory.slice(0, inventoryIndex),
    ...state.inventory.slice(inventoryIndex + 1),
  ]);
  const candidate: GameState = Object.freeze({
    ...state,
    board: Object.freeze(board),
    inventory: remainingInventory,
  });

  const candidateValidation = validateGameState(candidate);
  if (!candidateValidation.ok) {
    return gateFailure(state, candidateValidation.error);
  }

  const event = createGateEvent(
    action,
    target,
    distributionAfter,
    remainingInventory,
  );
  return Object.freeze({
    ok: true,
    state: candidate,
    events: Object.freeze([event]),
    entropyDelta: Object.freeze([]),
  });
};
