import { motion } from "framer-motion";
import { useDailyGameStore } from "../store/daily-game-store";
import type { GameMode } from "./mission-control";
import { useDialogFocus } from "./use-dialog-focus";

const learningSteps = [
  ["1", "Elige una posibilidad", "Usa el cursor para explorar casillas cercanas."],
  ["2", "Observa y descubre el resultado", "Cada observación convierte una posibilidad en información visible."],
  ["3", "Avanza por caminos seguros", "Muévete solo por casillas resueltas y transitables."],
  ["4", "Administra observaciones y energía", "Tus recursos son limitados; una batería puede ser decisiva."],
  ["5", "Anticípate a la decoherencia", "Cada cuatro turnos el universo también toma una decisión."],
  ["6", "Llega a la salida", "Busca una ruta directa: no necesitas descubrir todo el tablero."],
] as const;

export function OnboardingPresentation() {
  const { closePanel, openPanel, selectMode, start } = useDailyGameStore();
  const dialogRef = useDialogFocus(closePanel);
  const launch = (mode: GameMode) => { selectMode(mode); start(); };
  return <motion.div className="mission-modal" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
    <motion.section ref={dialogRef} aria-labelledby="onboarding-title" aria-modal="true" className="onboarding-presentation" role="dialog" tabIndex={-1} initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}>
      <header><div><p className="eyebrow">Descubre cómo funciona</p><h2 id="onboarding-title">Convierte incertidumbre en una ruta</h2></div><button aria-label="Cerrar explicación" onClick={closePanel} type="button">×</button></header>
      <ol>{learningSteps.map(([number, title, copy], index) => <motion.li key={title} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.04 }}><span aria-hidden="true">{number}</span><div><strong>{title}</strong><p>{copy}</p></div></motion.li>)}</ol>
      <footer><button className="intro-primary" onClick={() => launch("EXPLORER")} type="button">Comenzar en Modo Explorador</button><button className="intro-secondary" onClick={() => launch("GUIDED")} type="button">Iniciar Ruta Guiada</button><button className="intro-secondary" onClick={() => openPanel("MODES")} type="button">Elegir otro modo</button></footer>
    </motion.section>
  </motion.div>;
}
