import {
  BOARD_CELL_COUNT,
  BOARD_SIZE,
  ENTRY_COORDINATE,
  EXIT_COORDINATE,
  INITIAL_ENERGY,
  INITIAL_INVENTORY,
  INITIAL_OBSERVATIONS,
  MAX_OBSERVATIONS,
  OUTCOME_ORDER,
  PAIR_POLICY_ORDER,
  PASSABLE_OUTCOMES,
  RULES_VERSION,
  SCHEMA_VERSION,
  TERMINAL_REASON_ORDER,
} from "./constants";
import {
  compareCoordinates,
  coordinateKey,
  coordinatesEqual,
  validateCoordinate,
} from "./coordinates";
import { validateDistribution } from "./distribution";
import { analyzeRoutes } from "./routes";
import type {
  InvalidStateError,
  InvalidStateReason,
  StateValidationError,
  StateValidationResult,
} from "./errors";
import type {
  Cell,
  Coordinate,
  DefeatReason,
  GameState,
  GateKind,
  Outcome,
  PairPolicy,
  TerminalReason,
} from "./types";

const STATE_KEYS = Object.freeze([
  "schemaVersion",
  "rulesVersion",
  "status",
  "terminalReason",
  "turn",
  "board",
  "player",
  "observations",
  "energy",
  "inventory",
  "pairs",
  "collectedCrystals",
  "collectedBatteries",
] as const);

