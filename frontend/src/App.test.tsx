import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import {
  PRODUCTION_PREFERENCES_KEY,
  TUTORIAL_PREFERENCE_KEY,
  useDailyGameStore,
} from "./store/daily-game-store";

let scrollIntoView = vi.fn();

function activeTourPopover(): HTMLElement {
  const popover = document.querySelector<HTMLElement>(".colapso-tour-popover");
  expect(popover).not.toBeNull();
  return popover as HTMLElement;
}

async function startCanonicalExperience(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "COMENZAR A JUGAR" }));
  await user.click(screen.getByRole("button", { name: /MISIÓN CUÁNTICA/ }));
  await user.click(screen.getByRole("button", { name: "Comenzar experiencia" }));
}

async function startTour(user: ReturnType<typeof userEvent.setup>) {
  await startCanonicalExperience(user);
  await waitFor(() => expect(document.querySelector(".colapso-tour-popover")).not.toBeNull());
}

async function advanceTour(user: ReturnType<typeof userEvent.setup>, times: number) {
  for (let index = 0; index < times; index += 1) {
    await user.click(within(activeTourPopover()).getByRole("button", { name: "Siguiente" }));
    await waitFor(() => expect(screen.getByText(`Tutorial paso ${index + 2} de 8`)).toBeInTheDocument());
  }
}

