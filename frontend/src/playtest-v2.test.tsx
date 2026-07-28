import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { Howl } from "howler";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { colapsoAssets } from "./components/colapso-assets";
import {
  GameSoundState,
  isGameSoundTestEnvironment,
  playGameSound,
} from "./components/game-sound";
import { auditGuidedRoute } from "./components/guided-route-integrity";
import { GUIDED_JOURNEY, GUIDED_JOURNEYS, getGuidedJourney } from "./components/guided-journey";
import { LazyModuleBoundary } from "./components/LazyModuleBoundary";
import {
  appendEventLog,
  decoherencePressureCue,
  deriveDecoherencePressure,
  deriveObservationAlert,
  deriveVisibleTacticalInfo,
  observationAlertCue,
  recommendPulseTarget,
  recommendQuantumPulse,
} from "./components/mission-control";
import { ProvenanceModal } from "./components/ProvenanceModal";
import { createResolutionEntropySource, type DailyUniverse } from "./daily-universe/client";
import { getPlayableCampaignEntry, publishedDailyUniverse } from "./daily-game/universe";
import { deserializeGameState, processAction, type Action, type GameState, type Result } from "./engine";
import {
  CAMPAIGN_PROGRESS_KEY,
  observationBudgetForMode,
  TUTORIAL_PREFERENCE_KEY,
  useDailyGameStore,
  type GameMode,
} from "./store/daily-game-store";

type Coordinate = GameState["player"];
type EntropyFailure = { readonly kind: "ENTROPY_EXHAUSTED" };
type EntropyResult = Result<number, EntropyFailure>;

class SeededEntropy {
  private value: number;

  constructor(seed: number) {
    this.value = seed >>> 0 || 0x9e3779b9;
  }

  nextUint32(): EntropyResult {
    let value = this.value;
    value ^= value << 13;
    value ^= value >>> 17;
    value ^= value << 5;
    this.value = value >>> 0;
    return { ok: true, value: this.value };
  }
}

function sameCoordinate(first: Coordinate, second: Coordinate): boolean {
  return first.row === second.row && first.col === second.col;
}

function neighbors(coordinate: Coordinate): Coordinate[] {
  return [
    { row: coordinate.row - 1, col: coordinate.col },
    { row: coordinate.row, col: coordinate.col + 1 },
    { row: coordinate.row + 1, col: coordinate.col },
    { row: coordinate.row, col: coordinate.col - 1 },
  ].filter(({ row, col }) => row >= 0 && row < 7 && col >= 0 && col < 7);
}

function visibleTarget(state: GameState, visits: ReadonlyMap<string, number>): Coordinate | null {
  return neighbors(state.player)
    .map((coordinate) => {
      const cell = state.board.find((candidate) => sameCoordinate(candidate.coordinate, coordinate));
      if (cell === undefined || (cell.kind === "COLLAPSED" && cell.outcome === "WALL")) return null;
      const distance = coordinate.row + (6 - coordinate.col);
      const key = `${coordinate.row}-${coordinate.col}`;
      const visibleValue = cell.kind === "UNRESOLVED"
        ? (cell.distribution[0] ?? 0) * 100
        : cell.outcome === "BATTERY" ? 145 : cell.outcome === "CRYSTAL" ? 128 : 118;
      return { coordinate, score: visibleValue - distance * 7 - (visits.get(key) ?? 0) * 24 };
    })
    .filter((entry): entry is { readonly coordinate: Coordinate; readonly score: number } => entry !== null)
    .sort((first, second) => second.score - first.score
      || first.coordinate.row - second.coordinate.row
      || first.coordinate.col - second.coordinate.col)[0]?.coordinate ?? null;
}

function deterministicDefeat(): GameState {
  const decoded = deserializeGameState(publishedDailyUniverse.serializedInitialGameState);
  if (!decoded.ok) throw new Error("Playtest could not decode Universe #001.");

  for (let seed = 1; seed <= 500; seed += 1) {
    const entropy = new SeededEntropy(seed);
    const visits = new Map<string, number>();
    let state = decoded.value;
    for (let count = 0; count < 80 && state.status !== "VICTORY" && state.status !== "DEFEAT"; count += 1) {
      const target = visibleTarget(state, visits);
      if (target === null) break;
      const key = `${target.row}-${target.col}`;
      visits.set(key, (visits.get(key) ?? 0) + 1);
      const cell = state.board.find((candidate) => sameCoordinate(candidate.coordinate, target));
      const action: Action = cell?.kind === "UNRESOLVED"
        ? { kind: "OBSERVE", target }
        : { kind: "MOVE", target };
      const result = processAction(state, action, entropy as Parameters<typeof processAction>[2]);
      if (!result.ok) break;
      state = result.state;
    }
    if (state.status === "DEFEAT") return state;
  }
  throw new Error("Playtest could not produce a deterministic visible-strategy defeat.");
}

function startMode(mode: GameMode): void {
  window.localStorage.setItem(TUTORIAL_PREFERENCE_KEY, "true");
  useDailyGameStore.getState().selectMode(mode);
  useDailyGameStore.getState().start();
}

function executeStoreAction(action: Action): void {
  const store = useDailyGameStore.getState();
  store.selectCell(action.target);
  if (action.kind === "OBSERVE") useDailyGameStore.getState().observeSelected();
  else if (action.kind === "MOVE") useDailyGameStore.getState().moveSelected();
  else useDailyGameStore.getState().applyGateToSelected(action.gate);
}

