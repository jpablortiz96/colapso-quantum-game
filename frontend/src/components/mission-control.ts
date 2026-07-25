import type { GameState } from "../engine";

export type GameMode = "QUANTUM_MISSION" | "EXPLORER" | "GUIDED";
export type Coordinate = GameState["player"];
export type ConsoleStatus =
  | "Analizando campo"
  | "Posibilidad seleccionada"
  | "Camino disponible"
  | "Decoherencia próxima"
  | "Ruta bloqueada"
  | "Salida alcanzable";
export type ResourceMarginStatus = "STABLE" | "TIGHT" | "CRITICAL";
export type DecoherencePressureLevel = "stable" | "rising" | "high" | "maximum" | "pulse";
export type DecoherencePressureCue = "tick" | "high" | "peak" | "pulse";

export interface DecoherencePressureState {
  readonly level: DecoherencePressureLevel;
  readonly turnsRemaining: 1 | 2 | 3 | 4;
  readonly intensity: 0 | 34 | 67 | 100;
  readonly label: string;
  readonly message: string;
  readonly cue: DecoherencePressureCue | null;
}

export function deriveDecoherencePressure(turn: number, pulsing = false): DecoherencePressureState {
  const normalizedTurn = Math.max(0, Math.trunc(turn));
  const turnsRemaining = (4 - (normalizedTurn % 4)) as DecoherencePressureState["turnsRemaining"];
  if (pulsing) return {
    level: "pulse",
    turnsRemaining,
    intensity: 100,
    label: "PULSO DE COLAPSO",
    message: "La decoherencia se ejecutó. El siguiente ciclo comienza ahora.",
    cue: "pulse",
  };
  if (turnsRemaining === 4) return {
    level: "stable",
    turnsRemaining,
    intensity: 0,
    label: "CAMPO ESTABLE",
    message: "El siguiente ciclo de decoherencia está a cuatro turnos.",
    cue: null,
  };
  if (turnsRemaining === 3) return {
    level: "rising",
    turnsRemaining,
    intensity: 34,
    label: "SEÑAL INESTABLE",
    message: "Quedan tres turnos antes de la próxima decoherencia.",
    cue: "tick",
  };
  if (turnsRemaining === 2) return {
    level: "high",
    turnsRemaining,
    intensity: 67,
    label: "DECOHERENCIA PRÓXIMA",
    message: "Quedan dos turnos: prepara tu siguiente decisión.",
    cue: "high",
  };
  return {
    level: "maximum",
    turnsRemaining,
    intensity: 100,
    label: "ALERTA DE COLAPSO",
    message: "La próxima acción ejecutará la decoherencia.",
    cue: "peak",
  };
}

export function decoherencePressureCue(
  previousLevel: DecoherencePressureLevel | null,
  next: DecoherencePressureState,
): DecoherencePressureCue | null {
  if (previousLevel === null || previousLevel === next.level) return null;
  return next.cue;
}

export type ObservationAlertLevel = "stable" | "warning" | "risk" | "high" | "maximum";
export type ObservationAlertCue = "resourceWarning" | "resourceRisk" | "resourceHigh" | "resourceMaximum";

export interface ObservationAlertState {
  readonly level: ObservationAlertLevel;
  readonly intensity: 0 | 40 | 60 | 80 | 100;
  readonly label: string;
  readonly message: string;
  readonly cue: ObservationAlertCue | null;
}

export function deriveObservationAlert(observations: number): ObservationAlertState {
  if (observations >= 5) return {
    level: "stable",
    intensity: 0,
    label: "Recursos bajo control",
    message: "Tienes margen para explorar, pero conserva una ruta clara.",
    cue: null,
  };
  if (observations === 4) return {
    level: "warning",
    intensity: 40,
    label: "Pocas observaciones",
    message: "Te quedan pocas observaciones. Empieza a cerrar una ruta.",
    cue: "resourceWarning",
  };
  if (observations === 3) return {
    level: "risk",
    intensity: 60,
    label: "Zona de riesgo",
    message: "Zona de riesgo: cada observación cuenta.",
    cue: "resourceRisk",
  };
  if (observations === 2) return {
    level: "high",
    intensity: 80,
    label: "Alerta alta",
    message: "Alerta alta: necesitas una ruta muy eficiente o una batería.",
    cue: "resourceHigh",
  };
  return {
    level: "maximum",
    intensity: 100,
    label: observations === 1 ? "Última oportunidad" : "Sin observaciones",
    message: observations === 1 ? "Última oportunidad de observación." : "No quedan observaciones: busca una ruta abierta o una batería.",
    cue: "resourceMaximum",
  };
}

