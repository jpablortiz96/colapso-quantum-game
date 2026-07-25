import { describe, expect, it } from "vitest";

import { EXIT_COORDINATE } from "./constants";
import { coordinateKey, orthogonalNeighbors } from "./coordinates";
import { enumerateDecoherenceCandidates } from "./decoherence";
import { UINT32_RANGE } from "./entropy";
import { findEntangledPair } from "./entanglement";
import type { EntropyError } from "./errors";
import { generateInitialState } from "./generation";
import { validateGameState } from "./invariants";
import { movePlayer } from "./movement";
import { processAction } from "./turn";
import type {
  Coordinate,
  EntropyContext,
  EntropySource,
  GameState,
  Outcome,
  Result,
} from "./types";

const generatedState = (seed: string): GameState => {
  const result = generateInitialState(seed);
  if (!result.ok) {
    throw new Error(result.error.message);
  }
  return result.value;
};

const scriptedSource = (result: Result<number, EntropyError>) => {
  const contexts: EntropyContext[] = [];
  const source: EntropySource<EntropyError> = {
    nextUint32: (context) => {
      contexts.push(context);
      return result;
    },
  };
  return { source, contexts };
};

const queuedSource = (results: readonly Result<number, EntropyError>[]) => {
  let cursor = 0;
  const contexts: EntropyContext[] = [];
  const source: EntropySource<EntropyError> = {
    nextUint32: (context) => {
      contexts.push(context);
      const result = results[cursor];
      cursor += 1;
      return result ?? {
        ok: false,
        error: {
          kind: "ENTROPY_EXHAUSTED",
          message: "Turn script exhausted.",
        },
      };
    },
  };
  return { source, contexts };
};

const movementFixture = (
  outcome: Outcome,
  options: Readonly<{ turn?: number; energy?: 0 | 1; observations?: number }> = {},
): Readonly<{ state: GameState; origin: Coordinate; target: Coordinate }> => {
  const initial = generatedState(`turn-movement-${outcome}`);
  const paired = new Set(
    initial.pairs.flatMap(({ memberA, memberB }) => [
      coordinateKey(memberA),
      coordinateKey(memberB),
    ]),
  );
  const originCell = initial.board.find(
    (cell) =>
      cell.kind === "UNRESOLVED" &&
      !paired.has(coordinateKey(cell.coordinate)) &&
      orthogonalNeighbors(cell.coordinate).some((neighbor) => {
        const targetCell = initial.board[neighbor.row * 7 + neighbor.col];
        return (
          targetCell?.kind === "UNRESOLVED" &&
          !paired.has(coordinateKey(neighbor))
        );
      }),
  );
  const target = originCell === undefined
    ? undefined
    : orthogonalNeighbors(originCell.coordinate).find((neighbor) => {
        const targetCell = initial.board[neighbor.row * 7 + neighbor.col];
        return (
          targetCell?.kind === "UNRESOLVED" &&
          !paired.has(coordinateKey(neighbor))
        );
      });
  if (originCell === undefined || target === undefined) {
    throw new Error("Fixture did not contain adjacent unpaired cells.");
  }
  const board = [...initial.board];
  board[originCell.coordinate.row * 7 + originCell.coordinate.col] =
    Object.freeze({
      kind: "COLLAPSED",
      coordinate: originCell.coordinate,
      outcome: "FLOOR",
    });
  board[target.row * 7 + target.col] = Object.freeze({
    kind: "COLLAPSED",
    coordinate: target,
    outcome,
  });
  const state: GameState = Object.freeze({
    ...initial,
    status: "PLAYING",
    turn: options.turn ?? 2,
    player: originCell.coordinate,
    observations: options.observations ?? 5,
    energy: options.energy ?? 1,
    board: Object.freeze(board),
  });
  if (!validateGameState(state).ok) {
    throw new Error("Turn movement fixture must be valid.");
  }
  return Object.freeze({ state, origin: originCell.coordinate, target });
};

