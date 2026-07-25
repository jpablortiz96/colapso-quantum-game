import {
  BOARD_CELL_COUNT,
  BOARD_SIZE,
  DECOHERENCE_INTERVAL,
  REPLAY_SCHEMA_VERSION,
  RULES_VERSION,
} from "./constants";
import { TranscriptEntropySource, validateUint32 } from "./entropy";
import type {
  InvalidDtoError,
  ReplayError,
  ReplayResult,
} from "./errors";
import { generateInitialState } from "./generation";
import { calculateScore } from "./score";
import {
  deserializeGameStateDto,
  serializeGameState,
  serializeGameStateToDto,
} from "./serialization";
import { validateSeed } from "./seed-prng";
import { processAction } from "./turn";
import type {
  Action,
  Coordinate,
  EntropyContext,
  EntropyRecord,
  GameState,
  GameStateDto,
  ReplayInitialDto,
  Result,
} from "./types";

const REPLAY_KEYS = Object.freeze([
  "replaySchemaVersion",
  "rulesVersion",
  "initial",
  "actions",
  "entropyTranscript",
  "expectedFinalState",
  "expectedFinalScore",
] as const);
const SEED_INITIAL_KEYS = Object.freeze(["kind", "seed"] as const);
const UNIVERSE_INITIAL_KEYS = Object.freeze(["kind", "universe"] as const);
const ACTION_KEYS = Object.freeze(["kind", "target"] as const);
const GATE_ACTION_KEYS = Object.freeze(["kind", "gate", "target"] as const);
const RECORD_KEYS = Object.freeze(["context", "word"] as const);
const OBSERVE_CONTEXT_KEYS = Object.freeze([
  "operation",
  "coordinate",
  "pairId",
] as const);
const SELECT_CONTEXT_KEYS = Object.freeze([
  "operation",
  "turn",
  "candidateCount",
] as const);
const DECOHERENCE_CONTEXT_KEYS = Object.freeze([
  "operation",
  "turn",
  "coordinate",
  "pairId",
] as const);
const COORDINATE_KEYS = Object.freeze(["row", "col"] as const);

type ParseResult<T> = Result<T, ReplayError>;

type ParsedReplay = Readonly<{
  initial: ReplayInitialDto;
  initialState: GameState | null;
  actions: readonly Action[];
  entropyTranscript: readonly EntropyRecord[];
  expectedFinalState: GameState;
  expectedFinalStateDto: GameStateDto;
  expectedFinalScore: number;
}>;

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

const parseEntropyCoordinate = (
  value: unknown,
  path: string,
): ParseResult<Coordinate> => {
  const hasNegativeZero =
    isRecord(value) &&
    (Object.is(value.row, -0) || Object.is(value.col, -0));
  const coordinate = parseCoordinate(value, path);
  if (!coordinate.ok) {
    return coordinate;
  }
  if (
    !Number.isInteger(coordinate.value.row) ||
    !Number.isInteger(coordinate.value.col) ||
    hasNegativeZero ||
    coordinate.value.row < 0 ||
    coordinate.value.row >= BOARD_SIZE ||
    coordinate.value.col < 0 ||
    coordinate.value.col >= BOARD_SIZE
  ) {
    return {
      ok: false,
      error: invalidDto(path, "Entropy coordinate must be an in-bounds board coordinate."),
    };
  }
  return coordinate;
};

const parseScheduledTurn = (
  value: unknown,
  path: string,
): ParseResult<number> => {
  const turn = parseFiniteNumber(value, path);
  if (!turn.ok) {
    return turn;
  }
  return Number.isSafeInteger(turn.value) &&
    turn.value > 0 &&
    turn.value % DECOHERENCE_INTERVAL === 0
    ? turn
    : {
        ok: false,
        error: invalidDto(
          path,
          `Decoherence turn must be a positive safe integer divisible by ${DECOHERENCE_INTERVAL}.`,
        ),
      };
};

const parseCandidateCount = (
  value: unknown,
  path: string,
): ParseResult<number> => {
  const candidateCount = parseFiniteNumber(value, path);
  if (!candidateCount.ok) {
    return candidateCount;
  }
  return Number.isSafeInteger(candidateCount.value) &&
    candidateCount.value >= 1 &&
    candidateCount.value <= BOARD_CELL_COUNT - 2
    ? candidateCount
    : {
        ok: false,
        error: invalidDto(
          path,
          `Candidate count must be a safe integer from 1 through ${BOARD_CELL_COUNT - 2}.`,
        ),
      };
};

