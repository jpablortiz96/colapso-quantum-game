import { createHash } from "node:crypto";
import {
  analyzeRoutes,
  deserializeGameState,
  processAction,
  type Action,
  type GameState,
  type Result,
} from "../frontend/src/engine/index.ts";
import { createResolutionEntropySource } from "../frontend/src/daily-universe/client.ts";
import { publishedDailyUniverse } from "../frontend/src/daily-game/universe.ts";
import { GUIDED_JOURNEY } from "../frontend/src/components/guided-journey.ts";
import { auditGuidedRoute } from "../frontend/src/components/guided-route-integrity.ts";
import { recommendPulseTarget } from "../frontend/src/components/mission-control.ts";

const BOARD_SIZE = 7;
const MONTE_CARLO_RUNS = 500;
const SEARCH_LIMIT = 100_000;
const MAX_REPORTED_SOLUTIONS = 256;
const decoded = deserializeGameState(publishedDailyUniverse.serializedInitialGameState);
if (!decoded.ok) throw new Error("Published universe could not be decoded through the public F1 API.");
const initialState = decoded.value;
const observationBudgets = {
  quantumMission: initialState.observations,
  explorer: 13,
  guided: 13,
} as const;

type Coordinate = GameState["player"];
type SearchNode = { readonly actions: readonly Action[]; readonly state: GameState; readonly entropyIndex: number };
type EntropyFailure = { readonly kind: "ENTROPY_EXHAUSTED" };
type EntropyResult = Result<number, EntropyFailure>;
type EntropyContext = Parameters<ReturnType<typeof createResolutionEntropySource>["nextUint32"]>[0];
type EntropyLike = { nextUint32: (context: EntropyContext) => EntropyResult };
type TargetStrategy = (state: GameState, visits: ReadonlyMap<string, number>) => Coordinate | null;
type PulseTargetStrategy = (state: GameState) => Coordinate | null;

function sameCoordinate(first: Coordinate, second: Coordinate): boolean {
  return first.row === second.row && first.col === second.col;
}

function coordinateKey(coordinate: Coordinate): string {
  return `${coordinate.row}-${coordinate.col}`;
}

function neighbors(coordinate: Coordinate): Coordinate[] {
  return [
    { row: coordinate.row - 1, col: coordinate.col },
    { row: coordinate.row, col: coordinate.col + 1 },
    { row: coordinate.row + 1, col: coordinate.col },
    { row: coordinate.row, col: coordinate.col - 1 },
  ].filter(({ row, col }) => row >= 0 && row < BOARD_SIZE && col >= 0 && col < BOARD_SIZE);
}

function forwardNeighbors(coordinate: Coordinate): Coordinate[] {
  return neighbors(coordinate).filter(
    (candidate) => candidate.row < coordinate.row || candidate.col > coordinate.col,
  );
}

function cellAt(state: GameState, coordinate: Coordinate) {
  return state.board.find((cell) => sameCoordinate(cell.coordinate, coordinate));
}

const canonicalEntropy = createResolutionEntropySource(publishedDailyUniverse.resolutionPlan);
const canonicalWords: number[] = [];

class BranchEntropy implements EntropyLike {
  index: number;
  constructor(index: number) { this.index = index; }
  nextUint32(context: EntropyContext): EntropyResult {
    if (this.index === canonicalWords.length) {
      const next = canonicalEntropy.nextUint32(context);
      if (!next.ok) return next as EntropyResult;
      canonicalWords.push(next.value);
    }
    const value = canonicalWords[this.index];
    this.index += 1;
    return value === undefined ? { ok: false, error: { kind: "ENTROPY_EXHAUSTED" } } : { ok: true, value };
  }
}

class SeededEntropy implements EntropyLike {
  private value: number;
  constructor(seed: number) { this.value = seed >>> 0 || 0x9e3779b9; }
  nextUint32(): EntropyResult {
    let value = this.value;
    value ^= value << 13;
    value ^= value >>> 17;
    value ^= value << 5;
    this.value = value >>> 0;
    return { ok: true, value: this.value };
  }
}

function candidateActions(state: GameState, allowGates: boolean): Action[] {
  const actions: Action[] = [];
  for (const target of forwardNeighbors(state.player)) {
    const cell = cellAt(state, target);
    if (cell?.kind === "UNRESOLVED") {
      actions.push({ kind: "OBSERVE", target });
      if (allowGates && state.inventory.includes("X")) actions.push({ kind: "APPLY_GATE", gate: "X", target });
      if (allowGates && state.inventory.includes("H")) actions.push({ kind: "APPLY_GATE", gate: "H", target });
    } else if (cell?.kind === "COLLAPSED") {
      actions.push({ kind: "MOVE", target });
    }
  }
  return actions;
}

