import { create } from "zustand";
import {
  LEGACY_TUTORIAL_PREFERENCE_KEY,
  PRODUCTION_PREFERENCES_KEY,
  readProductionPreferences,
  resetProductionPreferences,
  writeProductionPreferences,
} from "../production/preferences";
import {
  createResolutionEntropySource,
  type DailyUniverse,
} from "../daily-universe/client";
import {
  deserializeGameState,
  processAction,
  type Action,
  type GameState,
} from "../engine";
import { publishedDailyUniverse } from "../daily-game/universe";
import { GUIDED_JOURNEY, actionsMatch } from "../components/guided-journey";
import { auditGuidedRoute } from "../components/guided-route-integrity";
import {
  appendEventLog,
  coordinateKey,
  coordinatesMatch,
  EMPTY_MISSION_METRICS,
  recommendQuantumPulse,
  type Coordinate,
  type GameMode,
  type MissionMetrics,
  type RouteEvent,
} from "../components/mission-control";

export type GamePhase = "INTRO" | "PLAYING" | "FINISHED";
export type Panel = "HELP" | "PROVENANCE" | "RESTART" | "MODES" | "ONBOARDING" | null;
type TutorialStep = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
type CellOutcome = "FLOOR" | "WALL" | "VOID" | "CRYSTAL" | "BATTERY";
type CursorDirection = "UP" | "DOWN" | "LEFT" | "RIGHT";

export const TUTORIAL_PREFERENCE_KEY = LEGACY_TUTORIAL_PREFERENCE_KEY;
export { PRODUCTION_PREFERENCES_KEY };
export { recommendPulseTarget } from "../components/mission-control";
export type { GameMode } from "../components/mission-control";

export interface ActionAvailability {
  readonly observe: boolean;
  readonly move: boolean;
  readonly powerX: boolean;
  readonly powerH: boolean;
  readonly powerXReason: string | null;
  readonly powerHReason: string | null;
}

export const MODE_OBSERVATION_BUDGETS: Readonly<Record<GameMode, 10 | 13>> = {
  QUANTUM_MISSION: 10,
  EXPLORER: 13,
  GUIDED: 13,
};

export function observationBudgetForMode(mode: GameMode): 10 | 13 {
  return MODE_OBSERVATION_BUDGETS[mode];
}

interface DailyGameStore {
  readonly universe: DailyUniverse;
  readonly gameState: GameState;
  readonly phase: GamePhase;
  readonly selectedCell: Coordinate | null;
  readonly panel: Panel;
  readonly feedback: string;
  readonly messages: readonly string[];
  readonly eventLog: readonly string[];
  readonly tutorialStep: TutorialStep | null;
  readonly tutorialObservationTarget: Coordinate | null;
  readonly tutorialMoveTarget: Coordinate | null;
  readonly tutorialOutcome: CellOutcome | null;
  readonly soundEnabled: boolean;
  readonly gameMode: GameMode | null;
  readonly suggestedMode: GameMode | null;
  readonly quantumPulses: number;
  readonly pulseTarget: Coordinate | null;
  readonly pulseNonce: number;
  readonly flow: number;
  readonly coherenceBurstNonce: number;
  readonly keyboardCursor: Coordinate;
  readonly metrics: MissionMetrics;
  readonly routeEvents: readonly RouteEvent[];
  readonly routePositions: readonly Coordinate[];
  readonly observedCoordinates: readonly Coordinate[];
  readonly decoherenceCoordinates: readonly Coordinate[];
  readonly transcript: readonly Action[];
  readonly guidedStep: number;
  readonly guidanceActive: boolean;
  readonly guidedDeviation: boolean;
  readonly guidedError: string | null;
  readonly rewindsRemaining: number;
  readonly rewindsUsed: number;
  start: () => void;
  startTutorial: () => void;
  nextTutorial: () => void;
  previousTutorial: () => void;
  setTutorialStep: (step: TutorialStep) => void;
  skipTutorial: () => void;
  completeTutorial: () => void;
  repeatTutorial: () => void;
  reset: () => void;
  retry: () => void;
  changeMode: () => void;
  selectMode: (mode: GameMode) => void;
  selectCell: (coordinate: Coordinate) => void;
  togglePanel: (panel: Exclude<Panel, null>) => void;
  openPanel: (panel: Exclude<Panel, null>) => void;
  closePanel: () => void;
  toggleSound: () => void;
  resetPreferences: () => void;
  getActionAvailability: () => ActionAvailability;
  observeSelected: () => void;
  moveSelected: () => void;
  executePrimary: () => void;
  applyGateToSelected: (gate: "X" | "H") => void;
  activateQuantumPulse: () => boolean;
  clearPulse: () => void;
  moveKeyboardCursor: (direction: CursorDirection) => void;
  handleKeyboardSpace: () => void;
  executeCursorPrimary: () => void;
  dismissGuidance: () => void;
  returnToGuidance: () => void;
  rewindLastAction: () => void;
}