const UNRESOLVED_CELL_KEYS = Object.freeze([
  "kind",
  "coordinate",
  "distribution",
] as const);
const COLLAPSED_CELL_KEYS = Object.freeze([
  "kind",
  "coordinate",
  "outcome",
] as const);
const PAIR_KEYS = Object.freeze([
  "id",
  "memberA",
  "memberB",
  "policy",
] as const);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const hasExactKeys = (
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean => {
  const actual = Object.keys(value);
  return (
    actual.length === expected.length &&
    expected.every((key) => Object.hasOwn(value, key))
  );
};

const invalidState = (
  reason: InvalidStateReason,
  path: string,
  message: string,
): StateValidationResult => ({
  ok: false,
  error: { kind: "INVALID_STATE", reason, path, message },
});

const invalidStateError = (
  reason: InvalidStateReason,
  path: string,
  message: string,
): InvalidStateError => ({ kind: "INVALID_STATE", reason, path, message });

const isOutcome = (value: unknown): value is Outcome =>
  typeof value === "string" &&
  (OUTCOME_ORDER as readonly string[]).includes(value);

const isPairPolicy = (value: unknown): value is PairPolicy =>
  typeof value === "string" &&
  (PAIR_POLICY_ORDER as readonly string[]).includes(value);

const isTerminalReason = (value: unknown): value is TerminalReason =>
  typeof value === "string" &&
  (TERMINAL_REASON_ORDER as readonly string[]).includes(value);

const isDefeatReason = (value: unknown): value is DefeatReason =>
  value === "INSUFFICIENT_VOID_ENERGY" ||
  value === "IRREVERSIBLE_BLOCKAGE" ||
  value === "RESOURCE_DEAD_END";

const isCanonicalNonNegativeSafeInteger = (value: unknown): value is number =>
  typeof value === "number" &&
  Number.isSafeInteger(value) &&
  value >= 0 &&
  !Object.is(value, -0);

const boardIndex = (coordinate: Coordinate): number =>
  coordinate.row * BOARD_SIZE + coordinate.col;

const isInitialInventory = (inventory: readonly GateKind[]): boolean =>
  inventory.length === INITIAL_INVENTORY.length &&
  inventory.every((gate, index) => gate === INITIAL_INVENTORY[index]);

const validateInventory = (value: unknown): InvalidStateError | null => {
  if (!Array.isArray(value) || value.length > 2) {
    return invalidStateError(
      "INVENTORY",
      "inventory",
      "Inventory must be an array with at most two gates.",
    );
  }

  if (!value.every((gate) => gate === "X" || gate === "H")) {
    return invalidStateError(
      "INVENTORY",
      "inventory",
      "Inventory may contain only X and H.",
    );
  }

  const key = value.join(",");
  if (key !== "" && key !== "X" && key !== "H" && key !== "X,H") {
    return invalidStateError(
      "INVENTORY",
      "inventory",
      "Inventory must preserve the stable X then H order without duplicates.",
    );
  }

  return null;
};

const validateCollectedCoordinates = (
  value: unknown,
  path: "collectedCrystals" | "collectedBatteries",
  requiredOutcome: "CRYSTAL" | "BATTERY",
  board: readonly Cell[],
): InvalidStateError | null => {
  if (!Array.isArray(value)) {
    return invalidStateError(
      "COLLECTION",
      path,
      `${path} must be an array.`,
    );
  }

  let previous: Coordinate | null = null;
  for (let index = 0; index < value.length; index += 1) {
    const coordinateResult = validateCoordinate(value[index]);
    if (!coordinateResult.ok) {
      return invalidStateError(
        "COLLECTION",
        `${path}[${index}]`,
        `${path} contains an invalid coordinate.`,
      );
    }

    const coordinate = coordinateResult.value;
    if (previous !== null && compareCoordinates(previous, coordinate) >= 0) {
      return invalidStateError(
        "COLLECTION",
        `${path}[${index}]`,
        `${path} must be duplicate-free and sorted in row-major order.`,
      );
    }

    const cell = board[boardIndex(coordinate)];
    if (
      cell === undefined ||
      cell.kind !== "COLLAPSED" ||
      cell.outcome !== requiredOutcome
    ) {
      return invalidStateError(
        "COLLECTION",
        `${path}[${index}]`,
        `${path} coordinates must point to collapsed ${requiredOutcome} cells.`,
      );
    }
    previous = coordinate;
  }

  return null;
};

export const validateGameState = (value: unknown): StateValidationResult => {
  if (!isRecord(value) || !hasExactKeys(value, STATE_KEYS)) {
    return invalidState(
      "MALFORMED_STATE",
      "$",
      "Game state must contain exactly the version 1 state fields.",
    );
  }

  if (value.schemaVersion !== SCHEMA_VERSION) {
    if (typeof value.schemaVersion === "number") {
      return {
        ok: false,
        error: {
          kind: "UNSUPPORTED_SCHEMA_VERSION",
          received: value.schemaVersion,
          message: `Unsupported schema version ${value.schemaVersion}.`,
        },
      };
    }
    return invalidState(
      "MALFORMED_STATE",
      "schemaVersion",
      "Schema version must be numeric.",
    );
  }

  if (value.rulesVersion !== RULES_VERSION) {
    if (typeof value.rulesVersion === "number") {
      return {
        ok: false,
        error: {
          kind: "UNSUPPORTED_RULES_VERSION",
          received: value.rulesVersion,
          message: `Unsupported rules version ${value.rulesVersion}.`,
        },
      };
    }
    return invalidState(
      "MALFORMED_STATE",
      "rulesVersion",
      "Rules version must be numeric.",
    );
  }

  if (!Array.isArray(value.board) || value.board.length !== BOARD_CELL_COUNT) {
    return invalidState(
      "BOARD_SIZE",
      "board",
      `Board must contain exactly ${BOARD_CELL_COUNT} cells.`,
    );
  }

  const board: Cell[] = [];
  for (let index = 0; index < value.board.length; index += 1) {
    const rawCell: unknown = value.board[index];
    if (!isRecord(rawCell)) {
      return invalidState(
        "CELL_VARIANT",
        `board[${index}]`,
        "Each board entry must be a cell object.",
      );
    }

    const isUnresolved = rawCell.kind === "UNRESOLVED";
    const isCollapsed = rawCell.kind === "COLLAPSED";
    if (
      (!isUnresolved && !isCollapsed) ||
      !hasExactKeys(
        rawCell,
        isUnresolved ? UNRESOLVED_CELL_KEYS : COLLAPSED_CELL_KEYS,
      )
    ) {
      return invalidState(
        "CELL_VARIANT",
        `board[${index}]`,
        "Cell must be exactly one supported discriminated variant.",
      );
    }

    const coordinateResult = validateCoordinate(rawCell.coordinate);
    if (!coordinateResult.ok) {
      return invalidState(
        "BOARD_COORDINATE",
        `board[${index}].coordinate`,
        "Cell coordinate must be a canonical in-bounds coordinate.",
      );
    }

    const expectedCoordinate = {
      row: Math.floor(index / BOARD_SIZE),
      col: index % BOARD_SIZE,
    };
    if (!coordinatesEqual(coordinateResult.value, expectedCoordinate)) {
      return invalidState(
        "BOARD_COORDINATE",
        `board[${index}].coordinate`,
        "Board coordinates must be unique and in row-major order.",
      );
    }

    if (isUnresolved) {
      const distributionResult = validateDistribution(rawCell.distribution);
      if (!distributionResult.ok) {
        return invalidState(
          "CELL_DISTRIBUTION",
          `board[${index}].distribution`,
          distributionResult.error.message,
        );
      }
      const negativeZeroIndex = distributionResult.value.findIndex((probability) =>
        Object.is(probability, -0),
      );
      if (negativeZeroIndex >= 0) {
        return invalidState(
          "NEGATIVE_ZERO",
          `board[${index}].distribution[${negativeZeroIndex}]`,
          "Stored probabilities must use canonical positive zero.",
        );
      }
      board.push({
        kind: "UNRESOLVED",
        coordinate: coordinateResult.value,
        distribution: distributionResult.value,
      });
    } else {
      if (!isOutcome(rawCell.outcome)) {
        return invalidState(
          "CELL_VARIANT",
          `board[${index}].outcome`,
          "Collapsed cell outcome is unsupported.",
        );
      }
      board.push({
        kind: "COLLAPSED",
        coordinate: coordinateResult.value,
        outcome: rawCell.outcome,
      });
    }
  }

  const entryCell = board[boardIndex(ENTRY_COORDINATE)];
  const exitCell = board[boardIndex(EXIT_COORDINATE)];
  if (
    entryCell?.kind !== "COLLAPSED" ||
    entryCell.outcome !== "FLOOR" ||
    exitCell?.kind !== "COLLAPSED" ||
    exitCell.outcome !== "FLOOR"
  ) {
    return invalidState(
      "ENDPOINT",
      "board",
      "Entry and exit must remain collapsed FLOOR cells.",
    );
  }

  const playerResult = validateCoordinate(value.player);
  if (!playerResult.ok) {
    return invalidState(
      "PLAYER",
      "player",
      "Player must occupy an in-bounds coordinate.",
    );
  }
  const player = playerResult.value;
  const playerCell = board[boardIndex(player)];
  if (
    playerCell?.kind !== "COLLAPSED" ||
    !(PASSABLE_OUTCOMES as readonly Outcome[]).includes(playerCell.outcome)
  ) {
    return invalidState(
      "PLAYER",
      "player",
      "Player must occupy a collapsed passable cell.",
    );
  }

  if (!Array.isArray(value.pairs) || value.pairs.length < 3 || value.pairs.length > 5) {
    return invalidState(
      "PAIR_COUNT",
      "pairs",
      "State must contain between three and five pairs.",
    );
  }

  const pairedCoordinates = new Set<string>();
  let previousPairId: string | null = null;
  for (let index = 0; index < value.pairs.length; index += 1) {
    const rawPair: unknown = value.pairs[index];
    if (!isRecord(rawPair) || !hasExactKeys(rawPair, PAIR_KEYS)) {
      return invalidState(
        "PAIR_MEMBER",
        `pairs[${index}]`,
        "Pair must contain exactly id, memberA, memberB, and policy.",
      );
    }
    if (typeof rawPair.id !== "string" || rawPair.id.length === 0) {
      return invalidState(
        "PAIR_ID",
        `pairs[${index}].id`,
        "Pair ID must be a non-empty string.",
      );
    }
    if (previousPairId !== null && previousPairId >= rawPair.id) {
      return invalidState(
        previousPairId === rawPair.id ? "PAIR_ID" : "PAIR_ORDER",
        `pairs[${index}].id`,
        "Pair IDs must be unique and sorted in ascending code-unit order.",
      );
    }

    const memberAResult = validateCoordinate(rawPair.memberA);
    const memberBResult = validateCoordinate(rawPair.memberB);
    if (!memberAResult.ok || !memberBResult.ok) {
      return invalidState(
        "PAIR_MEMBER",
        `pairs[${index}]`,
        "Pair members must be in-bounds coordinates.",
      );
    }
    const memberA = memberAResult.value;
    const memberB = memberBResult.value;
    if (
      compareCoordinates(memberA, memberB) >= 0 ||
      coordinatesEqual(memberA, ENTRY_COORDINATE) ||
      coordinatesEqual(memberA, EXIT_COORDINATE) ||
      coordinatesEqual(memberB, ENTRY_COORDINATE) ||
      coordinatesEqual(memberB, EXIT_COORDINATE)
    ) {
      return invalidState(
        "PAIR_MEMBER",
        `pairs[${index}]`,
        "Pair members must be distinct, canonical A/B, and exclude endpoints.",
      );
    }

    const memberAKey = coordinateKey(memberA);
    const memberBKey = coordinateKey(memberB);
    if (
      pairedCoordinates.has(memberAKey) ||
      pairedCoordinates.has(memberBKey)
    ) {
      return invalidState(
        "PAIR_MEMBER",
        `pairs[${index}]`,
        "Pair membership must be globally disjoint.",
      );
    }
    if (!isPairPolicy(rawPair.policy)) {
      return invalidState(
        "PAIR_MEMBER",
        `pairs[${index}].policy`,
        "Pair policy is unsupported.",
      );
    }

    const memberACell = board[boardIndex(memberA)];
    const memberBCell = board[boardIndex(memberB)];
    if (memberACell?.kind !== memberBCell?.kind) {
      return invalidState(
        "PAIR_RESOLUTION",
        `pairs[${index}]`,
        "Pair members must both be unresolved or both be collapsed.",
      );
    }

    pairedCoordinates.add(memberAKey);
    pairedCoordinates.add(memberBKey);
    previousPairId = rawPair.id;
  }

  const inventoryError = validateInventory(value.inventory);
  if (inventoryError !== null) {
    return { ok: false, error: inventoryError };
  }

  if (!isCanonicalNonNegativeSafeInteger(value.observations)) {
    return invalidState(
      Object.is(value.observations, -0) ? "NEGATIVE_ZERO" : "OBSERVATIONS",
      "observations",
      "Observations must be a canonical non-negative safe integer.",
    );
  }
  if (value.observations > MAX_OBSERVATIONS) {
    return invalidState(
      "OBSERVATIONS",
      "observations",
      `Observations cannot exceed ${MAX_OBSERVATIONS}.`,
    );
  }

  if (!isCanonicalNonNegativeSafeInteger(value.turn)) {
    return invalidState(
      Object.is(value.turn, -0) ? "NEGATIVE_ZERO" : "TURN",
      "turn",
      "Turn must be a canonical non-negative safe integer.",
    );
  }

  if (
    !isCanonicalNonNegativeSafeInteger(value.energy) ||
    value.energy > INITIAL_ENERGY
  ) {
    return invalidState(
      Object.is(value.energy, -0) ? "NEGATIVE_ZERO" : "ENERGY",
      "energy",
      `Version 1 energy must be either 0 or ${INITIAL_ENERGY}.`,
    );
  }

  const crystalCollectionError = validateCollectedCoordinates(
    value.collectedCrystals,
    "collectedCrystals",
    "CRYSTAL",
    board,
  );
  if (crystalCollectionError !== null) {
    return { ok: false, error: crystalCollectionError };
  }
  const batteryCollectionError = validateCollectedCoordinates(
    value.collectedBatteries,
    "collectedBatteries",
    "BATTERY",
    board,
  );
  if (batteryCollectionError !== null) {
    return { ok: false, error: batteryCollectionError };
  }

  const crystalKeys = new Set(
    (value.collectedCrystals as readonly Coordinate[]).map(coordinateKey),
  );
  const batteryKeys = new Set(
    (value.collectedBatteries as readonly Coordinate[]).map(coordinateKey),
  );
  const playerKey = coordinateKey(player);
  if (
    (playerCell.outcome === "CRYSTAL" && !crystalKeys.has(playerKey)) ||
    (playerCell.outcome === "BATTERY" && !batteryKeys.has(playerKey))
  ) {
    return invalidState(
      "PLAYER",
      "player",
      "An occupied collectible cell must already be marked collected.",
    );
  }

  if (
    value.status !== "START" &&
    value.status !== "PLAYING" &&
    value.status !== "VICTORY" &&
    value.status !== "DEFEAT"
  ) {
    return invalidState("STATUS", "status", "Game status is unsupported.");
  }

  if (value.terminalReason !== null && !isTerminalReason(value.terminalReason)) {
    return invalidState(
      "TERMINAL_REASON",
      "terminalReason",
      "Terminal reason is unsupported.",
    );
  }

  if (value.status === "START") {
    if (
      value.turn !== 0 ||
      value.terminalReason !== null ||
      !coordinatesEqual(player, ENTRY_COORDINATE) ||
      value.observations < INITIAL_OBSERVATIONS ||
      value.energy !== INITIAL_ENERGY ||
      !isInitialInventory(value.inventory as readonly GateKind[]) ||
      (value.collectedCrystals as readonly unknown[]).length !== 0 ||
      (value.collectedBatteries as readonly unknown[]).length !== 0
    ) {
      return invalidState(
        "STATUS",
        "status",
        "START requires turn zero, entry position, initial resources, and no collections.",
      );
    }

    for (let index = 0; index < board.length; index += 1) {
      if (
        index !== boardIndex(ENTRY_COORDINATE) &&
        index !== boardIndex(EXIT_COORDINATE) &&
        board[index]?.kind !== "UNRESOLVED"
      ) {
        return invalidState(
          "STATUS",
          `board[${index}]`,
          "START requires every non-endpoint cell to be unresolved.",
        );
      }
    }
  } else if (value.status === "PLAYING") {
    if (value.turn < 1 || value.terminalReason !== null) {
      return invalidState(
        "STATUS",
        "status",
        "PLAYING requires a positive turn and no terminal reason.",
      );
    }
  } else if (value.status === "VICTORY") {
    if (
      value.turn < 1 ||
      value.terminalReason !== "EXIT_REACHED" ||
      !coordinatesEqual(player, EXIT_COORDINATE)
    ) {
      return invalidState(
        "TERMINAL_REASON",
        "terminalReason",
        "VICTORY requires a positive turn, EXIT_REACHED, and exit occupancy.",
      );
    }
  } else {
    if (
      value.turn < 1 ||
      !isDefeatReason(value.terminalReason) ||
      (value.terminalReason === "INSUFFICIENT_VOID_ENERGY" && value.energy !== 0)
    ) {
      return invalidState(
        "TERMINAL_REASON",
        "terminalReason",
        "DEFEAT requires a positive turn and a structurally consistent defeat reason.",
      );
    }

    if (coordinatesEqual(player, EXIT_COORDINATE)) {
      return invalidState(
        "TERMINAL_REASON",
        "terminalReason",
        "Exit occupancy must use VICTORY because victory has terminal precedence.",
      );
    }

    if (
      value.terminalReason === "IRREVERSIBLE_BLOCKAGE" ||
      value.terminalReason === "RESOURCE_DEAD_END"
    ) {
      const routes = analyzeRoutes(value as unknown as GameState);
      const reasonIsConsistent =
        value.terminalReason === "IRREVERSIBLE_BLOCKAGE"
          ? !routes.structuralPotentialRoute
          : routes.structuralPotentialRoute &&
            value.observations === 0 &&
            !routes.currentRoute &&
            !routes.reachableUncollectedBattery;
      if (!reasonIsConsistent) {
        return invalidState(
          "TERMINAL_REASON",
          "terminalReason",
          "DEFEAT reason must match the canonical route and resource predicates.",
        );
      }
    }
  }

  return { ok: true, value: value as unknown as GameState };
};

export const isValidGameState = (value: unknown): value is GameState =>
  validateGameState(value).ok;

export type { StateValidationError };