const unpairedTarget = (state: GameState): Coordinate => {
  const paired = new Set(
    state.pairs.flatMap(({ memberA, memberB }) => [
      coordinateKey(memberA),
      coordinateKey(memberB),
    ]),
  );
  const target = state.board.find(
    (cell) =>
      cell.kind === "UNRESOLVED" &&
      !paired.has(coordinateKey(cell.coordinate)),
  )?.coordinate;
  if (target === undefined) {
    throw new Error("Fixture did not contain an unpaired target.");
  }
  return target;
};

describe("authoritative action pipeline", () => {
  it("starts the game through OBSERVE, charges once, and advances one turn", () => {
    const state = generatedState("turn-start-observe");
    const target = unpairedTarget(state);
    const entropy = scriptedSource({ ok: true, value: 0 });

    const result = processAction(
      state,
      { kind: "OBSERVE", target },
      entropy.source,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.state.status).toBe("PLAYING");
    expect(result.state.turn).toBe(1);
    expect(result.state.observations).toBe(9);
    expect(result.events.map(({ kind }) => kind)).toEqual([
      "GAME_STARTED",
      "OBSERVATION_SPENT",
      "CELL_COLLAPSED",
      "TURN_ADVANCED",
    ]);
    expect(result.entropyDelta).toHaveLength(1);
    expect(entropy.contexts).toHaveLength(1);
    expect(validateGameState(result.state).ok).toBe(true);
  });

  it("starts the game through APPLY_GATE without requesting entropy", () => {
    const state = generatedState("turn-start-gate");
    const target = state.board.find((cell) => cell.kind === "UNRESOLVED")
      ?.coordinate;
    if (target === undefined) {
      throw new Error("Fixture did not contain a gate target.");
    }
    const entropy = scriptedSource({ ok: true, value: 0 });

    const result = processAction(
      state,
      { kind: "APPLY_GATE", gate: "X", target },
      entropy.source,
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.state.status).toBe("PLAYING");
      expect(result.state.turn).toBe(1);
      expect(result.state.inventory).toEqual(["H"]);
      expect(result.events.map(({ kind }) => kind)).toEqual([
        "GAME_STARTED",
        "GATE_APPLIED",
        "TURN_ADVANCED",
      ]);
      expect(result.entropyDelta).toEqual([]);
      expect(entropy.contexts).toEqual([]);
      expect(validateGameState(result.state).ok).toBe(true);
    }
  });

  it("integrates passable movement, collection, and one turn in causal order", () => {
    const fixture = movementFixture("CRYSTAL");
    const action = Object.freeze({ kind: "MOVE", target: fixture.target });
    const entropy = scriptedSource({ ok: true, value: 0 });
    const direct = movePlayer(fixture.state, action);

    const result = processAction(fixture.state, action, entropy.source);

    expect(direct.ok).toBe(true);
    expect(result.ok).toBe(true);
    if (direct.ok && result.ok) {
      expect(direct.state.turn).toBe(fixture.state.turn);
      expect(result.state.turn).toBe(fixture.state.turn + 1);
      expect(result.state.player).toEqual(direct.state.player);
      expect(result.state.collectedCrystals).toEqual(
        direct.state.collectedCrystals,
      );
      expect(result.events.map(({ kind }) => kind)).toEqual([
        "PLAYER_MOVED",
        "CRYSTAL_COLLECTED",
        "TURN_ADVANCED",
      ]);
      expect(result.entropyDelta).toEqual([]);
      expect(entropy.contexts).toEqual([]);
      expect(validateGameState(result.state).ok).toBe(true);
    }
  });

  it("integrates VOID_ENTRY and consumes insufficiency in terminal evaluation", () => {
    const fixture = movementFixture("VOID", { energy: 0 });
    const entropy = scriptedSource({ ok: true, value: 0 });

    const result = processAction(
      fixture.state,
      { kind: "MOVE", target: fixture.target },
      entropy.source,
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.state.player).toBe(fixture.state.player);
      expect(result.state.energy).toBe(0);
      expect(result.state.status).toBe("DEFEAT");
      expect(result.state.terminalReason).toBe("INSUFFICIENT_VOID_ENERGY");
      expect(result.state.turn).toBe(fixture.state.turn + 1);
      expect(result.events.map(({ kind }) => kind)).toEqual([
        "VOID_ENTRY",
        "TURN_ADVANCED",
        "STATUS_CHANGED",
      ]);
      expect(result.events[0]).toMatchObject({ sufficientEnergy: false });
      expect(result.events[2]).toEqual({
        kind: "STATUS_CHANGED",
        status: "DEFEAT",
        reason: "INSUFFICIENT_VOID_ENERGY",
      });
      expect(entropy.contexts).toEqual([]);
    }
  });

  it("advances OBSERVE and APPLY_GATE exactly once from PLAYING", () => {
    const observationState = Object.freeze({
      ...generatedState("turn-playing-observe"),
      status: "PLAYING" as const,
      turn: 6,
    });
    const observeTarget = unpairedTarget(observationState);
    const observationEntropy = scriptedSource({ ok: true, value: 1 });
    const observed = processAction(
      observationState,
      { kind: "OBSERVE", target: observeTarget },
      observationEntropy.source,
    );
    expect(observed.ok).toBe(true);
    if (observed.ok) {
      expect(observed.state.turn).toBe(7);
      expect(observed.events.at(-1)).toEqual({
        kind: "TURN_ADVANCED",
        turn: 7,
      });
    }

    const gateState = Object.freeze({
      ...generatedState("turn-playing-gate"),
      status: "PLAYING" as const,
      turn: 8,
    });
    const gateTarget = gateState.board.find(
      (cell) => cell.kind === "UNRESOLVED",
    )?.coordinate;
    if (gateTarget === undefined) {
      throw new Error("Fixture did not contain a gate target.");
    }
    const gateEntropy = scriptedSource({ ok: true, value: 1 });
    const gated = processAction(
      gateState,
      { kind: "APPLY_GATE", gate: "H", target: gateTarget },
      gateEntropy.source,
    );
    expect(gated.ok).toBe(true);
    if (gated.ok) {
      expect(gated.state.turn).toBe(9);
      expect(gated.events.map(({ kind }) => kind)).toEqual([
        "GATE_APPLIED",
        "TURN_ADVANCED",
      ]);
      expect(gateEntropy.contexts).toEqual([]);
    }
  });

  it.each([
    { fromTurn: 3, toTurn: 4 },
    { fromTurn: 7, toTurn: 8 },
  ])(
    "runs scheduled decoherence from $fromTurn to $toTurn after TURN_ADVANCED",
    ({ fromTurn, toTurn }) => {
      const fixture = movementFixture("FLOOR", { turn: fromTurn });
      const action = Object.freeze({ kind: "MOVE" as const, target: fixture.target });
      const direct = movePlayer(fixture.state, action);
      if (!direct.ok) {
        throw new Error("Scheduled turn fixture must move successfully.");
      }
      const candidates = enumerateDecoherenceCandidates(direct.state);
      const selectedIndex = candidates.findIndex(
        (coordinate) => findEntangledPair(direct.state, coordinate) === null,
      );
      const selected = candidates[selectedIndex];
      if (selectedIndex < 0 || selected === undefined) {
        throw new Error("Scheduled turn fixture must contain an unpaired candidate.");
      }
      const entropy = queuedSource([
        { ok: true, value: selectedIndex },
        { ok: true, value: 0 },
      ]);
      const before = JSON.stringify(fixture.state);

      const result = processAction(fixture.state, action, entropy.source);

      expect(result.ok).toBe(true);
      if (!result.ok) {
        return;
      }
      expect(result.state.turn).toBe(toTurn);
      expect(result.events.map(({ kind }) => kind)).toEqual([
        "PLAYER_MOVED",
        "TURN_ADVANCED",
        "DECOHERENCE_SELECTED",
        "CELL_COLLAPSED",
      ]);
      expect(result.events[1]).toEqual({
        kind: "TURN_ADVANCED",
        turn: toTurn,
      });
      expect(result.events[2]).toEqual({
        kind: "DECOHERENCE_SELECTED",
        turn: toTurn,
        coordinate: selected,
        pairId: null,
      });
      expect(result.entropyDelta).toEqual([
        {
          context: {
            operation: "DECOHERENCE_SELECT",
            turn: toTurn,
            candidateCount: candidates.length,
          },
          word: selectedIndex,
        },
        {
          context: {
            operation: "DECOHERENCE_COLLAPSE",
            turn: toTurn,
            coordinate: selected,
            pairId: null,
          },
          word: 0,
        },
      ]);
      expect(entropy.contexts).toEqual(
        result.entropyDelta.map(({ context }) => context),
      );
      expect(JSON.stringify(fixture.state)).toBe(before);
    },
  );

  it("continues through a scheduled turn without entropy when no candidates remain", () => {
    const fixture = movementFixture("FLOOR", { turn: 3 });
    const state: GameState = Object.freeze({
      ...fixture.state,
      board: Object.freeze(
        fixture.state.board.map((cell) =>
          cell.kind === "UNRESOLVED"
            ? Object.freeze({
                kind: "COLLAPSED" as const,
                coordinate: cell.coordinate,
                outcome: "FLOOR" as const,
              })
            : cell,
        ),
      ),
    });
    if (!validateGameState(state).ok) {
      throw new Error("Empty-candidate turn fixture must be valid.");
    }
    const entropy = scriptedSource({ ok: true, value: 0 });

    const result = processAction(
      state,
      { kind: "MOVE", target: fixture.target },
      entropy.source,
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.state.turn).toBe(4);
      expect(result.events.map(({ kind }) => kind)).toEqual([
        "PLAYER_MOVED",
        "TURN_ADVANCED",
      ]);
      expect(result.entropyDelta).toEqual([]);
      expect(entropy.contexts).toEqual([]);
    }
  });

  it("orders pair decoherence selection and canonical free resolution after turn advancement", () => {
    const fixture = movementFixture("FLOOR", { turn: 3, observations: 4 });
    const action = Object.freeze({ kind: "MOVE" as const, target: fixture.target });
    const direct = movePlayer(fixture.state, action);
    if (!direct.ok) {
      throw new Error("Pair integration fixture must move successfully.");
    }
    const pair = direct.state.pairs[0];
    if (pair === undefined) {
      throw new Error("Pair integration fixture must contain a pair.");
    }
    const candidates = enumerateDecoherenceCandidates(direct.state);
    const selectedIndex = candidates.findIndex(
      (coordinate) => coordinateKey(coordinate) === coordinateKey(pair.memberB),
    );
    if (selectedIndex < 0) {
      throw new Error("Pair member must be a decoherence candidate.");
    }
    const entropy = queuedSource([
      { ok: true, value: selectedIndex },
      { ok: true, value: 0 },
    ]);

    const result = processAction(fixture.state, action, entropy.source);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.state.observations).toBe(4);
    expect(result.events.map(({ kind }) => kind)).toEqual([
      "PLAYER_MOVED",
      "TURN_ADVANCED",
      "DECOHERENCE_SELECTED",
      "CELL_COLLAPSED",
      "CELL_COLLAPSED",
    ]);
    expect(result.events[2]).toEqual({
      kind: "DECOHERENCE_SELECTED",
      turn: 4,
      coordinate: pair.memberB,
      pairId: pair.id,
    });
    expect(result.events.slice(3).map((event) =>
      "coordinate" in event ? event.coordinate : null,
    )).toEqual([pair.memberA, pair.memberB]);
    expect(result.entropyDelta).toEqual([
      {
        context: {
          operation: "DECOHERENCE_SELECT",
          turn: 4,
          candidateCount: candidates.length,
        },
        word: selectedIndex,
      },
      {
        context: {
          operation: "DECOHERENCE_COLLAPSE",
          turn: 4,
          coordinate: pair.memberA,
          pairId: pair.id,
        },
        word: 0,
      },
    ]);
  });

  it.each([
    {
      name: "selection exhaustion",
      script: [] as readonly Result<number, EntropyError>[],
      errorKind: "ENTROPY_EXHAUSTED",
      requests: 1,
    },
    {
      name: "selection range failure",
      script: [{ ok: true as const, value: UINT32_RANGE }],
      errorKind: "ENTROPY_RANGE",
      requests: 1,
    },
    {
      name: "selection context failure",
      script: [{
        ok: false as const,
        error: {
          kind: "ENTROPY_CONTEXT_MISMATCH" as const,
          message: "Wrong selection context.",
        },
      }],
      errorKind: "ENTROPY_CONTEXT_MISMATCH",
      requests: 1,
    },
    {
      name: "collapse exhaustion",
      script: [{ ok: true as const, value: 0 }],
      errorKind: "ENTROPY_EXHAUSTED",
      requests: 2,
    },
    {
      name: "collapse range failure",
      script: [
        { ok: true as const, value: 0 },
        { ok: true as const, value: UINT32_RANGE },
      ],
      errorKind: "ENTROPY_RANGE",
      requests: 2,
    },
    {
      name: "collapse context failure",
      script: [
        { ok: true as const, value: 0 },
        {
          ok: false as const,
          error: {
            kind: "ENTROPY_CONTEXT_MISMATCH" as const,
            message: "Wrong collapse context.",
          },
        },
      ],
      errorKind: "ENTROPY_CONTEXT_MISMATCH",
      requests: 2,
    },
  ])(
    "rolls the whole valid action back on $name",
    ({ script, errorKind, requests }) => {
      const fixture = movementFixture("FLOOR", { turn: 3 });
      const entropy = queuedSource(script);
      const before = JSON.stringify(fixture.state);

      const result = processAction(
        fixture.state,
        { kind: "MOVE", target: fixture.target },
        entropy.source,
      );

      expect(result.ok).toBe(false);
      expect(result.state).toBe(fixture.state);
      expect(result.events).toEqual([]);
      expect(result).toMatchObject({ error: { kind: errorKind } });
      expect("entropyDelta" in result).toBe(false);
      expect(entropy.contexts).toHaveLength(requests);
      expect(JSON.stringify(fixture.state)).toBe(before);
    },
  );

  it.each([
    null,
    {},
    { kind: "TELEPORT", target: { row: 0, col: 0 } },
    { kind: "MOVE" },
    { kind: "MOVE", target: { row: 0, col: 0 }, extra: true },
    { kind: "APPLY_GATE", gate: "Z", target: { row: 0, col: 0 } },
  ])("rejects invalid payload %# before entropy", (action) => {
    const fixture = movementFixture("FLOOR");
    const entropy = scriptedSource({ ok: true, value: 0 });
    const before = JSON.stringify(fixture.state);

    const result = processAction(fixture.state, action, entropy.source);

    expect(result.ok).toBe(false);
    expect(result.state).toBe(fixture.state);
    expect(result.events).toEqual([]);
    expect(entropy.contexts).toEqual([]);
    expect(JSON.stringify(fixture.state)).toBe(before);
  });

  it("rejects terminal input before action validation or entropy", () => {
    const base = movementFixture("FLOOR").state;
    const terminal: GameState = Object.freeze({
      ...base,
      status: "VICTORY",
      terminalReason: "EXIT_REACHED",
      player: EXIT_COORDINATE,
    });
    if (!validateGameState(terminal).ok) {
      throw new Error("Terminal fixture must be valid.");
    }
    const entropy = scriptedSource({ ok: true, value: 0 });

    const result = processAction(terminal, null, entropy.source);

    expect(result).toMatchObject({
      ok: false,
      state: terminal,
      events: [],
      error: { kind: "INVALID_ACTION", reason: "TERMINAL_STATE" },
    });
    expect(entropy.contexts).toEqual([]);
  });

  it("rolls START and all success events back on entropy failure", () => {
    const state = generatedState("turn-entropy-rollback");
    const target = unpairedTarget(state);
    const before = JSON.stringify(state);
    const entropy = scriptedSource({
      ok: false,
      error: { kind: "ENTROPY_EXHAUSTED", message: "No scripted word." },
    });

    const result = processAction(
      state,
      { kind: "OBSERVE", target },
      entropy.source,
    );

    expect(result).toMatchObject({
      ok: false,
      state,
      events: [],
      error: { kind: "ENTROPY_EXHAUSTED" },
    });
    expect(result.state).toBe(state);
    expect(entropy.contexts).toHaveLength(1);
    expect(JSON.stringify(state)).toBe(before);
    expect("entropyDelta" in result).toBe(false);
  });

  it("rolls back a valid direct effect when turn increment violates invariants", () => {
    const state = Object.freeze({
      ...generatedState("turn-overflow"),
      status: "PLAYING" as const,
      turn: Number.MAX_SAFE_INTEGER,
    });
    const target = state.board.find((cell) => cell.kind === "UNRESOLVED")
      ?.coordinate;
    if (target === undefined || !validateGameState(state).ok) {
      throw new Error("Overflow fixture must be valid before the action.");
    }
    const entropy = scriptedSource({ ok: true, value: 0 });

    const result = processAction(
      state,
      { kind: "APPLY_GATE", gate: "X", target },
      entropy.source,
    );

    expect(result).toMatchObject({
      ok: false,
      state,
      events: [],
      error: { kind: "INVALID_STATE", reason: "TURN" },
    });
    expect(result.state).toBe(state);
    expect(entropy.contexts).toEqual([]);
  });
});

