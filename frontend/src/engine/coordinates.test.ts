import { describe, expect, it } from "vitest";

import {
  allCoordinatesRowMajor,
  compareCoordinates,
  coordinateKey,
  coordinatesEqual,
  isCoordinate,
  isOrthogonallyAdjacent,
  orthogonalNeighbors,
  validateCoordinate,
} from "./coordinates";

describe("coordinate validation", () => {
  it.each([
    { row: 0, col: 0 },
    { row: 0, col: 6 },
    { row: 6, col: 0 },
    { row: 6, col: 6 },
    { row: 3, col: 4 },
  ])("accepts in-bounds integer coordinate $row,$col", (coordinate) => {
    const result = validateCoordinate(coordinate);
    expect(result).toEqual({ ok: true, value: coordinate });
    expect(result.ok && Object.isFrozen(result.value)).toBe(true);
    expect(isCoordinate(coordinate)).toBe(true);
  });

  it.each([
    null,
    [],
    "0,0",
    {},
    { row: 0 },
    { row: 0, col: 0, depth: 0 },
  ])("rejects malformed coordinate %#", (coordinate) => {
    const result = validateCoordinate(coordinate);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.reason).toBe("MALFORMED_COORDINATE");
    }
  });

  it.each([
    { row: 0.5, col: 0 },
    { row: 0, col: Number.NaN },
    { row: Number.POSITIVE_INFINITY, col: 0 },
    { row: "0", col: 0 },
  ])("rejects non-integer coordinate %#", (coordinate) => {
    const result = validateCoordinate(coordinate);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.reason).toBe("NON_INTEGER_COORDINATE");
    }
  });

  it.each([
    { row: -1, col: 0 },
    { row: 0, col: -1 },
    { row: 7, col: 0 },
    { row: 0, col: 7 },
  ])("rejects out-of-bounds coordinate %#", (coordinate) => {
    const result = validateCoordinate(coordinate);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.reason).toBe("COORDINATE_OUT_OF_BOUNDS");
    }
  });

  it.each([
    { row: -0, col: 1 },
    { row: 1, col: -0 },
  ])("rejects negative zero coordinate %#", (coordinate) => {
    const result = validateCoordinate(coordinate);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.reason).toBe("NEGATIVE_ZERO_COORDINATE");
    }
  });
});

describe("coordinate operations", () => {
  it("compares coordinates in row-major order", () => {
    const coordinates = [
      { row: 6, col: 6 },
      { row: 0, col: 6 },
      { row: 1, col: 0 },
      { row: 0, col: 0 },
    ];
    expect([...coordinates].sort(compareCoordinates)).toEqual([
      { row: 0, col: 0 },
      { row: 0, col: 6 },
      { row: 1, col: 0 },
      { row: 6, col: 6 },
    ]);
  });

  it("creates stable keys and compares values structurally", () => {
    expect(coordinateKey({ row: 2, col: 5 })).toBe("2,5");
    expect(coordinatesEqual({ row: 2, col: 5 }, { row: 2, col: 5 })).toBe(
      true,
    );
    expect(coordinatesEqual({ row: 2, col: 5 }, { row: 5, col: 2 })).toBe(
      false,
    );
  });

  it("returns corner neighbors in row-major order", () => {
    expect(orthogonalNeighbors({ row: 0, col: 0 })).toEqual([
      { row: 0, col: 1 },
      { row: 1, col: 0 },
    ]);
    expect(orthogonalNeighbors({ row: 6, col: 6 })).toEqual([
      { row: 5, col: 6 },
      { row: 6, col: 5 },
    ]);
  });

  it("returns edge and center neighbors in row-major order", () => {
    expect(orthogonalNeighbors({ row: 0, col: 3 })).toEqual([
      { row: 0, col: 2 },
      { row: 0, col: 4 },
      { row: 1, col: 3 },
    ]);
    const center = orthogonalNeighbors({ row: 3, col: 3 });
    expect(center).toEqual([
      { row: 2, col: 3 },
      { row: 3, col: 2 },
      { row: 3, col: 4 },
      { row: 4, col: 3 },
    ]);
    expect(Object.isFrozen(center)).toBe(true);
    expect(center.every(Object.isFrozen)).toBe(true);
  });

  it("recognizes only orthogonal unit adjacency", () => {
    expect(isOrthogonallyAdjacent({ row: 2, col: 2 }, { row: 2, col: 3 })).toBe(
      true,
    );
    expect(isOrthogonallyAdjacent({ row: 2, col: 2 }, { row: 3, col: 2 })).toBe(
      true,
    );
    expect(isOrthogonallyAdjacent({ row: 2, col: 2 }, { row: 3, col: 3 })).toBe(
      false,
    );
    expect(isOrthogonallyAdjacent({ row: 2, col: 2 }, { row: 2, col: 2 })).toBe(
      false,
    );
    expect(isOrthogonallyAdjacent({ row: 2, col: 2 }, { row: 2, col: 4 })).toBe(
      false,
    );
  });

  it("enumerates all 49 coordinates once in row-major order", () => {
    const coordinates = allCoordinatesRowMajor();
    expect(coordinates).toHaveLength(49);
    expect(coordinates[0]).toEqual({ row: 0, col: 0 });
    expect(coordinates[6]).toEqual({ row: 0, col: 6 });
    expect(coordinates[7]).toEqual({ row: 1, col: 0 });
    expect(coordinates[48]).toEqual({ row: 6, col: 6 });
    expect(new Set(coordinates.map(coordinateKey)).size).toBe(49);
    expect(Object.isFrozen(coordinates)).toBe(true);
  });
});
