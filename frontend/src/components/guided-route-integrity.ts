import { createResolutionEntropySource } from "../daily-universe/client";
import { getPlayableCampaignEntry } from "../daily-game/universe";
import { deserializeGameState, processAction, type Action, type GameState } from "../engine";
import {
  GUIDED_JOURNEY,
  getGuidedJourney,
  type GuidedJourneyDefinition,
} from "./guided-journey";

export interface GuidedRouteIntegrityReport {
  readonly ok: boolean;
  readonly error: string | null;
  readonly actionsProcessed: number;
  readonly batteryCollected: boolean;
  readonly decoherencesSurvived: number;
  readonly finalObservations: number;
  readonly finalState: GameState | null;
  readonly initialStateUnchanged: boolean;
  readonly transcript: readonly Action[];
}

function failed(
  error: string,
  actionsProcessed = 0,
  transcript: readonly Action[] = [],
): GuidedRouteIntegrityReport {
  return {
    ok: false,
    error,
    actionsProcessed,
    batteryCollected: false,
    decoherencesSurvived: 0,
    finalObservations: 0,
    finalState: null,
    initialStateUnchanged: true,
    transcript,
  };
}

export function auditGuidedRoute(
  definition: GuidedJourneyDefinition = GUIDED_JOURNEY,
): GuidedRouteIntegrityReport {
  const entry = getPlayableCampaignEntry(definition.universeNumber);
  const canonicalDefinition = getGuidedJourney(definition.universeNumber);
  const identifier = String(definition.universeNumber).padStart(3, "0");
  if (
    entry === undefined
    || definition.version !== 1
    || definition.rulesVersion !== 1
    || definition.integrityReference !== entry.artifact.commitment
    || definition.actionTranscriptSha256 !== canonicalDefinition.actionTranscriptSha256
    || JSON.stringify(definition.steps.map((step) => step.action))
      !== JSON.stringify(canonicalDefinition.steps.map((step) => step.action))
    || definition.steps.length === 0
  ) {
    return failed(`La definición versionada de la Ruta Guiada no coincide con el Universo #${identifier}.`);
  }

  const universe = entry.artifact;
  const decoded = deserializeGameState(universe.serializedInitialGameState);
  if (!decoded.ok) return failed("El estado canónico no pudo reconstruirse para verificar la Ruta Guiada.");

  const initialState: GameState = { ...decoded.value, observations: 13 };
  const initialBytes = JSON.stringify(initialState);
  const initialBatteryCount = initialState.collectedBatteries.length;
  const entropy = createResolutionEntropySource(universe.resolutionPlan);
  const transcript = definition.steps.map((step) => step.action);
  let state = initialState;
  let decoherencesSurvived = 0;

  for (let index = 0; index < transcript.length; index += 1) {
    const action = transcript[index];
    if (action === undefined) return failed("La Ruta Guiada contiene un paso vacío.", index, transcript);
    const result = processAction(state, action, entropy as Parameters<typeof processAction>[2]);
    if (!result.ok) {
      return {
        ...failed(`La acción ${index + 1} de la Ruta Guiada dejó de ser válida.`, index, transcript),
        initialStateUnchanged: JSON.stringify(initialState) === initialBytes,
      };
    }
    if (result.events.some((event) => event.kind.includes("DECOHERENCE"))) decoherencesSurvived += 1;
    state = result.state;
  }

  const batteryCollected = state.collectedBatteries.length > initialBatteryCount;
  const initialStateUnchanged = JSON.stringify(initialState) === initialBytes;
  const requirementsMet = state.status === "VICTORY" && initialStateUnchanged;

  return {
    ok: requirementsMet,
    error: requirementsMet
      ? null
      : `La Ruta Guiada del Universo #${identifier} no conserva una victoria F1 verificable.`,
    actionsProcessed: transcript.length,
    batteryCollected,
    decoherencesSurvived,
    finalObservations: state.observations,
    finalState: state,
    initialStateUnchanged,
    transcript,
  };
}