function findWinningSolutions(allowGates: boolean): readonly SearchNode[] {
  const queue: SearchNode[] = [{ actions: [], state: initialState, entropyIndex: 0 }];
  const visited = new Set<string>();
  const winners: SearchNode[] = [];
  for (let cursor = 0; cursor < queue.length && cursor < SEARCH_LIMIT && winners.length < MAX_REPORTED_SOLUTIONS; cursor += 1) {
    const node = queue[cursor] as SearchNode;
    if (node.state.status === "VICTORY") {
      winners.push(node);
      continue;
    }
    if (node.state.status === "DEFEAT" || node.actions.length >= 34) continue;
    const key = `${node.entropyIndex}:${JSON.stringify(node.state)}`;
    if (visited.has(key)) continue;
    visited.add(key);
    for (const action of candidateActions(node.state, allowGates)) {
      const entropy = new BranchEntropy(node.entropyIndex);
      const result = processAction(node.state, action, entropy as Parameters<typeof processAction>[2]);
      if (result.ok) queue.push({ actions: [...node.actions, action], state: result.state, entropyIndex: entropy.index });
    }
  }
  return winners;
}

function routeSequences(): Coordinate[][] {
  const routes: Coordinate[][] = [];
  const walk = (current: Coordinate, route: Coordinate[]) => {
    if (current.row === 0 && current.col === 6) {
      routes.push(route);
      return;
    }
    for (const next of forwardNeighbors(current)) walk(next, [...route, next]);
  };
  walk(initialState.player, []);
  return routes;
}

function simulateDirectRoute(route: readonly Coordinate[]): boolean {
  const entropy = createResolutionEntropySource(publishedDailyUniverse.resolutionPlan);
  let state = initialState;
  for (const target of route) {
    if (cellAt(state, target)?.kind === "UNRESOLVED") {
      const observation = processAction(state, { kind: "OBSERVE", target }, entropy as Parameters<typeof processAction>[2]);
      if (!observation.ok) return false;
      state = observation.state;
    }
    const movement = processAction(state, { kind: "MOVE", target }, entropy as Parameters<typeof processAction>[2]);
    if (!movement.ok) return false;
    state = movement.state;
  }
  return state.status === "VICTORY";
}

function basicVisibleTarget(state: GameState, visits: ReadonlyMap<string, number>): Coordinate | null {
  const ranked = neighbors(state.player)
    .map((coordinate) => {
      const cell = cellAt(state, coordinate);
      if (cell === undefined || (cell.kind === "COLLAPSED" && cell.outcome === "WALL")) return null;
      const distance = coordinate.row + (6 - coordinate.col);
      const priorVisits = visits.get(coordinateKey(coordinate)) ?? 0;
      const visibleValue = cell.kind === "UNRESOLVED"
        ? (cell.distribution[0] ?? 0) * 100
        : cell.outcome === "BATTERY" ? 145 : cell.outcome === "CRYSTAL" ? 128 : 118;
      return { coordinate, score: visibleValue - distance * 7 - priorVisits * 24 };
    })
    .filter((entry): entry is { coordinate: Coordinate; score: number } => entry !== null)
    .sort((first, second) => second.score - first.score
      || first.coordinate.row - second.coordinate.row
      || first.coordinate.col - second.coordinate.col);
  return ranked[0]?.coordinate ?? null;
}

function entryCost(state: GameState, coordinate: Coordinate, visits: ReadonlyMap<string, number>): number {
  const cell = cellAt(state, coordinate);
  if (cell === undefined || (cell.kind === "COLLAPSED" && cell.outcome === "WALL")) return Number.POSITIVE_INFINITY;
  if (cell.kind === "COLLAPSED" && cell.outcome === "VOID" && state.energy <= 0) return Number.POSITIVE_INFINITY;
  const visitCost = (visits.get(coordinateKey(coordinate)) ?? 0) * 2;
  if (cell.kind === "UNRESOLVED") return 1 + (1 - (cell.distribution[0] ?? 0)) * 4 + visitCost;
  if (cell.outcome === "BATTERY") return Math.max(0, visitCost - 0.75);
  return visitCost;
}

