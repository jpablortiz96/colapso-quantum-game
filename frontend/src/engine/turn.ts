import { collapseUnpairedCell } from "./collapse";
import { validateCoordinate } from "./coordinates";
import { processScheduledDecoherence } from "./decoherence";
import { collapseEntangledPair, findEntangledPair } from "./entanglement";
import {
  evaluateTerminalState,
  type TerminalEvaluationContext,
} from "./endings";
import type {
  ActionExecutionError,
  EngineActionResult,
  EntropyError,
  InvalidActionError,
} from "./errors";
import { applyGate } from "./gates";
import { validateGameState } from "./invariants";
import { applyMovementDirect } from "./movement";
import type {
  Action,
  EngineEvent,
  EntropyRecord,
  EntropySource,
  GameState,
} from "./types";

export type TurnEntropySource = EntropySource<EntropyError>;

export type DeferredTurnHookResult =
  | Readonly<{
      ok: true;
      state: GameState;
      events: readonly EngineEvent[];
      entropyDelta: readonly EntropyRecord[];
    }>
  | Readonly<{
      ok: false;
      error: ActionExecutionError;
    }>;

export interface DecoherenceHook {
  run(state: GameState, source: TurnEntropySource): DeferredTurnHookResult;
}

export type { TerminalEvaluationContext } from "./endings";

export interface TerminalEvaluationHook {
  run(context: TerminalEvaluationContext): DeferredTurnHookResult;
}

/** Milestone 6 scheduled decoherence, retained as a hook boundary for turn order. */
export const deferredDecoherenceHook: DecoherenceHook = Object.freeze({
  run: processScheduledDecoherence,
});

/** Canonical post-decoherence terminal evaluation hook. */
export const deferredTerminalEvaluationHook: TerminalEvaluationHook =
  Object.freeze({ run: evaluateTerminalState });

const invalidAction = (
  reason: InvalidActionError["reason"],
  message: string,
): InvalidActionError => ({ kind: "INVALID_ACTION", reason, message });