export function observationAlertCue(previousObservations: number, currentObservations: number): ObservationAlertCue | null {
  if (previousObservations === currentObservations) return null;
  const previous = deriveObservationAlert(previousObservations);
  const current = deriveObservationAlert(currentObservations);
  return previous.level === current.level ? null : current.cue;
}

export interface RouteEvent {
  readonly kind: "START" | "MOVE" | "OBSERVE" | "DECOHERENCE";
  readonly coordinate: Coordinate;
  readonly turn: number;
}

export interface MissionMetrics {
  readonly moves: number;
  readonly observations: number;
  readonly decoherences: number;
  readonly pulsesUsed: number;
  readonly coherenceBursts: number;
  readonly maxFlow: number;
}

export interface VisibleTacticalInfo {
  readonly potentialRoutes: number;
  readonly manhattanDistance: number;
  readonly estimatedObservationsNeeded: number;
  readonly estimatedMargin: number;
  readonly marginStatus: ResourceMarginStatus;
  readonly marginLabel: "ESTABLE" | "AJUSTADO" | "CRÍTICO";
  readonly marginMessage: string;
}

export type PulseStrategy = "PROGRESS" | "BATTERY" | "VOID_RISK";

export interface PulseRecommendation {
  readonly target: Coordinate;
  readonly strategy: PulseStrategy;
  readonly message: string;
  readonly visibleScore: number;
  readonly floorProbability: number;
  readonly batteryProbability: number;
  readonly voidProbability: number;
}

export const EMPTY_MISSION_METRICS: MissionMetrics = {
  moves: 0,
  observations: 0,
  decoherences: 0,
  pulsesUsed: 0,
  coherenceBursts: 0,
  maxFlow: 0,
};

export function coordinatesMatch(first: Coordinate, second: Coordinate): boolean {
  return first.row === second.row && first.col === second.col;
}

export function coordinateKey(coordinate: Coordinate): string {
  return `${coordinate.row}-${coordinate.col}`;
}

export function visibleNeighbors(state: GameState): Coordinate[] {
  return [
    { row: state.player.row - 1, col: state.player.col },
    { row: state.player.row, col: state.player.col + 1 },
    { row: state.player.row + 1, col: state.player.col },
    { row: state.player.row, col: state.player.col - 1 },
  ].filter(({ row, col }) => row >= 0 && row < 7 && col >= 0 && col < 7);
}

function cellAt(state: GameState, coordinate: Coordinate) {
  return state.board.find((candidate) => coordinatesMatch(candidate.coordinate, coordinate));
}

function isKnownBlocked(state: GameState, coordinate: Coordinate): boolean {
  const cell = cellAt(state, coordinate);
  return cell === undefined
    || (cell.kind === "COLLAPSED" && cell.outcome === "WALL")
    || (cell.kind === "COLLAPSED" && cell.outcome === "VOID" && state.energy <= 0);
}

function visibleRouteExists(state: GameState, start: Coordinate): boolean {
  const queue = [start];
  const visited = new Set([coordinateKey(start)]);
  for (let index = 0; index < queue.length; index += 1) {
    const current = queue[index];
    if (current === undefined) break;
    if (current.row === 0 && current.col === 6) return true;
    for (const next of [
      { row: current.row - 1, col: current.col },
      { row: current.row, col: current.col + 1 },
      { row: current.row + 1, col: current.col },
      { row: current.row, col: current.col - 1 },
    ]) {
      if (next.row < 0 || next.row >= 7 || next.col < 0 || next.col >= 7 || isKnownBlocked(state, next)) continue;
      const key = coordinateKey(next);
      if (!visited.has(key)) { visited.add(key); queue.push(next); }
    }
  }
  return false;
}

function visiblePotentialRouteCount(state: GameState, start: Coordinate): number {
  const startKey = coordinateKey(start);
  const exitKey = "0-6";
  const queue = [start];
  const distances = new Map<string, number>([[startKey, 0]]);
  const routeCounts = new Map<string, number>([[startKey, 1]]);

  for (let index = 0; index < queue.length; index += 1) {
    const current = queue[index];
    if (current === undefined) break;
    const currentKey = coordinateKey(current);
    const currentDistance = distances.get(currentKey) ?? 0;
    for (const next of visibleNeighbors({ ...state, player: current })) {
      if (isKnownBlocked(state, next)) continue;
      const nextKey = coordinateKey(next);
      const knownDistance = distances.get(nextKey);
      if (knownDistance === undefined) {
        distances.set(nextKey, currentDistance + 1);
        routeCounts.set(nextKey, routeCounts.get(currentKey) ?? 0);
        queue.push(next);
      } else if (knownDistance === currentDistance + 1) {
        routeCounts.set(nextKey, Math.min(999_999, (routeCounts.get(nextKey) ?? 0) + (routeCounts.get(currentKey) ?? 0)));
      }
    }
  }

  return routeCounts.get(exitKey) ?? 0;
}

