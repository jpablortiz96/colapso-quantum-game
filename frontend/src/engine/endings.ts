import { EXIT_COORDINATE } from "./constants";
import { coordinatesEqual } from "./coordinates";
import { analyzeRoutes } from "./routes";
import type {
  DefeatReason,
  EngineEvent,
  EntropyRecord,
  GameState,
  TerminalReason,
} from "./types";

export type TerminalEvaluationContext = Readonly<{
  state: GameState;
  voidEntryInsufficient: boolean;
}>;

export type TerminalEvaluationResult = Readonly<{
  ok: true;
  state: GameState;
  events: readonly EngineEvent[];
  entropyDelta: readonly EntropyRecord[];
}>;

type TerminalDecision = Readonly<{
  status: "VICTORY" | "DEFEAT";
  reason: TerminalReason;
}> | null;

const decideTerminalState = (
  context: TerminalEvaluationContext,
): TerminalDecision => {
  if (coordinatesEqual(context.state.player, EXIT_COORDINATE)) {
    return Object.freeze({ status: "VICTORY", reason: "EXIT_REACHED" });
  }
  if (context.voidEntryInsufficient) {
    return Object.freeze({
      status: "DEFEAT",
      reason: "INSUFFICIENT_VOID_ENERGY",
    });
  }

  const routes = analyzeRoutes(context.state);
  if (!routes.structuralPotentialRoute) {
    return Object.freeze({
      status: "DEFEAT",
      reason: "IRREVERSIBLE_BLOCKAGE",
    });
  }
  if (
    context.state.observations === 0 &&
    !routes.currentRoute &&
    !routes.reachableUncollectedBattery
  ) {
    return Object.freeze({ status: "DEFEAT", reason: "RESOURCE_DEAD_END" });
  }
  return null;
};

const statusChangedEvent = (
  status: "VICTORY" | "DEFEAT",
  reason: TerminalReason,
): EngineEvent =>
  status === "VICTORY"
    ? Object.freeze({ kind: "STATUS_CHANGED", status, reason: "EXIT_REACHED" })
    : Object.freeze({
        kind: "STATUS_CHANGED",
        status,
        reason: reason as DefeatReason,
      });

/** Applies the canonical post-decoherence terminal precedence without entropy. */
export const evaluateTerminalState = (
  context: TerminalEvaluationContext,
): TerminalEvaluationResult => {
  if (
    context.state.status === "START" ||
    context.state.status === "VICTORY" ||
    context.state.status === "DEFEAT"
  ) {
    return Object.freeze({
      ok: true,
      state: context.state,
      events: Object.freeze([]),
      entropyDelta: Object.freeze([]),
    });
  }

  const decision = decideTerminalState(context);
  if (decision === null) {
    return Object.freeze({
      ok: true,
      state: context.state,
      events: Object.freeze([]),
      entropyDelta: Object.freeze([]),
    });
  }

  const state: GameState = Object.freeze({
    ...context.state,
    status: decision.status,
    terminalReason: decision.reason,
  });
  return Object.freeze({
    ok: true,
    state,
    events: Object.freeze([
      statusChangedEvent(decision.status, decision.reason),
    ]),
    entropyDelta: Object.freeze([]),
  });
};