describe("premium first-time player onboarding", () => {
  beforeEach(() => {
    scrollIntoView = vi.fn();
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: scrollIntoView,
    });
    window.localStorage.clear();
    useDailyGameStore.getState().reset();
    useDailyGameStore.setState({ soundEnabled: true });
  });

  afterEach(() => {
    cleanup();
    document.body.replaceChildren();
    window.localStorage.clear();
  });

  it("explains the mission before the first game", () => {
    render(<App />);

    expect(screen.getByRole("heading", { name: "Observa antes de que el universo decida por ti." })).toBeInTheDocument();
    expect(screen.getByText("Tu misión es llevar al Observador desde la esquina inferior izquierda hasta la salida dorada.")).toBeInTheDocument();
    expect(screen.getByText("1. Observa")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "COMENZAR A JUGAR" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "DESCUBRE CÓMO FUNCIONA" })).toBeInTheDocument();
  });

  it("opens the Driver.js tour and scrolls the first focused target into view", async () => {
    const user = userEvent.setup();
    render(<App />);

    await startTour(user);

    expect(activeTourPopover()).toHaveClass("driver-popover");
    expect(screen.getByText("Tutorial paso 1 de 8")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Tú, el Observador.*Objetivo del tutorial/ })).toHaveClass("tour-target-active");
    expect(scrollIntoView).toHaveBeenCalledWith(expect.objectContaining({ block: "center" }));
  });

  it("guides the player from observer to exit and an observation possibility", async () => {
    const user = userEvent.setup();
    render(<App />);

    await startTour(user);
    await advanceTour(user, 2);

    expect(screen.getByText("Tutorial paso 3 de 8")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Casilla sin observar.*Objetivo del tutorial/ })).toHaveClass("mission-cell--tutorial");
    expect(screen.getByRole("button", { name: "Observar casilla" })).toBeInTheDocument();
  });

  it("keeps the tour popup available and its target visible on a mobile viewport", async () => {
    const user = userEvent.setup();
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 375 });
    render(<App />);

    await startTour(user);

    expect(activeTourPopover()).toHaveClass("colapso-tour-popover");
    expect(screen.getByTestId("cell-6-0")).toHaveClass("tour-target-active");
    expect(scrollIntoView).toHaveBeenCalled();
  });

  it("allows a player to skip the tour and stores only its completion preference", async () => {
    const user = userEvent.setup();
    render(<App />);

    await startTour(user);
    await user.click(within(activeTourPopover()).getByRole("button", { name: "Saltar tutorial" }));

    await waitFor(() => expect(document.querySelector(".colapso-tour-popover")).toBeNull());
    expect(window.localStorage.getItem(TUTORIAL_PREFERENCE_KEY)).toBeNull();
    expect(JSON.parse(window.localStorage.getItem(PRODUCTION_PREFERENCES_KEY) ?? "{}")).toMatchObject({
      version: 1,
      tutorialCompleted: true,
    });
  });

  it("does not force the tour after its completion preference is set", async () => {
    const user = userEvent.setup();
    window.localStorage.setItem(TUTORIAL_PREFERENCE_KEY, "true");
    render(<App />);

    await startCanonicalExperience(user);

    expect(document.querySelector(".colapso-tour-popover")).toBeNull();
    expect(screen.getByRole("heading", { name: "Decide tu siguiente paso" })).toBeInTheDocument();
  });

  it("repeats the tour from the player help panel", async () => {
    const user = userEvent.setup();
    window.localStorage.setItem(TUTORIAL_PREFERENCE_KEY, "true");
    render(<App />);

    await startCanonicalExperience(user);
    await user.click(screen.getByRole("button", { name: "Cómo jugar" }));
    await user.click(screen.getByRole("button", { name: "Repetir tutorial" }));

    await waitFor(() => expect(document.querySelector(".colapso-tour-popover")).not.toBeNull());
    expect(screen.getByText("Tutorial paso 1 de 8")).toBeInTheDocument();
  });

  it("shows one contextual primary action instead of competing controls", async () => {
    const user = userEvent.setup();
    window.localStorage.setItem(TUTORIAL_PREFERENCE_KEY, "true");
    render(<App />);

    await startCanonicalExperience(user);
    expect(screen.queryByRole("button", { name: "Observar casilla" })).not.toBeInTheDocument();
    await user.click(screen.getByTestId("cell-6-1"));

    expect(screen.getByRole("button", { name: "Observar casilla" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Acción rápida: Observar" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Mover aquí" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Acción rápida: Mover aquí" })).not.toBeInTheDocument();
    expect(screen.getByText("Pulsa Espacio otra vez para observar.")).toBeInTheDocument();
  });

  it("renders readable probability bars for a selected possibility", async () => {
    const user = userEvent.setup();
    window.localStorage.setItem(TUTORIAL_PREFERENCE_KEY, "true");
    render(<App />);

    await startCanonicalExperience(user);
    await user.click(screen.getByTestId("cell-6-1"));

    expect(screen.getByRole("heading", { name: "Posibilidades de esta casilla" })).toBeInTheDocument();
    expect(screen.getByLabelText(/Camino: \d+%/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Muro: \d+%/)).toBeInTheDocument();
    expect(screen.getByText(/Una probabilidad alta mejora tus posibilidades/)).toBeInTheDocument();
  });

  it("uses friendly feedback without raw implementation strings", async () => {
    const user = userEvent.setup();
    window.localStorage.setItem(TUTORIAL_PREFERENCE_KEY, "true");
    render(<App />);

    await startCanonicalExperience(user);
    await user.click(screen.getByTestId("cell-6-1"));
    await user.click(screen.getByRole("button", { name: "Observar casilla" }));

    expect(screen.getByText("Usaste una observación.")).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent(/PLAYING|OBSERVATION_SPENT|CELL_COLLAPSED|TARGET_UNRESOLVED/);
  });

  it("keeps F1 as the authority for a guided observation", async () => {
    const user = userEvent.setup();
    render(<App />);

    await startTour(user);
    await advanceTour(user, 3);
    const before = useDailyGameStore.getState().gameState;
    await user.click(screen.getByRole("button", { name: "Observar casilla" }));
    const after = useDailyGameStore.getState().gameState;

    expect(after).not.toBe(before);
    expect(after.turn).toBe(1);
    expect(after.board.some((cell) => cell.kind === "COLLAPSED" && cell.coordinate.row !== 6)).toBe(true);
  });

  it("persists sound only as an allowed versioned preference", async () => {
    const user = userEvent.setup();
    render(<App />);

    await startTour(user);
    await user.click(within(activeTourPopover()).getByRole("button", { name: "Saltar tutorial" }));
    await user.click(screen.getByRole("button", { name: "Silenciar sonidos" }));

    expect(screen.getByRole("button", { name: "Activar sonidos" })).toHaveAttribute("aria-pressed", "true");
    expect(window.localStorage.getItem("colapso:sound-enabled")).toBeNull();
    expect(JSON.parse(window.localStorage.getItem(PRODUCTION_PREFERENCES_KEY) ?? "{}")).toMatchObject({
      version: 1,
      mute: true,
      audioConsent: true,
    });
  });

  it("keeps help as scannable cards and preserves scientific provenance copy", async () => {
    const user = userEvent.setup();
    window.localStorage.setItem(TUTORIAL_PREFERENCE_KEY, "true");
    render(<App />);

    await startCanonicalExperience(user);
    await user.click(screen.getByRole("button", { name: "Cómo jugar" }));
    expect(screen.getByText("Tipos de casilla")).toBeInTheDocument();
    expect(screen.getByText("Consejo rápido")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Procedencia cuántica" }));
    expect(await screen.findByText(/No existe una afirmación anti-trampa/i)).toBeInTheDocument();
  });

  it("renders the local quantum assets across the hero, board, selection, and powers", async () => {
    const user = userEvent.setup();
    window.localStorage.setItem(TUTORIAL_PREFERENCE_KEY, "true");
    render(<App />);

    expect(screen.getByRole("img", { name: "COLAPSO" })).toHaveAttribute("src", "/assets/colapso/logo_colapso.webp");
    await startCanonicalExperience(user);

    expect(screen.getByTestId("cell-6-0").querySelector('img[src="/assets/colapso/player_observer.webp"]')).not.toBeNull();
    expect(screen.getByTestId("cell-0-6").querySelector('img[src="/assets/colapso/tile_exit.webp"]')).not.toBeNull();
    await user.click(screen.getByTestId("cell-6-1"));
    expect(screen.getByTestId("cell-6-1").querySelector('img[src="/assets/colapso/fx_selection_glow.webp"]')).not.toBeNull();
    await user.click(screen.getByText("Poderes cuánticos"));
    expect(screen.getByRole("button", { name: "Poder X" }).querySelector('img[src="/assets/colapso/power_x.webp"]')).not.toBeNull();
    expect(screen.getByRole("button", { name: "Poder H" }).querySelector('img[src="/assets/colapso/power_h.webp"]')).not.toBeNull();
  });

  it("renders the premium hero and memorable finished state without changing gameplay data", () => {
    const intro = render(<App />);

    expect(screen.getByText("Real quantum universe")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "COMENZAR A JUGAR" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "DESCUBRE CÓMO FUNCIONA" })).toBeInTheDocument();

    intro.unmount();
    const current = useDailyGameStore.getState();
    useDailyGameStore.setState({
      phase: "FINISHED",
      gameMode: "QUANTUM_MISSION",
      gameState: { ...current.gameState, status: "VICTORY" },
    });
    render(<App />);

    expect(screen.getByRole("heading", { name: "Llegaste a la salida" })).toBeInTheDocument();
    expect(screen.getByText("Resultado · universo estabilizado")).toBeInTheDocument();
    expect(screen.getByLabelText(/Puntaje final/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Volver a intentar" })).toBeInTheDocument();
  });

  it("keeps invalid movement in player language", async () => {
    const user = userEvent.setup();
    window.localStorage.setItem(TUTORIAL_PREFERENCE_KEY, "true");
    render(<App />);

    await startCanonicalExperience(user);
    await user.click(screen.getByTestId("cell-6-1"));
    act(() => useDailyGameStore.getState().moveSelected());

    expect(screen.getAllByText("Primero necesitas observar esta casilla.")).toHaveLength(1);
    expect(screen.queryByText("TARGET_UNRESOLVED")).not.toBeInTheDocument();
  });
});