const turnFailure = (
  state: GameState,
  error: ActionExecutionError,
): EngineActionResult => ({
  ok: false,
  state,
  events: [],
  error,
});

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const exactKeys = (
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean =>
  Object.keys(value).length === keys.length &&
  keys.every((key) => Object.hasOwn(value, key));

const parseAction = (
  value: unknown,
):
  | Readonly<{ ok: true; value: Action }>
  | Readonly<{ ok: false; error: InvalidActionError }> => {
  if (!isRecord(value) || !Object.hasOwn(value, "kind")) {
    return {
      ok: false,
      error: invalidAction(
        "MALFORMED_ACTION",
        "Action must be an object with a supported kind.",
      ),
    };
  }
  if (
    value.kind !== "OBSERVE" &&
    value.kind !== "APPLY_GATE" &&
    value.kind !== "MOVE"
  ) {
    return {
      ok: false,
      error: invalidAction(
        "UNSUPPORTED_ACTION",
        "Action kind is unsupported by version 1 rules.",
      ),
    };
  }

  const requiredKeys =
    value.kind === "APPLY_GATE"
      ? (["kind", "gate", "target"] as const)
      : (["kind", "target"] as const);
  if (!exactKeys(value, requiredKeys)) {
    return {
      ok: false,
      error: invalidAction(
        "MALFORMED_ACTION",
        "Action contains missing or unexpected fields.",
      ),
    };
  }

  const target = validateCoordinate(value.target);
  if (!target.ok) {
    return {
      ok: false,
      error: invalidAction(
        "TARGET_OUT_OF_BOUNDS",
        "Action target must be a canonical in-bounds coordinate.",
      ),
    };
  }

  if (value.kind === "APPLY_GATE") {
    if (value.gate !== "X" && value.gate !== "H") {
      return {
        ok: false,
        error: invalidAction(
          "MALFORMED_ACTION",
          "Gate action must specify X or H.",
        ),
      };
    }
    return {
      ok: true,
      value: Object.freeze({
        kind: "APPLY_GATE",
        gate: value.gate,
        target: target.value,
      }),
    };
  }

  return {
    ok: true,
    value: Object.freeze({ kind: value.kind, target: target.value }),
  };
};

const executeDirectAction = (
  state: GameState,
  action: Action,
  source: TurnEntropySource,
): Readonly<{
  result: EngineActionResult;
  voidEntryInsufficient: boolean;
}> => {
  if (action.kind === "APPLY_GATE") {
    return Object.freeze({
      result: applyGate(state, action),
      voidEntryInsufficient: false,
    });
  }

  if (action.kind === "MOVE") {
    const movement = applyMovementDirect(state, action);
    return Object.freeze({
      result: movement,
      voidEntryInsufficient:
        movement.ok && movement.voidEntryInsufficient,
    });
  }

  const pair = findEntangledPair(state, action.target);
  const result =
    pair === null
      ? collapseUnpairedCell(state, action.target, "OBSERVATION", source)
      : collapseEntangledPair(state, action.target, "OBSERVATION", source);
  return Object.freeze({ result, voidEntryInsufficient: false });
};

/**
 * The sole authoritative action entry point. Direct operations deliberately do
 * not advance lifecycle or turn; this pipeline does so exactly once.
 */
export const processAction = (
  state: GameState,
  actionInput: unknown,
  source: TurnEntropySource,
): EngineActionResult => {
  const stateValidation = validateGameState(state);
  if (!stateValidation.ok) {
    return turnFailure(state, stateValidation.error);
  }
  if (state.status === "VICTORY" || state.status === "DEFEAT") {
    return turnFailure(
      state,
      invalidAction(
        "TERMINAL_STATE",
        "Actions are unavailable after the game has ended.",
      ),
    );
  }

  const parsedAction = parseAction(actionInput);
  if (!parsedAction.ok) {
    return turnFailure(state, parsedAction.error);
  }

  const startsGame = state.status === "START";
  const directInput: GameState = startsGame
    ? Object.freeze({ ...state, status: "PLAYING" as const, turn: 1 })
    : state;
  const direct = executeDirectAction(directInput, parsedAction.value, source);
  if (!direct.result.ok) {
    return turnFailure(state, direct.result.error);
  }

  const advancedState: GameState = startsGame
    ? direct.result.state
    : Object.freeze({
        ...direct.result.state,
        turn: direct.result.state.turn + 1,
      });
  const advancedValidation = validateGameState(advancedState);
  if (!advancedValidation.ok) {
    return turnFailure(state, advancedValidation.error);
  }

  const decoherence = deferredDecoherenceHook.run(advancedState, source);
  if (!decoherence.ok) {
    return turnFailure(state, decoherence.error);
  }
  const terminal = deferredTerminalEvaluationHook.run({
    state: decoherence.state,
    voidEntryInsufficient: direct.voidEntryInsufficient,
  });
  if (!terminal.ok) {
    return turnFailure(state, terminal.error);
  }
  const finalValidation = validateGameState(terminal.state);
  if (!finalValidation.ok) {
    return turnFailure(state, finalValidation.error);
  }

  const events: EngineEvent[] = [];
  if (startsGame) {
    events.push(Object.freeze({ kind: "GAME_STARTED", status: "PLAYING" }));
  }
  events.push(
    ...direct.result.events,
    Object.freeze({ kind: "TURN_ADVANCED", turn: advancedState.turn }),
    ...decoherence.events,
    ...terminal.events,
  );

  return Object.freeze({
    ok: true,
    state: terminal.state,
    events: Object.freeze(events),
    entropyDelta: Object.freeze([
      ...direct.result.entropyDelta,
      ...decoherence.entropyDelta,
      ...terminal.entropyDelta,
    ]),
  });
};