function pulseMessage(strategy: PulseStrategy): string {
  if (strategy === "BATTERY") return "Tus observaciones son escasas; el Pulso está buscando una posibilidad de batería.";
  if (strategy === "VOID_RISK") return "Esta opción reduce el riesgo visible de vacío.";
  return "Esta posibilidad ofrece buen progreso hacia la salida.";
}

export function recommendQuantumPulse(state: GameState): PulseRecommendation | null {
  if (state.observations <= 0) return null;
  const tactical = deriveVisibleTacticalInfo(state);
  const currentDistance = Math.abs(state.player.row) + Math.abs(6 - state.player.col);
  const turnsUntilDecoherence = 4 - (state.turn % 4);
  const decoherenceSoon = turnsUntilDecoherence === 1;
  const weights = tactical.marginStatus === "STABLE"
    ? { floor: 1_000, battery: 40, void: 70, wall: 90, progress: 5, routes: 1.5, decoherence: 30 }
    : tactical.marginStatus === "TIGHT"
      ? { floor: 900, battery: 150, void: 110, wall: 120, progress: 4, routes: 2, decoherence: 45 }
      : { floor: 800, battery: 320, void: 170, wall: 140, progress: 3, routes: 2.5, decoherence: 60 };

  const ranked = visibleNeighbors(state)
    .map((coordinate) => {
      const cell = cellAt(state, coordinate);
      if (cell === undefined || cell.kind !== "UNRESOLVED") return null;
      const floorProbability = cell.distribution[0] ?? 0;
      const wallProbability = cell.distribution[1] ?? 0;
      const voidProbability = cell.distribution[2] ?? 0;
      const crystalProbability = cell.distribution[3] ?? 0;
      const batteryProbability = cell.distribution[4] ?? 0;
      const distance = Math.abs(coordinate.row) + Math.abs(6 - coordinate.col);
      const progress = currentDistance - distance;
      const potentialRoutes = visiblePotentialRouteCount(state, coordinate);
      const routeValue = Math.log2(1 + potentialRoutes);
      const routeOpen = visibleRouteExists(state, coordinate);
      const visibleScore = floorProbability * weights.floor
        + batteryProbability * weights.battery
        + crystalProbability * 16
        - voidProbability * weights.void
        - wallProbability * weights.wall
        + progress * weights.progress
        + routeValue * weights.routes
        + (routeOpen ? 8 : -24)
        - (decoherenceSoon ? (wallProbability + voidProbability) * weights.decoherence : 0);
      return { coordinate, visibleScore, floorProbability, batteryProbability, voidProbability };
    })
    .filter((entry): entry is {
      readonly coordinate: Coordinate;
      readonly visibleScore: number;
      readonly floorProbability: number;
      readonly batteryProbability: number;
      readonly voidProbability: number;
    } => entry !== null)
    .sort((first, second) => second.visibleScore - first.visibleScore
      || second.floorProbability - first.floorProbability
      || first.coordinate.row - second.coordinate.row
      || first.coordinate.col - second.coordinate.col);

  const selected = ranked[0];
  if (selected === undefined) return null;
  const strategy: PulseStrategy = tactical.marginStatus === "STABLE"
    ? "PROGRESS"
    : tactical.marginStatus === "CRITICAL" || selected.batteryProbability >= 0.12
      ? "BATTERY"
      : "VOID_RISK";
  return {
    target: selected.coordinate,
    strategy,
    message: pulseMessage(strategy),
    visibleScore: selected.visibleScore,
    floorProbability: selected.floorProbability,
    batteryProbability: selected.batteryProbability,
    voidProbability: selected.voidProbability,
  };
}

export function recommendPulseTarget(state: GameState): Coordinate | null {
  return recommendQuantumPulse(state)?.target ?? null;
}

function marginCopy(status: ResourceMarginStatus): Pick<VisibleTacticalInfo, "marginLabel" | "marginMessage"> {
  if (status === "STABLE") return { marginLabel: "ESTABLE", marginMessage: "Todavía tienes margen para explorar." };
  if (status === "TIGHT") return { marginLabel: "AJUSTADO", marginMessage: "Planifica bien: tus observaciones comienzan a escasear." };
  return { marginLabel: "CRÍTICO", marginMessage: "Necesitas una ruta corta o encontrar una batería." };
}

