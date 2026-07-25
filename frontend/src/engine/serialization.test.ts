import { describe, expect, it } from "vitest";

import { generateInitialState } from "./generation";
import {
  deserializeGameState,
  deserializeGameStateDto,
  serializeGameState,
  serializeGameStateToDto,
} from "./serialization";
import type { GameState, GameStateDto } from "./types";

type MutableRecord = Record<string, unknown>;
type DtoMutation = Readonly<{
  label: string;
  path: string;
  mutate: (dto: MutableRecord) => void;
}>;

const generatedState = (seed = "serialization-unit"): GameState => {
  const result = generateInitialState(seed);
  if (!result.ok) {
    throw new Error(result.error.message);
  }
  return result.value;
};

const dtoOf = (state: GameState): GameStateDto => {
  const result = serializeGameStateToDto(state);
  if (!result.ok) {
    throw new Error(result.error.message);
  }
  return result.value;
};

const bytesOf = (state: GameState): string => {
  const result = serializeGameState(state);
  if (!result.ok) {
    throw new Error(result.error.message);
  }
  return result.value;
};

const mutableDto = (): MutableRecord =>
  JSON.parse(bytesOf(generatedState())) as MutableRecord;

const asRecord = (value: unknown): MutableRecord => value as MutableRecord;
const asArray = (value: unknown): unknown[] => value as unknown[];
const firstBoardCell = (dto: MutableRecord): MutableRecord =>
  asRecord(asArray(dto.board)[0]);
const firstPair = (dto: MutableRecord): MutableRecord =>
  asRecord(asArray(dto.pairs)[0]);
const firstCollapsedCell = (dto: MutableRecord): MutableRecord => {
  const cell = asArray(dto.board).find(
    (candidate) => asRecord(candidate).kind === "COLLAPSED",
  );
  if (cell === undefined) {
    throw new Error("Generated state must contain a collapsed endpoint.");
  }
  return asRecord(cell);
};