function deserializePublishedState(universe: DailyUniverse): GameState {
  const result = deserializeGameState(universe.serializedInitialGameState);
  if (!result.ok) throw new Error("El estado inicial publicado no pudo deserializarse mediante F1.");
  return result.value;
}

function stateForMode(state: GameState, mode: GameMode): GameState {
  return { ...state, observations: observationBudgetForMode(mode) };
}

function isTerminal(state: GameState): boolean {
  return state.status === "VICTORY" || state.status === "DEFEAT";
}

function isTutorialCompleted(): boolean {
  return readProductionPreferences().tutorialCompleted;
}

function markTutorialCompleted(): void {
  writeProductionPreferences({ tutorialCompleted: true });
}

function previewAction(universe: DailyUniverse, state: GameState, action: Action): boolean {
  const previewEntropy = createResolutionEntropySource(universe.resolutionPlan);
  return processAction(state, action, previewEntropy as Parameters<typeof processAction>[2]).ok;
}

function selectedAction(selectedCell: Coordinate | null, createAction: (target: Coordinate) => Action): Action | null {
  return selectedCell === null ? null : createAction(selectedCell);
}

function powerUnavailableReason(state: GameState, selectedCell: Coordinate | null, gate: "X" | "H", available: boolean): string | null {
  if (selectedCell === null) return "Primero elige una casilla objetivo.";
  const target = state.board.find((cell) => coordinatesMatch(cell.coordinate, selectedCell));
  if (target === undefined) return "Debes seleccionar una posibilidad válida.";
  if (target.kind !== "UNRESOLVED") return "Esta casilla ya fue observada.";
  if (!state.inventory.includes(gate)) return `El Poder ${gate} ya no está disponible.`;
  return available ? null : "Este poder no puede aplicarse aquí.";
}

function actionAvailability(universe: DailyUniverse, state: GameState, selectedCell: Coordinate | null): ActionAvailability {
  const observe = selectedCell !== null && previewAction(universe, state, { kind: "OBSERVE", target: selectedCell });
  const move = selectedCell !== null && previewAction(universe, state, { kind: "MOVE", target: selectedCell });
  const powerX = selectedCell !== null && previewAction(universe, state, { kind: "APPLY_GATE", gate: "X", target: selectedCell });
  const powerH = selectedCell !== null && previewAction(universe, state, { kind: "APPLY_GATE", gate: "H", target: selectedCell });
  return {
    observe,
    move,
    powerX,
    powerH,
    powerXReason: powerUnavailableReason(state, selectedCell, "X", powerX),
    powerHReason: powerUnavailableReason(state, selectedCell, "H", powerH),
  };
}

function sortedUnresolvedCoordinates(state: GameState): Coordinate[] {
  return state.board
    .filter((cell) => cell.kind === "UNRESOLVED")
    .map((cell) => cell.coordinate)
    .sort((first, second) => {
      const firstDistance = Math.abs(first.row - state.player.row) + Math.abs(first.col - state.player.col);
      const secondDistance = Math.abs(second.row - state.player.row) + Math.abs(second.col - state.player.col);
      return firstDistance - secondDistance || first.row - second.row || first.col - second.col;
    });
}

function findTutorialObservationTarget(universe: DailyUniverse, state: GameState): Coordinate | null {
  let firstLegalTarget: Coordinate | null = null;
  for (const target of sortedUnresolvedCoordinates(state)) {
    const observation = processAction(state, { kind: "OBSERVE", target }, createResolutionEntropySource(universe.resolutionPlan) as Parameters<typeof processAction>[2]);
    if (!observation.ok) continue;
    if (firstLegalTarget === null) firstLegalTarget = target;
    const move = processAction(observation.state, { kind: "MOVE", target }, createResolutionEntropySource(universe.resolutionPlan) as Parameters<typeof processAction>[2]);
    if (move.ok) return target;
  }
  return firstLegalTarget;
}

function findLegalMoveTarget(universe: DailyUniverse, state: GameState): Coordinate | null {
  for (const target of state.board.map((cell) => cell.coordinate)) {
    if (previewAction(universe, state, { kind: "MOVE", target })) return target;
  }
  return null;
}

function observedOutcome(state: GameState, target: Coordinate): CellOutcome | null {
  const cell = state.board.find((candidate) => coordinatesMatch(candidate.coordinate, target));
  return cell?.kind === "COLLAPSED" ? cell.outcome : null;
}