function improvedVisibleTarget(state: GameState, visits: ReadonlyMap<string, number>): Coordinate | null {
  const start = coordinateKey(state.player);
  const exit = "0-6";
  const costs = new Map<string, number>([[start, 0]]);
  const previous = new Map<string, string>();
  const coordinates = new Map(state.board.map((cell) => [coordinateKey(cell.coordinate), cell.coordinate]));
  const pending = new Set(coordinates.keys());

  while (pending.size > 0) {
    let currentKey: string | null = null;
    let currentCost = Number.POSITIVE_INFINITY;
    for (const key of pending) {
      const cost = costs.get(key) ?? Number.POSITIVE_INFINITY;
      if (cost < currentCost || (cost === currentCost && key < (currentKey ?? key))) {
        currentKey = key;
        currentCost = cost;
      }
    }
    if (currentKey === null || !Number.isFinite(currentCost)) break;
    pending.delete(currentKey);
    if (currentKey === exit) break;
    const current = coordinates.get(currentKey);
    if (current === undefined) break;
    for (const next of neighbors(current)) {
      const nextKey = coordinateKey(next);
      if (!pending.has(nextKey)) continue;
      const nextCost = currentCost + entryCost(state, next, visits) + 0.08;
      if (nextCost < (costs.get(nextKey) ?? Number.POSITIVE_INFINITY)) {
        costs.set(nextKey, nextCost);
        previous.set(nextKey, currentKey);
      }
    }
  }

  if (!costs.has(exit)) return basicVisibleTarget(state, visits);
  let cursor = exit;
  let parent = previous.get(cursor);
  while (parent !== undefined && parent !== start) {
    cursor = parent;
    parent = previous.get(cursor);
  }
  return parent === start ? coordinates.get(cursor) ?? null : basicVisibleTarget(state, visits);
}

function pulseVisibleTarget(state: GameState): Coordinate | null {
  return neighbors(state.player)
    .map((coordinate) => {
      const cell = cellAt(state, coordinate);
      if (cell === undefined || cell.kind !== "UNRESOLVED") return null;
      const floorProbability = cell.distribution[0] ?? 0;
      const distance = coordinate.row + (6 - coordinate.col);
      return { coordinate, floorProbability, distance };
    })
    .filter((entry): entry is { coordinate: Coordinate; floorProbability: number; distance: number } => entry !== null)
    .sort((first, second) => second.floorProbability - first.floorProbability
      || first.distance - second.distance
      || first.coordinate.row - second.coordinate.row
      || first.coordinate.col - second.coordinate.col)[0]?.coordinate ?? null;
}

function runVisibleStrategy(
  seed: number,
  strategy: TargetStrategy,
  explorerPulses = 0,
  pulseStrategy: PulseTargetStrategy = pulseVisibleTarget,
  observationBudget = initialState.observations,
): boolean {
  const entropy = new SeededEntropy(seed);
  const visits = new Map<string, number>();
  let pulses = explorerPulses;
  let state: GameState = { ...initialState, observations: observationBudget };
  for (let actionCount = 0; (actionCount < 80 && state.status === "PLAYING") || (actionCount === 0 && state.status === "START"); actionCount += 1) {
    const planned = strategy(state, visits);
    const pulse = pulses > 0 ? pulseStrategy(state) : null;
    const target = pulse ?? planned;
    if (target === null) return false;
    if (pulse !== null && cellAt(state, pulse)?.kind === "UNRESOLVED") pulses -= 1;
    const key = coordinateKey(target);
    visits.set(key, (visits.get(key) ?? 0) + 1);
    const cell = cellAt(state, target);
    const action: Action = cell?.kind === "UNRESOLVED"
      ? { kind: "OBSERVE", target }
      : { kind: "MOVE", target };
    const result = processAction(state, action, entropy as Parameters<typeof processAction>[2]);
    if (!result.ok) return false;
    state = result.state;
  }
  return state.status === "VICTORY";
}

function replayGuidedCandidate(actions: readonly Action[], observationBudget = initialState.observations): GameState | null {
  const entropy = createResolutionEntropySource(publishedDailyUniverse.resolutionPlan);
  let state: GameState = { ...initialState, observations: observationBudget };
  for (const action of actions) {
    const result = processAction(state, action, entropy as Parameters<typeof processAction>[2]);
    if (!result.ok) return null;
    state = result.state;
  }
  return state.status === "VICTORY" ? state : null;
}