describe("canonical state serialization", () => {
  it("constructs exact fixed-order owned DTO and JSON fields", () => {
    const state = generatedState();
    const dto = dtoOf(state);
    const bytes = bytesOf(state);

    expect(Object.keys(dto)).toEqual([
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
    ]);
    expect(Object.keys(dto.board[0] ?? {})).toEqual([
      "kind",
      "coordinate",
      "distribution",
    ]);
    expect(Object.keys(dto.player)).toEqual(["row", "col"]);
    expect(Object.keys(dto.pairs[0] ?? {})).toEqual([
      "id",
      "memberA",
      "memberB",
      "policy",
    ]);
    expect(dto.board.map(({ coordinate }) => coordinate)).toEqual(
      Array.from({ length: 49 }, (_, index) => ({
        row: Math.floor(index / 7),
        col: index % 7,
      })),
    );
    expect(dto.pairs.map(({ id }) => id)).toEqual(
      [...dto.pairs.map(({ id }) => id)].sort(),
    );
    expect(dto.inventory).toEqual(["X", "H"]);
    expect(bytes).toBe(JSON.stringify(dto));
    expect(bytes).toContain('"terminalReason":null');
    expect(Object.isFrozen(dto)).toBe(true);
    expect(Object.isFrozen(dto.board)).toBe(true);
    expect(Object.isFrozen(dto.board[0])).toBe(true);
    expect(Object.isFrozen(dto.board[0]?.coordinate)).toBe(true);
    expect(Object.isFrozen(dto.inventory)).toBe(true);
    expect(Object.isFrozen(dto.pairs[0])).toBe(true);
    expect(Object.isFrozen(dto.pairs[0]?.memberA)).toBe(true);
    expect(Object.isFrozen(dto.collectedCrystals)).toBe(true);
    expect(Object.isFrozen(dto.collectedBatteries)).toBe(true);
    expect(dto).not.toBe(state);
    expect(dto.board).not.toBe(state.board);
  });

  it("round-trips nested cells, pairs, and arrays to canonical JSON", () => {
    const state = generatedState("serialization-round-trip");
    const firstDto = dtoOf(state);
    const firstBytes = bytesOf(state);
    const restored = deserializeGameState(firstBytes);

    expect(restored.ok).toBe(true);
    if (restored.ok) {
      expect(dtoOf(restored.value)).toEqual(firstDto);
      expect(bytesOf(restored.value)).toBe(firstBytes);
      expect(Object.isFrozen(restored.value)).toBe(true);
      expect(Object.isFrozen(restored.value.board)).toBe(true);
      expect(Object.isFrozen(restored.value.board[0])).toBe(true);
      expect(Object.isFrozen(restored.value.pairs)).toBe(true);
      expect(Object.isFrozen(restored.value.pairs[0]?.memberA)).toBe(true);
      expect(Object.isFrozen(restored.value.inventory)).toBe(true);
    }
  });

  it("owns successful deserialization so caller mutation cannot alter state", () => {
    const callerDto = mutableDto();
    const result = deserializeGameStateDto(callerDto);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    const before = bytesOf(result.value);
    callerDto.status = "DEFEAT";
    asArray(callerDto.board)[0] = { kind: "COLLAPSED" };
    asRecord(firstPair(callerDto).memberA).row = 99;
    asArray(callerDto.inventory)[0] = "H";

    expect(bytesOf(result.value)).toBe(before);
  });

  it("returns distinct malformed, DTO, version, and invariant errors", () => {
    const dto = mutableDto();

    expect(deserializeGameState("{")).toMatchObject({
      ok: false,
      error: { kind: "MALFORMED_JSON" },
    });
    expect(deserializeGameStateDto({ ...dto, extra: true })).toMatchObject({
      ok: false,
      error: { kind: "INVALID_DTO", path: "$" },
    });
    const missing = { ...dto };
    delete missing.energy;
    expect(deserializeGameStateDto(missing)).toMatchObject({
      ok: false,
      error: { kind: "INVALID_DTO", path: "$" },
    });
    expect(
      deserializeGameStateDto({ ...dto, schemaVersion: 2 }),
    ).toMatchObject({
      ok: false,
      error: { kind: "UNSUPPORTED_SCHEMA_VERSION", received: 2 },
    });
    expect(deserializeGameStateDto({ ...dto, rulesVersion: 2 })).toMatchObject({
      ok: false,
      error: { kind: "UNSUPPORTED_RULES_VERSION", received: 2 },
    });
    expect(
      deserializeGameStateDto({
        ...dto,
        observations: Number.POSITIVE_INFINITY,
      }),
    ).toMatchObject({
      ok: false,
      error: { kind: "INVALID_DTO", path: "observations" },
    });
    expect(deserializeGameStateDto({ ...dto, observations: 14 })).toMatchObject({
      ok: false,
      error: { kind: "INVALID_STATE", reason: "OBSERVATIONS" },
    });
  });

  it("rejects primitive roots and valid JSON containing non-object DTOs", () => {
    for (const value of [undefined, null, false, 1, [], {}, Symbol("state")]) {
      expect(deserializeGameState(value)).toMatchObject({
        ok: false,
        error: { kind: "INVALID_DTO", path: "$" },
      });
      expect(serializeGameState(value)).toMatchObject({
        ok: false,
        error: { kind: "INVALID_STATE", reason: "MALFORMED_STATE" },
      });
    }

    for (const value of [null, false, 1, "dto", []]) {
      expect(deserializeGameStateDto(value)).toMatchObject({
        ok: false,
        error: { kind: "INVALID_DTO", path: "$" },
      });
    }

    for (const json of ["null", "false", "1", '"dto"', "[]"]) {
      expect(deserializeGameState(json)).toMatchObject({
        ok: false,
        error: { kind: "INVALID_DTO", path: "$" },
      });
    }
  });

  it("reports precise paths for malformed nested DTO values", () => {
    const cases: readonly DtoMutation[] = [
      {
        label: "schema primitive",
        path: "schemaVersion",
        mutate: (dto) => {
          dto.schemaVersion = "1";
        },
      },
      {
        label: "rules primitive",
        path: "rulesVersion",
        mutate: (dto) => {
          dto.rulesVersion = null;
        },
      },
      {
        label: "status primitive",
        path: "status",
        mutate: (dto) => {
          dto.status = 1;
        },
      },
      {
        label: "terminal reason primitive",
        path: "terminalReason",
        mutate: (dto) => {
          dto.terminalReason = {};
        },
      },
      {
        label: "turn primitive",
        path: "turn",
        mutate: (dto) => {
          dto.turn = "0";
        },
      },
      {
        label: "board container",
        path: "board",
        mutate: (dto) => {
          dto.board = {};
        },
      },
      {
        label: "cell primitive",
        path: "board[0]",
        mutate: (dto) => {
          asArray(dto.board)[0] = null;
        },
      },
      {
        label: "unresolved cell extra field",
        path: "board[0]",
        mutate: (dto) => {
          firstBoardCell(dto).extra = true;
        },
      },
      {
        label: "cell coordinate shape",
        path: "board[0].coordinate",
        mutate: (dto) => {
          firstBoardCell(dto).coordinate = null;
        },
      },
      {
        label: "cell coordinate row",
        path: "board[0].coordinate.row",
        mutate: (dto) => {
          asRecord(firstBoardCell(dto).coordinate).row = "0";
        },
      },
      {
        label: "cell coordinate col",
        path: "board[0].coordinate.col",
        mutate: (dto) => {
          asRecord(firstBoardCell(dto).coordinate).col = Number.NaN;
        },
      },
      {
        label: "distribution container",
        path: "board[0].distribution",
        mutate: (dto) => {
          firstBoardCell(dto).distribution = {};
        },
      },
      {
        label: "distribution item",
        path: "board[0].distribution[2]",
        mutate: (dto) => {
          asArray(firstBoardCell(dto).distribution)[2] = null;
        },
      },
      {
        label: "collapsed cell extra field",
        path: "board[6]",
        mutate: (dto) => {
          firstCollapsedCell(dto).extra = true;
        },
      },
      {
        label: "collapsed coordinate shape",
        path: "board[6].coordinate",
        mutate: (dto) => {
          firstCollapsedCell(dto).coordinate = null;
        },
      },
      {
        label: "collapsed outcome primitive",
        path: "board[6].outcome",
        mutate: (dto) => {
          firstCollapsedCell(dto).outcome = 1;
        },
      },
      {
        label: "unsupported cell discriminant",
        path: "board[0].kind",
        mutate: (dto) => {
          firstBoardCell(dto).kind = "UNKNOWN";
        },
      },
      {
        label: "player coordinate shape",
        path: "player",
        mutate: (dto) => {
          dto.player = [];
        },
      },
      {
        label: "energy primitive",
        path: "energy",
        mutate: (dto) => {
          dto.energy = false;
        },
      },
      {
        label: "inventory container",
        path: "inventory",
        mutate: (dto) => {
          dto.inventory = {};
        },
      },
      {
        label: "inventory item",
        path: "inventory[1]",
        mutate: (dto) => {
          asArray(dto.inventory)[1] = 1;
        },
      },
      {
        label: "pairs container",
        path: "pairs",
        mutate: (dto) => {
          dto.pairs = {};
        },
      },
      {
        label: "pair primitive",
        path: "pairs[0]",
        mutate: (dto) => {
          asArray(dto.pairs)[0] = null;
        },
      },
      {
        label: "pair extra field",
        path: "pairs[0]",
        mutate: (dto) => {
          firstPair(dto).extra = true;
        },
      },
      {
        label: "pair id primitive",
        path: "pairs[0].id",
        mutate: (dto) => {
          firstPair(dto).id = 1;
        },
      },
      {
        label: "pair member A shape",
        path: "pairs[0].memberA",
        mutate: (dto) => {
          firstPair(dto).memberA = null;
        },
      },
      {
        label: "pair member B shape",
        path: "pairs[0].memberB",
        mutate: (dto) => {
          firstPair(dto).memberB = { row: 0 };
        },
      },
      {
        label: "pair policy primitive",
        path: "pairs[0].policy",
        mutate: (dto) => {
          firstPair(dto).policy = [];
        },
      },
      {
        label: "crystal array item",
        path: "collectedCrystals[0]",
        mutate: (dto) => {
          dto.collectedCrystals = [null];
        },
      },
      {
        label: "battery array container",
        path: "collectedBatteries",
        mutate: (dto) => {
          dto.collectedBatteries = {};
        },
      },
    ];

    for (const { label, path, mutate } of cases) {
      const dto = mutableDto();
      mutate(dto);
      expect(deserializeGameStateDto(dto), label).toMatchObject({
        ok: false,
        error: { kind: "INVALID_DTO", path },
      });
    }
  });

  it("delegates unsupported domain strings to invariant validation", () => {
    const cases: readonly DtoMutation[] = [
      {
        label: "status",
        path: "status",
        mutate: (dto) => {
          dto.status = "PAUSED";
        },
      },
      {
        label: "terminal reason",
        path: "terminalReason",
        mutate: (dto) => {
          dto.terminalReason = "TIMEOUT";
        },
      },
      {
        label: "cell outcome",
        path: "board[6].outcome",
        mutate: (dto) => {
          firstCollapsedCell(dto).outcome = "LAVA";
        },
      },
      {
        label: "pair policy",
        path: "pairs[0].policy",
        mutate: (dto) => {
          firstPair(dto).policy = "INDEPENDENT";
        },
      },
      {
        label: "inventory gate",
        path: "inventory",
        mutate: (dto) => {
          asArray(dto.inventory)[0] = "Z";
        },
      },
    ];

    for (const { label, path, mutate } of cases) {
      const dto = mutableDto();
      mutate(dto);
      expect(deserializeGameStateDto(dto), label).toMatchObject({
        ok: false,
        error: { kind: "INVALID_STATE", path },
      });
    }
  });

  it("canonicalizes negative zero inside nested coordinates", () => {
    const original = bytesOf(generatedState());
    const dto = mutableDto();
    asRecord(firstBoardCell(dto).coordinate).col = -0;

    const result = deserializeGameStateDto(dto);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(Object.is(result.value.board[0]?.coordinate.col, -0)).toBe(false);
      expect(result.value.board[0]?.coordinate.col).toBe(0);
      expect(bytesOf(result.value)).toBe(original);
    }
  });

  it("rejects invalid state serialization without emitting partial JSON", () => {
    const invalid = { ...generatedState(), turn: Number.NaN } as GameState;
    expect(serializeGameState(invalid)).toMatchObject({
      ok: false,
      error: { kind: "INVALID_STATE", reason: "TURN" },
    });
  });
});