function outcomeMessage(outcome: CellOutcome | null): string | null {
  switch (outcome) {
    case "FLOOR": return "¡Es un camino! Ahora puedes avanzar.";
    case "WALL": return "Es un muro. Busca otra ruta.";
    case "VOID": return "Es vacío. Entrar allí cuesta energía.";
    case "CRYSTAL": return "Es un cristal. Recógelo para ganar puntos.";
    case "BATTERY": return "Es una batería. Recupera una observación.";
    default: return null;
  }
}

function friendlyInvalidAction(reason: string): string {
  const messages: Record<string, string> = {
    TARGET_UNRESOLVED: "Primero necesitas observar esta casilla.",
    TARGET_NOT_ADJACENT: "Solo puedes actuar sobre una casilla vecina.",
    NOT_ADJACENT: "Solo puedes actuar sobre una casilla vecina.",
    TARGET_WALL: "Un muro no se puede atravesar.",
    CELL_ALREADY_COLLAPSED: "Esta casilla ya fue observada.",
    TERMINAL_STATE: "La misión ya terminó. Puedes volver a empezar.",
  };
  return messages[reason] ?? "Esa acción no está disponible ahora.";
}

function friendlyEngineMessage(kind: string): string | null {
  const messages: Record<string, string> = {
    OBSERVATION_SPENT: "Usaste una observación.",
    CELL_COLLAPSED: "La casilla se definió.",
    ENTANGLED_PARTNER_COLLAPSED: "Su pareja entrelazada también reaccionó.",
    PLAYER_MOVED: "Ahora puedes avanzar.",
    MOVED: "Ahora puedes avanzar.",
    CRYSTAL_COLLECTED: "Recogiste un cristal: +50 puntos.",
    BATTERY_COLLECTED: "Recuperaste una observación.",
    DECOHERENCE_TRIGGERED: "El universo colapsó una casilla por su cuenta.",
    DECOHERENCE_COLLAPSED: "El universo colapsó una casilla por su cuenta.",
    VICTORY: "Llegaste a la salida.",
    DEFEAT: "La ruta se cerró antes de llegar a la salida.",
  };
  return messages[kind] ?? null;
}

function friendlyMessages(before: GameState, after: GameState, action: Action, events: readonly { readonly kind: string }[]): readonly string[] {
  const messages = events.map((event) => friendlyEngineMessage(event.kind)).filter((message): message is string => message !== null);
  if (action.kind === "OBSERVE") {
    messages.unshift("Usaste una observación.");
    const message = outcomeMessage(observedOutcome(after, action.target));
    if (message !== null) messages.push(message);
  }
  if (action.kind === "MOVE" && !messages.includes("Ahora puedes avanzar.")) messages.unshift("Ahora puedes avanzar.");
  if (action.kind === "APPLY_GATE") messages.unshift(`Aplicaste el Poder ${action.gate}.`);
  if (before.status !== "VICTORY" && after.status === "VICTORY") messages.push("Llegaste a la salida.");
  if (before.status !== "DEFEAT" && after.status === "DEFEAT") messages.push("La ruta se cerró antes de llegar a la salida.");
  return [...new Set(messages)];
}

function tutorialFeedback(step: TutorialStep): string {
  const messages: Record<TutorialStep, string> = {
    1: "Mira el brillo azul: ahí comienzas.",
    2: "La salida dorada está arriba a la derecha.",
    3: "Las casillas con ? todavía son posibilidades.",
    4: "Observa esta casilla para descubrir qué es.",
    5: "Si hay un camino seguro, ahora puedes avanzar.",
    6: "Cada cuatro turnos, el universo toma una decisión solo.",
    7: "Los poderes cambian probabilidades antes de observar.",
    8: "Busca una ruta: no necesitas descubrir todo el tablero.",
  };
  return messages[step];
}

function uniqueCoordinates(current: readonly Coordinate[], next: readonly Coordinate[]): readonly Coordinate[] {
  const map = new Map(current.map((coordinate) => [coordinateKey(coordinate), coordinate]));
  for (const coordinate of next) map.set(coordinateKey(coordinate), coordinate);
  return [...map.values()];
}

function guidedProgress(transcript: readonly Action[]): number {
  let step = 0;
  for (const action of transcript) {
    const expected = GUIDED_JOURNEY.steps[step]?.action;
    if (expected !== undefined && actionsMatch(action, expected)) step += 1;
  }
  return step;
}