const parseAction = (value: unknown, path: string): ParseResult<Action> => {
  if (!isRecord(value)) {
    return { ok: false, error: invalidDto(path, "Action must be an object.") };
  }
  if (value.kind === "APPLY_GATE") {
    if (!hasExactKeys(value, GATE_ACTION_KEYS)) {
      return {
        ok: false,
        error: invalidDto(path, "Gate action fields are missing or unknown."),
      };
    }
    if (value.gate !== "X" && value.gate !== "H") {
      return {
        ok: false,
        error: invalidDto(`${path}.gate`, "Gate must be X or H."),
      };
    }
    const target = parseCoordinate(value.target, `${path}.target`);
    return target.ok
      ? {
          ok: true,
          value: Object.freeze({
            kind: "APPLY_GATE",
            gate: value.gate,
            target: target.value,
          }),
        }
      : target;
  }
  if (value.kind === "OBSERVE" || value.kind === "MOVE") {
    if (!hasExactKeys(value, ACTION_KEYS)) {
      return {
        ok: false,
        error: invalidDto(path, "Action fields are missing or unknown."),
      };
    }
    const target = parseCoordinate(value.target, `${path}.target`);
    return target.ok
      ? {
          ok: true,
          value: Object.freeze({ kind: value.kind, target: target.value }),
        }
      : target;
  }
  return {
    ok: false,
    error: invalidDto(`${path}.kind`, "Action kind is unsupported."),
  };
};

const parsePairId = (
  value: unknown,
  path: string,
): ParseResult<string | null> =>
  value === null || typeof value === "string"
    ? { ok: true, value }
    : {
        ok: false,
        error: invalidDto(path, "Pair ID must be a string or null."),
      };

const parseEntropyContext = (
  value: unknown,
  path: string,
): ParseResult<EntropyContext> => {
  if (!isRecord(value)) {
    return {
      ok: false,
      error: invalidDto(path, "Entropy context must be an object."),
    };
  }
  if (value.operation === "OBSERVE_COLLAPSE") {
    if (!hasExactKeys(value, OBSERVE_CONTEXT_KEYS)) {
      return {
        ok: false,
        error: invalidDto(path, "Observation context fields are invalid."),
      };
    }
    const coordinate = parseEntropyCoordinate(
      value.coordinate,
      `${path}.coordinate`,
    );
    if (!coordinate.ok) {
      return coordinate;
    }
    const pairId = parsePairId(value.pairId, `${path}.pairId`);
    if (!pairId.ok) {
      return pairId;
    }
    return {
      ok: true,
      value: Object.freeze({
        operation: "OBSERVE_COLLAPSE",
        coordinate: coordinate.value,
        pairId: pairId.value,
      }),
    };
  }
  if (value.operation === "DECOHERENCE_SELECT") {
    if (!hasExactKeys(value, SELECT_CONTEXT_KEYS)) {
      return {
        ok: false,
        error: invalidDto(path, "Selection context fields are invalid."),
      };
    }
    const turn = parseScheduledTurn(value.turn, `${path}.turn`);
    if (!turn.ok) {
      return turn;
    }
    const candidateCount = parseCandidateCount(
      value.candidateCount,
      `${path}.candidateCount`,
    );
    if (!candidateCount.ok) {
      return candidateCount;
    }
    return {
      ok: true,
      value: Object.freeze({
        operation: "DECOHERENCE_SELECT",
        turn: turn.value,
        candidateCount: candidateCount.value,
      }),
    };
  }
  if (value.operation === "DECOHERENCE_COLLAPSE") {
    if (!hasExactKeys(value, DECOHERENCE_CONTEXT_KEYS)) {
      return {
        ok: false,
        error: invalidDto(path, "Decoherence context fields are invalid."),
      };
    }
    const turn = parseScheduledTurn(value.turn, `${path}.turn`);
    if (!turn.ok) {
      return turn;
    }
    const coordinate = parseEntropyCoordinate(
      value.coordinate,
      `${path}.coordinate`,
    );
    if (!coordinate.ok) {
      return coordinate;
    }
    const pairId = parsePairId(value.pairId, `${path}.pairId`);
    if (!pairId.ok) {
      return pairId;
    }
    return {
      ok: true,
      value: Object.freeze({
        operation: "DECOHERENCE_COLLAPSE",
        turn: turn.value,
        coordinate: coordinate.value,
        pairId: pairId.value,
      }),
    };
  }
  return {
    ok: false,
    error: invalidDto(`${path}.operation`, "Entropy operation is unsupported."),
  };
};