function executeGuidedRoute(from = 0): void {
  const journey = getGuidedJourney(useDailyGameStore.getState().universe.universeNumber);
  for (const step of journey.steps.slice(from)) executeStoreAction(step.action);
}

function canonicalReplay(
  actions: readonly Action[],
  observationBudget = 10,
  universe: DailyUniverse = publishedDailyUniverse,
): GameState {
  const decoded = deserializeGameState(universe.serializedInitialGameState);
  if (!decoded.ok) throw new Error(`Replay could not decode Universe #${universe.universeNumber}.`);
  const entropy = createResolutionEntropySource(universe.resolutionPlan);
  let state: GameState = { ...decoded.value, observations: observationBudget };
  for (const action of actions) {
    const result = processAction(state, action, entropy as Parameters<typeof processAction>[2]);
    if (!result.ok) throw new Error("Replay rejected a guided action.");
    state = result.state;
  }
  return state;
}

function dispatchGameplayKey(key: string, repeat = false): KeyboardEvent {
  const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key, repeat });
  act(() => window.dispatchEvent(event));
  return event;
}

function BrokenPresentationModule(): never {
  throw new Error("Synthetic lazy module failure");
}

describe("COLAPSO V2.2 deterministic production playtest", () => {
  beforeEach(() => {
    window.localStorage.clear();
    useDailyGameStore.getState().resetCampaignProgress();
    useDailyGameStore.getState().reset();
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: vi.fn() });
    Object.defineProperty(window, "requestAnimationFrame", {
      configurable: true,
      value: (callback: FrameRequestCallback) => { callback(0); return 1; },
    });
    Object.defineProperty(window.navigator, "vibrate", { configurable: true, value: vi.fn() });
    Object.defineProperty(window.navigator, "clipboard", { configurable: true, value: undefined });
  });

  afterEach(() => {
    cleanup();
    document.body.replaceChildren();
    useDailyGameStore.getState().resetCampaignProgress();
    useDailyGameStore.getState().reset();
    window.localStorage.clear();
  });

  it("plays the canonical mission through powers, decoherence, victory, defeat and CANÓNICO result", async () => {
    startMode("QUANTUM_MISSION");
    executeStoreAction({ kind: "APPLY_GATE", gate: "X", target: { row: 6, col: 1 } });
    executeStoreAction({ kind: "APPLY_GATE", gate: "H", target: { row: 6, col: 1 } });
    expect(useDailyGameStore.getState().transcript.map((action) => action.kind)).toEqual(["APPLY_GATE", "APPLY_GATE"]);
    expect(useDailyGameStore.getState().gameState.board.find((cell) => sameCoordinate(cell.coordinate, { row: 6, col: 1 }))?.kind).toBe("UNRESOLVED");

    useDailyGameStore.getState().retry();
    executeGuidedRoute();
    const victory = useDailyGameStore.getState();
    expect(victory.gameState.status).toBe("VICTORY");
    expect(victory.completedUniverseNumbers).toContain(1);
    expect(JSON.parse(window.localStorage.getItem(CAMPAIGN_PROGRESS_KEY) ?? "{}")).toEqual({ completedUniverseNumbers: [1] });
    expect(victory.metrics.decoherences).toBeGreaterThan(0);
    render(<App />);
    expect(screen.getByText("CANÓNICO")).toBeInTheDocument();
    expect(screen.getByText("Puntaje oficial")).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "Ver recorrido" }, { timeout: 5_000 })).toBeInTheDocument();

    cleanup();
    useDailyGameStore.setState({ phase: "FINISHED", gameMode: "QUANTUM_MISSION", gameState: deterministicDefeat() });
    render(<App />);
    expect(screen.getByRole("heading", { name: "La ruta se cerró" })).toBeInTheDocument();
    expect(screen.getByText("CANÓNICO")).toBeInTheDocument();
  });

  it("plays Explorer through five Pulses, recovery, visible margins and ASISTIDO results", async () => {
    startMode("EXPLORER");
    const engineBytes = JSON.stringify(useDailyGameStore.getState().gameState);
    for (let pulse = 0; pulse < 5; pulse += 1) expect(useDailyGameStore.getState().activateQuantumPulse()).toBe(true);
    expect(useDailyGameStore.getState().quantumPulses).toBe(0);
    expect(JSON.stringify(useDailyGameStore.getState().gameState)).toBe(engineBytes);
    expect(useDailyGameStore.getState().feedback).toContain("La sugerencia usa probabilidades, no conoce el resultado final.");

    executeStoreAction(GUIDED_JOURNEY.steps[0]!.action);
    executeStoreAction(GUIDED_JOURNEY.steps[1]!.action);
    executeStoreAction(GUIDED_JOURNEY.steps[2]!.action);
    expect(useDailyGameStore.getState().metrics.coherenceBursts).toBe(1);
    expect(useDailyGameStore.getState().quantumPulses).toBe(1);
    executeGuidedRoute(3);
    expect(useDailyGameStore.getState().gameState.status).toBe("VICTORY");

    render(<App />);
    expect(screen.getByText("ASISTIDO")).toBeInTheDocument();
    expect(screen.getByText("Puntaje F1 · resultado no competitivo")).toBeInTheDocument();
    expect(screen.getByText("Pulsos usados")).toBeInTheDocument();
    expect(screen.getByText("Coherence Bursts")).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "Ver recorrido" }, { timeout: 5_000 })).toBeInTheDocument();

    cleanup();
    useDailyGameStore.setState({ phase: "FINISHED", gameMode: "EXPLORER", gameState: deterministicDefeat() });
    render(<App />);
    expect(screen.getByRole("heading", { name: "La ruta se cerró" })).toBeInTheDocument();
    expect(screen.getByText("ASISTIDO")).toBeInTheDocument();
  });

  it("audits and plays every Guided Journey with deterministic replay, recovery and rewinds", () => {
    for (const universeNumber of [1, 2, 3, 4, 5] as const) {
      const definition = GUIDED_JOURNEYS[universeNumber];
      const entry = getPlayableCampaignEntry(universeNumber);
      expect(entry).toBeDefined();
      if (entry === undefined) throw new Error(`Universe #${universeNumber} is not playable.`);
      const report = auditGuidedRoute(definition);
      const actions = definition.steps.map((step) => step.action);
      expect(report).toMatchObject({
        ok: true,
        actionsProcessed: definition.steps.length,
        initialStateUnchanged: true,
        finalState: expect.objectContaining({ status: "VICTORY" }),
      });
      expect(createHash("sha256").update(JSON.stringify(actions)).digest("hex")).toBe(definition.actionTranscriptSha256);
      expect(JSON.stringify(canonicalReplay(actions, observationBudgetForMode("GUIDED"), entry.artifact))).toBe(JSON.stringify(report.finalState));

      useDailyGameStore.getState().selectUniverseFromRoute(universeNumber);
      startMode("GUIDED");
      executeGuidedRoute();
      const completedUniverse = useDailyGameStore.getState();
      expect(completedUniverse.gameState.status).toBe("VICTORY");
      expect(completedUniverse.guidedStep).toBe(definition.steps.length);
      expect(completedUniverse.completedUniverseNumbers).toContain(universeNumber);
    }
    expect(useDailyGameStore.getState().completedUniverseNumbers).toEqual([1, 2, 3, 4, 5]);

    useDailyGameStore.getState().selectUniverseFromRoute(1);
    startMode("GUIDED");
    executeStoreAction({ kind: "OBSERVE", target: { row: 5, col: 0 } });
    executeStoreAction({ kind: "MOVE", target: { row: 5, col: 0 } });
    expect(useDailyGameStore.getState().guidedDeviation).toBe(true);
    useDailyGameStore.getState().returnToGuidance();
    expect(useDailyGameStore.getState().transcript).toHaveLength(0);
    expect(useDailyGameStore.getState().guidedDeviation).toBe(false);

    executeStoreAction(GUIDED_JOURNEY.steps[0]!.action);
    useDailyGameStore.getState().rewindLastAction();
    expect(useDailyGameStore.getState().rewindsRemaining).toBe(2);
    executeGuidedRoute();
    const completed = useDailyGameStore.getState();
    expect(completed.phase).toBe("FINISHED");
    expect(completed.gameState.status).toBe("VICTORY");
    expect(completed.guidedStep).toBe(GUIDED_JOURNEY.steps.length);
    expect(completed.gameState.collectedBatteries.length).toBeGreaterThan(0);
    expect(JSON.stringify(canonicalReplay(completed.transcript, observationBudgetForMode("GUIDED")))).toBe(JSON.stringify(completed.gameState));

    useDailyGameStore.getState().retry();
    for (let rewind = 0; rewind < 3; rewind += 1) {
      executeStoreAction(GUIDED_JOURNEY.steps[0]!.action);
      useDailyGameStore.getState().rewindLastAction();
    }
    executeStoreAction(GUIDED_JOURNEY.steps[0]!.action);
    const afterLimit = useDailyGameStore.getState().gameState;
    useDailyGameStore.getState().rewindLastAction();
    expect(useDailyGameStore.getState().rewindsRemaining).toBe(0);
    expect(useDailyGameStore.getState().gameState).toBe(afterLimit);
  });

  it("keeps hidden outcomes and controls isolated between modes", async () => {
    const initial = useDailyGameStore.getState().gameState;
    const decorated = {
      ...initial,
      board: initial.board.map((cell, index) => ({ ...cell, hiddenOutcome: index % 2 === 0 ? "BATTERY" : "WALL" })),
    } as GameState;
    expect(recommendPulseTarget(decorated)).toEqual(recommendPulseTarget(initial));

    for (const mode of ["QUANTUM_MISSION", "EXPLORER", "GUIDED"] as const) {
      cleanup();
      useDailyGameStore.getState().reset();
      startMode(mode);
      render(<App />);
      expect(screen.queryByLabelText("Pulso Cuántico") !== null).toBe(mode === "EXPLORER");
      if (mode === "GUIDED") {
        expect(await screen.findByLabelText("Controles de Ruta Guiada")).toBeInTheDocument();
        expect(screen.getByText("Rebobinar última acción")).toBeInTheDocument();
      } else {
        expect(screen.queryByLabelText("Controles de Ruta Guiada")).not.toBeInTheDocument();
        expect(screen.queryByText("Rebobinar última acción")).not.toBeInTheDocument();
      }
      expect(document.body).not.toHaveTextContent(/hiddenOutcome|BATTERY|FLOOR|WALL|VOID/);
    }
  });

  it("weights public battery probability when the visible margin is critical", () => {
    const initial = useDailyGameStore.getState().gameState;
    const critical = {
      ...initial,
      observations: 1,
      board: initial.board.map((cell) => {
        if (cell.kind !== "UNRESOLVED") return cell;
        if (sameCoordinate(cell.coordinate, { row: 5, col: 0 })) {
          return { ...cell, distribution: [0.5, 0.05, 0.05, 0.4, 0] as const };
        }
        if (sameCoordinate(cell.coordinate, { row: 6, col: 1 })) {
          return { ...cell, distribution: [0.5, 0.05, 0.05, 0.05, 0.35] as const };
        }
        return cell;
      }),
    } as GameState;

    expect(deriveVisibleTacticalInfo(critical).marginStatus).toBe("CRITICAL");
    expect(recommendQuantumPulse(critical)).toMatchObject({
      target: { row: 6, col: 1 },
      strategy: "BATTERY",
      message: "Tus observaciones son escasas; el Pulso está buscando una posibilidad de batería.",
      batteryProbability: 0.35,
    });
  });

  it("prevents repeated keys and makes Space select before executing without scrolling", async () => {
    startMode("QUANTUM_MISSION");
    render(<App />);

    const repeatedArrow = dispatchGameplayKey("ArrowRight", true);
    expect(repeatedArrow.defaultPrevented).toBe(true);
    expect(useDailyGameStore.getState().keyboardCursor).toEqual({ row: 6, col: 0 });

    const arrow = dispatchGameplayKey("ArrowRight");
    expect(arrow.defaultPrevented).toBe(true);
    expect(useDailyGameStore.getState().keyboardCursor).toEqual({ row: 6, col: 1 });
    await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId("cell-6-1")));

    const firstSpace = dispatchGameplayKey(" ");
    expect(firstSpace.defaultPrevented).toBe(true);
    expect(useDailyGameStore.getState().selectedCell).toEqual({ row: 6, col: 1 });
    expect(useDailyGameStore.getState().transcript).toHaveLength(0);

    const repeatedSpace = dispatchGameplayKey(" ", true);
    expect(repeatedSpace.defaultPrevented).toBe(true);
    expect(useDailyGameStore.getState().transcript).toHaveLength(0);

    const secondSpace = dispatchGameplayKey(" ");
    expect(secondSpace.defaultPrevented).toBe(true);
    expect(useDailyGameStore.getState().transcript.at(-1)).toMatchObject({ kind: "OBSERVE", target: { row: 6, col: 1 } });

    const enter = dispatchGameplayKey("Enter");
    expect(enter.defaultPrevented).toBe(true);
    expect(useDailyGameStore.getState().transcript.at(-1)).toMatchObject({ kind: "MOVE", target: { row: 6, col: 1 } });
    expect(useDailyGameStore.getState().eventLog.length).toBeLessThanOrEqual(3);
  });

  it("targets the keyboard cursor for WASD and valid X/H powers", () => {
    startMode("QUANTUM_MISSION");
    render(<App />);

    expect(dispatchGameplayKey("d").defaultPrevented).toBe(true);
    expect(useDailyGameStore.getState().keyboardCursor).toEqual({ row: 6, col: 1 });
    expect(dispatchGameplayKey("x").defaultPrevented).toBe(true);
    expect(useDailyGameStore.getState().transcript.at(-1)).toMatchObject({
      kind: "APPLY_GATE",
      gate: "X",
      target: { row: 6, col: 1 },
    });

    act(() => useDailyGameStore.getState().retry());
    dispatchGameplayKey("d");
    dispatchGameplayKey("h");
    expect(useDailyGameStore.getState().transcript.at(-1)).toMatchObject({
      kind: "APPLY_GATE",
      gate: "H",
      target: { row: 6, col: 1 },
    });
  });

  it("blocks gameplay shortcuts in overlays and restores focus after Escape", async () => {
    startMode("EXPLORER");
    render(<App />);
    const initial = useDailyGameStore.getState();

    const restart = dispatchGameplayKey("r");
    expect(restart.defaultPrevented).toBe(true);
    expect(useDailyGameStore.getState().panel).toBe("RESTART");
    expect(screen.getByRole("alertdialog", { name: "¿Reiniciar esta misión?" })).toBeInTheDocument();

    dispatchGameplayKey("ArrowUp");
    dispatchGameplayKey("q");
    dispatchGameplayKey("x");
    dispatchGameplayKey("m");
    expect(useDailyGameStore.getState()).toMatchObject({
      keyboardCursor: initial.keyboardCursor,
      quantumPulses: initial.quantumPulses,
      soundEnabled: initial.soundEnabled,
      transcript: initial.transcript,
    });

    const escape = dispatchGameplayKey("Escape");
    expect(escape.defaultPrevented).toBe(true);
    expect(useDailyGameStore.getState().panel).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId("cell-6-0")));

    dispatchGameplayKey("?");
    expect(useDailyGameStore.getState().panel).toBe("HELP");
    dispatchGameplayKey("Escape");
    dispatchGameplayKey("m");
    expect(useDailyGameStore.getState().soundEnabled).toBe(false);
  });

  it("keeps the mobile console compact, mode-specific and thumb-accessible", () => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 375 });
    startMode("EXPLORER");
    render(<App />);

    const heading = screen.getByRole("heading", { name: "Consola del Observador" });
    const consolePanel = heading.closest("section");
    expect(consolePanel).toHaveAttribute("data-console-expanded", "true");
    expect(screen.getByText("MODO EXPLORADOR")).toBeInTheDocument();
    expect(screen.getByLabelText("Pulso Cuántico")).toBeInTheDocument();
    expect(screen.getByLabelText("Presión de decoherencia")).toHaveAttribute("data-pressure-state", "stable");
    expect(screen.queryByLabelText("Controles de Ruta Guiada")).not.toBeInTheDocument();
    expect(document.querySelector(".observer-console__primary")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Seleccionar posibilidad" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Contraer consola" }));
    expect(consolePanel).toHaveAttribute("data-console-expanded", "false");
    expect(screen.getByRole("button", { name: "Seleccionar posibilidad" })).toBeInTheDocument();
    expect(appendEventLog([], ["uno", "dos", "tres", "cuatro"])).toEqual(["dos", "tres", "cuatro"]);
    expect(document.querySelectorAll(".observer-console__log > p").length).toBeLessThanOrEqual(3);
  });

  it("unlocks, mutes and deduplicates the audio state machine", () => {
    const audio = new GameSoundState();
    expect(audio.shouldPlay("select", 100)).toBe(false);
    expect(audio.unlock()).toBe(true);
    expect(audio.unlock()).toBe(false);
    expect(audio.shouldPlay("select", 100)).toBe(true);
    expect(audio.shouldPlay("select", 110)).toBe(false);
    expect(audio.shouldPlay("select", 128)).toBe(true);
    audio.setMuted(true);
    expect(audio.shouldPlay("move", 200)).toBe(false);
    audio.setMuted(false);
    expect(audio.shouldPlay("move", 200)).toBe(true);
    expect(audio.shouldPlay("move", 240, true)).toBe(false);

    const blocked = new GameSoundState();
    expect(blocked.unlock(true)).toBe(false);
    expect(blocked.shouldPlay("victory", 300)).toBe(false);
  });

  it("renders a controlled fallback when a lazy presentation module throws", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const close = vi.fn();
    try {
      render(<LazyModuleBoundary label="La procedencia no pudo cargarse." onClose={close}>
        <BrokenPresentationModule />
      </LazyModuleBoundary>);
      expect(screen.getByRole("alert")).toHaveTextContent("La procedencia no pudo cargarse.");
      expect(screen.getByText("La experiencia principal sigue disponible. Puedes cerrar este panel y continuar.")).toBeInTheDocument();
      expect(document.body).not.toHaveTextContent("Synthetic lazy module failure");
      fireEvent.click(screen.getByRole("button", { name: "Cerrar y continuar" }));
      expect(close).toHaveBeenCalledOnce();
    } finally {
      consoleError.mockRestore();
    }
  });

  it("keeps the integrity reference visible when Clipboard API is unavailable", async () => {
    render(<ProvenanceModal />);
    fireEvent.click(screen.getByRole("button", { name: "Copiar referencia de integridad" }));
    expect(await screen.findByText("La copia automática no está disponible. La referencia sigue visible en este panel.")).toBeInTheDocument();
    expect(screen.getByText("Commitment")).toBeInTheDocument();
  });

  it("removes corrupt local preferences and falls back to normal onboarding", () => {
    window.localStorage.setItem(TUTORIAL_PREFERENCE_KEY, "corrupt-value");
    useDailyGameStore.getState().selectMode("QUANTUM_MISSION");
    useDailyGameStore.getState().start();

    expect(window.localStorage.getItem(TUTORIAL_PREFERENCE_KEY)).toBeNull();
    expect(useDailyGameStore.getState().phase).toBe("PLAYING");
    expect(useDailyGameStore.getState().tutorialStep).toBe(1);
  });

  it("shows controlled guided-route errors and never labels a guided defeat completed", async () => {
    startMode("GUIDED");
    useDailyGameStore.setState({
      guidedError: "La acción guiada dejó de ser válida.",
      guidanceActive: false,
    });
    render(<App />);
    expect(await screen.findByRole("alert")).toHaveTextContent("La acción guiada dejó de ser válida.");
    expect(screen.getByRole("button", { name: "Volver a la portada" })).toBeInTheDocument();

    cleanup();
    const current = useDailyGameStore.getState();
    useDailyGameStore.setState({
      phase: "FINISHED",
      gameMode: "GUIDED",
      gameState: { ...current.gameState, status: "DEFEAT" },
    });
    render(<App />);
    expect(screen.getAllByText("RUTA GUIADA")).toHaveLength(2);
    expect(screen.queryByText("RUTA GUIADA COMPLETADA")).not.toBeInTheDocument();
    expect(screen.getByText("La Ruta Guiada se detuvo antes de completar la solución verificable.")).toBeInTheDocument();
  });

  it("renders separate decoherence pressure through 3, 2, 1 and collapse without mutating F1", () => {
    const initialState = useDailyGameStore.getState().gameState;
    const initialBytes = JSON.stringify(initialState);
    expect([0, 1, 2, 3].map((turn) => deriveDecoherencePressure(turn))).toEqual([
      expect.objectContaining({ level: "stable", turnsRemaining: 4, intensity: 0, label: "CAMPO ESTABLE", cue: null }),
      expect.objectContaining({ level: "rising", turnsRemaining: 3, intensity: 34, label: "SEÑAL INESTABLE", cue: "tick" }),
      expect.objectContaining({ level: "high", turnsRemaining: 2, intensity: 67, label: "DECOHERENCIA PRÓXIMA", cue: "high" }),
      expect.objectContaining({ level: "maximum", turnsRemaining: 1, intensity: 100, label: "ALERTA DE COLAPSO", cue: "peak" }),
    ]);
    expect(deriveDecoherencePressure(4, true)).toEqual(expect.objectContaining({ level: "pulse", label: "PULSO DE COLAPSO", cue: "pulse" }));
    expect(JSON.stringify(initialState)).toBe(initialBytes);

    startMode("QUANTUM_MISSION");
    act(() => useDailyGameStore.setState({
      gameState: { ...useDailyGameStore.getState().gameState, observations: 4 },
    }));
    const playingBytes = JSON.stringify(useDailyGameStore.getState().gameState);
    render(<App />);
    const pressure = screen.getByLabelText("Presión de decoherencia");
    const resources = screen.getByLabelText("Observaciones y alerta activa");
    expect(pressure).toHaveAttribute("data-pressure-state", "stable");
    expect(resources).toHaveAttribute("data-resource-alert", "warning");
    expect(screen.getByText("CAMPO ESTABLE")).toBeInTheDocument();
    expect(document.querySelector("main")).toHaveAttribute("data-decoherence-pressure", "stable");
    expect(document.querySelector("main")).toHaveAttribute("data-resource-alert", "warning");
    expect(JSON.stringify(useDailyGameStore.getState().gameState)).toBe(playingBytes);

    for (const [turn, level, copy, intensity] of [
      [1, "rising", "SEÑAL INESTABLE", "34"],
      [2, "high", "DECOHERENCIA PRÓXIMA", "67"],
      [3, "maximum", "ALERTA DE COLAPSO", "100"],
    ] as const) {
      act(() => useDailyGameStore.setState({
        gameState: { ...useDailyGameStore.getState().gameState, turn },
        messages: [],
      }));
      expect(pressure).toHaveAttribute("data-pressure-state", level);
      expect(document.querySelector("main")).toHaveAttribute("data-decoherence-pressure", level);
      expect(screen.getByText(copy)).toBeInTheDocument();
      expect(screen.getByRole("progressbar", { name: `Presión de decoherencia: ${intensity}%` })).toHaveAttribute("aria-valuenow", intensity);
    }

    act(() => useDailyGameStore.setState({
      gameState: { ...useDailyGameStore.getState().gameState, turn: 4 },
      messages: ["El universo colapsó una casilla por su cuenta."],
    }));
    expect(pressure).toHaveAttribute("data-pressure-state", "pulse");
    expect(document.querySelector("main")).toHaveAttribute("data-decoherence-pressure", "pulse");
    expect(screen.getByText("PULSO DE COLAPSO")).toBeInTheDocument();
    expect(document.querySelector(".quantum-decoherence-fx")).not.toBeNull();
  });

  it("deduplicates pressure sounds by transition and mute blocks both alert systems", () => {
    const stable = deriveDecoherencePressure(0);
    const rising = deriveDecoherencePressure(1);
    const high = deriveDecoherencePressure(2);
    const maximum = deriveDecoherencePressure(3);
    const pulse = deriveDecoherencePressure(4, true);
    expect(decoherencePressureCue(null, stable)).toBeNull();
    expect(decoherencePressureCue("stable", rising)).toBe("tick");
    expect(decoherencePressureCue("rising", rising)).toBeNull();
    expect(decoherencePressureCue("rising", high)).toBe("high");
    expect(decoherencePressureCue("high", maximum)).toBe("peak");
    expect(decoherencePressureCue("maximum", pulse)).toBe("pulse");
    expect(decoherencePressureCue("pulse", pulse)).toBeNull();

    const audio = new GameSoundState();
    expect(audio.unlock()).toBe(true);
    expect(audio.shouldPlay("tensionHigh", 100)).toBe(true);
    expect(audio.shouldPlay("tensionHigh", 1_199)).toBe(false);
    expect(audio.shouldPlay("tensionHigh", 1_200)).toBe(true);
    audio.setMuted(true);
    expect(audio.shouldPlay("decoherencePulse", 2_000)).toBe(false);
    expect(audio.shouldPlay("resourceWarning", 2_000)).toBe(false);
    expect(isGameSoundTestEnvironment(window.navigator.userAgent)).toBe(true);

    const play = vi.spyOn(Howl.prototype, "play");
    try {
      playGameSound("decoherencePulse");
      expect(play).not.toHaveBeenCalled();
    } finally {
      play.mockRestore();
    }
  });

  it("keeps canonical, assisted, guided and defeat finals free of checkerboard assets", () => {
    const scenarios = [
      ["QUANTUM_MISSION", "VICTORY", "CANÓNICO"],
      ["QUANTUM_MISSION", "DEFEAT", "CANÓNICO"],
      ["EXPLORER", "VICTORY", "ASISTIDO"],
      ["GUIDED", "VICTORY", "RUTA GUIADA"],
    ] as const;

    for (const [gameMode, status, resultLabel] of scenarios) {
      cleanup();
      useDailyGameStore.getState().reset();
      const current = useDailyGameStore.getState();
      useDailyGameStore.setState({
        phase: "FINISHED",
        gameMode,
        gameState: { ...current.gameState, status },
      });
      render(<App />);

      const atmosphere = document.querySelector(".final-atmosphere");
      expect(atmosphere).toHaveAttribute("data-clean-effects", "css-fragments");
      expect(atmosphere?.querySelector("img")).toBeNull();
      expect(document.querySelectorAll(".final-atmosphere__fragment")).toHaveLength(4);
      expect(document.querySelector(`.finished-card__fx--${status === "VICTORY" ? "victory" : "defeat"}`)).not.toBeNull();
      expect(document.querySelector('img[src*="fx_decoherence_pulse"], img[src*="fx_collapse_burst"]')).toBeNull();
      expect(screen.getAllByText(resultLabel).length).toBeGreaterThan(0);
    }

    expect(existsSync("public/assets/colapso/fx_decoherence_pulse.webp")).toBe(false);
    expect(existsSync("public/assets/colapso/fx_collapse_burst.webp")).toBe(false);
    expect(colapsoAssets.effects).not.toHaveProperty("decoherence");
    expect(colapsoAssets.effects).not.toHaveProperty("collapse");

    const css = readFileSync("src/index.css", "utf8");
    expect(css).toContain("final_quantum_bg.webp");
    expect(css).toContain(".final-atmosphere__fragment");
    expect(css).not.toContain(".finished-card__fx img");
    expect(css).not.toContain(".quantum-decoherence-fx__image");
    expect(css).not.toContain("fx_decoherence_pulse.webp");
    expect(css).not.toContain("fx_collapse_burst.webp");
  });

  it("provides a 390px pressure layout and disables pressure/final motion when requested", () => {
    const css = readFileSync("src/index.css", "utf8");
    expect(css).toContain("@media (max-width: 767px)");
    expect(css).toContain("@media (max-width: 479px)");
    expect(css).toContain(".decoherence-pressure__ring");
    expect(css).toContain(".decoherence-pressure__copy,");
    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
    expect(css).toContain(".game-atmosphere__pressure-scan,");
    expect(css).toContain(".game-shell--decoherence-maximum .mission-board,");
    expect(css).toContain(".game-shell--decoherence-pulse .mission-board,");
    expect(css).toContain(".final-atmosphere__fragment,");
    expect(css).not.toContain("fx_decoherence_pulse.webp");
    expect(css).not.toContain("fx_collapse_burst.webp");
  });
});


