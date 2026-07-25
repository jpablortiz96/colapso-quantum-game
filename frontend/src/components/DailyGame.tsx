import {
  AnimatePresence,
  animate,
  motion,
  useMotionValue,
  useMotionValueEvent,
  useReducedMotion,
} from "framer-motion";
import { lazy, Suspense, useEffect, useRef, useState, type CSSProperties } from "react";
import { calculateScore, type GameState } from "../engine";
import { useDailyGameStore } from "../store/daily-game-store";
import { colapsoAssets } from "./colapso-assets";
import {
  CoherenceMeter,
  KeyboardController,
  KeyboardHelp,
  MissionControlOverlays,
  QuantumPulseControl,
} from "./MissionControlV2";
import { GUIDED_JOURNEY } from "./guided-journey";
import {
  decoherencePressureCue,
  deriveConsoleStatus,
  deriveDecoherencePressure,
  deriveObservationAlert,
  deriveVisibleTacticalInfo,
  observationAlertCue,
  type DecoherencePressureLevel,
  type GameMode,
} from "./mission-control";
import { PremiumTour } from "./PremiumTour";
import { LazyModuleBoundary } from "./LazyModuleBoundary";
import {
  playGameSound,
  setGameSoundMuted,
  unlockGameSound,
} from "./game-sound";

const LazyProvenanceModal = lazy(() => import("./ProvenanceModal").then((module) => ({ default: module.ProvenanceModal })));
const LazyFinalRouteMap = lazy(() => import("./FinalRouteMap").then((module) => ({ default: module.FinalRouteMap })));
const LazyOnboardingPresentation = lazy(() => import("./OnboardingPresentation").then((module) => ({ default: module.OnboardingPresentation })));
const LazyGuidedJourneyControls = lazy(() => import("./GuidedJourneyControls").then((module) => ({ default: module.GuidedJourneyControls })));

function LazyFallback({ label }: { readonly label: string }) {
  return <p className="lazy-fallback" role="status">{label}</p>;
}

type Coordinate = GameState["player"];
type BoardCell = GameState["board"][number];
type CellOutcome = "FLOOR" | "WALL" | "VOID" | "CRYSTAL" | "BATTERY";

const outcomeSymbols: Record<CellOutcome, string> = {
  FLOOR: "·",
  WALL: "▦",
  VOID: "◌",
  CRYSTAL: "✦",
  BATTERY: "+",
};

const outcomeNames: Record<CellOutcome, string> = {
  FLOOR: "Camino",
  WALL: "Muro",
  VOID: "Vacío",
  CRYSTAL: "Cristal",
  BATTERY: "Batería",
};

const distributionOutcomes: readonly CellOutcome[] = ["FLOOR", "WALL", "VOID", "CRYSTAL", "BATTERY"];

function sameCoordinate(first: Coordinate, second: Coordinate): boolean {
  return first.row === second.row && first.col === second.col;
}

function coordinateKey(coordinate: Coordinate): string {
  return `${coordinate.row}-${coordinate.col}`;
}

function isExit(coordinate: Coordinate): boolean {
  return coordinate.row === 0 && coordinate.col === 6;
}

function cellLabel(cell: BoardCell): string {
  return cell.kind === "UNRESOLVED" ? "sin observar" : outcomeNames[cell.outcome];
}

function cellSymbol(cell: BoardCell): string {
  return cell.kind === "UNRESOLVED" ? "?" : outcomeSymbols[cell.outcome];
}

function cellAsset(cell: BoardCell, playerHere: boolean, exitHere: boolean): { readonly src: string | null; readonly kind: string } {
  if (playerHere) return { src: null, kind: "observer" };
  if (exitHere) return { src: null, kind: "exit" };
  if (cell.kind === "UNRESOLVED") return { src: null, kind: "unresolved" };
  return { src: colapsoAssets.tiles[cell.outcome], kind: cell.outcome.toLowerCase() };
}

function pairForCell(state: GameState, coordinate: Coordinate) {
  return state.pairs.find(
    (pair) => sameCoordinate(pair.memberA, coordinate) || sameCoordinate(pair.memberB, coordinate),
  );
}