const parseEntropyRecord = (
  value: unknown,
  path: string,
): ParseResult<EntropyRecord> => {
  if (!isRecord(value) || !hasExactKeys(value, RECORD_KEYS)) {
    return {
      ok: false,
      error: invalidDto(path, "Entropy record fields are missing or unknown."),
    };
  }
  const context = parseEntropyContext(value.context, `${path}.context`);
  if (!context.ok) {
    return context;
  }
  if (typeof value.word !== "number") {
    return {
      ok: false,
      error: invalidDto(`${path}.word`, "Entropy word must be numeric."),
    };
  }
  return {
    ok: true,
    value: Object.freeze({
      context: context.value,
      word: canonicalNumber(value.word),
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
  const output: T[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const item = parseItem(value[index], `${path}[${index}]`);
    if (!item.ok) {
      return item;
    }
    output.push(item.value);
  }
  return { ok: true, value: Object.freeze(output) };
};

const parseReplay = (value: unknown): ParseResult<ParsedReplay> => {
  if (!isRecord(value) || !hasExactKeys(value, REPLAY_KEYS)) {
    return {
      ok: false,
      error: invalidDto("$", "Replay DTO fields are missing or unknown."),
    };
  }
  const replaySchemaVersion = parseFiniteNumber(
    value.replaySchemaVersion,
    "replaySchemaVersion",
  );
  if (!replaySchemaVersion.ok) {
    return replaySchemaVersion;
  }
  if (replaySchemaVersion.value !== REPLAY_SCHEMA_VERSION) {
    return {
      ok: false,
      error: {
        kind: "UNSUPPORTED_SCHEMA_VERSION",
        received: replaySchemaVersion.value,
        message: `Unsupported replay schema version ${replaySchemaVersion.value}.`,
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

  if (!isRecord(value.initial)) {
    return {
      ok: false,
      error: invalidDto("initial", "Replay initial value must be an object."),
    };
  }
  let initial: ReplayInitialDto;
  let initialState: GameState | null = null;
  if (value.initial.kind === "SEED") {
    if (!hasExactKeys(value.initial, SEED_INITIAL_KEYS)) {
      return {
        ok: false,
        error: invalidDto("initial", "Seed initial fields are missing or unknown."),
      };
    }
    const seed = validateSeed(value.initial.seed);
    if (!seed.ok) {
      return {
        ok: false,
        error: invalidDto("initial.seed", seed.error.message),
      };
    }
    initial = Object.freeze({ kind: "SEED", seed: seed.value });
  } else if (value.initial.kind === "UNIVERSE") {
    if (!hasExactKeys(value.initial, UNIVERSE_INITIAL_KEYS)) {
      return {
        ok: false,
        error: invalidDto(
          "initial",
          "Universe initial fields are missing or unknown.",
        ),
      };
    }
    const universe = deserializeGameStateDto(value.initial.universe);
    if (!universe.ok) {
      return universe;
    }
    const universeDto = serializeGameStateToDto(universe.value);
    if (!universeDto.ok) {
      return universeDto;
    }
    initialState = universe.value;
    initial = Object.freeze({ kind: "UNIVERSE", universe: universeDto.value });
  } else {
    return {
      ok: false,
      error: invalidDto("initial.kind", "Initial kind must be SEED or UNIVERSE."),
    };
  }

  const actions = parseArray(value.actions, "actions", parseAction);
  if (!actions.ok) {
    return actions;
  }
  const entropyTranscript = parseArray(
    value.entropyTranscript,
    "entropyTranscript",
    parseEntropyRecord,
  );
  if (!entropyTranscript.ok) {
    return entropyTranscript;
  }
  const expectedFinalState = deserializeGameStateDto(value.expectedFinalState);
  if (!expectedFinalState.ok) {
    return expectedFinalState;
  }
  const expectedFinalStateDto = serializeGameStateToDto(
    expectedFinalState.value,
  );
  if (!expectedFinalStateDto.ok) {
    return expectedFinalStateDto;
  }
  const expectedFinalScore = parseFiniteNumber(
    value.expectedFinalScore,
    "expectedFinalScore",
  );
  if (!expectedFinalScore.ok) {
    return expectedFinalScore;
  }

  return {
    ok: true,
    value: Object.freeze({
      initial,
      initialState,
      actions: actions.value,
      entropyTranscript: entropyTranscript.value,
      expectedFinalState: expectedFinalState.value,
      expectedFinalStateDto: expectedFinalStateDto.value,
      expectedFinalScore: expectedFinalScore.value,
    }),
  };
};

const replayActionFailed = (
  actionIndex: number,
  cause: Extract<ReplayError, { kind: "REPLAY_ACTION_FAILED" }> ["cause"],
): Extract<ReplayError, { kind: "REPLAY_ACTION_FAILED" }> => ({
  kind: "REPLAY_ACTION_FAILED",
  actionIndex,
  cause,
  message: `Replay action ${actionIndex} failed: ${cause.message}`,
});

export const replayGame = (input: unknown): ReplayResult => {
  const parsed = parseReplay(input);
  if (!parsed.ok) {
    return parsed;
  }

  let state: GameState;
  if (parsed.value.initial.kind === "SEED") {
    const generated = generateInitialState(
      parsed.value.initial.seed,
      RULES_VERSION,
    );
    if (!generated.ok) {
      return {
        ok: false,
        error: invalidDto("initial.seed", generated.error.message),
      };
    }
    state = generated.value;
  } else {
    if (parsed.value.initialState === null) {
      return {
        ok: false,
        error: invalidDto("initial.universe", "Validated universe is missing."),
      };
    }
    state = parsed.value.initialState;
  }

  const entropy = new TranscriptEntropySource(parsed.value.entropyTranscript);
  for (let actionIndex = 0; actionIndex < parsed.value.actions.length; actionIndex += 1) {
    const action = parsed.value.actions[actionIndex];
    if (action === undefined) {
      return {
        ok: false,
        error: invalidDto(`actions[${actionIndex}]`, "Replay action is missing."),
      };
    }
    const result = processAction(state, action, entropy);
    if (!result.ok) {
      return {
        ok: false,
        error: replayActionFailed(actionIndex, result.error),
      };
    }
    state = result.state;
  }

  for (
    let recordIndex = entropy.consumedEntries;
    recordIndex < parsed.value.entropyTranscript.length;
    recordIndex += 1
  ) {
    const record = parsed.value.entropyTranscript[recordIndex]!;
    const wordValidation = validateUint32(record.word);
    if (!wordValidation.ok) {
      return wordValidation;
    }
  }

  if (entropy.remainingEntries !== 0) {
    return {
      ok: false,
      error: {
        kind: "REPLAY_UNUSED_ENTROPY",
        remainingEntries: entropy.remainingEntries,
        message: `Replay contains ${entropy.remainingEntries} unused entropy entries.`,
      },
    };
  }

  const finalState = serializeGameStateToDto(state);
  if (!finalState.ok) {
    return finalState;
  }
  const actualBytes = serializeGameState(state);
  const expectedBytes = serializeGameState(parsed.value.expectedFinalState);
  if (!actualBytes.ok) {
    return actualBytes;
  }
  if (!expectedBytes.ok) {
    return expectedBytes;
  }
  if (actualBytes.value !== expectedBytes.value) {
    return {
      ok: false,
      error: {
        kind: "REPLAY_MISMATCH",
        field: "FINAL_STATE",
        message: "Replay final state does not match the expected canonical state.",
      },
    };
  }

  const finalScore = calculateScore(state);
  if (finalScore !== parsed.value.expectedFinalScore) {
    return {
      ok: false,
      error: {
        kind: "REPLAY_MISMATCH",
        field: "FINAL_SCORE",
        message: "Replay final score does not match the expected score.",
      },
    };
  }

  return {
    ok: true,
    value: Object.freeze({
      replaySchemaVersion: REPLAY_SCHEMA_VERSION,
      rulesVersion: RULES_VERSION,
      finalState: finalState.value,
      finalScore,
      consumedEntropy: entropy.consumedEntries,
    }),
  };
};

export const executeReplay = replayGame;