function successRate(wins: number, runs: number): { readonly runs: number; readonly wins: number; readonly successPercent: number } {
  return { runs, wins, successPercent: Number(((wins / runs) * 100).toFixed(1)) };
}

const guidedTranscript = GUIDED_JOURNEY.steps.map((step) => step.action);
const guidedTranscriptHash = createHash("sha256").update(JSON.stringify(guidedTranscript)).digest("hex");
const guidedAudit = auditGuidedRoute();
const guidedReplayFirst = replayGuidedCandidate(guidedTranscript);
const guidedReplaySecond = replayGuidedCandidate(guidedTranscript);
const guidedReplayIdentical = guidedReplayFirst !== null
  && guidedReplaySecond !== null
  && JSON.stringify(guidedReplayFirst) === JSON.stringify(guidedReplaySecond);
const guidedV24Replay = replayGuidedCandidate(guidedTranscript, observationBudgets.guided);
if (
  !guidedAudit.ok
  || guidedAudit.finalState === null
  || guidedTranscriptHash !== GUIDED_JOURNEY.actionTranscriptSha256
  || !guidedReplayIdentical
  || guidedV24Replay === null
) {
  throw new Error(`BLOCKED: guided route integrity failed: ${guidedAudit.error ?? "hash or replay mismatch"}`);
}

const routeAnalysis = analyzeRoutes(initialState);
const structuralRoutes = routeSequences();
const directWinningRoutes = structuralRoutes.filter(simulateDirectRoute).length;
const noGateWinners = findWinningSolutions(false);
const winningSolutions = noGateWinners.length > 0 ? noGateWinners : findWinningSolutions(true);
const canonicalWinner = winningSolutions[0] ?? null;

