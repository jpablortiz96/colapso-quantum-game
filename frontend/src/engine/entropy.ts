import type { EntropyError, EntropyRangeError } from "./errors";
import type {
  Coordinate,
  EntropyContext,
  EntropyRecord,
  EntropySource,
  Result,
} from "./types";

export const UINT32_RANGE = 0x1_0000_0000;
export const UINT32_MAX = 0xffff_ffff;

const entropyRangeError = (value: unknown): EntropyRangeError => ({
  kind: "ENTROPY_RANGE",
  message: `Entropy word must be an integer from 0 through ${UINT32_MAX}; received ${String(value)}.`,
});

export const validateUint32 = (
  value: unknown,
): Result<number, EntropyRangeError> =>
  typeof value === "number" &&
  Number.isInteger(value) &&
  value >= 0 &&
  value <= UINT32_MAX
    ? { ok: true, value }
    : { ok: false, error: entropyRangeError(value) };

const assertUint32 = (word: number): void => {
  const validation = validateUint32(word);
  if (!validation.ok) {
    throw new RangeError(validation.error.message);
  }
};

const assertBound = (bound: number): void => {
  if (
    !Number.isSafeInteger(bound) ||
    bound <= 0 ||
    bound > UINT32_RANGE
  ) {
    throw new RangeError(
      `Bound must be a positive safe integer no greater than ${UINT32_RANGE}.`,
    );
  }
};

export const wordToQuantile = (word: number): number => {
  assertUint32(word);
  return word / UINT32_RANGE;
};

export const complementaryWordToQuantile = (word: number): number => {
  assertUint32(word);
  return (UINT32_MAX - word) / UINT32_RANGE;
};

const cloneCoordinate = (coordinate: Coordinate): Coordinate =>
  Object.freeze({ row: coordinate.row, col: coordinate.col });

const cloneContext = (context: EntropyContext): EntropyContext => {
  switch (context.operation) {
    case "OBSERVE_COLLAPSE":
      return Object.freeze({
        operation: context.operation,
        coordinate: cloneCoordinate(context.coordinate),
        pairId: context.pairId,
      });
    case "DECOHERENCE_SELECT":
      return Object.freeze({
        operation: context.operation,
        turn: context.turn,
        candidateCount: context.candidateCount,
      });
    case "DECOHERENCE_COLLAPSE":
      return Object.freeze({
        operation: context.operation,
        turn: context.turn,
        coordinate: cloneCoordinate(context.coordinate),
        pairId: context.pairId,
      });
  }
};

const coordinatesEqual = (left: Coordinate, right: Coordinate): boolean =>
  left.row === right.row && left.col === right.col;

export const entropyContextsEqual = (
  left: EntropyContext,
  right: EntropyContext,
): boolean => {
  if (left.operation !== right.operation) {
    return false;
  }

  switch (left.operation) {
    case "OBSERVE_COLLAPSE":
      return (
        right.operation === "OBSERVE_COLLAPSE" &&
        coordinatesEqual(left.coordinate, right.coordinate) &&
        left.pairId === right.pairId
      );
    case "DECOHERENCE_SELECT":
      return (
        right.operation === "DECOHERENCE_SELECT" &&
        left.turn === right.turn &&
        left.candidateCount === right.candidateCount
      );
    case "DECOHERENCE_COLLAPSE":
      return (
        right.operation === "DECOHERENCE_COLLAPSE" &&
        left.turn === right.turn &&
        coordinatesEqual(left.coordinate, right.coordinate) &&
        left.pairId === right.pairId
      );
  }
};

export const requestValidatedUint32 = <E>(
  source: EntropySource<E>,
  context: EntropyContext,
): Result<number, E | EntropyRangeError> => {
  const result = source.nextUint32(context);
  if (!result.ok) {
    return result;
  }
  return validateUint32(result.value);
};

export class RecordingEntropySource<E = EntropyError>
  implements EntropySource<E | EntropyRangeError>
{
  readonly #source: EntropySource<E>;
  readonly #records: EntropyRecord[] = [];

  public constructor(source: EntropySource<E>) {
    this.#source = source;
  }

  public get records(): readonly EntropyRecord[] {
    return Object.freeze([...this.#records]);
  }

  public get transcript(): readonly EntropyRecord[] {
    return this.records;
  }

  public get consumedEntries(): number {
    return this.#records.length;
  }

  public nextUint32(
    context: EntropyContext,
  ): Result<number, E | EntropyRangeError> {
    const result = requestValidatedUint32(this.#source, context);
    if (!result.ok) {
      return result;
    }

    const record = Object.freeze({
      context: cloneContext(context),
      word: result.value,
    });
    this.#records.push(record);
    return result;
  }
}

export class TranscriptEntropySource implements EntropySource<EntropyError> {
  readonly #records: readonly EntropyRecord[];
  #cursor = 0;

  public constructor(records: readonly EntropyRecord[]) {
    this.#records = Object.freeze(
      records.map((record) =>
        Object.freeze({
          context: cloneContext(record.context),
          word: record.word,
        }),
      ),
    );
  }

  public get consumedEntries(): number {
    return this.#cursor;
  }

  public get remainingEntries(): number {
    return this.#records.length - this.#cursor;
  }

  public nextUint32(context: EntropyContext): Result<number, EntropyError> {
    const record = this.#records[this.#cursor];
    if (record === undefined) {
      return {
        ok: false,
        error: {
          kind: "ENTROPY_EXHAUSTED",
          message: "Entropy transcript has no entry for the requested context.",
        },
      };
    }

    if (!entropyContextsEqual(record.context, context)) {
      return {
        ok: false,
        error: {
          kind: "ENTROPY_CONTEXT_MISMATCH",
          message: `Entropy transcript context mismatch at entry ${this.#cursor}.`,
        },
      };
    }

    const validation = validateUint32(record.word);
    if (!validation.ok) {
      return validation;
    }

    this.#cursor += 1;
    return validation;
  }
}

type Uint32ResultReader<E> = () => Result<number, E>;

export const drawUnbiasedBoundedIntegerFromWords = <E>(
  bound: number,
  nextUint32: Uint32ResultReader<E>,
): Result<number, E | EntropyRangeError> => {
  assertBound(bound);
  const limit = Math.floor(UINT32_RANGE / bound) * bound;

  for (;;) {
    const result = nextUint32();
    if (!result.ok) {
      return result;
    }
    const validation = validateUint32(result.value);
    if (!validation.ok) {
      return validation;
    }
    if (validation.value < limit) {
      return { ok: true, value: validation.value % bound };
    }
  }
};

export const drawUnbiasedBoundedInteger = <E>(
  source: EntropySource<E>,
  context: EntropyContext,
  bound: number,
): Result<number, E | EntropyRangeError> =>
  drawUnbiasedBoundedIntegerFromWords(bound, () =>
    requestValidatedUint32(source, context),
  );

export const unbiasedBoundedInteger = drawUnbiasedBoundedInteger;

export const drawUnbiasedBoundedIntegerFromUint32 = (
  bound: number,
  nextUint32: () => number,
): number => {
  const result = drawUnbiasedBoundedIntegerFromWords<never>(bound, () => ({
    ok: true,
    value: nextUint32(),
  }));
  if (!result.ok) {
    throw new RangeError(result.error.message);
  }
  return result.value;
};
