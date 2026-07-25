import { GUIDED_JOURNEY } from "./guided-journey";
import { useDailyGameStore } from "../store/daily-game-store";
import { playGameSound, unlockGameSound } from "./game-sound";

export function GuidedJourneyControls() {
  const { gameMode, guidedStep, guidanceActive, guidedError, rewindsRemaining, transcript, dismissGuidance, returnToGuidance, rewindLastAction, reset } = useDailyGameStore();
  if (gameMode !== "GUIDED") return null;
  if (guidedError !== null) return <section aria-live="assertive" className="guided-controls guided-controls--error" role="alert"><div><strong>Ruta Guiada detenida</strong><p>{guidedError}</p></div><button onClick={reset} type="button">Volver a la portada</button></section>;
  const step = GUIDED_JOURNEY.steps[guidedStep];
  if (!guidanceActive) return <section className="guided-controls guided-controls--paused"><div><strong>Orientación en pausa</strong><p>Puedes continuar libremente y regresar cuando quieras.</p></div><button onClick={returnToGuidance} type="button">Volver a la orientación</button></section>;
  const actionLabel = step?.action.kind === "OBSERVE" ? "Observar" : step?.action.kind === "MOVE" ? "Avanzar" : "Aplicar poder";
  return <section aria-label="Controles de Ruta Guiada" className="guided-controls">
    <header><span>RUTA GUIADA · PASO {Math.min(guidedStep + 1, GUIDED_JOURNEY.steps.length)} DE {GUIDED_JOURNEY.steps.length}</span><button onClick={dismissGuidance} type="button">Cerrar orientación</button></header>
    {step === undefined ? <p>Orientación completada. Continúa hasta confirmar el resultado.</p> : <div className="guided-controls__step"><strong>{actionLabel} · fila {step.action.target.row + 1}, columna {step.action.target.col + 1}</strong><p>{step.explanation}</p><small>Ejecuta la acción manualmente; F1 validará el resultado.</small></div>}
    <footer><button disabled={transcript.length === 0 || rewindsRemaining === 0} onClick={() => { unlockGameSound(); playGameSound("rewind"); rewindLastAction(); }} type="button">Rebobinar última acción</button><span>{rewindsRemaining}/3 disponibles</span></footer>
  </section>;
}
