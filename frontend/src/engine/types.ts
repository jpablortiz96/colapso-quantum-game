export type Outcome = "FLOOR" | "WALL" | "VOID" | "CRYSTAL" | "BATTERY";

export type GameStatus = "START" | "PLAYING" | "VICTORY" | "DEFEAT";

export type GateKind = "X" | "H";

export type PairPolicy = "CORRELATED" | "ANTI_CORRELATED";

export type Coordinate = Readonly<{
  row: number;
  col: number;
}>;

export type Distribution = readonly [number, number, number, number, number];

export type UnresolvedCell = Readonly<{
  kind: "UNRESOLVED";
  coordinate: Coordinate;
  distribution: Distribution;
}>;

export type CollapsedCell = Readonly<{
  kind: "COLLAPSED";
  coordinate: Coordinate;
  outcome: Outcome;
}>;

export type Cell = UnresolvedCell | CollapsedCell;

export type EntangledPair = Readonly<{
  id: string;
  memberA: Coordinate;
  memberB: Coordinate;
  policy: PairPolicy;
}>;

export type TerminalReason =
  | "EXIT_REACHED"
  | "INSUFFICIENT_VOID_ENERGY"
  | "IRREVERSIBLE_BLOCKAGE"
  | "RESOURCE_DEAD_END";

export type DefeatReason = Exclude<TerminalReason, "EXIT_REACHED">;

export type RuleConfig = Readonly<{
  rulesVersion: 1;
  boardSize: 7;
  initialObservations: 10;
  maxObservations: 13;
  initialEnergy: 1;
  voidEnergyPenalty: 1;
  inventoryCapacity: 2;
  decoherenceInterval: 4;
}>;

export type GameState = Readonly<{
  schemaVersion: 1;
  rulesVersion: 1;
  status: GameStatus;
  terminalReason: TerminalReason | null;
  turn: number;
  board: readonly Cell[];
  player: Coordinate;
  observations: number;
  energy: number;
  inventory: readonly GateKind[];
  pairs: readonly EntangledPair[];
  collectedCrystals: readonly Coordinate[];
  collectedBatteries: readonly Coordinate[];
}>;

export type ObserveAction = Readonly<{
  kind: "OBSERVE";
  target: Coordinate;
}>;

export type ApplyGateAction = Readonly<{
  kind: "APPLY_GATE";
  gate: GateKind;
  target: Coordinate;
}>;

export type MoveAction = Readonly<{
  kind: "MOVE";
  target: Coordinate;
}>;

export type Action = ObserveAction | ApplyGateAction | MoveAction;

export type CollapseCause = "OBSERVATION" | "DECOHERENCE";

export type EngineEvent =
  | Readonly<{
      kind: "GAME_STARTED";
      status: "PLAYING";
    }>
  | Readonly<{
      kind: "OBSERVATION_SPENT";
      target: Coordinate;
      remainingObservations: number;
    }>
  | Readonly<{
      kind: "GATE_APPLIED";
      gate: GateKind;
      target: Coordinate;
      distributionBefore: Distribution;
      distributionAfter: Distribution;
      remainingInventory: readonly GateKind[];
    }>
  | Readonly<{
      kind: "CELL_COLLAPSED";
      coordinate: Coordinate;
      outcome: Outcome;
      cause: CollapseCause;
      pairId: string | null;
    }>
  | Readonly<{
      kind: "PLAYER_MOVED";
      from: Coordinate;
      to: Coordinate;
    }>
  | Readonly<{
      kind: "CRYSTAL_COLLECTED";
      coordinate: Coordinate;
      collectedCrystals: number;
    }>
  | Readonly<{
      kind: "BATTERY_COLLECTED";
      coordinate: Coordinate;
      observationsBefore: number;
      observationsAfter: number;
    }>
  | Readonly<{
      kind: "VOID_ENTRY";
      from: Coordinate;
      target: Coordinate;
      energyBefore: number;
      energyAfter: number;
      sufficientEnergy: boolean;
    }>
  | Readonly<{
      kind: "TURN_ADVANCED";
      turn: number;
    }>
  | Readonly<{
      kind: "DECOHERENCE_SELECTED";
      turn: number;
      coordinate: Coordinate;
      pairId: string | null;
    }>
  | Readonly<{
      kind: "STATUS_CHANGED";
      status: "VICTORY";
      reason: "EXIT_REACHED";
    }>
  | Readonly<{
      kind: "STATUS_CHANGED";
      status: "DEFEAT";
      reason: DefeatReason;
    }>;

export type Result<T, E> =
  | Readonly<{ ok: true; value: T }>
  | Readonly<{ ok: false; error: E }>;

export type ActionResult<E> =
  | Readonly<{
      ok: true;
      state: GameState;
      events: readonly EngineEvent[];
      entropyDelta: readonly EntropyRecord[];
    }>
  | Readonly<{
      ok: false;
      state: GameState;
      events: readonly [];
      error: E;
    }>;

export type EntropyContext =
  | Readonly<{
      operation: "OBSERVE_COLLAPSE";
      coordinate: Coordinate;
      pairId: string | null;
    }>
  | Readonly<{
      operation: "DECOHERENCE_SELECT";
      turn: number;
      candidateCount: number;
    }>
  | Readonly<{
      operation: "DECOHERENCE_COLLAPSE";
      turn: number;
      coordinate: Coordinate;
      pairId: string | null;
    }>;

export type EntropyRecord = Readonly<{
  context: EntropyContext;
  word: number;
}>;

export interface EntropySource<E = unknown> {
  nextUint32(context: EntropyContext): Result<number, E>;
}

export type CoordinateDto = Readonly<{
  row: number;
  col: number;
}>;

export type DistributionDto = readonly [number, number, number, number, number];

export type CellDto =
  | Readonly<{
      kind: "UNRESOLVED";
      coordinate: CoordinateDto;
      distribution: DistributionDto;
    }>
  | Readonly<{
      kind: "COLLAPSED";
      coordinate: CoordinateDto;
      outcome: Outcome;
    }>;

export type EntangledPairDto = Readonly<{
  id: string;
  memberA: CoordinateDto;
  memberB: CoordinateDto;
  policy: PairPolicy;
}>;

export type GameStateDto = Readonly<{
  schemaVersion: 1;
  rulesVersion: 1;
  status: GameStatus;
  terminalReason: TerminalReason | null;
  turn: number;
  board: readonly CellDto[];
  player: CoordinateDto;
  observations: number;
  energy: number;
  inventory: readonly GateKind[];
  pairs: readonly EntangledPairDto[];
  collectedCrystals: readonly CoordinateDto[];
  collectedBatteries: readonly CoordinateDto[];
}>;

export type ReplayInitialDto =
  | Readonly<{ kind: "SEED"; seed: string }>
  | Readonly<{ kind: "UNIVERSE"; universe: GameStateDto }>;

export type ReplayDto = Readonly<{
  replaySchemaVersion: 1;
  rulesVersion: 1;
  initial: ReplayInitialDto;
  actions: readonly Action[];
  entropyTranscript: readonly EntropyRecord[];
  expectedFinalState: GameStateDto;
  expectedFinalScore: number;
}>;

export type ReplayOutputDto = Readonly<{
  replaySchemaVersion: 1;
  rulesVersion: 1;
  finalState: GameStateDto;
  finalScore: number;
  consumedEntropy: number;
}>;