export function deriveVisibleTacticalInfo(state: GameState): VisibleTacticalInfo {
  const startKey = coordinateKey(state.player);
  const exitKey = "0-6";
  const queue: Coordinate[] = [state.player];
  const distances = new Map<string, number>([[startKey, 0]]);
  const routeCounts = new Map<string, number>([[startKey, 1]]);

  for (let index = 0; index < queue.length; index += 1) {
    const current = queue[index];
    if (current === undefined) break;
    const currentKey = coordinateKey(current);
    const currentDistance = distances.get(currentKey) ?? 0;
    for (const next of [
      { row: current.row - 1, col: current.col },
      { row: current.row, col: current.col + 1 },
      { row: current.row + 1, col: current.col },
      { row: current.row, col: current.col - 1 },
    ]) {
      if (next.row < 0 || next.row >= 7 || next.col < 0 || next.col >= 7 || isKnownBlocked(state, next)) continue;
      const nextKey = coordinateKey(next);
      const knownDistance = distances.get(nextKey);
      if (knownDistance === undefined) {
        distances.set(nextKey, currentDistance + 1);
        routeCounts.set(nextKey, routeCounts.get(currentKey) ?? 0);
        queue.push(next);
      } else if (knownDistance === currentDistance + 1) {
        routeCounts.set(nextKey, Math.min(999_999, (routeCounts.get(nextKey) ?? 0) + (routeCounts.get(currentKey) ?? 0)));
      }
    }
  }

  const costs = new Map<string, number>([[startKey, 0]]);
  const pending = new Set(state.board.map((cell) => coordinateKey(cell.coordinate)));
  while (pending.size > 0) {
    let currentKey: string | null = null;
    let currentCost = Number.POSITIVE_INFINITY;
    for (const key of pending) {
      const cost = costs.get(key) ?? Number.POSITIVE_INFINITY;
      if (cost < currentCost || (cost === currentCost && key < (currentKey ?? key))) { currentKey = key; currentCost = cost; }
    }
    if (currentKey === null || !Number.isFinite(currentCost)) break;
    pending.delete(currentKey);
    const [rowText, colText] = currentKey.split("-");
    const current = { row: Number(rowText), col: Number(colText) };
    for (const next of [
      { row: current.row - 1, col: current.col },
      { row: current.row, col: current.col + 1 },
      { row: current.row + 1, col: current.col },
      { row: current.row, col: current.col - 1 },
    ]) {
      const nextKey = coordinateKey(next);
      if (!pending.has(nextKey) || isKnownBlocked(state, next)) continue;
      const cell = cellAt(state, next);
      const nextCost = currentCost + (cell?.kind === "UNRESOLVED" ? 1 : 0);
      if (nextCost < (costs.get(nextKey) ?? Number.POSITIVE_INFINITY)) costs.set(nextKey, nextCost);
    }
  }

  const estimatedObservationsNeeded = costs.get(exitKey) ?? state.observations + 1;
  const estimatedMargin = state.observations - estimatedObservationsNeeded;
  const marginStatus: ResourceMarginStatus = estimatedMargin >= 3 ? "STABLE" : estimatedMargin >= 1 ? "TIGHT" : "CRITICAL";
  return {
    potentialRoutes: routeCounts.get(exitKey) ?? 0,
    manhattanDistance: Math.abs(state.player.row) + Math.abs(6 - state.player.col),
    estimatedObservationsNeeded,
    estimatedMargin,
    marginStatus,
    ...marginCopy(marginStatus),
  };
}

export function deriveConsoleStatus(
  state: GameState,
  selected: Coordinate | null,
  canMove: boolean,
): ConsoleStatus {
  if (4 - (state.turn % 4) === 1) return "Decoherencia próxima";
  if (selected === null) return "Analizando campo";
  if (selected.row === 0 && selected.col === 6) return "Salida alcanzable";
  const cell = state.board.find((candidate) => coordinatesMatch(candidate.coordinate, selected));
  if (cell?.kind === "COLLAPSED" && cell.outcome === "WALL") return "Ruta bloqueada";
  if (canMove) return "Camino disponible";
  if (cell?.kind === "UNRESOLVED") return "Posibilidad seleccionada";
  return "Analizando campo";
}

export function appendEventLog(current: readonly string[], next: readonly string[]): readonly string[] {
  const deduplicated = [...current];
  for (const message of next) {
    const existing = deduplicated.indexOf(message);
    if (existing >= 0) deduplicated.splice(existing, 1);
    deduplicated.push(message);
  }
  return deduplicated.slice(-3);
}