function probability(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function probabilityOfFloor(cell: BoardCell): string | null {
  return cell.kind === "UNRESOLVED" ? probability(cell.distribution[0] ?? 0) : null;
}

function selectedCell(state: GameState, coordinate: Coordinate | null): BoardCell | null {
  if (coordinate === null) return null;
  return state.board.find((cell) => sameCoordinate(cell.coordinate, coordinate)) ?? null;
}

function decoherenceLabel(turn: number): string {
  const remaining = 4 - (turn % 4);
  return `Decoherencia en ${remaining} ${remaining === 1 ? "turno" : "turnos"}`;
}

function outcomeClass(cell: BoardCell): string {
  return cell.kind === "UNRESOLVED" ? "unresolved" : cell.outcome.toLowerCase();
}

function unlockFromKeyboard(key: string): void {
  if (key === "Enter" || key === " ") unlockGameSound();
}

function MissionSoundEffects() {
  const { gameState, messages, soundEnabled } = useDailyGameStore();
  const previousMessages = useRef("");
  const previousStatus = useRef(gameState.status);
  const previousPressureLevel = useRef<DecoherencePressureLevel | null>(null);
  const previousObservations = useRef(gameState.observations);
  const decoherencePulsing = messages.some((message) => message.toLowerCase().includes("universo colapsó"));

  useEffect(() => {
    const syncSound = () => setGameSoundMuted(!soundEnabled || document.hidden);
    syncSound();
    document.addEventListener("visibilitychange", syncSound);
    return () => {
      document.removeEventListener("visibilitychange", syncSound);
      setGameSoundMuted(!soundEnabled);
    };
  }, [soundEnabled]);

  useEffect(() => {
    const messageKey = messages.join("|");
    if (!soundEnabled || messageKey === previousMessages.current) {
      previousMessages.current = messageKey;
      return;
    }
    previousMessages.current = messageKey;
    const normalized = messageKey.toLowerCase();

    if (messageKey.includes("Usaste una observación.")) playGameSound("observe");
    if (messageKey.includes("La casilla se definió.")) playGameSound("collapse");
    if (normalized.includes("es un camino")) playGameSound("path");
    else if (normalized.includes("es un muro")) playGameSound("wall");
    else if (normalized.includes("es vacío")) playGameSound("void");
    else if (normalized.includes("es un cristal") || normalized.includes("recogiste un cristal")) playGameSound("crystal");
    else if (normalized.includes("es una batería") || normalized.includes("recuperaste una observación")) playGameSound("battery");
    else if (normalized.includes("ahora puedes avanzar")) playGameSound("move");
  }, [messages, soundEnabled]);

  useEffect(() => {
    const pressure = deriveDecoherencePressure(gameState.turn, decoherencePulsing);
    const cue = decoherencePressureCue(previousPressureLevel.current, pressure);
    previousPressureLevel.current = pressure.level;
    if (!soundEnabled || gameState.status !== "PLAYING" || cue === null) return;

    if (cue === "tick") playGameSound("tensionTick");
    if (cue === "high") playGameSound("tensionHigh");
    if (cue === "peak") playGameSound("tensionPeak");
    if (cue === "pulse") playGameSound("decoherencePulse");
  }, [decoherencePulsing, gameState.status, gameState.turn, soundEnabled]);

  useEffect(() => {
    const previous = previousObservations.current;
    previousObservations.current = gameState.observations;
    if (!soundEnabled || gameState.status !== "PLAYING") return;
    const cue = observationAlertCue(previous, gameState.observations);
    if (cue !== null) playGameSound(cue);
  }, [gameState.observations, gameState.status, soundEnabled]);

  useEffect(() => {
    if (!soundEnabled || previousStatus.current === gameState.status) {
      previousStatus.current = gameState.status;
      return;
    }
    previousStatus.current = gameState.status;
    if (gameState.status === "VICTORY") playGameSound("victory");
    if (gameState.status === "DEFEAT") playGameSound("defeat");
  }, [gameState.status, soundEnabled]);

  return null;
}

function QuantumFeedbackEffects() {
  const { gameState, messages } = useDailyGameStore();
  const reducedMotion = useReducedMotion() ?? false;
  const decoherencePulseKey = messages.some((message) => message.toLowerCase().includes("universo colapsó"))
    ? `decoherence-${gameState.turn}-${messages.join("|")}`
    : null;

  return (
    <AnimatePresence>
      {decoherencePulseKey !== null && <motion.div
        key={decoherencePulseKey}
        aria-hidden="true"
        className="quantum-decoherence-fx"
        animate={reducedMotion ? { opacity: 0.56 } : { opacity: [0, 0.84, 0] }}
        exit={{ opacity: 0 }}
        initial={{ opacity: 0 }}
        transition={{ duration: reducedMotion ? 0 : 0.78, ease: [0.16, 1, 0.3, 1] }}
      >
        <motion.div
          className="quantum-decoherence-fx__field"
          animate={reducedMotion ? undefined : { rotate: [0, 1.5, -1, 0], scale: [0.92, 1.04, 1] }}
          transition={{ duration: 0.78, ease: "easeOut" }}
        >
          <span className="quantum-decoherence-fx__ring quantum-decoherence-fx__ring--outer" />
          <span className="quantum-decoherence-fx__ring quantum-decoherence-fx__ring--inner" />
          <span className="quantum-decoherence-fx__core" />
        </motion.div>
      </motion.div>}
    </AnimatePresence>
  );
}

function Board() {
  const {
    gameState,
    selectedCell: selected,
    selectCell,
    tutorialStep,
    tutorialObservationTarget,
    tutorialMoveTarget,
    keyboardCursor,
    pulseTarget,
    gameMode,
    guidedStep,
    guidanceActive,
  } = useDailyGameStore();
  const guidedTarget = gameMode === "GUIDED" && guidanceActive ? GUIDED_JOURNEY.steps[guidedStep]?.action.target ?? null : null;
  const reducedMotion = useReducedMotion() ?? false;
  const previousBoard = useRef(gameState.board);
  const collapseTimeout = useRef<number | undefined>(undefined);
  const [recentCollapseKeys, setRecentCollapseKeys] = useState<readonly string[]>([]);

  useEffect(() => {
    const previous = previousBoard.current;
    const newCollapses = gameState.board
      .filter((cell, index) => cell.kind === "COLLAPSED" && previous[index]?.kind !== "COLLAPSED")
      .map((cell) => coordinateKey(cell.coordinate));
    previousBoard.current = gameState.board;

    if (newCollapses.length === 0) return;
    window.setTimeout(() => setRecentCollapseKeys(newCollapses), 0);
    if (collapseTimeout.current !== undefined) window.clearTimeout(collapseTimeout.current);
    collapseTimeout.current = window.setTimeout(
      () => setRecentCollapseKeys([]),
      reducedMotion ? 130 : 620,
    );
  }, [gameState.board, reducedMotion]);

  useEffect(() => () => {
    if (collapseTimeout.current !== undefined) window.clearTimeout(collapseTimeout.current);
  }, []);

  return (
    <section aria-labelledby="board-heading" className="mission-board rounded-3xl p-4 sm:p-5">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="eyebrow">Navegación cuántica</p>
          <h2 id="board-heading" className="mt-1 text-xl font-semibold text-cyan-50">Traza una ruta hacia la salida</h2>
          <p className="mt-1 text-sm text-slate-300">Observa posibilidades, elige un camino y avanza con intención.</p>
        </div>
        <span className="exit-direction">Salida arriba a la derecha <span aria-hidden="true">↗</span></span>
      </div>
      <div className="mission-grid grid grid-cols-7" role="grid" aria-label="Tablero de la misión">
        {pulseTarget !== null && <svg aria-hidden="true" className="pulse-wave" preserveAspectRatio="none" viewBox="0 0 7 7"><line x1={gameState.player.col + 0.5} x2={pulseTarget.col + 0.5} y1={gameState.player.row + 0.5} y2={pulseTarget.row + 0.5} /></svg>}
        {gameState.board.map((cell) => {
          const cellKey = coordinateKey(cell.coordinate);
          const playerHere = sameCoordinate(cell.coordinate, gameState.player);
          const exitHere = isExit(cell.coordinate);
          const selectedHere = selected !== null && sameCoordinate(cell.coordinate, selected);
          const powerTargetHere = selectedHere && cell.kind === "UNRESOLVED";
          const cursorHere = sameCoordinate(cell.coordinate, keyboardCursor);
          const pulseHere = pulseTarget !== null && sameCoordinate(cell.coordinate, pulseTarget);
          const guidedHere = guidedTarget !== null && sameCoordinate(cell.coordinate, guidedTarget);
          const pair = pairForCell(gameState, cell.coordinate);
          const floorChance = probabilityOfFloor(cell);
          const tutorialPlayer = tutorialStep === 1 && playerHere;
          const tutorialExit = tutorialStep === 2 && exitHere;
          const tutorialObserve = (tutorialStep === 3 || tutorialStep === 4)
            && tutorialObservationTarget !== null
            && sameCoordinate(cell.coordinate, tutorialObservationTarget);
          const tutorialMove = tutorialStep === 5
            && tutorialMoveTarget !== null
            && sameCoordinate(cell.coordinate, tutorialMoveTarget);
          const tutorialHighlight = tutorialPlayer || tutorialExit || tutorialObserve || tutorialMove;
          const art = cellAsset(cell, playerHere, exitHere);
          const label = [
            playerHere ? "Tú, el Observador" : exitHere ? "Salida dorada" : `Casilla ${cellLabel(cell)}`,
            cell.kind === "UNRESOLVED" && floorChance !== null ? `Probabilidad de camino: ${floorChance}` : null,
            pair ? "Tiene una pareja entrelazada" : null,
            selectedHere ? "Objetivo seleccionado" : null,
            powerTargetHere ? "Objetivo apto para aplicar Poder X o H antes de observar" : null,
            cursorHere ? "Cursor de teclado" : null,
            pulseHere ? "Recomendación visible del Pulso Cuántico" : null,
            guidedHere ? "Siguiente acción de la Ruta Guiada" : null,
            tutorialHighlight ? "Objetivo del tutorial" : null,
          ].filter((part): part is string => part !== null).join(". ");
          const tourTarget = playerHere
            ? "observer"
            : exitHere
              ? "exit"
              : tutorialObservationTarget !== null && sameCoordinate(cell.coordinate, tutorialObservationTarget)
                ? "possibility"
                : undefined;

          return (
            <motion.button
              key={cellKey}
              aria-label={label}
              aria-current={cursorHere ? "true" : undefined}
              aria-pressed={selectedHere}
              animate={reducedMotion ? undefined : {
                scale: tutorialHighlight ? 1.025 : selectedHere ? 1.012 : 1,
                y: playerHere ? [0, -1, 0] : 0,
              }}
              className={`mission-cell mission-cell--${outcomeClass(cell)} ${
                tutorialHighlight ? "mission-cell--tutorial" : selectedHere ? "mission-cell--selected" : ""
              } ${playerHere ? "mission-cell--observer" : ""} ${exitHere ? "mission-cell--exit" : ""} ${cursorHere ? "mission-cell--cursor" : ""} ${powerTargetHere ? "mission-cell--power-target" : ""} ${pulseHere ? "mission-cell--pulse" : ""} ${guidedHere ? "mission-cell--guided" : ""} ${recentCollapseKeys.includes(cellKey) ? "mission-cell--just-collapsed" : ""}`}
              data-cell-kind={outcomeClass(cell)}
              data-testid={`cell-${cellKey}`}
              data-tour={tourTarget}
              onClick={() => {
                unlockGameSound();
                playGameSound("select");
                selectCell(cell.coordinate);
              }}
              onFocus={() => playGameSound("focus")}
              onKeyDown={(event) => unlockFromKeyboard(event.key)}
              onPointerEnter={() => playGameSound("focus")}
              transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
              tabIndex={cursorHere ? 0 : -1}
              type="button"
              whileHover={reducedMotion ? undefined : { y: -2 }}
              whileTap={reducedMotion ? undefined : { scale: 0.985 }}
            >
              <span aria-hidden="true" className="mission-cell__art">
                {art.src !== null && <img
                  alt=""
                  className={`mission-cell__asset mission-cell__asset--${art.kind}`}
                  decoding="async"
                  height="256"
                  loading="lazy"
                  src={art.src}
                  width="256"
                />}
                {art.kind === "observer" && <><img alt="" aria-hidden="true" decoding="async" height="256" hidden loading="lazy" src={colapsoAssets.observer} width="256" /><span className="css-observer"><span className="css-observer__orbit" /><span className="css-observer__hood"><span className="css-observer__lens" /></span></span></>}
                {art.kind === "exit" && <><img alt="" aria-hidden="true" decoding="async" height="256" hidden loading="lazy" src={colapsoAssets.tiles.EXIT} width="256" /><span className="css-exit"><span className="css-exit__gate"><span className="css-exit__core" /></span></span></>}
                {art.kind === "unresolved" && <span className="unresolved-field"><span className="unresolved-field__orbit" /><span className="unresolved-field__mote unresolved-field__mote--one" /><span className="unresolved-field__mote unresolved-field__mote--two" /><span className="unresolved-field__mote unresolved-field__mote--three" /></span>}
              </span>
              {pair && <>
                <img alt="" aria-hidden="true" className="mission-cell__entanglement" decoding="async" height="256" loading="lazy" src={colapsoAssets.effects.entanglement} width="256" />
                <span aria-label="Pareja entrelazada" className="mission-cell__pair">∞</span>
              </>}
              {selectedHere && <motion.img
                alt=""
                aria-hidden="true"
                animate={reducedMotion ? { opacity: 0.9 } : { opacity: [0.5, 0.92, 0.64], rotate: [0, 1.2, 0] }}
                className="mission-cell__selection-fx"
                decoding="async"
                height="256"
                initial={false}
                loading="lazy"
                src={colapsoAssets.effects.selection}
                transition={{ duration: 1.1, ease: "easeInOut", repeat: Infinity }}
                width="256"
              />}
              {powerTargetHere && <motion.span
                key={cell.kind === "UNRESOLVED" ? cell.distribution.join("-") : cellKey}
                aria-hidden="true"
                className="mission-cell__power-fx"
                initial={{ opacity: 0, scale: reducedMotion ? 1 : 0.72 }}
                animate={{ opacity: [0, 0.95, 0.35], scale: 1 }}
                transition={{ duration: reducedMotion ? 0 : 0.48, ease: "easeOut" }}
              ><span>X</span><span>H</span></motion.span>}
              {recentCollapseKeys.includes(cellKey) && <motion.span
                aria-hidden="true"
                animate={{ opacity: 0, scale: reducedMotion ? 1 : 1.45 }}
                className="mission-cell__collapse-fx"
                initial={{ opacity: reducedMotion ? 0.58 : 0.95, scale: reducedMotion ? 1 : 0.45 }}
                transition={{ duration: reducedMotion ? 0.12 : 0.52, ease: [0.16, 1, 0.3, 1] }}
              ><span /></motion.span>}
              <span aria-hidden="true" className="mission-cell__core">
                {playerHere ? <span>TÚ</span> : exitHere ? "SALIDA" : cellSymbol(cell)}
              </span>
              {floorChance !== null && <span aria-hidden="true" className="mission-cell__chance">Camino {floorChance}</span>}
              {pulseHere && <motion.span aria-hidden="true" className="mission-cell__pulse-label" initial={{ opacity: 0, y: 4 }} animate={{ opacity: [0, 1, 0.72], y: 0 }}>PULSO</motion.span>}
              {guidedHere && <span aria-hidden="true" className="mission-cell__guided-label">SIGUIENTE</span>}
              {tutorialHighlight && <span className="sr-only">Objetivo del tutorial</span>}
            </motion.button>
          );
        })}
      </div>
      <details className="mission-legend" open>
        <summary><span>Leyenda de señales</span><small>8 lecturas</small></summary>
        <div className="mission-legend__items" aria-label="Leyenda del tablero">
          <span><i className="legend-symbol legend-symbol--observer" aria-hidden="true">◉</i>Observador</span>
          <span><i className="legend-symbol legend-symbol--exit" aria-hidden="true">⬡</i>Salida</span>
          <span><i className="legend-symbol" aria-hidden="true">?</i>Posibilidad</span>
          <span><i className="legend-symbol legend-symbol--floor" aria-hidden="true">·</i>Camino</span>
          <span><i className="legend-symbol legend-symbol--wall" aria-hidden="true">▦</i>Muro</span>
          <span><i className="legend-symbol legend-symbol--void" aria-hidden="true">◌</i>Vacío</span>
          <span><i className="legend-symbol legend-symbol--crystal" aria-hidden="true">✦</i>Cristal</span>
          <span><i className="legend-symbol legend-symbol--battery" aria-hidden="true">+</i>Batería</span>
        </div>
      </details>
    </section>
  );
}

function Hud() {
  const { gameState, messages } = useDailyGameStore();
  const reducedMotion = useReducedMotion() ?? false;
  const energyLevel = Math.min(1, Math.max(0, gameState.energy / 5));
  const decoherencePulsing = messages.some((message) => message.toLowerCase().includes("universo colapsó"));
  const pressure = deriveDecoherencePressure(gameState.turn, decoherencePulsing);
  const remainingLabel = pressure.level === "pulse"
    ? "AHORA"
    : `${pressure.turnsRemaining} ${pressure.turnsRemaining === 1 ? "turno" : "turnos"}`;

  return (
    <section aria-label="Estado de la misión" className="mission-hud">
      <div className="mission-hud__identity">
        <span className="mission-hud__signal" aria-hidden="true" />
        <div><span>Cámara activa</span><strong>Telemetría de misión</strong></div>
      </div>
      <dl className="mission-hud__stats">
        <motion.div className="hud-stat hud-stat--observations" animate={reducedMotion ? undefined : { opacity: 1, y: 0 }} initial={reducedMotion ? false : { opacity: 0, y: 5 }}>
          <span className="hud-stat__icon hud-stat__icon--observer" aria-hidden="true">◉</span>
          <div><dt>Observaciones</dt><dd>{gameState.observations}</dd><p>Lecturas disponibles</p></div>
        </motion.div>
        <motion.div className="hud-stat hud-stat--energy" animate={reducedMotion ? undefined : { opacity: 1, y: 0 }} initial={reducedMotion ? false : { opacity: 0, y: 5 }} transition={{ delay: 0.035 }}>
          <div className="hud-energy" aria-hidden="true"><motion.span animate={{ scaleY: energyLevel }} initial={false} transition={{ duration: reducedMotion ? 0 : 0.24, ease: [0.16, 1, 0.3, 1] }} /></div>
          <div><dt>Energía</dt><dd>{gameState.energy}</dd><p>Reserva del campo</p></div>
        </motion.div>
        <motion.div data-tour="decoherence" className="hud-stat hud-stat--turn" animate={reducedMotion ? undefined : { opacity: 1, y: 0 }} initial={reducedMotion ? false : { opacity: 0, y: 5 }} transition={{ delay: 0.07 }}>
          <span className="hud-stat__icon" aria-hidden="true">⌁</span>
          <div><dt>Turno {gameState.turn}</dt><dd>{decoherenceLabel(gameState.turn)}</dd><p>El campo decide cada cuatro turnos</p></div>
        </motion.div>
        <motion.div className="hud-stat hud-stat--crystals" animate={reducedMotion ? undefined : { opacity: 1, y: 0 }} initial={reducedMotion ? false : { opacity: 0, y: 5 }} transition={{ delay: 0.105 }}>
          <span className="hud-stat__icon hud-stat__icon--crystal" aria-hidden="true">✦</span>
          <div><dt>Cristales</dt><dd>{gameState.collectedCrystals.length}</dd><p>Materia recuperada</p></div>
        </motion.div>
        <motion.div className="hud-stat hud-stat--score" animate={reducedMotion ? undefined : { opacity: 1, y: 0 }} initial={reducedMotion ? false : { opacity: 0, y: 5 }} transition={{ delay: 0.14 }}>
          <div><dt>Puntaje</dt><dd>{calculateScore(gameState)}</dd><p>Registro actual</p></div>
        </motion.div>
      </dl>
      <aside
        aria-label="Presión de decoherencia"
        className={`decoherence-pressure decoherence-pressure--${pressure.level}`}
        data-motion={reducedMotion ? "reduced" : "full"}
        data-pressure-state={pressure.level}
      >
        <div className="decoherence-pressure__header">
          <span><i aria-hidden="true" /> PRESIÓN DE DECOHERENCIA</span>
          <strong>{remainingLabel}</strong>
        </div>
        <div
          aria-label={`Presión de decoherencia: ${pressure.intensity}%`}
          aria-valuemax={100}
          aria-valuemin={0}
          aria-valuenow={pressure.intensity}
          className="decoherence-pressure__ring"
          role="progressbar"
          style={{ "--pressure-progress": `${pressure.intensity}%` } as CSSProperties}
        ><span>{pressure.level === "pulse" ? "⌁" : pressure.turnsRemaining}</span><small>{pressure.level === "pulse" ? "pulso" : "turnos"}</small></div>
        <div className="decoherence-pressure__copy" aria-live="polite">
          <strong>{pressure.label}</strong>
          <small>{pressure.message}</small>
        </div>
        <div aria-hidden="true" className="decoherence-pressure__track"><motion.span animate={{ width: `${pressure.intensity}%` }} initial={false} transition={{ duration: reducedMotion ? 0 : 0.3, ease: [0.16, 1, 0.3, 1] }} /></div>
      </aside>
    </section>
  );
}

function MissionStickyBar() {
  const store = useDailyGameStore();
  const resourceAlert = deriveObservationAlert(store.gameState.observations);
  const decoherencePressure = deriveDecoherencePressure(store.gameState.turn);
  const availability = store.getActionAvailability();
  const selected = selectedCell(store.gameState, store.selectedCell);
  const modeLabel = store.gameMode === "EXPLORER" ? "Explorador" : store.gameMode === "GUIDED" ? "Guiada" : "Canónica";
  const action = selected === null
    ? { label: "Elegir objetivo", disabled: false, run: () => store.selectCell(store.keyboardCursor) }
    : availability.move
      ? { label: "Mover aquí", disabled: false, run: store.moveSelected }
      : availability.observe
        ? { label: "Observar", disabled: false, run: store.observeSelected }
        : { label: "Cambia de objetivo", disabled: true, run: store.executePrimary };

  return <section
    aria-label="Barra de misión persistente"
    className={`mission-sticky-hud mission-sticky-hud--${resourceAlert.level}`}
    data-resource-alert={resourceAlert.level}
    data-sticky="true"
  >
    <div className="mission-sticky-hud__observations">
      <span>Observaciones</span>
      <strong aria-label={`${store.gameState.observations} observaciones restantes`}>{store.gameState.observations}</strong>
      <small>restantes</small>
    </div>
    <div className="mission-sticky-hud__alert" aria-live="polite">
      <span>ALERTA DE RECURSOS · {resourceAlert.intensity}%</span>
      <strong>{resourceAlert.label}</strong>
      <small>{resourceAlert.message}</small>
    </div>
    <dl className="mission-sticky-hud__stats">
      <div><dt>Energía</dt><dd>{store.gameState.energy}</dd></div>
      <div><dt>Turno</dt><dd>{store.gameState.turn}</dd></div>
      <div><dt>Cristales</dt><dd>{store.gameState.collectedCrystals.length}</dd></div>
      <div><dt>Puntaje</dt><dd>{calculateScore(store.gameState)}</dd></div>
      {store.gameMode === "EXPLORER" && <div><dt>Pulsos</dt><dd>{store.quantumPulses}</dd></div>}
    </dl>
    <div className="mission-sticky-hud__mode"><span>Modo</span><strong>{modeLabel}</strong><small>Decoherencia en {decoherencePressure.turnsRemaining}</small></div>
    <button
      aria-label={`Acción rápida: ${action.label}`}
      className="mission-sticky-hud__action"
      disabled={action.disabled}
      onClick={() => { unlockGameSound(); if (selected === null) playGameSound("select"); action.run(); }}
      type="button"
    >{action.label}<span aria-hidden="true">→</span></button>
  </section>;
}

function SelectedProbabilities() {
  const { gameState, selectedCell: selected } = useDailyGameStore();
  const cell = selectedCell(gameState, selected);
  const reducedMotion = useReducedMotion();

  if (cell === null || cell.kind !== "UNRESOLVED") return null;

  return (
    <motion.section aria-labelledby="probabilities-heading" className="probability-panel" initial={reducedMotion ? false : { opacity: 0, y: 7 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}>
      <div className="flex items-baseline justify-between gap-3">
        <h3 id="probabilities-heading">Posibilidades de esta casilla</h3><span>Antes de observar</span>
      </div>
      <ul className="mt-3 space-y-2">
        {distributionOutcomes.map((outcome, index) => {
          const value = cell.distribution[index] ?? 0;
          return <li key={outcome} aria-label={`${outcomeNames[outcome]}: ${probability(value)}`} className="probability-row">
            <div><span>{outcomeNames[outcome]}</span><strong>{probability(value)}</strong></div>
            <div className="probability-track"><motion.span animate={{ scaleX: value }} className={`probability-fill probability-fill--${outcome.toLowerCase()}`} initial={false} style={{ transformOrigin: "left" }} transition={{ duration: reducedMotion ? 0 : 0.24, ease: [0.16, 1, 0.3, 1] }} /></div>
          </li>;
        })}
      </ul>
      <p className="mt-3 text-xs leading-5 text-slate-400">Una probabilidad alta mejora tus posibilidades, pero no garantiza el resultado.</p>
    </motion.section>
  );
}

function Controls() {
  const store = useDailyGameStore();
  const [consoleExpanded, setConsoleExpanded] = useState(true);
  const reducedMotion = useReducedMotion() ?? false;
  const selected = selectedCell(store.gameState, store.selectedCell);
  const availability = store.getActionAvailability();
  const unresolved = selected?.kind === "UNRESOLVED";
  const wall = selected?.kind === "COLLAPSED" && selected.outcome === "WALL";
  const canMove = availability.move;
  const canObserve = availability.observe;
  const tactical = deriveVisibleTacticalInfo(store.gameState);
  const resourceAlert = deriveObservationAlert(store.gameState.observations);
  const primary = selected === null
    ? { label: "Seleccionar posibilidad", hint: "El cursor está sobre una posibilidad.", action: () => store.selectCell(store.keyboardCursor), disabled: false }
    : canMove
      ? { label: "Mover aquí", hint: "Camino disponible. Avanza hacia la salida.", action: store.moveSelected, disabled: false }
      : canObserve
        ? { label: "Observar casilla", hint: "Pulsa Espacio otra vez para observar.", action: store.observeSelected, disabled: false }
        : { label: "Sin acción disponible", hint: wall ? "Ruta bloqueada: elige otra casilla." : "Esta casilla no admite una acción ahora.", action: store.executePrimary, disabled: true };
  const invalid = selected !== null && !canMove && !canObserve;
  const targetTitle = selected === null ? "Sin objetivo fijado" : cellLabel(selected);
  const targetCoordinate = store.selectedCell === null ? "Usa flechas o WASD" : `Fila ${store.selectedCell.row + 1} · Columna ${store.selectedCell.col + 1}`;
  const status = deriveConsoleStatus(store.gameState, store.selectedCell, canMove);
  const log = store.eventLog.length > 0 ? store.eventLog : [store.feedback];
  const modeLabel = store.gameMode === "EXPLORER" ? "MODO EXPLORADOR" : store.gameMode === "GUIDED" ? "RUTA GUIADA" : "MISIÓN CUÁNTICA";
  const powerInstruction = selected === null
    ? "Selecciona una posibilidad sin observar para aplicar X o H."
    : unresolved
      ? "Objetivo válido: aplica un poder antes de observar."
      : "Los poderes solo actúan sobre posibilidades sin observar.";

  return (
    <motion.section aria-labelledby="controls-heading" animate={invalid && !reducedMotion ? { x: [0, -3, 3, 0] } : { x: 0 }} className={`game-actions observer-console rounded-3xl p-4 ${consoleExpanded ? "" : "observer-console--collapsed"}`} data-console-expanded={consoleExpanded} data-tour="controls" transition={{ duration: 0.18 }}>
      <header className="observer-console__header"><span className="observer-console__avatar" aria-hidden="true"><i /></span><div><p className="eyebrow">{modeLabel}</p><h2 id="controls-heading">Consola del Observador</h2><h3 className="sr-only">Decide tu siguiente paso</h3></div><span className="observer-console__status">{status}</span><button aria-expanded={consoleExpanded} aria-label={consoleExpanded ? "Contraer consola" : "Expandir consola"} className="observer-console__collapse" onClick={() => setConsoleExpanded((value) => !value)} type="button">{consoleExpanded ? "⌄" : "⌃"}</button></header>

      <section className={`observer-console__resources observer-console__resources--${resourceAlert.level}`} data-console-priority="1" data-resource-alert={resourceAlert.level} aria-label="Observaciones y alerta activa">
        <div><span>OBSERVACIONES RESTANTES</span><strong>{store.gameState.observations}</strong></div>
        <p aria-live="polite"><strong>{resourceAlert.label}</strong><span>{resourceAlert.message}</span></p>
      </section>
      {store.gameMode === "EXPLORER" && <section className={`resource-margin resource-margin--${tactical.marginStatus.toLowerCase()}`} aria-label={`Margen de recursos ${tactical.marginLabel}`}><div><span>MARGEN {tactical.marginLabel}</span><strong>{tactical.estimatedMargin >= 0 ? `+${tactical.estimatedMargin}` : tactical.estimatedMargin}</strong></div><p>{tactical.marginMessage}</p></section>}

      <div data-console-priority="3">
        <p className="observer-console__directive">{primary.hint}</p>
        <div className="observer-console__primary" data-tour="observe-button"><div data-tour="move-button"><motion.button
          whileHover={primary.disabled || reducedMotion ? undefined : { y: -1 }} whileTap={primary.disabled || reducedMotion ? undefined : { y: 0 }}
          className="action-button action-button--primary" disabled={primary.disabled} onClick={() => { unlockGameSound(); if (selected === null) playGameSound("select"); primary.action(); }} onFocus={() => playGameSound("focus")}
          onKeyDown={(event) => unlockFromKeyboard(event.key)} onPointerEnter={() => playGameSound("focus")} type="button"
        ><span>{primary.label}</span><span aria-hidden="true">{canMove ? "→" : canObserve ? "◉" : "◎"}</span></motion.button></div></div>
      </div>

      <div className="observer-console__target" data-console-priority="4"><span>Objetivo actual</span><strong>{targetTitle}</strong><small>{targetCoordinate}</small></div>
      {unresolved && <p className="action-tip">{availability.powerX || availability.powerH ? "Puedes aplicar X o H antes de observar." : "Esta posibilidad está lista para observar."}</p>}
      {wall && <p className="action-tip action-tip--danger">Un muro no se puede atravesar.</p>}

      <section aria-label="Poderes cuánticos" className={`power-panel power-panel--visible ${availability.powerX || availability.powerH ? "power-panel--ready" : ""}`} data-console-priority="5" data-tour="powers">
        <header><span className="power-panel__title">Poderes cuánticos</span><span>Módulos X / H</span></header>
        <p id="power-instruction">{powerInstruction}</p>
        <div className="power-panel__controls">
          <div><button aria-describedby="power-x-status power-instruction" aria-label="Poder X" className="action-button action-button--secondary action-button--power" disabled={!availability.powerX} onClick={() => { unlockGameSound(); playGameSound("powerX"); store.applyGateToSelected("X"); }} type="button"><img alt="" aria-hidden="true" className="action-button__power-icon" decoding="async" height="256" loading="lazy" src={colapsoAssets.powers.X} width="256" /><span>Poder X <kbd>X</kbd></span></button><small id="power-x-status">{availability.powerX ? "Disponible para este objetivo." : availability.powerXReason}</small></div>
          <div><button aria-describedby="power-h-status power-instruction" aria-label="Poder H" className="action-button action-button--secondary action-button--power" disabled={!availability.powerH} onClick={() => { unlockGameSound(); playGameSound("powerH"); store.applyGateToSelected("H"); }} type="button"><img alt="" aria-hidden="true" className="action-button__power-icon" decoding="async" height="256" loading="lazy" src={colapsoAssets.powers.H} width="256" /><span>Poder H <kbd>H</kbd></span></button><small id="power-h-status">{availability.powerH ? "Disponible para este objetivo." : availability.powerHReason}</small></div>
        </div>
        <p className="power-panel__hint">X intercambia las probabilidades principales. H las equilibra.</p>
      </section>

      <div data-console-priority="6"><QuantumPulseControl /></div>
      <SelectedProbabilities />
      <CoherenceMeter />
      {store.gameMode === "GUIDED" && <LazyModuleBoundary label="La orientación no pudo cargarse." onClose={store.dismissGuidance} resetKey={store.guidedStep}><Suspense fallback={<LazyFallback label="Cargando orientación…" />}><LazyGuidedJourneyControls /></Suspense></LazyModuleBoundary>}
      <div aria-live="polite" className="mission-feedback observer-console__log" data-console-priority="7"><span className="observer-console__log-title">Últimos eventos</span><AnimatePresence initial={false}>{log.map((message) => <motion.p key={message} initial={{ opacity: 0, x: -4 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }}>{message}</motion.p>)}</AnimatePresence></div>
      {store.gameMode === "EXPLORER" && <details className="tactical-details" data-console-priority="8"><summary>Detalles tácticos visibles</summary><dl><div><dt>Rutas potenciales</dt><dd>{tactical.potentialRoutes}</dd></div><div><dt>Distancia aproximada</dt><dd>{tactical.manhattanDistance}</dd></div><div><dt>Observaciones</dt><dd>{store.gameState.observations}</dd></div><div><dt>Margen estimado</dt><dd>{tactical.estimatedMargin}</dd></div><div><dt>Pulsos</dt><dd>{store.quantumPulses}/5</dd></div></dl></details>}
    </motion.section>
  );
}

const helpCards = [
  ["◎", "Tu misión", "Llega desde la esquina inferior izquierda hasta la salida dorada."],
  ["?", "Tipos de casilla", "Camino permite avanzar; muro bloquea; vacío cuesta energía; cristal suma puntos; batería recupera una observación."],
  ["→", "Cómo jugar tu turno", "Selecciona una casilla, obsérvala y avanza sólo cuando sea segura."],
  ["◌", "Decoherencia", "Cada cuatro turnos, el universo define una casilla por su cuenta."],
  ["X H", "Poderes cuánticos", "X cambia probabilidades. H las equilibra. Úsalos antes de observar."],
  ["✦", "Consejo rápido", "No necesitas descubrir todo el tablero. Busca una ruta hasta la salida."],
] as const;

function Details() {
  const { panel, togglePanel, repeatTutorial, openPanel } = useDailyGameStore();
  const helpOpen = panel === "HELP";
  const provenanceOpen = panel === "PROVENANCE";

  return <section aria-label="Ayuda y procedencia" className="space-y-4">
    <section className="details-panel rounded-3xl p-4">
      <button aria-expanded={helpOpen} className="details-trigger" onClick={() => { unlockGameSound(); playGameSound("panel"); togglePanel("HELP"); }} type="button"><span><span aria-hidden="true" className="details-trigger__icon">?</span> Cómo jugar</span><span aria-hidden="true">{helpOpen ? "−" : "+"}</span></button>
      <AnimatePresence initial={false}>{helpOpen && <motion.div className="mt-4 space-y-2" initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.18 }}>
        {helpCards.map(([icon, title, copy], index) => <details key={title} className="help-card" open={index === 0}><summary><span aria-hidden="true">{icon}</span><strong>{title}</strong></summary><p>{copy}</p></details>)}
        <details className="help-card difficulty-help"><summary><span aria-hidden="true">△</span><strong>¿POR QUÉ ESTE UNIVERSO ES DIFÍCIL?</strong></summary><p>El Universo #001 fue compilado una sola vez y no cambia para favorecerte después de comenzar. Algunas rutas exigen administrar recursos o encontrar una batería antes de agotar tus observaciones.</p><ul><li>No observes todo el tablero.</li><li>Busca una ruta directa.</li><li>Una batería puede ser decisiva.</li><li>La decoherencia puede abrir o cerrar opciones.</li><li>Los Pulsos sugieren, pero no revelan.</li><li>La Ruta Guiada enseña una solución verificable.</li><li>Perder también revela información útil sobre el universo.</li></ul></details>
        <button className="repeat-tutorial" onClick={() => { unlockGameSound(); playGameSound("panel"); repeatTutorial(); }} type="button">Repetir tutorial</button>
      </motion.div>}</AnimatePresence>
    </section>
    <section className="details-panel rounded-3xl p-4">
      <button aria-expanded={provenanceOpen} aria-haspopup="dialog" className="details-trigger" onClick={() => { unlockGameSound(); playGameSound("panel"); openPanel("PROVENANCE"); }} type="button"><span><span aria-hidden="true" className="details-trigger__icon">⌁</span> Procedencia cuántica</span><span aria-hidden="true">↗</span></button>
    </section>
  </section>;
}