describe("terminal integration", () => {
  it("runs scheduled decoherence before same-turn exit victory", () => {
    const initial = generatedState("turn-scheduled-exit-victory");
    const paired = new Set(
      initial.pairs.flatMap(({ memberA, memberB }) => [
        coordinateKey(memberA),
        coordinateKey(memberB),
      ]),
    );
    const candidate = initial.board.find(
      (cell) =>
        cell.kind === "UNRESOLVED" &&
        !paired.has(coordinateKey(cell.coordinate)) &&
        !(cell.coordinate.row === 0 && cell.coordinate.col === 5),
    );
    const approach = initial.board[5]?.coordinate;
    if (candidate?.kind !== "UNRESOLVED" || approach === undefined) {
      throw new Error("Exit fixture requires an unpaired candidate and approach.");
    }
    const board = initial.board.map((cell) =>
      coordinateKey(cell.coordinate) === coordinateKey(candidate.coordinate)
        ? Object.freeze({
            kind: "UNRESOLVED" as const,
            coordinate: cell.coordinate,
            distribution: Object.freeze([0, 1, 0, 0, 0] as const),
          })
        : cell.kind === "UNRESOLVED"
          ? Object.freeze({
              kind: "COLLAPSED" as const,
              coordinate: cell.coordinate,
              outcome: "FLOOR" as const,
            })
          : cell,
    );
    const state: GameState = Object.freeze({
      ...initial,
      status: "PLAYING",
      turn: 3,
      board: Object.freeze(board),
      player: approach,
      observations: 5,
      energy: 0,
    });
    if (!validateGameState(state).ok) {
      throw new Error("Scheduled exit fixture must be valid.");
    }
    const entropy = queuedSource([
      { ok: true, value: 0 },
      { ok: true, value: 0xffffffff },
    ]);
    const before = JSON.stringify(state);

    const result = processAction(
      state,
      { kind: "MOVE", target: EXIT_COORDINATE },
      entropy.source,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.state).toMatchObject({
      status: "VICTORY",
      terminalReason: "EXIT_REACHED",
      turn: 4,
      player: EXIT_COORDINATE,
    });
    expect(result.events.map(({ kind }) => kind)).toEqual([
      "PLAYER_MOVED",
      "TURN_ADVANCED",
      "DECOHERENCE_SELECTED",
      "CELL_COLLAPSED",
      "STATUS_CHANGED",
    ]);
    expect(result.events[3]).toMatchObject({
      kind: "CELL_COLLAPSED",
      coordinate: candidate.coordinate,
      outcome: "WALL",
      cause: "DECOHERENCE",
    });
    expect(result.events.at(-1)).toEqual({
      kind: "STATUS_CHANGED",
      status: "VICTORY",
      reason: "EXIT_REACHED",
    });
    expect(result.entropyDelta).toHaveLength(2);
    expect(entropy.contexts).toHaveLength(2);
    expect(JSON.stringify(state)).toBe(before);
  });
});