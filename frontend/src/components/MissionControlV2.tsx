import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useRef } from "react";
import { useDailyGameStore } from "../store/daily-game-store";
import { coordinateKey, coordinatesMatch, type GameMode } from "./mission-control";
import { playGameSound, unlockGameSound } from "./game-sound";
import { useDialogFocus } from "./use-dialog-focus";

const modeOptions: readonly {
  readonly mode: GameMode;
  readonly title: string;
  readonly badge: string;
  readonly description: string;
  readonly details: string;
}[] = [
  {
    mode: "QUANTUM_MISSION",
    title: "MISIÓN CUÁNTICA",
    badge: "DESAFÍO CANÓNICO",
    description: "El universo original, sin orientación de ruta. Cada decisión cuenta.",
    details: "10 observaciones · Score oficial · 0 Pulsos · sin rewind",
  },
  {
    mode: "EXPLORER",
    title: "MODO EXPLORADOR",
    badge: "RECOMENDADO PARA COMENZAR",
    description: "El mismo universo y las mismas reglas, con orientación opcional para ayudarte a planificar.",
    details: "13 observaciones · Score F1 · 5 Pulsos · datos visibles",
  },
  {
    mode: "GUIDED",
    title: "RUTA GUIADA",
    badge: "APRENDE JUGANDO",
    description: "Recorre una solución auditada del Universo #001 mientras descubres observación, recursos, decoherencia y replay.",
    details: "13 observaciones · paso a paso · 3 rewinds · sin score competitivo",
  },
];

export function ModeSelector() {
  const { gameMode, suggestedMode, selectMode } = useDailyGameStore();
  return <section aria-labelledby="mode-heading" className="mode-selector">
    <div><p className="eyebrow">Elige tu experiencia</p><h2 id="mode-heading">Tres formas de explorar el mismo universo</h2></div>
    <div className="mode-selector__grid">
      {modeOptions.map(({ mode, title, badge, description, details }) => <motion.button
        key={mode}
        aria-pressed={gameMode === mode}
        className={`mode-card ${gameMode === mode ? "mode-card--selected" : ""} ${mode === "EXPLORER" ? "mode-card--recommended" : ""}`}
        onClick={() => { unlockGameSound(); playGameSound("select"); selectMode(mode); }}
        type="button"
        whileTap={{ scale: 0.99 }}
      >
        <span className="mode-card__check" aria-hidden="true">{gameMode === mode ? "●" : "○"}</span>
        <small className="mode-card__badge">{badge}</small>
        {gameMode === null && suggestedMode === mode && <span className="mode-card__suggestion">Tu última elección</span>}
        <strong>{title}</strong><span>{description}</span><small>{details}</small>
      </motion.button>)}
    </div>
  </section>;
}

function ModeSelectionDialog() {
  const { panel, gameMode, closePanel, start } = useDailyGameStore();
  const dialogRef = useDialogFocus(closePanel, panel === "MODES");
  return <AnimatePresence>{panel === "MODES" && <motion.div className="mission-modal" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
    <motion.section ref={dialogRef} aria-labelledby="mode-dialog-title" aria-modal="true" className="mode-dialog" role="dialog" tabIndex={-1} initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 10 }}>
      <header><div><p className="eyebrow">Comenzar a jugar</p><h2 id="mode-dialog-title">¿Cómo quieres entrar al campo?</h2></div><button aria-label="Cerrar selección de modo" onClick={closePanel} type="button">×</button></header>
      <ModeSelector />
      <footer><p>{gameMode === null ? "Elige una opción para continuar." : "Tu elección puede cambiarse al terminar o desde la portada."}</p><button className="intro-primary" disabled={gameMode === null} onClick={() => { unlockGameSound(); playGameSound("cta"); start(); }} type="button">Comenzar experiencia <span aria-hidden="true">→</span></button></footer>
    </motion.section>
  </motion.div>}</AnimatePresence>;
}

export function QuantumPulseControl() {
  const { gameMode, quantumPulses, pulseTarget, activateQuantumPulse } = useDailyGameStore();
  if (gameMode !== "EXPLORER") return null;
  const enabled = quantumPulses > 0;
  return <section className={`quantum-pulse ${pulseTarget !== null ? "quantum-pulse--active" : ""}`} aria-label="Pulso Cuántico">
    <div className="quantum-pulse__copy"><span className="quantum-pulse__icon" aria-hidden="true">⌁</span><div><strong>Pulso Cuántico</strong><small>El Pulso sugiere, no revela.</small></div></div>
    <button disabled={!enabled} onClick={() => { unlockGameSound(); if (activateQuantumPulse()) playGameSound("pulse"); }} type="button"><span>{quantumPulses}/5</span><kbd>Q</kbd></button>
  </section>;
}

export function CoherenceMeter() {
  const { flow, coherenceBurstNonce } = useDailyGameStore();
  const label = flow < 2 ? "Señal detectada" : "Patrón estable";
  return <section className="coherence-meter" aria-label={`Coherencia ${flow} de 3`}>
    <div className="coherence-meter__header"><span>COHERENCIA {flow}/3</span><small>{label}</small></div>
    <div className="coherence-meter__track" aria-hidden="true">{[1, 2, 3].map((value) => <span key={value} className={flow >= value ? "is-active" : ""} />)}</div>
    <AnimatePresence>{coherenceBurstNonce > 0 && <motion.p key={coherenceBurstNonce} className="coherence-meter__burst" initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>Coherence Burst</motion.p>}</AnimatePresence>
  </section>;
}