function SoundToggle() {
  const { soundEnabled, toggleSound } = useDailyGameStore();
  const label = soundEnabled ? "Silenciar sonidos" : "Activar sonidos";
  const handleToggle = () => {
    unlockGameSound();
    const nextEnabled = !soundEnabled;
    setGameSoundMuted(!nextEnabled);
    toggleSound();
    if (nextEnabled) playGameSound("panel");
  };
  return <button aria-label={label} aria-pressed={!soundEnabled} className="sound-toggle" onClick={handleToggle} type="button"><span aria-hidden="true">{soundEnabled ? "◖" : "◌"}</span> {soundEnabled ? "Sonido" : "Silencio"}</button>;
}

function HeroAtmosphere() {
  return <div aria-hidden="true" className="hero-atmosphere">
    <span className="hero-atmosphere__beam hero-atmosphere__beam--one" />
    <span className="hero-atmosphere__beam hero-atmosphere__beam--two" />
    <span className="hero-atmosphere__orbit hero-atmosphere__orbit--outer" />
    <span className="hero-atmosphere__orbit hero-atmosphere__orbit--inner" />
    <span className="hero-atmosphere__particle hero-atmosphere__particle--one" />
    <span className="hero-atmosphere__particle hero-atmosphere__particle--two" />
    <span className="hero-atmosphere__particle hero-atmosphere__particle--three" />
    <span className="hero-atmosphere__particle hero-atmosphere__particle--four" />
  </div>;
}

