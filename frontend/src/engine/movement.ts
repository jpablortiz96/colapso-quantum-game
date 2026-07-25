import { BOARD_SIZE, PASSABLE_OUTCOMES, V1_RULE_CONFIG } from "./constants";
import {
  isOrthogonallyAdjacent,
  validateCoordinate,
} from "./coordinates";
import type {
  ActionExecutionError,
  EngineActionResult,
  InvalidActionError,
} from "./errors";
import { validateGameState } from "./invariants";
import { collectResourceOnEntry } from "./resources";
import type {
  EngineEvent,
  EntropyRecord,
  GameState,
  MoveAction,
} from "./types";

const MOVE_ACTION_KEYS = Object.freeze(["kind", "target"] as const);

export type MovementDirectSuccess = Readonly<{
  ok: true;
  state: GameState;
  events: readonly EngineEvent[];
  entropyDelta: readonly EntropyRecord[];
  voidEntryInsufficient: boolean;
}>;

export type MovementDirectResult =
  | MovementDirectSuccess
  | Extract<EngineActionResult, { ok: false }>;

export type MovementResult = EngineActionResult;

const invalidAction = (
  reason: InvalidActionError["reason"],
  message: string,
): InvalidActionError => ({ kind: "INVALID_ACTION", reason, message });

const movementFailure = (
  state: GameState,
  error: ActionExecutionError,
): MovementDirectResult => ({
  ok: false,
  state,
  events: [],
  error,
});

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const parseMoveAction = (
  value: unknown,
):
  | Readonly<{ ok: true; value: MoveAction }>
  | Readonly<{ ok: false; error: InvalidActionError }> => {
  if (
    isRecord(value) &&
    Object.hasOwn(value, "kind") &&
    value.kind !== "MOVE"
  ) {
    return {
      ok: false,
      error: invalidAction(
        "UNSUPPORTED_ACTION",
        "Direct movement supports only MOVE actions.",
      ),
    };
  }

  if (
    !isRecord(value) ||
    value.kind !== "MOVE" ||
    Object.keys(value).length !== MOVE_ACTION_KEYS.length ||
    !MOVE_ACTION_KEYS.every((key) => Object.hasOwn(value, key))
  ) {
    return {
      ok: false,
      error: invalidAction(
        "MALFORMED_ACTION",
        "Move action must contain exactly kind and target.",
      ),
    };
  }

  const coordinate = validateCoordinate(value.target);
  if (!coordinate.ok) {
    return {
      ok: false,
      error: invalidAction(
        "TARGET_OUT_OF_BOUNDS",
        "Move target must be a canonical in-bounds coordinate.",
      ),
    };
  }

  return {
    ok: true,
    value: Object.freeze({ kind: "MOVE", target: coordinate.value }),
  };
};

const boardIndex = (row: number, col: number): number =>
  row * BOARD_SIZE + col;

const movementSuccess = (
  state: GameState,
  events: readonly EngineEvent[],
  voidEntryInsufficient: boolean,
): MovementDirectSuccess =>
  Object.freeze({
    ok: true,
    state,
    events: Object.freeze([...events]),
    entropyDelta: Object.freeze([]),
    voidEntryInsufficient,
  });

/**
 * Applies only movement, collection, or VOID direct effects. Turn and lifecycle
 * progression belong exclusively to processAction.
 */
export const applyMovementDirect = (
  state: GameState,
  action: unknown,
): MovementDirectResult => {
  const stateValidation = validateGameState(state);
  if (!stateValidation.ok) {
    return movementFailure(state, stateValidation.error);
  }

  if (state.status === "VICTORY" || state.status === "DEFEAT") {
    return movementFailure(
      state,
      invalidAction(
        "TERMINAL_STATE",
        "Movement is unavailable after the game has ended.",
      ),
    );
  }

  const parsedAction = parseMoveAction(action);
  if (!parsedAction.ok) {
    return movementFailure(state, parsedAction.error);
  }

  const targetCoordinate = parsedAction.value.target;
  if (!isOrthogonallyAdjacent(state.player, targetCoordinate)) {
    return movementFailure(
      state,
      invalidAction(
        "NON_ORTHOGONAL_MOVE",
        "Move target must be exactly one orthogonal step from the player.",
      ),
    );
  }

  const target = state.board[
    boardIndex(targetCoordinate.row, targetCoordinate.col)
  ];
  if (target === undefined) {
    return movementFailure(
      state,
      invalidAction(
        "TARGET_OUT_OF_BOUNDS",
        "Move target does not identify a board cell.",
      ),
    );
  }
  if (target.kind === "UNRESOLVED") {
    return movementFailure(
      state,
      invalidAction(
        "TARGET_UNRESOLVED",
        "An unresolved cell cannot be occupied.",
      ),
    );
  }
  if (target.outcome === "WALL") {
    return movementFailure(
      state,
      invalidAction("TARGET_WALL", "A wall cannot be occupied."),
    );
  }

  if (target.outcome === "VOID") {
    const energyBefore = state.energy;
    const sufficientEnergy = energyBefore >= V1_RULE_CONFIG.voidEnergyPenalty;
    const energyAfter = sufficientEnergy
      ? energyBefore - V1_RULE_CONFIG.voidEnergyPenalty
      : 0;
    const candidate: GameState = Object.freeze({ ...state, energy: energyAfter });
    const candidateValidation = validateGameState(candidate);
    if (!candidateValidation.ok) {
      return movementFailure(state, candidateValidation.error);
    }

    return movementSuccess(
      candidate,
      [
        Object.freeze({
          kind: "VOID_ENTRY",
          from: state.player,
          target: target.coordinate,
          energyBefore,
          energyAfter,
          sufficientEnergy,
        }),
      ],
      !sufficientEnergy,
    );
  }

  if (!PASSABLE_OUTCOMES.includes(target.outcome)) {
    return movementFailure(
      state,
      invalidAction("TARGET_WALL", "Move target is not passable."),
    );
  }

  const resources = collectResourceOnEntry(state, target);
  const candidate: GameState = Object.freeze({
    ...state,
    player: target.coordinate,
    observations: resources.observations,
    collectedCrystals: resources.collectedCrystals,
    collectedBatteries: resources.collectedBatteries,
  });
  const candidateValidation = validateGameState(candidate);
  if (!candidateValidation.ok) {
    return movementFailure(state, candidateValidation.error);
  }

  return movementSuccess(
    candidate,
    [
      Object.freeze({
        kind: "PLAYER_MOVED",
        from: state.player,
        to: target.coordinate,
      }),
      ...resources.events,
    ],
    false,
  );
};

/** Canonical direct-action result without the internal terminal signal. */
export const movePlayer = (
  state: GameState,
  action: unknown,
): MovementResult => {
  const result = applyMovementDirect(state, action);
  if (!result.ok) {
    return result;
  }
  return Object.freeze({
    ok: true,
    state: result.state,
    events: result.events,
    entropyDelta: result.entropyDelta,
  });
};

export const applyMovement = movePlayer;