function initialPresentation(state: GameState, mode: GameMode | null) {
  return {
    selectedCell: null,
    panel: null,
    feedback: mode === "GUIDED" ? "Sigue la primera orientación cuando estés listo." : "Selecciona una casilla cercana.",
    messages: [] as readonly string[],
    eventLog: [] as readonly string[],
    tutorialStep: null,
    tutorialObservationTarget: null,
    tutorialMoveTarget: null,
    tutorialOutcome: null,
    quantumPulses: mode === "EXPLORER" ? 5 : 0,
    pulseTarget: null,
    flow: 0,
    keyboardCursor: { ...state.player },
    metrics: { ...EMPTY_MISSION_METRICS },
    routeEvents: [{ kind: "START", coordinate: { ...state.player }, turn: state.turn }] as readonly RouteEvent[],
    routePositions: [{ ...state.player }] as readonly Coordinate[],
    observedCoordinates: [] as readonly Coordinate[],
    decoherenceCoordinates: [] as readonly Coordinate[],
    transcript: [] as readonly Action[],
    guidedStep: 0,
    guidanceActive: mode === "GUIDED",
    guidedDeviation: false,
    guidedError: null,
    rewindsRemaining: 3,
    rewindsUsed: 0,
  };
}

interface RebuiltPresentation {
  readonly gameState: GameState;
  readonly entropy: ReturnType<typeof createResolutionEntropySource>;
  readonly metrics: MissionMetrics;
  readonly routeEvents: readonly RouteEvent[];
  readonly routePositions: readonly Coordinate[];
  readonly observedCoordinates: readonly Coordinate[];
  readonly decoherenceCoordinates: readonly Coordinate[];
  readonly flow: number;
}

function rebuildFromTranscript(actions: readonly Action[], mode: GameMode = "GUIDED"): RebuiltPresentation | null {
  const entropy = createResolutionEntropySource(publishedDailyUniverse.resolutionPlan);
  let gameState = stateForMode(deserializePublishedState(publishedDailyUniverse), mode);
  let metrics: MissionMetrics = { ...EMPTY_MISSION_METRICS };
  let routeEvents: readonly RouteEvent[] = [{ kind: "START", coordinate: { ...gameState.player }, turn: gameState.turn }];
  let routePositions: readonly Coordinate[] = [{ ...gameState.player }];
  let observedCoordinates: readonly Coordinate[] = [];
  let decoherenceCoordinates: readonly Coordinate[] = [];
  let flow = 0;

  for (const action of actions) {
    const before = gameState;
    const result = processAction(before, action, entropy as Parameters<typeof processAction>[2]);
    if (!result.ok) return null;
    gameState = result.state;
    const newCollapses = gameState.board
      .filter((cell, index) => cell.kind === "COLLAPSED" && before.board[index]?.kind !== "COLLAPSED")
      .map((cell) => cell.coordinate);
    const decoherenceTriggered = result.events.some((event) => event.kind.includes("DECOHERENCE"));
    const nextFlow = Math.min(3, flow + 1);
    const burst = nextFlow === 3;
    flow = burst ? 0 : nextFlow;
    metrics = {
      moves: metrics.moves + (action.kind === "MOVE" ? 1 : 0),
      observations: metrics.observations + (action.kind === "OBSERVE" ? 1 : 0),
      decoherences: metrics.decoherences + (decoherenceTriggered ? 1 : 0),
      pulsesUsed: 0,
      coherenceBursts: metrics.coherenceBursts + (burst ? 1 : 0),
      maxFlow: Math.max(metrics.maxFlow, nextFlow),
    };
    if (action.kind === "OBSERVE") {
      routeEvents = [...routeEvents, { kind: "OBSERVE", coordinate: { ...action.target }, turn: gameState.turn }];
      observedCoordinates = uniqueCoordinates(observedCoordinates, newCollapses);
    }
    if (action.kind === "MOVE") {
      routeEvents = [...routeEvents, { kind: "MOVE", coordinate: { ...gameState.player }, turn: gameState.turn }];
      routePositions = [...routePositions, { ...gameState.player }];
    }
    if (decoherenceTriggered && newCollapses[0] !== undefined) {
      routeEvents = [...routeEvents, { kind: "DECOHERENCE", coordinate: { ...newCollapses[0] }, turn: gameState.turn }];
      decoherenceCoordinates = uniqueCoordinates(decoherenceCoordinates, newCollapses);
    }
  }
  return { gameState, entropy, metrics, routeEvents, routePositions, observedCoordinates, decoherenceCoordinates, flow };
}

let entropySource = createResolutionEntropySource(publishedDailyUniverse.resolutionPlan);
let pulseTimer: number | undefined;
const initialPreferences = readProductionPreferences();