function GameplayAtmosphere({ level }: { readonly level: DecoherencePressureLevel }) {
  return <div aria-hidden="true" className={`game-atmosphere game-atmosphere--${level}`}>
    <span className="game-atmosphere__fog game-atmosphere__fog--cyan" />
    <span className="game-atmosphere__fog game-atmosphere__fog--violet" />
    <span className="game-atmosphere__orbit game-atmosphere__orbit--one" />
    <span className="game-atmosphere__orbit game-atmosphere__orbit--two" />
    <span className="game-atmosphere__sweep" />
    <span className="game-atmosphere__pressure-halo" />
    <span className="game-atmosphere__pressure-scan" />
    <span className="game-atmosphere__spark game-atmosphere__spark--one" />
    <span className="game-atmosphere__spark game-atmosphere__spark--two" />
    <span className="game-atmosphere__spark game-atmosphere__spark--three" />
    <span className="game-atmosphere__spark game-atmosphere__spark--four" />
    <span className="game-atmosphere__spark game-atmosphere__spark--five" />
  </div>;
}

function FinalAtmosphere({ won }: { readonly won: boolean }) {
  return <div aria-hidden="true" className={`final-atmosphere final-atmosphere--${won ? "victory" : "defeat"}`} data-clean-effects="css-fragments">
    <span className="final-atmosphere__orbit final-atmosphere__orbit--outer" />
    <span className="final-atmosphere__orbit final-atmosphere__orbit--inner" />
    <span className="final-atmosphere__core" />
    <span className="final-atmosphere__particle final-atmosphere__particle--one" />
    <span className="final-atmosphere__particle final-atmosphere__particle--two" />
    <span className="final-atmosphere__particle final-atmosphere__particle--three" />
    <span className="final-atmosphere__particle final-atmosphere__particle--four" />
    <span className="final-atmosphere__particle final-atmosphere__particle--five" />
    <span className="final-atmosphere__fragment final-atmosphere__fragment--one" />
    <span className="final-atmosphere__fragment final-atmosphere__fragment--two" />
    <span className="final-atmosphere__fragment final-atmosphere__fragment--three" />
    <span className="final-atmosphere__fragment final-atmosphere__fragment--four" />
  </div>;
}

