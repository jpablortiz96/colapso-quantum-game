import type { Action } from "../engine";

export interface GuidedJourneyStep {
  readonly action: Action;
  readonly explanation: string;
  readonly concept: "OBSERVATION" | "MOVEMENT" | "RESOURCES" | "DECOHERENCE" | "REPLAY";
}

export interface GuidedJourneyDefinition {
  readonly version: 1;
  readonly universeNumber: 1;
  readonly rulesVersion: 1;
  readonly integrityReference: string;
  readonly actionTranscriptSha256: string;
  readonly steps: readonly GuidedJourneyStep[];
}

const observe = (row: number, col: number, explanation: string, concept: GuidedJourneyStep["concept"] = "OBSERVATION"): GuidedJourneyStep => ({
  action: { kind: "OBSERVE", target: { row, col } },
  explanation,
  concept,
});

const move = (row: number, col: number, explanation = "Este camino te acerca a la salida sin gastar observaciones extra.", concept: GuidedJourneyStep["concept"] = "MOVEMENT"): GuidedJourneyStep => ({
  action: { kind: "MOVE", target: { row, col } },
  explanation,
  concept,
});

export const GUIDED_JOURNEY: GuidedJourneyDefinition = {
  version: 1,
  universeNumber: 1,
  rulesVersion: 1,
  integrityReference: "bcff83aade29774587a84df10a9e168f5828e705728981d4eb8caf4075875579",
  actionTranscriptSha256: "a4f4739a8aa52bcd37e95af9943e03666064db2682af9cc97cb010809bf8f756",
  steps: [
    observe(6, 1, "Observa esta posibilidad para abrir la ruta inicial."),
    observe(5, 0, "Esta es una solución posible, no la única estrategia válida."),
    move(5, 0),
    observe(4, 0, "Observa solo la siguiente posibilidad necesaria; no necesitas descubrir todas las casillas."),
    move(4, 0, "La decoherencia también modifica el universo. Revisa el nuevo estado.", "DECOHERENCE"),
    observe(4, 1, "Observa esta posibilidad antes de comprometer la ruta."),
    move(4, 1, "Si aparece una batería, recógela: la ruta necesita más observaciones de las disponibles al inicio.", "RESOURCES"),
    observe(4, 2, "Abre la siguiente posibilidad manteniendo una ruta corta."),
    observe(3, 1, "La decoherencia puede cambiar otra casilla; confirma siempre el estado visible.", "DECOHERENCE"),
    move(4, 2),
    observe(4, 3, "No necesitas descubrir todas las casillas; abre solo el siguiente enlace."),
    move(4, 3),
    move(3, 3, "Avanza por el camino ya resuelto sin gastar observaciones extra."),
    observe(3, 4, "Observa esta posibilidad para continuar hacia la salida."),
    move(3, 4),
    observe(3, 5, "Administra el margen: cada observación debe sostener la ruta."),
    observe(2, 4, "La decoherencia también modifica el universo. Revisa las opciones visibles.", "DECOHERENCE"),
    move(3, 5),
    move(2, 5),
    observe(1, 5, "Observa la última posibilidad necesaria antes del tramo final."),
    move(1, 5),
    move(0, 5, "El camino visible conecta ya con la salida."),
    move(0, 6, "Completa la ruta; el transcript permitirá reproducir cada decisión.", "REPLAY"),
  ],
};

export function actionsMatch(first: Action, second: Action): boolean {
  return first.kind === second.kind
    && first.target.row === second.target.row
    && first.target.col === second.target.col
    && (first.kind !== "APPLY_GATE" || (second.kind === "APPLY_GATE" && first.gate === second.gate));
}

export function guidedPrefixLength(transcript: readonly Action[]): number {
  let index = 0;
  while (index < transcript.length && index < GUIDED_JOURNEY.steps.length) {
    const action = transcript[index];
    const step = GUIDED_JOURNEY.steps[index];
    if (action === undefined || step === undefined || !actionsMatch(action, step.action)) break;
    index += 1;
  }
  return index;
}
