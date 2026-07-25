import { BOARD_SIZE } from "./constants";
import type {
  CoordinateValidationResult,
  InvalidCoordinateError,
} from "./errors";
import type { Coordinate } from "./types";

const COORDINATE_KEYS = Object.freeze(["row", "col"] as const);

const invalidCoordinate = (
  reason: InvalidCoordinateError["reason"],
  message: string,
): CoordinateValidationResult<Coordinate> => ({
  ok: false,
  error: { kind: "INVALID_COORDINATE", reason, message },
});

const hasExactCoordinateKeys = (value: object): boolean => {
  const keys = Object.keys(value);
  return (
    keys.length === COORDINATE_KEYS.length &&
    COORDINATE_KEYS.every((key) => Object.hasOwn(value, key))
  );
};

export const validateCoordinate = (
  value: unknown,
): CoordinateValidationResult<Coordinate> => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return invalidCoordinate(
      "MALFORMED_COORDINATE",
      "Coordinate must be an object containing only row and col.",
    );
  }

  if (!hasExactCoordinateKeys(value)) {
    return invalidCoordinate(
      "MALFORMED_COORDINATE",
      "Coordinate must contain exactly row and col.",
    );
  }

  const { row, col } = value as Record<string, unknown>;
  if (typeof row !== "number" || typeof col !== "number") {
    return invalidCoordinate(
      "NON_INTEGER_COORDINATE",
      "Coordinate row and col must be integers.",
    );
  }

  if (Object.is(row, -0) || Object.is(col, -0)) {
    return invalidCoordinate(
      "NEGATIVE_ZERO_COORDINATE",
      "Coordinate row and col must use canonical non-negative zero.",
    );
  }

  if (!Number.isInteger(row) || !Number.isInteger(col)) {
    return invalidCoordinate(
      "NON_INTEGER_COORDINATE",
      "Coordinate row and col must be integers.",
    );
  }

  if (row < 0 || row >= BOARD_SIZE || col < 0 || col >= BOARD_SIZE) {
    return invalidCoordinate(
      "COORDINATE_OUT_OF_BOUNDS",
      `Coordinate must be within rows and columns 0 through ${BOARD_SIZE - 1}.`,
    );
  }

  return {
    ok: true,
    value: Object.freeze({ row, col }),
  };
};

export const isCoordinate = (value: unknown): value is Coordinate =>
  validateCoordinate(value).ok;

export const coordinatesEqual = (
  left: Coordinate,
  right: Coordinate,
): boolean => left.row === right.row && left.col === right.col;

export const compareCoordinates = (
  left: Coordinate,
  right: Coordinate,
): number => left.row - right.row || left.col - right.col;

export const coordinateKey = (coordinate: Coordinate): string =>
  `${coordinate.row},${coordinate.col}`;

export const isOrthogonallyAdjacent = (
  left: Coordinate,
  right: Coordinate,
): boolean =>
  Math.abs(left.row - right.row) + Math.abs(left.col - right.col) === 1;

export const orthogonalNeighbors = (
  coordinate: Coordinate,
): readonly Coordinate[] => {
  const candidates = [
    { row: coordinate.row - 1, col: coordinate.col },
    { row: coordinate.row, col: coordinate.col - 1 },
    { row: coordinate.row, col: coordinate.col + 1 },
    { row: coordinate.row + 1, col: coordinate.col },
  ];

  return Object.freeze(
    candidates
      .filter(
        ({ row, col }) =>
          row >= 0 && row < BOARD_SIZE && col >= 0 && col < BOARD_SIZE,
      )
      .map(({ row, col }) => Object.freeze({ row, col })),
  );
};

export const allCoordinatesRowMajor = (): readonly Coordinate[] => {
  const coordinates: Coordinate[] = [];
  for (let row = 0; row < BOARD_SIZE; row += 1) {
    for (let col = 0; col < BOARD_SIZE; col += 1) {
      coordinates.push(Object.freeze({ row, col }));
    }
  }
  return Object.freeze(coordinates);
};