export function KeyboardHelp() {
  return <details className="keyboard-help">
    <summary>Controles de teclado <span aria-hidden="true">⌨</span></summary>
    <div><span><kbd>↑↓←→</kbd><kbd>WASD</kbd> Cursor</span><span><kbd>Espacio</kbd> Seleccionar / actuar</span><span><kbd>Enter</kbd> Acción</span><span><kbd>X</kbd><kbd>H</kbd> Poderes</span><span><kbd>Q</kbd> Pulso en Explorador</span><span><kbd>M</kbd> Sonido</span><span><kbd>R</kbd> Reiniciar</span><span><kbd>?</kbd> Ayuda</span></div>
  </details>;
}

function RestartDialog() {
  const { panel, closePanel, retry } = useDailyGameStore();
  const dialogRef = useDialogFocus(closePanel, panel === "RESTART");
  return <AnimatePresence>{panel === "RESTART" && <motion.div className="mission-modal" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
    <motion.section ref={dialogRef} aria-labelledby="restart-title" aria-modal="true" className="restart-dialog" role="alertdialog" tabIndex={-1} initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}>
      <span aria-hidden="true">↻</span><h2 id="restart-title">¿Reiniciar esta misión?</h2><p>Volverás al inicio del mismo universo y conservarás el modo elegido.</p><div><button onClick={closePanel} type="button">Cancelar</button><button onClick={retry} type="button">Reiniciar misión</button></div>
    </motion.section>
  </motion.div>}</AnimatePresence>;
}

export function MissionControlOverlays() {
  return <><ModeSelectionDialog /><RestartDialog /></>;
}

function interactiveTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.closest("input, textarea, select, [contenteditable='true']")) return true;
  return target.closest("button, a, summary") !== null && !target.classList.contains("mission-cell");
}

export function KeyboardController() {
  const panel = useDailyGameStore((state) => state.panel);
  const phase = useDailyGameStore((state) => state.phase);
  const pulseNonce = useDailyGameStore((state) => state.pulseNonce);
  const burstNonce = useDailyGameStore((state) => state.coherenceBurstNonce);
  const previousPulse = useRef(pulseNonce);
  const previousBurst = useRef(burstNonce);
  const previousPanel = useRef(panel);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const store = useDailyGameStore.getState();
      const key = event.key.toLowerCase();
      const gameplayKeys = new Set(["arrowup", "arrowdown", "arrowleft", "arrowright", "w", "a", "s", "d", " ", "enter", "x", "h", "q", "m", "r", "?"]);
      if (event.repeat) {
        if (gameplayKeys.has(key)) event.preventDefault();
        return;
      }
      if (event.key === "Escape") {
        if (store.panel !== null) { event.preventDefault(); store.closePanel(); }
        return;
      }
      if (store.panel !== null || store.phase !== "PLAYING" || interactiveTarget(event.target)) return;
      const directions: Record<string, "UP" | "DOWN" | "LEFT" | "RIGHT"> = { arrowup: "UP", w: "UP", arrowdown: "DOWN", s: "DOWN", arrowleft: "LEFT", a: "LEFT", arrowright: "RIGHT", d: "RIGHT" };
      if (directions[key] !== undefined) {
        event.preventDefault();
        unlockGameSound();
        playGameSound("focus");
        store.moveKeyboardCursor(directions[key]);
        window.requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-testid="cell-${coordinateKey(useDailyGameStore.getState().keyboardCursor)}"]`)?.focus({ preventScroll: true }));
        return;
      }
      if (event.key === " ") {
        event.preventDefault();
        unlockGameSound();
        const current = useDailyGameStore.getState();
        if (current.selectedCell === null || !coordinatesMatch(current.selectedCell, current.keyboardCursor)) playGameSound("select");
        current.handleKeyboardSpace();
      } else if (event.key === "Enter") {
        event.preventDefault();
        unlockGameSound();
        store.executeCursorPrimary();
      } else if (key === "x" || key === "h") {
        event.preventDefault();
        unlockGameSound();
        store.selectCell(store.keyboardCursor);
        const current = useDailyGameStore.getState();
        const availability = current.getActionAvailability();
        const available = key === "x" ? availability.powerX : availability.powerH;
        if (available) playGameSound(key === "x" ? "powerX" : "powerH");
        current.applyGateToSelected(key.toUpperCase() as "X" | "H");
      } else if (key === "q") {
        event.preventDefault();
        unlockGameSound();
        if (store.gameMode === "EXPLORER" && store.quantumPulses > 0 && store.activateQuantumPulse()) playGameSound("pulse");
      } else if (key === "m") {
        event.preventDefault();
        unlockGameSound();
        store.toggleSound();
      } else if (key === "r") {
        event.preventDefault();
        store.openPanel("RESTART");
      } else if (event.key === "?") {
        event.preventDefault();
        store.openPanel("HELP");
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [panel, phase]);

  useEffect(() => {
    const lastPanel = previousPanel.current;
    previousPanel.current = panel;
    if (lastPanel === null || panel !== null || phase !== "PLAYING") return;
    window.requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-testid="cell-${coordinateKey(useDailyGameStore.getState().keyboardCursor)}"]`)?.focus({ preventScroll: true }));
  }, [panel, phase]);

  useEffect(() => {
    if (pulseNonce === previousPulse.current) return;
    previousPulse.current = pulseNonce;
    if (typeof navigator.vibrate === "function") navigator.vibrate(30);
  }, [pulseNonce]);

  useEffect(() => {
    if (burstNonce === previousBurst.current) return;
    previousBurst.current = burstNonce;
    playGameSound("crystal");
    if (typeof navigator.vibrate === "function") navigator.vibrate([35, 25, 60]);
  }, [burstNonce]);
  return null;
}
