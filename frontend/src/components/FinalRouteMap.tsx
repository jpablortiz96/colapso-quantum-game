import { motion, useReducedMotion } from "framer-motion";
import { useMemo, useState } from "react";
import { useDailyGameStore } from "../store/daily-game-store";
import { coordinateKey, coordinatesMatch } from "./mission-control";

export function FinalRouteMap() {
  const { gameState, routePositions, observedCoordinates, decoherenceCoordinates } = useDailyGameStore();
  const reducedMotion = useReducedMotion() ?? false;
  const [playing, setPlaying] = useState(false);
  const routeIndexes = useMemo(() => new Map(routePositions.map((coordinate, index) => [coordinateKey(coordinate), index])), [routePositions]);
  const observed = useMemo(() => new Set(observedCoordinates.map(coordinateKey)), [observedCoordinates]);
  const decohered = useMemo(() => new Set(decoherenceCoordinates.map(coordinateKey)), [decoherenceCoordinates]);
  const start = routePositions[0] ?? { row: 6, col: 0 };
  return <section className="final-route" aria-labelledby="route-title"><div><h3 id="route-title">Recorrido de la misión</h3><button aria-pressed={playing} onClick={() => setPlaying((value) => !value)} type="button">{playing ? "Pausar recorrido" : "Ver recorrido"}</button></div><div className="final-route__grid" role="img" aria-label="Miniatura 7 por 7 del recorrido">{Array.from({ length: 49 }, (_, index) => {
    const coordinate = { row: Math.floor(index / 7), col: index % 7 };
    const key = coordinateKey(coordinate);
    const routeIndex = routeIndexes.get(key);
    const classes = ["final-route__cell", routeIndex !== undefined ? "is-route" : "", observed.has(key) ? "is-observed" : "", decohered.has(key) ? "is-decohered" : "", coordinatesMatch(coordinate, start) ? "is-start" : "", coordinatesMatch(coordinate, gameState.player) ? "is-final" : "", coordinate.row === 0 && coordinate.col === 6 ? "is-exit" : ""].filter(Boolean).join(" ");
    return <motion.span key={key} className={classes} animate={playing && routeIndex !== undefined ? { opacity: [0.25, 1] } : { opacity: 1 }} transition={{ delay: reducedMotion ? 0 : (routeIndex ?? 0) * 0.08, duration: 0.22 }}><i aria-hidden="true" /></motion.span>;
  })}</div><div className="final-route__legend"><span>● Inicio</span><span>━ Ruta</span><span>○ Observada</span><span>⌁ Decoherencia</span><span>⬡ Salida</span></div></section>;
}