describe("COLAPSO V2.4 gameplay clarity", () => {
  beforeEach(() => {
    window.localStorage.clear();
    useDailyGameStore.getState().resetCampaignProgress();
    useDailyGameStore.getState().reset();
    window.localStorage.setItem(TUTORIAL_PREFERENCE_KEY, "true");
    Object.defineProperty(window, "requestAnimationFrame", {
      configurable: true,
      value: (callback: FrameRequestCallback) => { callback(0); return 1; },
    });
  });

  afterEach(() => {
    cleanup();
    document.body.replaceChildren();
    useDailyGameStore.getState().resetCampaignProgress();
    useDailyGameStore.getState().reset();
    window.localStorage.clear();
  });

  it("starts and restores the mode-specific observation budgets", () => {
    expect(observationBudgetForMode("QUANTUM_MISSION")).toBe(10);
    expect(observationBudgetForMode("EXPLORER")).toBe(13);
    expect(observationBudgetForMode("GUIDED")).toBe(13);

    for (const [mode, budget] of [
      ["QUANTUM_MISSION", 10],
      ["EXPLORER", 13],
      ["GUIDED", 13],
    ] as const) {
      useDailyGameStore.getState().reset();
      startMode(mode);
      expect(useDailyGameStore.getState().gameState.observations).toBe(budget);
      useDailyGameStore.getState().retry();
      expect(useDailyGameStore.getState().gameState.observations).toBe(budget);
    }
  });

  it("renders a compact command bar and one prioritized Observer Console", () => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1280 });
    startMode("EXPLORER");
    render(<App />);

    const commandBar = screen.getByLabelText("Comando y estado de la misión");
    expect(commandBar).toHaveTextContent("13");
    expect(commandBar).toHaveTextContent("Energía");
    expect(commandBar).toHaveTextContent("Turno");
    expect(commandBar).toHaveTextContent("Cristales");
    expect(commandBar).toHaveTextContent("Puntaje");
    expect(commandBar).toHaveTextContent("MODO EXPLORADOR");
    expect(screen.queryByLabelText("Barra de misión persistente")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Seleccionar posibilidad" })).toBeEnabled();

    const css = readFileSync("src/index.css", "utf8");
    expect(css).toContain('html[data-gameplay-cockpit="active"]');
    expect(css).toContain("@media (min-width: 1100px) and (min-height: 680px)");
    expect(css).toContain(".mission-sticky-hud {\n  display: none;");
  });

  it("raises visual and audio resource alerts once per observation threshold", () => {
    expect([4, 3, 2, 1, 0].map((observations) => deriveObservationAlert(observations))).toEqual([
      expect.objectContaining({ level: "warning", intensity: 40, cue: "resourceWarning" }),
      expect.objectContaining({ level: "risk", intensity: 60, cue: "resourceRisk" }),
      expect.objectContaining({ level: "high", intensity: 80, cue: "resourceHigh" }),
      expect.objectContaining({ level: "maximum", intensity: 100, cue: "resourceMaximum" }),
      expect.objectContaining({ level: "maximum", intensity: 100, cue: "resourceMaximum" }),
    ]);
    expect(observationAlertCue(5, 4)).toBe("resourceWarning");
    expect(observationAlertCue(4, 4)).toBeNull();
    expect(observationAlertCue(4, 3)).toBe("resourceRisk");
    expect(observationAlertCue(2, 1)).toBe("resourceMaximum");
    expect(observationAlertCue(1, 0)).toBeNull();

    const audio = new GameSoundState();
    audio.unlock();
    expect(audio.shouldPlay("resourceHigh", 100)).toBe(true);
    expect(audio.shouldPlay("resourceHigh", 999)).toBe(false);
    expect(audio.shouldPlay("resourceHigh", 1_000)).toBe(true);
    audio.setMuted(true);
    expect(audio.shouldPlay("resourceMaximum", 2_000)).toBe(false);

    startMode("QUANTUM_MISSION");
    render(<App />);
    for (const [observations, level, copy] of [
      [4, "warning", "Te quedan pocas observaciones. Empieza a cerrar una ruta."],
      [3, "risk", "Zona de riesgo: cada observación cuenta."],
      [2, "high", "Alerta alta: necesitas una ruta muy eficiente o una batería."],
      [1, "maximum", "Última oportunidad de observación."],
    ] as const) {
      act(() => useDailyGameStore.setState({
        gameState: { ...useDailyGameStore.getState().gameState, observations },
      }));
      expect(document.querySelector(".game-shell")).toHaveAttribute("data-resource-alert", level);
      expect(screen.getByLabelText("Observaciones y alerta activa")).toHaveAttribute("data-resource-alert", level);
      expect(screen.getAllByText(copy).length).toBeGreaterThanOrEqual(1);
    }
  });

  it("makes X and H explicit, actionable and single-execution for click and keyboard", () => {
    startMode("QUANTUM_MISSION");
    render(<App />);

    const powerX = screen.getByRole("button", { name: "Poder X" });
    const powerH = screen.getByRole("button", { name: "Poder H" });
    expect(powerX).toBeDisabled();
    expect(powerH).toBeDisabled();
    expect(screen.getAllByText("Primero elige una casilla objetivo.")).toHaveLength(2);

    fireEvent.click(screen.getByTestId("cell-6-1"));
    expect(powerX).toBeEnabled();
    expect(powerH).toBeEnabled();
    expect(screen.getAllByText("Disponible para este objetivo.")).toHaveLength(2);
    expect(screen.getByTestId("cell-6-1")).toHaveClass("mission-cell--power-target");

    fireEvent.click(powerX);
    expect(useDailyGameStore.getState().transcript).toHaveLength(1);
    expect(useDailyGameStore.getState().transcript[0]).toMatchObject({ kind: "APPLY_GATE", gate: "X", target: { row: 6, col: 1 } });
    expect(useDailyGameStore.getState().eventLog.filter((message) => message.includes("Poder X"))).toHaveLength(1);
    expect(screen.getByText("El Poder X ya no está disponible.")).toBeInTheDocument();

    act(() => useDailyGameStore.getState().retry());
    dispatchGameplayKey("x");
    expect(useDailyGameStore.getState().transcript).toHaveLength(0);
    expect(useDailyGameStore.getState().feedback).toBe("Esta casilla ya fue observada.");
    dispatchGameplayKey("d");
    dispatchGameplayKey("h");
    expect(useDailyGameStore.getState().transcript).toHaveLength(1);
    expect(useDailyGameStore.getState().transcript[0]).toMatchObject({ kind: "APPLY_GATE", gate: "H", target: { row: 6, col: 1 } });
  });

  it("orders essential console controls before the optional telemetry disclosure", () => {
    startMode("EXPLORER");
    render(<App />);
    const consolePanel = screen.getByRole("heading", { name: "Consola del Observador" }).closest("section");
    expect(consolePanel).not.toBeNull();
    const priorities = [...consolePanel!.querySelectorAll<HTMLElement>("[data-console-priority]")]
      .map((element) => Number(element.dataset.consolePriority));
    expect(priorities).toEqual([1, 1, 1, 2, 2, 3]);
    expect(screen.getByLabelText("Observaciones y alerta activa")).toHaveTextContent("13");
    expect(screen.getByLabelText("Poderes cuánticos")).toBeInTheDocument();
    const scrollRegion = screen.getByRole("region", { name: "Herramientas e información adicional" });
    expect(scrollRegion).toHaveAttribute("tabindex", "0");
    expect(scrollRegion).toContainElement(screen.getByText("Más telemetría").closest("details"));
    expect(screen.getByText("Más telemetría").closest("details")).not.toHaveAttribute("open");
  });

  it("keeps mode copy and the difficulty benchmark aligned with 10/13 budgets", () => {
    const modeCopy = readFileSync("src/components/MissionControlV2.tsx", "utf8");
    const benchmark = readFileSync("../scripts/analyze-v2-difficulty.ts", "utf8");
    expect(modeCopy).toContain("10 observaciones · Score oficial");
    expect(modeCopy).toContain("13 observaciones · Score F1");
    expect(modeCopy).toContain("13 observaciones · paso a paso");
    expect(benchmark).toContain("explorer: 13");
    expect(benchmark).toContain("guided: 13");
    expect(benchmark).toContain("explorerV24");
    expect(modeCopy).not.toMatch(/MODO EXPLORADOR[\s\S]{0,220}10 observaciones/);
    expect(modeCopy).not.toMatch(/RUTA GUIADA[\s\S]{0,220}10 observaciones/);
  });
});
