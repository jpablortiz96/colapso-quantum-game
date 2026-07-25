import fs from "node:fs";
import path from "node:path";
import {
  V1_RULE_CONFIG,
  analyzeRoutes,
  deserializeGameState,
  deserializeGameStateDto,
  serializeGameStateToDto,
} from "../engine/index";
import { hasValidCommitment } from "./commitment";
import { readLockedRealEvidence } from "./evidence-reader";
import { canonicalJson } from "./serializer";
import {
  FIRST_UNIVERSE_DATE,
  LOCKED_REAL_RUN_ID,
  type DailyUniverse,
} from "./types";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const sameCanonicalValue = (left: unknown, right: unknown): boolean =>
  canonicalJson(left) === canonicalJson(right);

const defaultUniversePath = (repositoryRoot: string): string =>
  path.join(
    repositoryRoot,
    "frontend",
    "public",
    "data",
    "universes",
    `${FIRST_UNIVERSE_DATE}.json`,
  );

export type UniverseVerification = Readonly<{
  ok: boolean;
  issues: readonly string[];
  universe?: DailyUniverse;
}>;

/** Verifies the published file only. It never regenerates or rewrites it. */
export const verifyPublishedUniverse = (
  repositoryRoot: string,
  universePath = defaultUniversePath(repositoryRoot),
): UniverseVerification => {
  const issues: string[] = [];
  try {
    const source = fs.readFileSync(universePath, "utf8");
    const parsed: unknown = JSON.parse(source) as unknown;
    if (!isRecord(parsed)) {
      throw new Error("Published universe must be a JSON object.");
    }
    if (canonicalJson(parsed) !== source) {
      issues.push("Published universe bytes are not canonical JSON.");
    }
    const universe = parsed as unknown as DailyUniverse;
    if (!hasValidCommitment(universe)) {
      issues.push("Universe commitment is missing or invalid.");
    }
    const evidence = readLockedRealEvidence({
      repositoryRoot,
      runId: LOCKED_REAL_RUN_ID,
    });
    if (
      universe.schemaVersion !== 1 ||
      universe.dateUtc !== FIRST_UNIVERSE_DATE ||
      universe.universeNumber !== 1 ||
      universe.mode !== "REAL" ||
      universe.locale !== "es-419" ||
      universe.engineRulesVersion !== V1_RULE_CONFIG.rulesVersion
    ) {
      issues.push("Universe identity or F1 rules metadata is invalid.");
    }
    if (
      universe.evidenceRunId !== evidence.runId ||
      universe.backend !== evidence.backend ||
      universe.generatedAt !== evidence.generatedAt ||
      universe.sourceEntropyHash !== evidence.sourceEntropyHash ||
      universe.entropyBitsAccepted !== evidence.entropyBitsAccepted ||
      !sameCanonicalValue(universe.jobIds, evidence.jobs.map(({ jobId }) => jobId).sort()) ||
      !sameCanonicalValue(universe.evidenceHashes, evidence.artifactHashes) ||
      !sameCanonicalValue(universe.bellSummary, evidence.bell) ||
      !sameCanonicalValue(universe.chshSummary, evidence.chsh)
    ) {
      issues.push("Published provenance does not match the locked real evidence.");
    }
    const serializedState = deserializeGameState(universe.serializedInitialGameState);
    if (!serializedState.ok) {
      issues.push(`Serialized initial game state is invalid: ${serializedState.error.message}`);
    } else {
      const serializedDto = serializeGameStateToDto(serializedState.value);
      if (!serializedDto.ok || !sameCanonicalValue(serializedDto.value, universe.initialGameState)) {
        issues.push("Serialized initial game state diverges from the initial game-state DTO.");
      }
    }
    const deserialized = deserializeGameStateDto(universe.initialGameState);
    if (!deserialized.ok) {
      issues.push(`Initial game state is invalid: ${deserialized.error.message}`);
    } else {
      const state = deserialized.value;
      const entry = state.board.find(
        (cell) => cell.coordinate.row === 6 && cell.coordinate.col === 0,
      );
      const exit = state.board.find(
        (cell) => cell.coordinate.row === 0 && cell.coordinate.col === 6,
      );
      const pairCoordinates = state.pairs.flatMap((pair) => [
        `${pair.memberA.row},${pair.memberA.col}`,
        `${pair.memberB.row},${pair.memberB.col}`,
      ]);
      const routes = analyzeRoutes(state);
      if (
        state.board.length !== V1_RULE_CONFIG.boardSize ** 2 ||
        state.status !== "START" ||
        state.observations !== V1_RULE_CONFIG.initialObservations ||
        state.pairs.length < 3 ||
        state.pairs.length > 5 ||
        new Set(pairCoordinates).size !== pairCoordinates.length ||
        entry?.kind !== "COLLAPSED" ||
        entry.outcome !== "FLOOR" ||
        exit?.kind !== "COLLAPSED" ||
        exit.outcome !== "FLOOR" ||
        !routes.legalPotentialRoute
      ) {
        issues.push("Initial state fails canonical board, pair, endpoint, or route rules.");
      }
      if (
        !sameCanonicalValue(universe.publicBoard, state.board) ||
        !sameCanonicalValue(universe.entangledPairs, state.pairs)
      ) {
        issues.push("Public board or entangled pairs diverge from the F1 serialized state.");
      }
    }
    if (
      universe.resolutionPlan.algorithm !== "SHA-256 counter mode" ||
      universe.resolutionPlan.counterStart !== 0 ||
      universe.resolutionPlan.bytesProduced !== 32 ||
      universe.resolutionPlan.bytesConsumed !== 32 ||
      !/^[a-f0-9]{64}$/u.test(universe.resolutionPlan.keyMaterialHex)
    ) {
      issues.push("Resolution plan is malformed.");
    }
    return Object.freeze(
      issues.length === 0
        ? { ok: true, issues: Object.freeze([]), universe }
        : { ok: false, issues: Object.freeze(issues) },
    );
  } catch (error) {
    return Object.freeze({
      ok: false,
      issues: Object.freeze([
        error instanceof Error ? error.message : String(error),
      ]),
    });
  }
};
