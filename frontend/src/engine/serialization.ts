import {
  RULES_VERSION,
  SCHEMA_VERSION,
} from "./constants";
import { compareCoordinates } from "./coordinates";
import type {
  DeserializationResult,
  InvalidDtoError,
  SerializationError,
  SerializationResult,
} from "./errors";
import { validateGameState } from "./invariants";
import type {
  Cell,
  CellDto,
  Coordinate,
  CoordinateDto,
  Distribution,
  EntangledPair,
  EntangledPairDto,
  GameStateDto,
  GateKind,
  GameStatus,
  Outcome,
  Result,
  TerminalReason,
} from "./types";

// DTO construction is also result-based so invalid states never yield partial output.
type StateDtoResult = Result<GameStateDto, SerializationError>;
type ParseResult<T> = Result<T, InvalidDtoError>;

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
const COORDINATE_KEYS = Object.freeze(["row", "col"] as const);
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

const invalidDto = (path: string, message: string): InvalidDtoError => ({
  kind: "INVALID_DTO",
  path,
  message,
});

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const hasExactKeys = (
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean =>
  Object.keys(value).length === keys.length &&
  keys.every((key) => Object.hasOwn(value, key));

const canonicalNumber = (value: number): number =>
  Object.is(value, -0) ? 0 : value;

const parseFiniteNumber = (value: unknown, path: string): ParseResult<number> =>
  typeof value === "number" && Number.isFinite(value)
    ? { ok: true, value: canonicalNumber(value) }
    : {
        ok: false,
        error: invalidDto(path, "Value must be a finite number."),
      };

const parseString = (value: unknown, path: string): ParseResult<string> =>
  typeof value === "string"
    ? { ok: true, value }
    : { ok: false, error: invalidDto(path, "Value must be a string.") };

const parseCoordinate = (
  value: unknown,
  path: string,
): ParseResult<Coordinate> => {
  if (!isRecord(value) || !hasExactKeys(value, COORDINATE_KEYS)) {
    return {
      ok: false,
      error: invalidDto(path, "Coordinate must contain exactly row and col."),
    };
  }
  const row = parseFiniteNumber(value.row, `${path}.row`);
  if (!row.ok) {
    return row;
  }
  const col = parseFiniteNumber(value.col, `${path}.col`);
  if (!col.ok) {
    return col;
  }
  return {
    ok: true,
    value: Object.freeze({ row: row.value, col: col.value }),
  };
};

const parseDistribution = (
  value: unknown,
  path: string,
): ParseResult<Distribution> => {
  if (!Array.isArray(value) || value.length !== 5) {
    return {
      ok: false,
      error: invalidDto(path, "Distribution must contain exactly five values."),
    };
  }
  const probabilities: number[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const probability = parseFiniteNumber(value[index], `${path}[${index}]`);
    if (!probability.ok) {
      return probability;
    }
    probabilities.push(probability.value);
  }
  return {
    ok: true,
    value: Object.freeze(probabilities) as unknown as Distribution,
  };
};

const parseCell = (value: unknown, path: string): ParseResult<Cell> => {
  if (!isRecord(value)) {
    return { ok: false, error: invalidDto(path, "Cell must be an object.") };
  }
  if (value.kind === "UNRESOLVED") {
    if (!hasExactKeys(value, UNRESOLVED_CELL_KEYS)) {
      return {
        ok: false,
        error: invalidDto(path, "Unresolved cell fields are missing or unknown."),
      };
    }
    const coordinate = parseCoordinate(value.coordinate, `${path}.coordinate`);
    if (!coordinate.ok) {
      return coordinate;
    }
    const distribution = parseDistribution(
      value.distribution,
      `${path}.distribution`,
    );
    if (!distribution.ok) {
      return distribution;
    }
    return {
      ok: true,
      value: Object.freeze({
        kind: "UNRESOLVED",
        coordinate: coordinate.value,
        distribution: distribution.value,
      }),
    };
  }
  if (value.kind === "COLLAPSED") {
    if (!hasExactKeys(value, COLLAPSED_CELL_KEYS)) {
      return {
        ok: false,
        error: invalidDto(path, "Collapsed cell fields are missing or unknown."),
      };
    }
    const coordinate = parseCoordinate(value.coordinate, `${path}.coordinate`);
    if (!coordinate.ok) {
      return coordinate;
    }
    const outcome = parseString(value.outcome, `${path}.outcome`);
    if (!outcome.ok) {
      return outcome;
    }
    return {
      ok: true,
      value: Object.freeze({
        kind: "COLLAPSED",
        coordinate: coordinate.value,
        outcome: outcome.value as Outcome,
      }),
    };
  }
  return {
    ok: false,
    error: invalidDto(`${path}.kind`, "Cell kind is unsupported."),
  };
};

const parsePair = (
  value: unknown,
  path: string,
): ParseResult<EntangledPair> => {
  if (!isRecord(value) || !hasExactKeys(value, PAIR_KEYS)) {
    return {
      ok: false,
      error: invalidDto(path, "Pair fields are missing or unknown."),
    };
  }
  const id = parseString(value.id, `${path}.id`);
  if (!id.ok) {
    return id;
  }
  const memberA = parseCoordinate(value.memberA, `${path}.memberA`);
  if (!memberA.ok) {
    return memberA;
  }
  const memberB = parseCoordinate(value.memberB, `${path}.memberB`);
  if (!memberB.ok) {
    return memberB;
  }
  const policy = parseString(value.policy, `${path}.policy`);
  if (!policy.ok) {
    return policy;
  }
  return {
    ok: true,
    value: Object.freeze({
      id: id.value,
      memberA: memberA.value,
      memberB: memberB.value,
      policy: policy.value as EntangledPair["policy"],
    }),
  };
};

const parseArray = <T>(
  value: unknown,
  path: string,
  parseItem: (item: unknown, path: string) => ParseResult<T>,
): ParseResult<readonly T[]> => {
  if (!Array.isArray(value)) {
    return { ok: false, error: invalidDto(path, "Value must be an array.") };
  }
  const items: T[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const item = parseItem(value[index], `${path}[${index}]`);
    if (!item.ok) {
      return item;
    }
    items.push(item.value);
  }
  return { ok: true, value: Object.freeze(items) };
};

const parseGameStateDto = (value: unknown): StateDtoResult => {
  if (!isRecord(value) || !hasExactKeys(value, STATE_KEYS)) {
    return {
      ok: false,
      error: invalidDto("$", "State DTO fields are missing or unknown."),
    };
  }

  const schemaVersion = parseFiniteNumber(value.schemaVersion, "schemaVersion");
  if (!schemaVersion.ok) {
    return schemaVersion;
  }
  if (schemaVersion.value !== SCHEMA_VERSION) {
    return {
      ok: false,
      error: {
        kind: "UNSUPPORTED_SCHEMA_VERSION",
        received: schemaVersion.value,
        message: `Unsupported schema version ${schemaVersion.value}.`,
      },
    };
  }
  const rulesVersion = parseFiniteNumber(value.rulesVersion, "rulesVersion");
  if (!rulesVersion.ok) {
    return rulesVersion;
  }
  if (rulesVersion.value !== RULES_VERSION) {
    return {
      ok: false,
      error: {
        kind: "UNSUPPORTED_RULES_VERSION",
        received: rulesVersion.value,
        message: `Unsupported rules version ${rulesVersion.value}.`,
      },
    };
  }

  const status = parseString(value.status, "status");
  if (!status.ok) {
    return status;
  }
  let terminalReason: TerminalReason | null;
  if (value.terminalReason === null) {
    terminalReason = null;
  } else {
    const parsedReason = parseString(value.terminalReason, "terminalReason");
    if (!parsedReason.ok) {
      return parsedReason;
    }
    terminalReason = parsedReason.value as TerminalReason;
  }
  const turn = parseFiniteNumber(value.turn, "turn");
  if (!turn.ok) {
    return turn;
  }
  const board = parseArray(value.board, "board", parseCell);
  if (!board.ok) {
    return board;
  }
  const player = parseCoordinate(value.player, "player");
  if (!player.ok) {
    return player;
  }
  const observations = parseFiniteNumber(value.observations, "observations");
  if (!observations.ok) {
    return observations;
  }
  const energy = parseFiniteNumber(value.energy, "energy");
  if (!energy.ok) {
    return energy;
  }
  const inventory = parseArray(value.inventory, "inventory", parseString);
  if (!inventory.ok) {
    return inventory;
  }
  const pairs = parseArray(value.pairs, "pairs", parsePair);
  if (!pairs.ok) {
    return pairs;
  }
  const collectedCrystals = parseArray(
    value.collectedCrystals,
    "collectedCrystals",
    parseCoordinate,
  );
  if (!collectedCrystals.ok) {
    return collectedCrystals;
  }
  const collectedBatteries = parseArray(
    value.collectedBatteries,
    "collectedBatteries",
    parseCoordinate,
  );
  if (!collectedBatteries.ok) {
    return collectedBatteries;
  }

  return {
    ok: true,
    value: Object.freeze({
      schemaVersion: SCHEMA_VERSION,
      rulesVersion: RULES_VERSION,
      status: status.value as GameStatus,
      terminalReason,
      turn: turn.value,
      board: board.value as readonly CellDto[],
      player: player.value,
      observations: observations.value,
      energy: energy.value,
      inventory: inventory.value as readonly GateKind[],
      pairs: pairs.value as readonly EntangledPairDto[],
      collectedCrystals: collectedCrystals.value,
      collectedBatteries: collectedBatteries.value,
    }),
  };
};

const cloneCoordinateDto = (coordinate: Coordinate): CoordinateDto =>
  Object.freeze({
    row: canonicalNumber(coordinate.row),
    col: canonicalNumber(coordinate.col),
  });

const cloneCellDto = (cell: Cell): CellDto =>
  cell.kind === "UNRESOLVED"
    ? Object.freeze({
        kind: "UNRESOLVED",
        coordinate: cloneCoordinateDto(cell.coordinate),
        distribution: Object.freeze(
          cell.distribution.map(canonicalNumber),
        ) as unknown as Distribution,
      })
    : Object.freeze({
        kind: "COLLAPSED",
        coordinate: cloneCoordinateDto(cell.coordinate),
        outcome: cell.outcome,
      });

const clonePairDto = (pair: EntangledPair): EntangledPairDto =>
  Object.freeze({
    id: pair.id,
    memberA: cloneCoordinateDto(pair.memberA),
    memberB: cloneCoordinateDto(pair.memberB),
    policy: pair.policy,
  });

export const serializeGameStateToDto = (state: unknown): StateDtoResult => {
  const validation = validateGameState(state);
  if (!validation.ok) {
    return validation;
  }
  const validState = validation.value;
  const board = Object.freeze(validState.board.map(cloneCellDto));
  const pairs = Object.freeze(
    [...validState.pairs]
      .sort(({ id: left }, { id: right }) =>
        left < right ? -1 : left > right ? 1 : 0,
      )
      .map(clonePairDto),
  );
  const collectedCrystals = Object.freeze(
    [...validState.collectedCrystals]
      .sort(compareCoordinates)
      .map(cloneCoordinateDto),
  );
  const collectedBatteries = Object.freeze(
    [...validState.collectedBatteries]
      .sort(compareCoordinates)
      .map(cloneCoordinateDto),
  );
  return {
    ok: true,
    value: Object.freeze({
      schemaVersion: SCHEMA_VERSION,
      rulesVersion: RULES_VERSION,
      status: validState.status,
      terminalReason: validState.terminalReason,
      turn: canonicalNumber(validState.turn),
      board,
      player: cloneCoordinateDto(validState.player),
      observations: canonicalNumber(validState.observations),
      energy: canonicalNumber(validState.energy),
      inventory: Object.freeze([...validState.inventory]),
      pairs,
      collectedCrystals,
      collectedBatteries,
    }),
  };
};

export const deserializeGameStateDto = (value: unknown): DeserializationResult => {
  const parsed = parseGameStateDto(value);
  if (!parsed.ok) {
    return parsed;
  }
  const validation = validateGameState(parsed.value);
  return validation.ok
    ? { ok: true, value: validation.value }
    : validation;
};

export const serializeGameState = (state: unknown): SerializationResult => {
  const dto = serializeGameStateToDto(state);
  return dto.ok ? { ok: true, value: JSON.stringify(dto.value) } : dto;
};

export const deserializeGameState = (json: unknown): DeserializationResult => {
  if (typeof json !== "string") {
    return {
      ok: false,
      error: invalidDto("$", "Serialized game state must be a JSON string."),
    };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(json) as unknown;
  } catch {
    return {
      ok: false,
      error: {
        kind: "MALFORMED_JSON",
        message: "Serialized game state is not valid JSON.",
      },
    };
  }
  return deserializeGameStateDto(parsed);
};

export const gameStateToDto = serializeGameStateToDto;