if (canonicalWinner === null) {
  console.error("BLOCKED: no winning route was found for published Universe #001.");
  process.exitCode = 1;
} else {
  const replayedGuidedState = replayGuidedCandidate(canonicalWinner.actions);
  if (replayedGuidedState === null) throw new Error("Guided candidate did not replay to victory through public F1 processAction.");
  const moves = canonicalWinner.actions.filter((action) => action.kind === "MOVE").length;
  const observations = canonicalWinner.actions.filter((action) => action.kind === "OBSERVE").length;
  const gates = canonicalWinner.actions.filter((action) => action.kind === "APPLY_GATE");
  const batteryRequiredSolutions = winningSolutions.filter((winner) =>
    winner.actions.filter((action) => action.kind === "OBSERVE").length > initialState.observations,
  ).length;
  const requiresBattery = observations > initialState.observations;
  const recoveredBatteries = replayedGuidedState.collectedBatteries.length;
  const effectiveObservationBudget = initialState.observations + recoveredBatteries;
  let basicWins = 0;
  let improvedWins = 0;
  let explorerV21Wins = 0;
  let explorerV22Wins = 0;
  let explorerV24Wins = 0;
  for (let seed = 1; seed <= MONTE_CARLO_RUNS; seed += 1) {
    if (runVisibleStrategy(seed, basicVisibleTarget)) basicWins += 1;
    if (runVisibleStrategy(seed, improvedVisibleTarget)) improvedWins += 1;
    if (runVisibleStrategy(seed, improvedVisibleTarget, 5, pulseVisibleTarget)) explorerV21Wins += 1;
    if (runVisibleStrategy(seed, improvedVisibleTarget, 5, recommendPulseTarget)) explorerV22Wins += 1;
    if (runVisibleStrategy(seed, improvedVisibleTarget, 5, recommendPulseTarget, observationBudgets.explorer)) explorerV24Wins += 1;
  }
  if (explorerV22Wins < explorerV21Wins) {
    throw new Error(`Explorer V2.2 regressed on the shared deterministic seeds: ${explorerV22Wins} < ${explorerV21Wins}.`);
  }
  if (explorerV24Wins < explorerV22Wins) {
    throw new Error(`Explorer V2.4 regressed after the 13-observation rebalance: ${explorerV24Wins} < ${explorerV22Wins}.`);
  }
  const serializedActions = JSON.stringify(canonicalWinner.actions);
  const result = {
    universe: "REAL #001",
    rulesVersion: initialState.rulesVersion,
    winningRouteExists: true,
    publicRouteAnalysis: routeAnalysis,
    initialObservations: initialState.observations,
    observationBudgets: {
      quantumMission: { initial: observationBudgets.quantumMission, canonicalConfiguration: true },
      explorer: { initial: observationBudgets.explorer, additionalVsCanonical: observationBudgets.explorer - observationBudgets.quantumMission },
      guided: { initial: observationBudgets.guided, additionalVsCanonical: observationBudgets.guided - observationBudgets.quantumMission },
    },
    knownMinimumMoves: moves,
    estimatedMinimumObservations: observations,
    routeDependsOnBattery: requiresBattery,
    winningSolutionsFound: winningSolutions.length,
    winningSolutionsSearchCap: MAX_REPORTED_SOLUTIONS,
    solutionsRequiringBattery: batteryRequiredSolutions,
    marginForError: {
      effectiveObservationBudget,
      observationsRequired: observations,
      spareObservations: effectiveObservationBudget - observations,
      explanation: `${effectiveObservationBudget - observations} observación adicional disponible en la configuración canónica con la batería recuperada.`,
      byMode: {
        quantumMission: observationBudgets.quantumMission - observations,
        explorer: observationBudgets.explorer - observations,
        guided: observationBudgets.guided - observations,
      },
    },
    structuralShortestRoutes: structuralRoutes.length,
    initiallyLegalPotentialRoutes: routeAnalysis.legalPotentialRoute ? structuralRoutes.length : 0,
    directCanonicalWinningRoutes: directWinningRoutes,
    requiresPowerXOrH: gates.length > 0,
    resources: {
      availableInitiallyByMode: {
        quantumMission: { observations: observationBudgets.quantumMission, energy: initialState.energy, powers: initialState.inventory },
        explorer: { observations: observationBudgets.explorer, energy: initialState.energy, powers: initialState.inventory, pulses: 5 },
        guided: { observations: observationBudgets.guided, energy: initialState.energy, powers: initialState.inventory, rewinds: 3 },
      },
      winningStrategySpends: { observations, minimumEnergy: 1 },
      recoveredBatteries,
      canonicalRemaining: { observations: replayedGuidedState.observations, energy: replayedGuidedState.energy },
      guidedV24Remaining: { observations: guidedV24Replay.observations, energy: guidedV24Replay.energy },
    },
    estimatedSuccessRates: {
      basicVisibleStrategy: { ...successRate(basicWins, MONTE_CARLO_RUNS), usesHiddenOutcomes: false },
      improvedVisibleStrategy: { ...successRate(improvedWins, MONTE_CARLO_RUNS), usesHiddenOutcomes: false },
      explorerV21: { ...successRate(explorerV21Wins, MONTE_CARLO_RUNS), usesHiddenOutcomes: false },
      explorerV22: {
        ...successRate(explorerV22Wins, MONTE_CARLO_RUNS),
        usesHiddenOutcomes: false,
        observationBudget: observationBudgets.quantumMission,
        changeFromV21Wins: explorerV22Wins - explorerV21Wins,
        explanation: "Visible margin-sensitive scoring balances progress, public battery probability, public void risk, remaining routes and imminent decoherence.",
      },
      explorerV24: {
        ...successRate(explorerV24Wins, MONTE_CARLO_RUNS),
        usesHiddenOutcomes: false,
        observationBudget: observationBudgets.explorer,
        changeFromV22Wins: explorerV24Wins - explorerV22Wins,
        explanation: "Explorer V2.4 keeps the same public strategy and adds three initial observations.",
      },
      guidedJourney: { ...successRate(1, 1), observationBudget: observationBudgets.guided, replayedThroughPublicF1: true },
    },
    guidedRouteIntegrity: {
      valid: guidedAudit.ok,
      actionsProcessed: guidedAudit.actionsProcessed,
      batteryCollected: guidedAudit.batteryCollected,
      decoherencesSurvived: guidedAudit.decoherencesSurvived,
      finalObservations: guidedAudit.finalObservations,
      initialStateUnchanged: guidedAudit.initialStateUnchanged,
      deterministicReplay: guidedReplayIdentical,
      expectedHash: GUIDED_JOURNEY.actionTranscriptSha256,
      actualHash: guidedTranscriptHash,
    },
    guidedSolutionCandidate: {
      version: 1,
      universeNumber: publishedDailyUniverse.universeNumber,
      rulesVersion: initialState.rulesVersion,
      integrityReference: publishedDailyUniverse.commitment,
      actionTranscriptSha256: createHash("sha256").update(serializedActions).digest("hex"),
      actions: canonicalWinner.actions,
    },
  };
  console.log("COLAPSO V2.4 — OFFLINE DIFFICULTY ANALYSIS");
  console.log(JSON.stringify(result, null, 2));
}
