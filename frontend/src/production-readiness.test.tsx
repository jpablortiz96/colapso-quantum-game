import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { AppErrorBoundary } from "./components/AppErrorBoundary";
import { LazyModuleBoundary } from "./components/LazyModuleBoundary";
import { ProductionRuntime } from "./components/ProductionRuntime";
import {
  LEGACY_TUTORIAL_PREFERENCE_KEY,
  parseProductionPreferences,
  PRODUCTION_PREFERENCES_KEY,
  PRODUCTION_PREFERENCES_VERSION,
  readProductionPreferences,
  resetProductionPreferences,
  writeProductionPreferences,
} from "./production/preferences";
import { useDailyGameStore } from "./store/daily-game-store";

const repositoryRoot = path.resolve(process.cwd(), "..");

interface MemoryStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  has(key: string): boolean;
}

function memoryStorage(seed: Record<string, string> = {}): MemoryStorage {
  const values = new Map(Object.entries(seed));
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => { values.delete(key); },
    has: (key) => values.has(key),
  };
}

function BrokenPresentation(): never {
  throw new Error("synthetic production failure");
}

function readProject(relativePath: string): string {
  return readFileSync(path.join(repositoryRoot, relativePath), "utf8");
}

describe("COLAPSO F5 production readiness", () => {
  beforeEach(() => {
    window.localStorage.clear();
    useDailyGameStore.getState().resetPreferences();
    useDailyGameStore.getState().reset();
    Object.defineProperty(window.navigator, "onLine", { configurable: true, value: true });
    Object.defineProperty(window, "matchMedia", { configurable: true, value: undefined });
  });

  afterEach(() => {
    cleanup();
    window.localStorage.clear();
    document.body.replaceChildren();
    delete document.documentElement.dataset.pageHidden;
    delete document.documentElement.dataset.reducedMotion;
    delete document.documentElement.dataset.performanceProfile;
    delete document.documentElement.dataset.gameplayCockpit;
    vi.restoreAllMocks();
  });

  it("declares essential Spanish metadata and a configurable canonical", () => {
    const html = readProject("frontend/index.html");
    expect(html).toContain("<title>COLAPSO — Un universo cuántico jugable</title>");
    expect(html).toContain("Explora un universo generado a partir de evidencia de hardware cuántico real.");
    expect(html).toContain('name="theme-color"');
    expect(html).toContain('property="og:title"');
    expect(html).toContain('name="twitter:card"');
    expect(html).toContain('rel="canonical" href="%COLAPSO_PUBLIC_URL%"');
  });

  it("renders the production Error Boundary instead of a blank screen", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    render(<AppErrorBoundary><BrokenPresentation /></AppErrorBoundary>);
    expect(screen.getByRole("heading", { name: "El universo encontró una interferencia inesperada." })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reintentar" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Volver al inicio" })).toBeInTheDocument();
  });

  it("recovers after retry when the failing condition is removed", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    let failing = true;
    function Recoverable() {
      if (failing) throw new Error("recoverable");
      return <p>Experiencia recuperada</p>;
    }
    const user = userEvent.setup();
    render(<AppErrorBoundary onRetry={() => { failing = false; }}><Recoverable /></AppErrorBoundary>);
    await user.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(screen.getByText("Experiencia recuperada")).toBeInTheDocument();
  });

  it("serializes only validated versioned presentation preferences", () => {
    const storage = memoryStorage();
    const preferences = writeProductionPreferences({
      mute: true,
      reducedMotion: true,
      tutorialCompleted: true,
      lastMode: "EXPLORER",
      audioConsent: true,
    }, storage);
    const persisted = storage.getItem(PRODUCTION_PREFERENCES_KEY);
    expect(preferences.version).toBe(PRODUCTION_PREFERENCES_VERSION);
    expect(persisted).not.toBeNull();
    expect(parseProductionPreferences(persisted ?? "")).toEqual(preferences);
  });

  it("recovers from corrupt preference JSON", () => {
    const storage = memoryStorage({ [PRODUCTION_PREFERENCES_KEY]: "{corrupt" });
    expect(readProductionPreferences(storage)).toMatchObject({ mute: false, tutorialCompleted: false, lastMode: null });
    expect(storage.has(PRODUCTION_PREFERENCES_KEY)).toBe(false);
  });

  it("resets current and obsolete preference keys", () => {
    const storage = memoryStorage({
      [PRODUCTION_PREFERENCES_KEY]: JSON.stringify({ version: 1 }),
      [LEGACY_TUTORIAL_PREFERENCE_KEY]: "true",
    });
    resetProductionPreferences(storage);
    expect(storage.has(PRODUCTION_PREFERENCES_KEY)).toBe(false);
    expect(storage.has(LEGACY_TUTORIAL_PREFERENCE_KEY)).toBe(false);
  });

  it("never persists F1 state, score, transcript, or hidden results", () => {
    useDailyGameStore.getState().selectMode("QUANTUM_MISSION");
    const persisted = window.localStorage.getItem(PRODUCTION_PREFERENCES_KEY) ?? "";
    expect(Object.keys(JSON.parse(persisted) as Record<string, unknown>).sort()).toEqual([
      "audioConsent", "lastMode", "mute", "reducedMotion", "tutorialCompleted", "version",
    ]);
    expect(persisted).not.toMatch(/gameState|score|transcript|board|resolutionPlan|commitment/iu);
  });

  it("ships the critical hero asset within its size budget", () => {
    const hero = path.join(repositoryRoot, "frontend/public/assets/colapso/backgrounds/hero_quantum_bg.webp");
    expect(statSync(hero).size).toBeGreaterThan(0);
    expect(statSync(hero).size).toBeLessThan(900 * 1024);
  });

  it("ships a valid manifest with real 192 and 512 icons", () => {
    const manifest = JSON.parse(readProject("frontend/public/manifest.webmanifest")) as { icons: { sizes: string; src: string }[]; lang: string };
    expect(manifest.lang).toBe("es");
    expect(manifest.icons.map((icon) => icon.sizes)).toEqual(["192x192", "512x512"]);
    for (const icon of manifest.icons) expect(statSync(path.join(repositoryRoot, "frontend/public", icon.src)).size).toBeGreaterThan(0);
  });

  it("offers a recoverable fallback when a lazy module fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const retry = vi.fn();
    const user = userEvent.setup();
    render(<LazyModuleBoundary label="El módulo no pudo cargarse." onRetry={retry}><BrokenPresentation /></LazyModuleBoundary>);
    expect(screen.getByRole("alert")).toHaveTextContent("El módulo no pudo cargarse.");
    await user.click(screen.getByRole("button", { name: "Reintentar carga" }));
    expect(retry).toHaveBeenCalledOnce();
  });

  it("traps keyboard focus inside an open modal", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: "COMENZAR A JUGAR" }));
    await user.click(screen.getByRole("button", { name: /MODO EXPLORADOR/ }));
    const last = screen.getByRole("button", { name: "Comenzar experiencia" });
    const first = screen.getByRole("button", { name: "Cerrar selección de modo" });
    last.focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(first).toHaveFocus();
  });

  it("restores focus to the control that opened a modal", async () => {
    const user = userEvent.setup();
    render(<App />);
    const trigger = screen.getByRole("button", { name: "COMENZAR A JUGAR" });
    await user.click(trigger);
    await user.click(screen.getByRole("button", { name: "Cerrar selección de modo" }));
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it("announces offline status once through a polite live region", () => {
    Object.defineProperty(window.navigator, "onLine", { configurable: true, value: false });
    render(<ProductionRuntime />);
    const status = screen.getByRole("status", { name: "Estado de la experiencia" });
    expect(status).toHaveAttribute("aria-live", "polite");
    expect(status).toHaveTextContent("Sin conexión.");
    expect(screen.getAllByRole("status", { name: "Estado de la experiencia" })).toHaveLength(1);
  });

  it("honors the operating-system reduced-motion preference", () => {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn(() => ({
        matches: true,
        media: "(prefers-reduced-motion: reduce)",
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
    render(<ProductionRuntime />);
    expect(document.documentElement).toHaveAttribute("data-reduced-motion", "reduce");
  });

  it("keeps the shell available across the required mobile and desktop viewports", () => {
    for (const [width, height] of [[320, 568], [390, 844], [768, 1024], [1366, 768], [1920, 1080]]) {
      Object.defineProperty(window, "innerWidth", { configurable: true, value: width });
      Object.defineProperty(window, "innerHeight", { configurable: true, value: height });
      const view = render(<App />);
      expect(screen.getByRole("button", { name: "COMENZAR A JUGAR" })).toBeInTheDocument();
      view.unmount();
    }
    const css = readProject("frontend/src/index.css");
    expect(css).toContain("min-width: 0");
    expect(css).toContain("overflow-y: auto");
  });

  it("declares desktop cockpit, short-screen, tablet and mobile layout contracts", () => {
    const css = readProject("frontend/src/index.css");
    expect(css).toContain('@media (min-width: 1100px) and (min-height: 680px)');
    expect(css).toContain('html[data-gameplay-cockpit="active"]');
    expect(css).toContain('grid-template-columns: minmax(0, 1fr) clamp(280px, 23vw, 360px)');
    expect(css).toContain('@media (min-width: 1100px) and (min-height: 600px) and (max-height: 679px)');
    expect(css).toContain('@media (max-width: 1099px)');
    expect(css).toContain('@media (max-width: 639px)');
    expect(css).toContain('aspect-ratio: 1');
    expect(css).toContain('max-height: none');
    expect(css).toContain('overflow: visible');
  });

  it("contains no localhost reference in production browser surfaces", () => {
    const source = [
      "frontend/src/App.tsx",
      "frontend/src/components/DailyGame.tsx",
      "frontend/src/components/ProductionRuntime.tsx",
      "frontend/src/production/preferences.ts",
    ].map(readProject).join("\n");
    expect(source).not.toMatch(/localhost|127\.0\.0\.1/iu);
  });

  it("contains no credential pattern or unsafe HTML in production browser surfaces", () => {
    const source = [
      "frontend/src/App.tsx",
      "frontend/src/components/DailyGame.tsx",
      "frontend/src/components/ProductionRuntime.tsx",
      "frontend/src/production/preferences.ts",
    ].map(readProject).join("\n");
    expect(source).not.toMatch(/dangerouslySetInnerHTML|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/u);
  });

  it("passes the reproducible production source verifier", () => {
    const output = execFileSync(process.execPath, [path.join(repositoryRoot, "scripts/verify-production.mjs"), "--source-only"], {
      cwd: repositoryRoot,
      encoding: "utf8",
    });
    expect(output).toContain("PRODUCTION VERIFICATION: PASS");
  });
});