function HeroBrand() {
  const [logoFailed, setLogoFailed] = useState(false);
  const [atomFailed, setAtomFailed] = useState(false);
  const reducedMotion = useReducedMotion() ?? false;

  return <div className="intro-brand intro-brand--juice">
    <motion.div animate={reducedMotion ? undefined : { y: [0, -2, 0] }} className="intro-brand__logo-frame" transition={{ duration: 4.8, ease: "easeInOut", repeat: Infinity }}>
      {logoFailed
        ? <span aria-label="COLAPSO" className="intro-brand__fallback" role="img">COLAPSO</span>
        : <img alt="COLAPSO" className="intro-brand__logo" decoding="async" fetchPriority="high" height="512" loading="eager" onError={() => setLogoFailed(true)} src={colapsoAssets.logo} width="512" />}
    </motion.div>
    {atomFailed
      ? <span aria-hidden="true" className="intro-brand__atom-fallback">◎</span>
      : <motion.img alt="" aria-hidden="true" animate={reducedMotion ? undefined : { opacity: [0.58, 0.9, 0.58], rotate: [0, 5, 0], scale: [0.98, 1.035, 0.98] }} className="intro-brand__atom" decoding="async" height="256" loading="lazy" onError={() => setAtomFailed(true)} src={colapsoAssets.atom} transition={{ duration: 5.8, ease: "easeInOut", repeat: Infinity }} width="256" />}
  </div>;
}

