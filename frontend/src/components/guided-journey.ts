import type { UniverseNumber } from "../daily-universe/client";
import type { Action } from "../engine";

export interface GuidedJourneyStep {
  readonly action: Action;
  readonly explanation: string;
  readonly concept: "OBSERVATION" | "MOVEMENT" | "RESOURCES" | "DECOHERENCE" | "REPLAY";
}

export interface GuidedJourneyDefinition {
  readonly version: 1;
  readonly universeNumber: UniverseNumber;
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

const universeOne: GuidedJourneyDefinition = {
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

const universeTwo: GuidedJourneyDefinition = {
  version: 1,
  universeNumber: 2,
  rulesVersion: 1,
  integrityReference: "bd5f8c97b66339df9f453c4a527bf6e68654c0472be133170aaf0c30b304cb27",
  actionTranscriptSha256: "9fc6f371e216bd5c1688e5beeb92c746908dceb6b41121fc9b01accf3067cb1c",
  steps: [
    observe(5, 0, "Observa la posibilidad superior para abrir la primera rama."),
    observe(6, 1, "Compara la ruta lateral antes de avanzar."),
    move(5, 0),
    observe(4, 0, "Resuelve solo el siguiente enlace necesario."),
    observe(5, 1, "La pareja entrelazada puede modificar dos posibilidades a la vez."),
    move(5, 1),
    observe(4, 1, "Confirma el corredor antes de comprometer la ruta."),
    observe(5, 2, "Abre una alternativa segura alrededor del campo."),
    move(5, 2),
    observe(5, 3, "Mantén una ruta continua con el menor gasto posible."),
    move(5, 3),
    observe(4, 3, "Observa el enlace que permite ascender."),
    observe(5, 4, "La decoherencia también puede definir posibilidades cercanas.", "DECOHERENCE"),
    move(4, 3),
    observe(4, 4, "Abre el siguiente tramo hacia la salida."),
    move(4, 4),
    observe(3, 4, "Conserva observaciones resolviendo solo la ruta elegida.", "RESOURCES"),
    move(3, 4),
    move(2, 4),
    move(1, 4),
    move(1, 5),
    move(0, 5),
    move(0, 6, "Completa la ruta entrelazada y conserva su replay.", "REPLAY"),
  ],
};

const universeThree: GuidedJourneyDefinition = {
  version: 1,
  universeNumber: 3,
  rulesVersion: 1,
  integrityReference: "be311b3567602eaa3bfd4da7881d5830b9ffc07bad97452e52b3c340d408eebe",
  actionTranscriptSha256: "6d2f517d504286293c2e01a324faa5340ea216e5d0cd18ef54f04d46a5e2eeef",
  steps: [
    observe(6, 1, "Comprueba la posibilidad lateral antes de elegir el corredor."),
    observe(5, 0, "Abre el ascenso más directo desde el origen."),
    move(5, 0),
    observe(4, 0, "Observa el siguiente tramo y protege tu energía."),
    move(4, 0),
    observe(3, 0, "Avanza por el borde para limitar la exposición al vacío."),
    move(3, 0),
    observe(2, 0, "Resuelve únicamente la posibilidad necesaria."),
    move(2, 0),
    observe(1, 0, "Confirma el último tramo vertical."),
    move(1, 0),
    observe(1, 1, "Gira hacia la salida manteniendo una ruta visible."),
    move(1, 1),
    observe(0, 1, "Abre el corredor superior."),
    move(0, 1),
    move(0, 2),
    observe(0, 3, "La decoherencia puede alterar otra posibilidad; revisa el campo.", "DECOHERENCE"),
    move(0, 3),
    observe(0, 4, "Administra las observaciones restantes con precisión.", "RESOURCES"),
    move(0, 4),
    observe(0, 5, "Resuelve la última posibilidad antes de la salida."),
    move(0, 5),
    move(0, 6, "Completa el protocolo y fija el replay verificable.", "REPLAY"),
  ],
};

const universeFour: GuidedJourneyDefinition = {
  version: 1,
  universeNumber: 4,
  rulesVersion: 1,
  integrityReference: "f8bcf4ff0154c8b4091f01236509046004223ae4ca46e43a7f0836276a5780ae",
  actionTranscriptSha256: "aa324889bfd971d74698d2d4a6d0650ffe0aa69583ac322d44667f59df86712e",
  steps: [
    observe(5, 0, "Abre la ruta inicial sin gastar lecturas innecesarias."),
    move(5, 0),
    move(4, 0),
    observe(4, 1, "Comprueba el corredor lateral antes de avanzar."),
    move(4, 1),
    observe(3, 1, "El vacío consume energía; esta acción enseña a reconocer su coste.", "RESOURCES"),
    move(3, 1, "Entrar en vacío gasta energía y puede dejarte en la misma posición.", "RESOURCES"),
    move(4, 2, "Elige la alternativa visible después del vacío."),
    observe(3, 2, "Resuelve el siguiente ascenso."),
    move(3, 2),
    observe(2, 2, "Mantén un margen de observaciones para el tramo final."),
    move(2, 2),
    observe(1, 2, "Abre el corredor superior hacia la salida."),
    move(1, 2),
    move(1, 3),
    observe(1, 4, "La decoherencia también modifica el campo visible.", "DECOHERENCE"),
    move(1, 4),
    observe(1, 5, "Confirma la última posibilidad necesaria."),
    move(1, 5),
    move(1, 6),
    move(0, 6, "Completa la ruta y conserva cada decisión en el replay.", "REPLAY"),
  ],
};

const universeFive: GuidedJourneyDefinition = {
  version: 1,
  universeNumber: 5,
  rulesVersion: 1,
  integrityReference: "c4cfc1afeb0da6b7223fa1a994bf240883a465d18c9a3acf48234696badf2a56",
  actionTranscriptSha256: "e80826e7656d04bc82489b0695a8cc5e40894d2fd1fce4c61e86c11d77483a6f",
  steps: [
    observe(5, 0, "Abre un punto estable dentro de la tormenta."),
    move(5, 0),
    observe(5, 1, "Comprueba la siguiente posibilidad antes de avanzar."),
    move(5, 1),
    observe(5, 2, "Resuelve el corredor central con una lectura precisa."),
    observe(4, 1, "La decoherencia puede cambiar otra región del tablero.", "DECOHERENCE"),
    move(5, 2),
    observe(4, 2, "Mantén visible una alternativa mientras progresa la tormenta."),
    move(5, 3),
    observe(5, 4, "Abre la ruta hacia el borde derecho."),
    move(5, 4),
    observe(4, 4, "Administra la reserva para el ascenso final.", "RESOURCES"),
    move(4, 4),
    move(4, 5),
    observe(4, 6, "Confirma el corredor vertical hacia la salida."),
    move(4, 6),
    move(3, 6),
    observe(2, 6, "Resuelve la última posibilidad crítica."),
    move(2, 6),
    move(1, 6),
    move(0, 6, "Estabiliza la tormenta y completa el replay verificable.", "REPLAY"),
  ],
};

export const GUIDED_JOURNEYS: Readonly<Record<UniverseNumber, GuidedJourneyDefinition>> = Object.freeze({
  1: universeOne,
  2: universeTwo,
  3: universeThree,
  4: universeFour,
  5: universeFive,
});

/** Compatibility export for the original Universe #001 guide. */
export const GUIDED_JOURNEY = GUIDED_JOURNEYS[1];

export function getGuidedJourney(universeNumber: UniverseNumber): GuidedJourneyDefinition {
  return GUIDED_JOURNEYS[universeNumber];
}

export function actionsMatch(first: Action, second: Action): boolean {
  return first.kind === second.kind
    && first.target.row === second.target.row
    && first.target.col === second.target.col
    && (first.kind !== "APPLY_GATE" || (second.kind === "APPLY_GATE" && first.gate === second.gate));
}

export function guidedPrefixLength(
  transcript: readonly Action[],
  definition: GuidedJourneyDefinition = GUIDED_JOURNEY,
): number {
  let index = 0;
  while (index < transcript.length && index < definition.steps.length) {
    const action = transcript[index];
    const step = definition.steps[index];
    if (action === undefined || step === undefined || !actionsMatch(action, step.action)) break;
    index += 1;
  }
  return index;
}
