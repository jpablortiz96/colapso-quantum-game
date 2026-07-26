import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { GUIDED_JOURNEY } from "./components/guided-journey";
import {
  deriveVisibleTacticalInfo,
  recommendPulseTarget,
} from "./components/mission-control";
import { calculateScore, type GameState } from "./engine";
import {
  TUTORIAL_PREFERENCE_KEY,
  useDailyGameStore,
  type GameMode,
} from "./store/daily-game-store";

function startMode(mode: GameMode): void {
  window.localStorage.setItem(TUTORIAL_PREFERENCE_KEY, "true");
  useDailyGameStore.getState().selectMode(mode);
  useDailyGameStore.getState().start();
}

function executeFirstGuidedAction(): void {
  useDailyGameStore.getState().selectCell({ row: 6, col: 1 });
  useDailyGameStore.getState().observeSelected();
}

function allFloorState(observations: number): GameState {
  const state = useDailyGameStore.getState().gameState;
  return {
    ...state,
    observations,
    board: state.board.map((cell) => ({ kind: "COLLAPSED" as const, coordinate: cell.coordinate, outcome: "FLOOR" as const })),
  };
}

describe("COLAPSO V2.1 balance and guided journey", () => {
  beforeEach(() => {
    window.localStorage.clear();
    useDailyGameStore.getState().reset();
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: vi.fn() });
    Object.defineProperty(window.navigator, "vibrate", { configurable: true, value: vi.fn() });
  });

  afterEach(() => {
    cleanup();
    document.body.replaceChildren();
    window.localStorage.clear();
    useDailyGameStore.getState().reset();
  });

  it("shows the three game modes", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: "COMENZAR A JUGAR" }));

    expect(screen.getByRole("button", { name: /MISIÓN CUÁNTICA/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /MODO EXPLORADOR/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /RUTA GUIADA/ })).toBeInTheDocument();
  });

  it("marks Explorer as recommended for new players", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: "COMENZAR A JUGAR" }));

    expect(screen.getByText("RECOMENDADO PARA COMENZAR")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /MODO EXPLORADOR/ })).toHaveClass("mode-card--recommended");
  });

  it("requires an explicit mode selection", async () => {
    const user = userEvent.setup();
    render(<App />);
    expect(useDailyGameStore.getState().gameMode).toBeNull();
    await user.click(screen.getByRole("button", { name: "COMENZAR A JUGAR" }));
    expect(screen.getByRole("button", { name: "Comenzar experiencia" })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: /MODO EXPLORADOR/ }));
    expect(screen.getByRole("button", { name: /MODO EXPLORADOR/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Comenzar experiencia" })).toBeEnabled();
  });

  it("renders one cockpit with the complete board and essential controls", () => {
    startMode("EXPLORER");
    const view = render(<App />);

    expect(document.querySelector(".game-shell--cockpit")).not.toBeNull();
    expect(document.querySelectorAll(".mission-cell")).toHaveLength(49);
    expect(screen.getByRole("heading", { name: "Explora una ruta hacia la salida" })).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: /Presión de decoherencia:/ })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Observaciones y alerta activa" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Seleccionar posibilidad" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Poder X" })).toBeInTheDocument();
    expect(document.querySelector(".mission-sticky-hud")).toBeNull();
    const telemetry = screen.getByText("Más telemetría").closest("details");
    const scrollRegion = screen.getByRole("region", { name: "Herramientas e información adicional" });
    expect(telemetry).not.toHaveAttribute("open");
    expect(scrollRegion).toHaveAttribute("tabindex", "0");
    expect(scrollRegion).toContainElement(telemetry);
    expect(document.documentElement).toHaveAttribute("data-gameplay-cockpit", "active");

    act(() => useDailyGameStore.getState().reset());
    expect(document.documentElement).not.toHaveAttribute("data-gameplay-cockpit");
    view.unmount();
    expect(document.documentElement).not.toHaveAttribute("data-gameplay-cockpit");
  });

  it("keeps observation pressure visible in the essential console", () => {
    startMode("QUANTUM_MISSION");
    const current = useDailyGameStore.getState().gameState;
    useDailyGameStore.setState({ gameState: { ...current, observations: 1 } });
    render(<App />);

    const resources = screen.getByRole("region", { name: "Observaciones y alerta activa" });
    expect(resources).toHaveAttribute("data-resource-alert");
    expect(resources).not.toHaveAttribute("data-resource-alert", "normal");
    expect(resources).toHaveTextContent("1");
  });

  it("uses a versioned guided solution tied to Universe #001", () => {
    expect(GUIDED_JOURNEY).toMatchObject({
      version: 1,
      universeNumber: 1,
      rulesVersion: 1,
      integrityReference: useDailyGameStore.getState().universe.commitment,
      actionTranscriptSha256: "a4f4739a8aa52bcd37e95af9943e03666064db2682af9cc97cb010809bf8f756",
    });
    expect(GUIDED_JOURNEY.steps).toHaveLength(23);
  });

  it("executes guided actions through F1 before advancing", () => {
    startMode("GUIDED");
    const before = useDailyGameStore.getState().gameState;
    act(executeFirstGuidedAction);
    const after = useDailyGameStore.getState();

    expect(after.gameState).not.toBe(before);
    expect(after.gameState.turn).toBe(1);
    expect(after.transcript).toEqual([GUIDED_JOURNEY.steps[0]?.action]);
    expect(after.guidedStep).toBe(1);
  });

  it("shows only the current guided action and not future results", async () => {
    startMode("GUIDED");
    render(<App />);

    expect(await screen.findByText(/RUTA GUIADA · PASO 1 DE 23/)).toBeInTheDocument();
    expect(screen.getByText(/Observar · fila 7, columna 2/)).toBeInTheDocument();
    expect(screen.queryByText(/fila 6, columna 1/)).not.toBeInTheDocument();
    expect(document.body).not.toHaveTextContent(/BATTERY|FLOOR|WALL|VOID/);
  });

  it("allows deviation from the guided solution", () => {
    startMode("GUIDED");
    act(() => {
      useDailyGameStore.getState().selectCell({ row: 5, col: 0 });
      useDailyGameStore.getState().observeSelected();
    });
    const state = useDailyGameStore.getState();

    expect(state.transcript).toHaveLength(1);
    expect(state.guidedStep).toBe(0);
    expect(state.guidedDeviation).toBe(true);
    expect(state.guidanceActive).toBe(false);
  });

  it("continues freely while guidance is closed", () => {
    startMode("GUIDED");
    act(() => {
      useDailyGameStore.getState().dismissGuidance();
      executeFirstGuidedAction();
    });

    expect(useDailyGameStore.getState().gameState.turn).toBe(1);
    expect(useDailyGameStore.getState().transcript).toHaveLength(1);
  });

  it("returns to the pending orientation", () => {
    startMode("GUIDED");
    act(() => {
      useDailyGameStore.getState().dismissGuidance();
      useDailyGameStore.getState().returnToGuidance();
    });

    expect(useDailyGameStore.getState().guidanceActive).toBe(true);
    expect(useDailyGameStore.getState().selectedCell).toEqual({ row: 6, col: 1 });
  });

  it("rewinds by rebuilding the universe from its transcript", () => {
    startMode("GUIDED");
    const original = JSON.stringify(useDailyGameStore.getState().gameState);
    act(executeFirstGuidedAction);
    act(() => useDailyGameStore.getState().rewindLastAction());
    const state = useDailyGameStore.getState();

    expect(JSON.stringify(state.gameState)).toBe(original);
    expect(state.transcript).toHaveLength(0);
    expect(state.rewindsRemaining).toBe(2);
    expect(state.feedback).toBe("El universo fue reconstruido desde su transcript verificable.");
  });

  it("limits guided rewind to three uses", () => {
    startMode("GUIDED");
    for (let index = 0; index < 3; index += 1) {
      act(executeFirstGuidedAction);
      act(() => useDailyGameStore.getState().rewindLastAction());
    }
    act(executeFirstGuidedAction);
    const afterAction = useDailyGameStore.getState().gameState;
    act(() => useDailyGameStore.getState().rewindLastAction());

    expect(useDailyGameStore.getState().rewindsRemaining).toBe(0);
    expect(useDailyGameStore.getState().rewindsUsed).toBe(3);
    expect(useDailyGameStore.getState().gameState).toBe(afterAction);
  });

  it("starts Explorer with five Pulses", () => {
    act(() => useDailyGameStore.getState().selectMode("EXPLORER"));
    expect(useDailyGameStore.getState().quantumPulses).toBe(5);
  });

  it("keeps a Pulse outside engine state and official score", () => {
    act(() => useDailyGameStore.getState().selectMode("EXPLORER"));
    const before = useDailyGameStore.getState().gameState;
    const score = calculateScore(before);
    act(() => useDailyGameStore.getState().activateQuantumPulse());

    expect(useDailyGameStore.getState().gameState).toBe(before);
    expect(calculateScore(useDailyGameStore.getState().gameState)).toBe(score);
    expect(useDailyGameStore.getState().quantumPulses).toBe(4);
  });

  it("ignores any non-public hidden-outcome decoration in Pulse recommendations", () => {
    const state = useDailyGameStore.getState().gameState;
    const decorated = {
      ...state,
      board: state.board.map((cell, index) => ({ ...cell, hiddenOutcome: index % 2 === 0 ? "WALL" : "BATTERY" })),
    } as GameState;

    expect(recommendPulseTarget(decorated)).toEqual(recommendPulseTarget(state));
  });

  it("classifies stable, tight and critical visible resource margins", () => {
    expect(deriveVisibleTacticalInfo(allFloorState(3)).marginLabel).toBe("ESTABLE");
    expect(deriveVisibleTacticalInfo(allFloorState(1)).marginLabel).toBe("AJUSTADO");
    expect(deriveVisibleTacticalInfo(allFloorState(0)).marginLabel).toBe("CRÍTICO");
  });

  it("recovers one Explorer Pulse on Coherence Burst without exceeding five", () => {
    startMode("EXPLORER");
    useDailyGameStore.setState({ quantumPulses: 4, flow: 2 });
    act(() => {
      useDailyGameStore.getState().selectCell({ row: 6, col: 1 });
      useDailyGameStore.getState().observeSelected();
    });

    expect(useDailyGameStore.getState().quantumPulses).toBe(5);
    expect(useDailyGameStore.getState().metrics.coherenceBursts).toBe(1);
  });

  it("renders the CANÓNICO result with official score", async () => {
    const current = useDailyGameStore.getState();
    useDailyGameStore.setState({ phase: "FINISHED", gameMode: "QUANTUM_MISSION", gameState: { ...current.gameState, status: "VICTORY" } });
    render(<App />);

    expect(screen.getByText("CANÓNICO")).toBeInTheDocument();
    expect(screen.getByText("Puntaje oficial")).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "Ver recorrido" }, { timeout: 5_000 })).toBeInTheDocument();
  });

  it("renders the ASISTIDO result without presenting it as competitive", () => {
    const current = useDailyGameStore.getState();
    useDailyGameStore.setState({ phase: "FINISHED", gameMode: "EXPLORER", metrics: { ...current.metrics, pulsesUsed: 2, coherenceBursts: 1 }, gameState: { ...current.gameState, status: "VICTORY" } });
    render(<App />);

    expect(screen.getByText("ASISTIDO")).toBeInTheDocument();
    expect(screen.getByText("Puntaje F1 · resultado no competitivo")).toBeInTheDocument();
    expect(screen.getByText("Coherence Bursts")).toBeInTheDocument();
  });

  it("renders the RUTA GUIADA result without competitive score", () => {
    const current = useDailyGameStore.getState();
    useDailyGameStore.setState({ phase: "FINISHED", gameMode: "GUIDED", guidedStep: 23, rewindsUsed: 1, gameState: { ...current.gameState, status: "VICTORY" } });
    render(<App />);

    expect(screen.getByText("RUTA GUIADA COMPLETADA")).toBeInTheDocument();
    expect(screen.queryByLabelText(/Puntaje final/)).not.toBeInTheDocument();
    expect(screen.getByText("Conceptos aprendidos")).toBeInTheDocument();
  });

  it("opens Descubre cómo funciona and launches both learning paths", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: "DESCUBRE CÓMO FUNCIONA" }));

    expect(await screen.findByRole("dialog", { name: "Convierte incertidumbre en una ruta" })).toBeInTheDocument();
    expect(screen.getByText("Elige una posibilidad")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Comenzar en Modo Explorador" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Iniciar Ruta Guiada" })).toBeInTheDocument();
  });

  it("loads advanced presentation modules without breaking the flow", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: "Procedencia cuántica" }));
    expect(await screen.findByRole("dialog", { name: "Cómo nació este universo" })).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Cómo nació este universo" })).not.toBeInTheDocument());
  });

  it("keeps canonical mission free of Pulses, rewind and guidance", () => {
    startMode("QUANTUM_MISSION");
    render(<App />);

    expect(useDailyGameStore.getState().quantumPulses).toBe(0);
    expect(screen.queryByLabelText("Pulso Cuántico")).not.toBeInTheDocument();
    expect(screen.queryByText("Rebobinar última acción")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Controles de Ruta Guiada")).not.toBeInTheDocument();
  });
});