export const useDailyGameStore = create<DailyGameStore>((set, get) => {
  const clearPulseTimer = () => {
    if (pulseTimer !== undefined && typeof window !== "undefined") window.clearTimeout(pulseTimer);
    pulseTimer = undefined;
  };

  const registerInvalid = (feedback: string) => {
    set((state) => ({ feedback, messages: [], flow: 0, eventLog: appendEventLog(state.eventLog, [feedback]) }));
  };

  const activateTutorialStep = (step: TutorialStep) => {
    const state = get();
    const observationTarget = state.tutorialObservationTarget ?? findTutorialObservationTarget(publishedDailyUniverse, state.gameState);
    const selectedCell = step === 3 || step === 4 ? observationTarget ?? state.selectedCell : step === 5 ? state.tutorialMoveTarget ?? state.selectedCell : state.selectedCell;
    set({ tutorialStep: step, tutorialObservationTarget: observationTarget, selectedCell, feedback: tutorialFeedback(step) });
  };

  const beginTutorial = (force: boolean) => {
    const current = get();
    if (current.gameMode === null) { set({ panel: "MODES", feedback: "Elige una experiencia antes de comenzar." }); return; }
    if (current.gameMode === "GUIDED") {
      const integrity = auditGuidedRoute();
      if (!integrity.ok) {
        const error = integrity.error ?? "La Ruta Guiada no está disponible en este momento.";
        set({ phase: "INTRO", panel: null, guidanceActive: false, guidedError: error, feedback: error });
        return;
      }
    }
    const state = current.gameState;
    const showTutorial = current.gameMode !== "GUIDED" && (force || !isTutorialCompleted());
    const observationTarget = showTutorial ? findTutorialObservationTarget(publishedDailyUniverse, state) : null;
    const fresh = current.phase === "INTRO" ? initialPresentation(state, current.gameMode) : {};
    set({
      ...fresh,
      phase: "PLAYING",
      panel: null,
      tutorialStep: showTutorial ? 1 : null,
      tutorialObservationTarget: observationTarget,
      tutorialMoveTarget: null,
      tutorialOutcome: null,
      feedback: showTutorial ? tutorialFeedback(1) : current.gameMode === "GUIDED" ? "Sigue la orientación y ejecuta cada acción manualmente." : "Selecciona una casilla cercana.",
      messages: [],
    });
  };

  const finishTutorial = () => {
    markTutorialCompleted();
    set({ tutorialStep: null, tutorialObservationTarget: null, tutorialMoveTarget: null, tutorialOutcome: null, feedback: "Selecciona una casilla cercana." });
  };

  const applyAction = (action: Action | null) => {
    if (action === null) { registerInvalid("Selecciona una casilla cercana."); return; }
    const current = get();
    const before = current.gameState;
    const result = processAction(before, action, entropySource as Parameters<typeof processAction>[2]);
    if (!result.ok) {
      const expectedAction = GUIDED_JOURNEY.steps[current.guidedStep]?.action;
      if (current.gameMode === "GUIDED" && expectedAction !== undefined && actionsMatch(action, expectedAction) && !current.guidedDeviation) {
        const error = "La Ruta Guiada detectó un paso inválido y se detuvo sin alterar el universo.";
        set({ guidedError: error, guidanceActive: false, feedback: error, messages: [error], eventLog: appendEventLog(current.eventLog, [error]) });
        return;
      }
      registerInvalid("reason" in result.error && typeof result.error.reason === "string" ? friendlyInvalidAction(result.error.reason) : "La acción no pudo completarse. Inténtalo de nuevo.");
      return;
    }

    const engineMessages = friendlyMessages(before, result.state, action, result.events);
    const decoherenceTriggered = result.events.some((event) => event.kind.includes("DECOHERENCE"));
    const newCollapses = result.state.board.filter((cell, index) => cell.kind === "COLLAPSED" && before.board[index]?.kind !== "COLLAPSED").map((cell) => cell.coordinate);
    const currentTutorialStep = current.tutorialStep;
    const outcome = action.kind === "OBSERVE" ? observedOutcome(result.state, action.target) : null;
    const moveTarget = currentTutorialStep === 4 && action.kind === "OBSERVE" ? findLegalMoveTarget(publishedDailyUniverse, result.state) : current.tutorialMoveTarget;
    const nextTutorialStep: TutorialStep | null = currentTutorialStep === 4 && action.kind === "OBSERVE" ? moveTarget === null ? 6 : 5 : currentTutorialStep === 5 && action.kind === "MOVE" ? 6 : currentTutorialStep;
    const terminal = isTerminal(result.state);
    const nextFlowValue = Math.min(3, current.flow + 1);
    const burst = nextFlowValue === 3;
    const expectedAction = GUIDED_JOURNEY.steps[current.guidedStep]?.action;
    const followsGuide = current.gameMode !== "GUIDED" || (expectedAction !== undefined && actionsMatch(action, expectedAction));
    const guidedMessage = current.gameMode === "GUIDED" && !followsGuide ? "Te apartaste de la ruta sugerida. Puedes continuar libremente o volver a la orientación." : null;
    const burstMessage = "COHERENCE BURST — el patrón del universo se estabilizó.";
    const messages = [...engineMessages, ...(burst ? [burstMessage] : []), ...(guidedMessage === null ? [] : [guidedMessage])];
    const nextPulses = burst && current.gameMode === "EXPLORER" ? Math.min(5, current.quantumPulses + 1) : current.quantumPulses;
    const routeEvents: RouteEvent[] = [...current.routeEvents];
    if (action.kind === "OBSERVE") routeEvents.push({ kind: "OBSERVE", coordinate: { ...action.target }, turn: result.state.turn });
    if (action.kind === "MOVE") routeEvents.push({ kind: "MOVE", coordinate: { ...result.state.player }, turn: result.state.turn });
    if (decoherenceTriggered && newCollapses[0] !== undefined) routeEvents.push({ kind: "DECOHERENCE", coordinate: { ...newCollapses[0] }, turn: result.state.turn });
    const metrics: MissionMetrics = {
      moves: current.metrics.moves + (action.kind === "MOVE" ? 1 : 0),
      observations: current.metrics.observations + (action.kind === "OBSERVE" ? 1 : 0),
      decoherences: current.metrics.decoherences + (decoherenceTriggered ? 1 : 0),
      pulsesUsed: current.metrics.pulsesUsed,
      coherenceBursts: current.metrics.coherenceBursts + (burst ? 1 : 0),
      maxFlow: Math.max(current.metrics.maxFlow, nextFlowValue),
    };

    set({
      gameState: result.state,
      phase: terminal ? "FINISHED" : "PLAYING",
      selectedCell: moveTarget ?? current.selectedCell,
      tutorialStep: terminal ? null : nextTutorialStep,
      tutorialMoveTarget: moveTarget,
      tutorialOutcome: outcome ?? current.tutorialOutcome,
      messages,
      eventLog: appendEventLog(current.eventLog, messages),
      feedback: messages.at(-1) ?? "La misión continúa.",
      flow: burst ? 0 : nextFlowValue,
      coherenceBurstNonce: current.coherenceBurstNonce + (burst ? 1 : 0),
      quantumPulses: nextPulses,
      keyboardCursor: action.kind === "MOVE" ? { ...result.state.player } : current.keyboardCursor,
      metrics,
      routeEvents,
      routePositions: action.kind === "MOVE" ? [...current.routePositions, { ...result.state.player }] : current.routePositions,
      observedCoordinates: action.kind === "OBSERVE" ? uniqueCoordinates(current.observedCoordinates, newCollapses) : current.observedCoordinates,
      decoherenceCoordinates: decoherenceTriggered ? uniqueCoordinates(current.decoherenceCoordinates, newCollapses) : current.decoherenceCoordinates,
      transcript: [...current.transcript, action],
      guidedStep: current.gameMode === "GUIDED" && followsGuide ? current.guidedStep + 1 : current.guidedStep,
      guidanceActive: current.gameMode === "GUIDED" ? current.guidanceActive && followsGuide : false,
      guidedDeviation: current.gameMode === "GUIDED" ? current.guidedDeviation || !followsGuide : false,
      guidedError: null,
    });
  };

  const retryMission = () => {
    const mode = get().gameMode;
    if (mode === null) { set({ phase: "INTRO", panel: "MODES" }); return; }
    clearPulseTimer();
    entropySource = createResolutionEntropySource(publishedDailyUniverse.resolutionPlan);
    const gameState = stateForMode(deserializePublishedState(publishedDailyUniverse), mode);
    set({ gameState, phase: "PLAYING", ...initialPresentation(gameState, mode) });
  };

  const initialGameState = deserializePublishedState(publishedDailyUniverse);
  return {
    universe: publishedDailyUniverse,
    gameState: initialGameState,
    phase: "INTRO",
    selectedCell: null,
    panel: null,
    feedback: "Elige cómo quieres explorar el universo.",
    messages: [],
    eventLog: [],
    tutorialStep: null,
    tutorialObservationTarget: null,
    tutorialMoveTarget: null,
    tutorialOutcome: null,
    soundEnabled: !initialPreferences.mute,
    gameMode: null,
    suggestedMode: initialPreferences.lastMode,
    quantumPulses: 0,
    pulseTarget: null,
    pulseNonce: 0,
    flow: 0,
    coherenceBurstNonce: 0,
    keyboardCursor: { ...initialGameState.player },
    metrics: { ...EMPTY_MISSION_METRICS },
    routeEvents: [{ kind: "START", coordinate: { ...initialGameState.player }, turn: initialGameState.turn }],
    routePositions: [{ ...initialGameState.player }],
    observedCoordinates: [],
    decoherenceCoordinates: [],
    transcript: [],
    guidedStep: 0,
    guidanceActive: false,
    guidedDeviation: false,
    guidedError: null,
    rewindsRemaining: 3,
    rewindsUsed: 0,
    start: () => beginTutorial(false),
    startTutorial: () => beginTutorial(true),
    nextTutorial: () => {
      const step = get().tutorialStep;
      if (step === null) return;
      if (step === 8) { finishTutorial(); return; }
      if (step === 4 || step === 5) return;
      activateTutorialStep((step + 1) as TutorialStep);
    },
    previousTutorial: () => {
      const step = get().tutorialStep;
      if (step === null || step === 1) return;
      activateTutorialStep((step - 1) as TutorialStep);
    },
    setTutorialStep: activateTutorialStep,
    skipTutorial: finishTutorial,
    completeTutorial: finishTutorial,
    repeatTutorial: () => beginTutorial(true),
    reset: () => {
      clearPulseTimer();
      entropySource = createResolutionEntropySource(publishedDailyUniverse.resolutionPlan);
      const gameState = deserializePublishedState(publishedDailyUniverse);
      set({ gameState, phase: "INTRO", gameMode: null, pulseNonce: 0, coherenceBurstNonce: 0, ...initialPresentation(gameState, null) });
    },
    retry: retryMission,
    changeMode: () => {
      clearPulseTimer();
      entropySource = createResolutionEntropySource(publishedDailyUniverse.resolutionPlan);
      const gameState = deserializePublishedState(publishedDailyUniverse);
      set({ gameState, phase: "INTRO", gameMode: null, ...initialPresentation(gameState, null), panel: "MODES" });
    },
    selectMode: (mode) => {
      writeProductionPreferences({ lastMode: mode });
      set((state) => ({
        gameMode: mode,
        suggestedMode: mode,
        gameState: state.phase === "INTRO" ? stateForMode(state.gameState, mode) : state.gameState,
        quantumPulses: mode === "EXPLORER" ? 5 : 0,
        feedback: mode === "EXPLORER"
          ? "Modo Explorador listo: 13 observaciones y 5 Pulsos Cuánticos."
          : mode === "GUIDED"
            ? "Ruta Guiada lista: 13 observaciones y orientación verificable."
            : "Misión Cuántica lista: configuración canónica de 10 observaciones.",
        pulseTarget: null,
        flow: state.phase === "INTRO" ? 0 : state.flow,
        guidanceActive: mode === "GUIDED",
        guidedError: null,
      }));
    },
    selectCell: (coordinate) => set({ selectedCell: { ...coordinate }, keyboardCursor: { ...coordinate }, feedback: "Elige qué hacer con esta casilla." }),
    togglePanel: (panel) => set((state) => ({ panel: state.panel === panel ? null : panel })),
    openPanel: (panel) => set({ panel }),
    closePanel: () => set({ panel: null }),
    toggleSound: () => {
      const soundEnabled = !get().soundEnabled;
      writeProductionPreferences({ mute: !soundEnabled, audioConsent: true });
      set({ soundEnabled });
    },
    resetPreferences: () => {
      resetProductionPreferences();
      set({ soundEnabled: true, suggestedMode: null });
    },
    getActionAvailability: () => actionAvailability(publishedDailyUniverse, get().gameState, get().selectedCell),
    observeSelected: () => applyAction(selectedAction(get().selectedCell, (target) => ({ kind: "OBSERVE", target }))),
    moveSelected: () => applyAction(selectedAction(get().selectedCell, (target) => ({ kind: "MOVE", target }))),
    executePrimary: () => {
      const availability = actionAvailability(publishedDailyUniverse, get().gameState, get().selectedCell);
      if (availability.move) applyAction(selectedAction(get().selectedCell, (target) => ({ kind: "MOVE", target })));
      else if (availability.observe) applyAction(selectedAction(get().selectedCell, (target) => ({ kind: "OBSERVE", target })));
      else registerInvalid("Sin acción disponible para esta casilla.");
    },
    applyGateToSelected: (gate) => {
      const current = get();
      const availability = actionAvailability(publishedDailyUniverse, current.gameState, current.selectedCell);
      const available = gate === "X" ? availability.powerX : availability.powerH;
      const reason = gate === "X" ? availability.powerXReason : availability.powerHReason;
      if (!available) { registerInvalid(reason ?? "Este poder no puede aplicarse aquí."); return; }
      applyAction(selectedAction(current.selectedCell, (target) => ({ kind: "APPLY_GATE", gate, target })));
    },
    activateQuantumPulse: () => {
      const current = get();
      if (current.gameMode !== "EXPLORER" || current.quantumPulses <= 0) { registerInvalid("No quedan Pulsos Cuánticos disponibles."); return false; }
      const recommendation = recommendQuantumPulse(current.gameState);
      if (recommendation === null) { registerInvalid("El Pulso no encontró una posibilidad legal cercana."); return false; }
      clearPulseTimer();
      const message = `${recommendation.message} La sugerencia usa probabilidades, no conoce el resultado final.`;
      set({
        quantumPulses: current.quantumPulses - 1,
        pulseTarget: recommendation.target,
        pulseNonce: current.pulseNonce + 1,
        metrics: { ...current.metrics, pulsesUsed: current.metrics.pulsesUsed + 1 },
        feedback: message,
        eventLog: appendEventLog(current.eventLog, [message]),
      });
      if (typeof window !== "undefined") pulseTimer = window.setTimeout(() => set({ pulseTarget: null }), 2_000);
      return true;
    },
    clearPulse: () => { clearPulseTimer(); set({ pulseTarget: null }); },
    moveKeyboardCursor: (direction) => set((state) => {
      const delta = direction === "UP" ? [-1, 0] : direction === "DOWN" ? [1, 0] : direction === "LEFT" ? [0, -1] : [0, 1];
      return {
        keyboardCursor: { row: Math.max(0, Math.min(6, state.keyboardCursor.row + (delta[0] ?? 0))), col: Math.max(0, Math.min(6, state.keyboardCursor.col + (delta[1] ?? 0))) },
        feedback: "El cursor está sobre una posibilidad.",
      };
    }),
    handleKeyboardSpace: () => {
      const current = get();
      if (current.selectedCell === null || !coordinatesMatch(current.selectedCell, current.keyboardCursor)) {
        set({ selectedCell: { ...current.keyboardCursor }, feedback: "Pulsa Espacio otra vez para ejecutar la acción contextual." });
        return;
      }
      get().executeCursorPrimary();
    },
    executeCursorPrimary: () => {
      const cursor = get().keyboardCursor;
      set({ selectedCell: { ...cursor } });
      const availability = actionAvailability(publishedDailyUniverse, get().gameState, cursor);
      if (availability.move) applyAction({ kind: "MOVE", target: cursor });
      else if (availability.observe) applyAction({ kind: "OBSERVE", target: cursor });
      else registerInvalid("Sin acción disponible para esta casilla.");
    },
    dismissGuidance: () => set({ guidanceActive: false, feedback: "Orientación cerrada. Puedes continuar libremente." }),
    returnToGuidance: () => {
      const current = get();
      if (current.gameMode !== "GUIDED") return;
      const transcript = GUIDED_JOURNEY.steps.slice(0, current.guidedStep).map((step) => step.action);
      const rebuilt = rebuildFromTranscript(transcript);
      if (rebuilt === null) {
        const error = "No fue posible restaurar la Ruta Guiada desde su estado canónico.";
        set({ guidanceActive: false, guidedError: error, feedback: error, messages: [error], eventLog: appendEventLog(current.eventLog, [error]) });
        return;
      }
      entropySource = rebuilt.entropy;
      const target = GUIDED_JOURNEY.steps[current.guidedStep]?.action.target;
      const message = target === undefined
        ? "La orientación ya está completa."
        : "Ruta canónica restaurada en el siguiente paso pendiente.";
      set({
        ...rebuilt,
        phase: isTerminal(rebuilt.gameState) ? "FINISHED" : "PLAYING",
        transcript,
        guidanceActive: true,
        guidedDeviation: false,
        guidedError: null,
        selectedCell: target === undefined ? null : { ...target },
        keyboardCursor: target === undefined ? { ...rebuilt.gameState.player } : { ...target },
        feedback: message,
        messages: [message],
        eventLog: appendEventLog(current.eventLog, [message]),
      });
    },
    rewindLastAction: () => {
      const current = get();
      if (current.gameMode !== "GUIDED" || current.rewindsRemaining <= 0 || current.transcript.length === 0) return;
      const transcript = current.transcript.slice(0, -1);
      const rebuilt = rebuildFromTranscript(transcript);
      if (rebuilt === null) { registerInvalid("No fue posible reconstruir el transcript verificable."); return; }
      entropySource = rebuilt.entropy;
      const message = "El universo fue reconstruido desde su transcript verificable.";
      set({
        ...rebuilt,
        phase: isTerminal(rebuilt.gameState) ? "FINISHED" : "PLAYING",
        transcript,
        guidedStep: guidedProgress(transcript),
        guidanceActive: true,
        guidedDeviation: false,
        guidedError: null,
        rewindsRemaining: current.rewindsRemaining - 1,
        rewindsUsed: current.rewindsUsed + 1,
        selectedCell: null,
        keyboardCursor: { ...rebuilt.gameState.player },
        quantumPulses: 0,
        pulseTarget: null,
        feedback: message,
        messages: [message],
        eventLog: appendEventLog(current.eventLog, [message]),
      });
    },
  };
});