function Intro() {
  const { universe, openPanel, guidedError, resetPreferences } = useDailyGameStore();
  const [preferencesReset, setPreferencesReset] = useState(false);
  const reducedMotion = useReducedMotion() ?? false;
  const universeId = String(universe.universeNumber).padStart(3, "0");

  return <motion.main className="intro-shell intro-shell--juice" initial={{ opacity: 0, y: reducedMotion ? 0 : 8 }} animate={{ opacity: 1, y: 0 }} onKeyDown={(event) => unlockFromKeyboard(event.key)} onPointerDown={unlockGameSound} transition={{ duration: reducedMotion ? 0 : 0.28, ease: [0.16, 1, 0.3, 1] }}>
    <HeroAtmosphere />
    <section aria-labelledby="daily-title" className="intro-card intro-card--juice">
      <HeroBrand />
      <div className="intro-universe-chip"><span className="intro-universe-chip__pulse" aria-hidden="true" /><span>Real quantum universe</span><strong>#{universeId}</strong><span className="intro-universe-chip__detail">evidencia publicada</span></div>
      <p className="eyebrow">COLAPSO <span aria-hidden="true">·</span> Universo #{universe.universeNumber}</p>
      <h1 id="daily-title">Observa antes de que el universo decida por ti.</h1>
      <p className="intro-copy">Tu misión es llevar al Observador desde la esquina inferior izquierda hasta la salida dorada.</p>
      {guidedError !== null && <p aria-live="assertive" className="guided-route-error" role="alert">{guidedError} Elige otro modo o vuelve a intentarlo más tarde.</p>}
      <ol className="intro-steps"><li><strong>1. Observa</strong><span>Descubre cada posibilidad.</span></li><li><strong>2. Avanza</strong><span>Elige casillas seguras.</span></li><li><strong>3. Anticípate</strong><span>El universo también decide.</span></li></ol>
      <dl className="intro-metadata"><div><dt>Fecha</dt><dd>{universe.dateUtc}</dd></div><div><dt>Universo</dt><dd>REAL #{universe.universeNumber.toString().padStart(3, "0")}</dd></div><div><dt>Backend</dt><dd>{universe.backend}</dd></div></dl>
      <div className="intro-entry-actions"><button aria-label="COMENZAR A JUGAR" className="intro-primary intro-primary--juice" onClick={() => { unlockGameSound(); playGameSound("cta"); openPanel("MODES"); }} type="button"><span>COMENZAR A JUGAR</span><small>Elige entre desafío, exploración o guía</small></button><button aria-label="DESCUBRE CÓMO FUNCIONA" className="intro-secondary intro-secondary--learn" onClick={() => { unlockGameSound(); playGameSound("panel"); openPanel("ONBOARDING"); }} type="button"><span>DESCUBRE CÓMO FUNCIONA</span><small>Aprende observación, recursos y decoherencia</small></button></div>
      <button aria-haspopup="dialog" aria-label="Procedencia cuántica" className="intro-provenance-link" onClick={() => { unlockGameSound(); playGameSound("panel"); openPanel("PROVENANCE"); }} type="button">Consultar procedencia cuántica</button>
      <div className="intro-preferences">
        <button onClick={() => { resetPreferences(); setGameSoundMuted(false); setPreferencesReset(true); }} type="button">Restablecer preferencias</button>
        {preferencesReset && <p role="status">Preferencias restablecidas en este dispositivo.</p>}
      </div>
    </section>
  </motion.main>;
}

function AnimatedScore({ score }: { readonly score: number }) {
  const reducedMotion = useReducedMotion() ?? false;
  const scoreValue = useMotionValue(0);
  const [displayScore, setDisplayScore] = useState(0);

  useMotionValueEvent(scoreValue, "change", (latest) => setDisplayScore(Math.round(latest)));
  useEffect(() => {
    if (reducedMotion) {
      scoreValue.set(score);
      return undefined;
    }
    const controls = animate(scoreValue, score, { duration: 0.86, delay: 0.16, ease: [0.16, 1, 0.3, 1] });
    return () => controls.stop();
  }, [reducedMotion, score, scoreValue]);

  return <span aria-label={`Puntaje final ${score}`}>{displayScore}</span>;
}

function Finished() {
  const { gameState, gameMode, metrics, guidedStep, rewindsUsed, retry, reset, changeMode, selectMode, openPanel } = useDailyGameStore();
  const reducedMotion = useReducedMotion() ?? false;
  const won = gameState.status === "VICTORY";
  const score = calculateScore(gameState);
  const isGuided = gameMode === "GUIDED";
  const modeLabel = isGuided ? won ? "RUTA GUIADA COMPLETADA" : "RUTA GUIADA" : gameMode === "EXPLORER" ? "MODO EXPLORADOR" : "MISIÓN CUÁNTICA";
  const resultLabel = isGuided ? "RUTA GUIADA" : gameMode === "EXPLORER" ? "ASISTIDO" : "CANÓNICO";
  const launchMode = (mode: GameMode) => { selectMode(mode); retry(); };

  return <motion.section aria-labelledby="result-heading" className={`finished-card finished-card--${won ? "victory" : "defeat"}`} initial={{ opacity: 0, scale: reducedMotion ? 1 : 0.975, y: reducedMotion ? 0 : 16 }} animate={{ opacity: 1, scale: 1, y: 0 }} transition={{ duration: reducedMotion ? 0 : 0.48, ease: [0.16, 1, 0.3, 1] }}>
    <div aria-hidden="true" className={`finished-card__fx finished-card__fx--${won ? "victory" : "defeat"}`}>
      <span className="finished-card__fx-orbit finished-card__fx-orbit--outer" />
      <span className="finished-card__fx-orbit finished-card__fx-orbit--inner" />
      <span className="finished-card__fx-core" />
      <span className="finished-card__fx-flare" />
    </div>
    <div aria-hidden="true" className="finished-card__sigil">{won ? "✦" : "◌"}</div>
    <p className="eyebrow">{won ? "Resultado · universo estabilizado" : "Resultado · ruta colapsada"}</p>
    <h2 id="result-heading">{won ? "Llegaste a la salida" : "La ruta se cerró"}</h2>
    <p className="finished-card__message">{isGuided ? won ? "Completaste una solución verificable ejecutada paso a paso mediante F1." : "La Ruta Guiada se detuvo antes de completar la solución verificable." : gameMode === "EXPLORER" ? "Este resultado asistido conserva el score F1 y registra las ayudas de presentación utilizadas." : won ? "Convertiste incertidumbre en una ruta canónica." : "Recalibra el campo y vuelve a intentarlo cuando quieras."}</p>
    <div className="finished-card__mode"><span>{modeLabel}</span><strong>{resultLabel}</strong></div>
    {!isGuided && <div className="finished-score-panel"><span>{gameMode === "EXPLORER" ? "Puntaje F1 · resultado no competitivo" : "Puntaje oficial"}</span><strong><AnimatedScore score={score} /></strong></div>}
    <div className="finished-card__status"><span>{won ? "✦ Ruta asegurada" : "◌ Energía dispersa"}</span><span>{gameState.turn} turnos</span></div>
    {isGuided ? <><dl className="mission-metrics mission-metrics--guided" aria-label="Métricas de Ruta Guiada"><div><dt>Pasos completados</dt><dd>{guidedStep}/{GUIDED_JOURNEY.steps.length}</dd></div><div><dt>Rebobinados</dt><dd>{rewindsUsed}/3</dd></div><div><dt>Acciones F1</dt><dd>{metrics.moves + metrics.observations}</dd></div></dl><section className="learned-concepts"><h3>Conceptos aprendidos</h3><ul><li>Observación</li><li>Recursos</li><li>Decoherencia</li><li>Replay verificable</li></ul></section></> : <dl className="mission-metrics" aria-label="Métricas de la misión"><div><dt>Movimientos</dt><dd>{metrics.moves}</dd></div><div><dt>Observaciones</dt><dd>{metrics.observations}</dd></div><div><dt>Decoherencias</dt><dd>{metrics.decoherences}</dd></div>{gameMode === "EXPLORER" && <><div><dt>Pulsos usados</dt><dd>{metrics.pulsesUsed}</dd></div><div><dt>Coherence Bursts</dt><dd>{metrics.coherenceBursts}</dd></div></>}<div><dt>Flow máximo</dt><dd>{metrics.maxFlow}/3</dd></div></dl>}
    <LazyModuleBoundary label="El recorrido reproducible no pudo cargarse." resetKey={`${gameMode ?? "NONE"}-${gameState.status}`}><Suspense fallback={<LazyFallback label="Cargando recorrido…" />}><LazyFinalRouteMap /></Suspense></LazyModuleBoundary>
    <div className="finished-actions">
      {gameMode === "QUANTUM_MISSION" && <button className="intro-primary finished-card__cta" onClick={retry} type="button">Volver a intentar</button>}
      {gameMode === "EXPLORER" && <button className="intro-primary finished-card__cta" onClick={() => launchMode("QUANTUM_MISSION")} type="button">Intentar Misión Cuántica</button>}
      {isGuided && <><button className="intro-primary finished-card__cta" onClick={() => launchMode("EXPLORER")} type="button">Jugar en Explorador</button><button className="intro-secondary" onClick={() => launchMode("QUANTUM_MISSION")} type="button">Intentar Misión Cuántica</button></>}
      <button className="intro-secondary" onClick={changeMode} type="button">Cambiar modo</button><button className="intro-secondary" onClick={reset} type="button">Volver a la portada</button><button className="intro-secondary" onClick={() => openPanel("PROVENANCE")} type="button">Ver procedencia</button>
    </div>
  </motion.section>;
}

export function DailyGame() {
  const { phase, panel, universe, tutorialStep, gameState, gameMode, messages, closePanel } = useDailyGameStore();
  const finished = phase === "FINISHED";
  const won = gameState.status === "VICTORY";
  const decoherencePulsing = messages.some((message) => message.toLowerCase().includes("universo colapsó"));
  const decoherencePressure = deriveDecoherencePressure(gameState.turn, decoherencePulsing);
  const resourceAlert = deriveObservationAlert(gameState.observations);
  const modeLabel = gameMode === "GUIDED" ? "RUTA GUIADA" : gameMode === "EXPLORER" ? "MODO EXPLORADOR" : gameMode === "QUANTUM_MISSION" ? "MISIÓN CUÁNTICA" : "MODO SIN ELEGIR";
  const shellClass = finished
    ? `final-shell final-shell--${won ? "victory" : "defeat"}`
    : `game-shell game-shell--juice game-shell--decoherence-${decoherencePressure.level} game-shell--resource-${resourceAlert.level} min-h-screen px-4 py-5 text-slate-100 sm:px-6 lg:px-10`;

  return <>
    <KeyboardController />
    {phase === "INTRO" ? <Intro /> : <main className={shellClass} data-decoherence-pressure={finished ? undefined : decoherencePressure.level} data-resource-alert={finished ? undefined : resourceAlert.level} onKeyDown={(event) => unlockFromKeyboard(event.key)} onPointerDown={unlockGameSound}>
      <MissionSoundEffects /><QuantumFeedbackEffects />
      {finished ? <>
        <FinalAtmosphere won={won} />
        <div className="final-topbar"><span>COLAPSO <span aria-hidden="true">·</span> Universo #{universe.universeNumber}</span><SoundToggle /></div>
        <div className="final-stage"><Finished /></div>
      </> : <>
        <GameplayAtmosphere level={decoherencePressure.level} />
        <div className="relative z-10 mx-auto max-w-7xl">
          <header className="game-header"><div><p className="eyebrow">COLAPSO <span aria-hidden="true">·</span> Universo #{universe.universeNumber}</p><h1>Explora una ruta hacia la salida</h1></div><div className="flex flex-wrap items-center justify-end gap-2"><p className="universe-badge">{universe.dateUtc} <span aria-hidden="true">·</span> {modeLabel}</p><SoundToggle /></div></header>
          <p data-tour="mission-goal" className="mission-goal">OBJETIVO: llega a la salida dorada. No necesitas descubrir todo el tablero.</p>
          <Hud />
          <MissionStickyBar />
          <div className="game-layout"><Board /><aside className="game-sidebar"><Controls /><Details /><KeyboardHelp /></aside></div>
        </div>
        {phase === "PLAYING" && <>{gameMode !== "GUIDED" && <PremiumTour />}{tutorialStep !== null && <p className="sr-only" aria-live="polite">Tutorial paso {tutorialStep} de 8</p>}</>}
      </>}
    </main>}
    <MissionControlOverlays />
    {panel === "PROVENANCE" && <LazyModuleBoundary label="La procedencia no pudo cargarse." onClose={closePanel} resetKey={panel}><Suspense fallback={<LazyFallback label="Cargando procedencia…" />}><LazyProvenanceModal /></Suspense></LazyModuleBoundary>}
    {panel === "ONBOARDING" && <LazyModuleBoundary label="La explicación no pudo cargarse." onClose={closePanel} resetKey={panel}><Suspense fallback={<LazyFallback label="Cargando explicación…" />}><LazyOnboardingPresentation /></Suspense></LazyModuleBoundary>}
  </>;
}
