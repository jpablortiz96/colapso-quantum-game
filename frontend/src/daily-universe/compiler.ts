import { Buffer } from "node:buffer";
import {
  V1_RULE_CONFIG,
  analyzeRoutes,
  generateInitialState,
  serializeGameState,
  serializeGameStateToDto,
} from "../engine/index";
import { calculateCommitment } from "./commitment";
import { deriveAttemptKey, expandCounterMode, sha256Hex } from "./entropy-expander";
import type {
  ChshSummary,
  DailyUniverse,
  DailyUniverseIndex,
  EntropyDerivation,
  EntropyExpansionMetadata,
  ResolutionPlan,
  VerifiedCampaignEvidence,
  VerifiedRealEvidence,
} from "./types";
import {
  CAMPAIGN_UNIVERSE_IDENTITIES,
  DAILY_UNIVERSE_SCHEMA_VERSION,
  FIRST_UNIVERSE_DATE,
  FIRST_UNIVERSE_NUMBER,
} from "./types";

const MAX_ATTEMPTS = 256;
const PROVENANCE_NOTICE =
  "Este universo fue derivado de mediciones realizadas en hardware cuántico real de IBM. La evidencia, los resultados exportados y sus hashes están preservados en el Evidence Pack.";
const CLIENT_DISCLOSURE =
  "El cliente puede inspeccionar técnicamente el estado y el plan de resolución publicados. No se afirma protección anti-trampa; un leaderboard futuro deberá validar replays del lado del servidor.";

type CompiledCandidate = Readonly<{
  attemptIndex: number;
  attemptHash: string;
  generationSeedHex: string;
  resolutionKeyHex: string;
  serializedInitialState: string;
  initialState: DailyUniverse["initialGameState"];
  entropyDerivations: readonly EntropyDerivation[];
}>;

export type CandidateFactory<T> = (
  attemptIndex: number,
  attemptKey: Uint8Array,
) => T | null;

export const selectFirstPlayableCandidate = <T>(
  sourceEntropyHash: string,
  factory: CandidateFactory<T>,
): Readonly<{ attemptIndex: number; attemptKey: Uint8Array; value: T }> => {
  for (let attemptIndex = 0; attemptIndex < MAX_ATTEMPTS; attemptIndex += 1) {
    const attemptKey = deriveAttemptKey(sourceEntropyHash, attemptIndex);
    const value = factory(attemptIndex, attemptKey);
    if (value !== null) {
      return Object.freeze({ attemptIndex, attemptKey, value });
    }
  }
  throw new Error(`No playable universe candidate was found in ${MAX_ATTEMPTS} deterministic attempts.`);
};

const derivation = (
  domain: string,
  material: Uint8Array,
): EntropyDerivation =>
  Object.freeze({
    domain,
    version: "v1",
    counterStart: 0,
    bytesProduced: material.length,
    bytesConsumed: material.length,
    materialHash: sha256Hex(material),
  });

const buildCandidate = (
  attemptIndex: number,
  attemptKey: Uint8Array,
): CompiledCandidate | null => {
  const initialStateMaterial = expandCounterMode(
    attemptKey,
    "initial-state/v1",
    0,
    32,
  );
  const resolutionMaterial = expandCounterMode(
    attemptKey,
    "resolution-plan/v1",
    0,
    32,
  );
  const generationSeedHex = Buffer.from(initialStateMaterial).toString("hex");
  const generated = generateInitialState(
    generationSeedHex,
    V1_RULE_CONFIG.rulesVersion,
  );
  if (!generated.ok) {
    throw new Error(`F1 generator rejected derived seed: ${generated.error.message}`);
  }
  const serialized = serializeGameStateToDto(generated.value);
  if (!serialized.ok) {
    throw new Error(`F1 serializer rejected generated state: ${serialized.error.message}`);
  }
  const serializedJson = serializeGameState(generated.value);
  if (!serializedJson.ok) {
    throw new Error(`F1 serializer rejected generated state: ${serializedJson.error.message}`);
  }
  const routes = analyzeRoutes(serialized.value);
  if (
    serialized.value.status !== "START" ||
    serialized.value.board.length !== V1_RULE_CONFIG.boardSize ** 2 ||
    !routes.legalPotentialRoute
  ) {
    return null;
  }
  return Object.freeze({
    attemptIndex,
    attemptHash: Buffer.from(attemptKey).toString("hex"),
    generationSeedHex,
    resolutionKeyHex: Buffer.from(resolutionMaterial).toString("hex"),
    serializedInitialState: serializedJson.value,
    initialState: serialized.value,
    entropyDerivations: Object.freeze([
      derivation("initial-state/v1", initialStateMaterial),
      derivation("resolution-plan/v1", resolutionMaterial),
    ]),
  });
};

const ensureFirstUniverseDate: (dateUtc: string) => asserts dateUtc is typeof FIRST_UNIVERSE_DATE = (dateUtc) => {
  if (dateUtc !== FIRST_UNIVERSE_DATE) {
    throw new Error(`F3 only defines the first universe date ${FIRST_UNIVERSE_DATE}.`);
  }
};

/** Builds the first published universe in memory; it performs no file or network I/O. */
export const compileDailyUniverse = (
  evidence: VerifiedRealEvidence,
  dateUtc: string,
): DailyUniverse => {
  ensureFirstUniverseDate(dateUtc);
  const selected = selectFirstPlayableCandidate(
    evidence.sourceEntropyHash,
    buildCandidate,
  );
  const candidate = selected.value;
  const resolutionPlan: ResolutionPlan = Object.freeze({
    schemaVersion: 1,
    algorithm: "SHA-256 counter mode",
    version: "colapso-daily-universe-resolution-v1",
    keyMaterialHex: candidate.resolutionKeyHex,
    keyMaterialHash: sha256Hex(Buffer.from(candidate.resolutionKeyHex, "hex")),
    derivationDomain: "resolution-plan/v1",
    streamDomain: "turn-resolution/v1",
    counterStart: 0,
    wordByteOrder: "big-endian",
    bytesProduced: 32,
    bytesConsumed: 32,
    clientDisclosure: CLIENT_DISCLOSURE,
  });
  const entropyExpansion: EntropyExpansionMetadata = Object.freeze({
    algorithm: "SHA-256 counter mode",
    version: "colapso-daily-universe-expansion-v1",
    inputMaterial: "entropy-derived.json:entropy_bytes_hex",
    sourceEntropyHash: evidence.sourceEntropyHash,
    attemptDerivation: Object.freeze({
      domain: "universe-attempt",
      version: "v1",
      attemptIndex: selected.attemptIndex,
      initialHash: candidate.attemptHash,
    }),
    derivations: candidate.entropyDerivations,
    note:
      "La expansión extiende de forma determinista el material aceptado; no crea ni certifica entropía física nueva.",
  });
  const withoutCommitment: Omit<DailyUniverse, "commitment"> = {
    schemaVersion: DAILY_UNIVERSE_SCHEMA_VERSION,
    universeId: "colapso-2026-07-22-001",
    universeNumber: FIRST_UNIVERSE_NUMBER,
    dateUtc,
    mode: "REAL",
    locale: "es-419",
    engineRulesVersion: V1_RULE_CONFIG.rulesVersion,
    attemptIndex: selected.attemptIndex,
    generatedAt: evidence.generatedAt,
    serializedInitialGameState: candidate.serializedInitialState,
    initialGameState: candidate.initialState,
    publicBoard: candidate.initialState.board,
    resolutionPlan,
    entangledPairs: candidate.initialState.pairs,
    sourceEntropyHash: evidence.sourceEntropyHash,
    entropyBitsAccepted: evidence.entropyBitsAccepted,
    entropyExpansionAlgorithm: "SHA-256 counter mode",
    entropyExpansion,
    evidenceRunId: evidence.runId,
    backend: evidence.backend,
    jobIds: Object.freeze(evidence.jobs.map(({ jobId }) => jobId).sort()),
    evidenceHashes: evidence.artifactHashes,
    bellSummary: evidence.bell,
    chshSummary: evidence.chsh,
    scientificClassification: evidence.chsh.classification,
    provenanceNotice: PROVENANCE_NOTICE,
    clientDisclosure: CLIENT_DISCLOSURE,
  };
  return Object.freeze({
    ...withoutCommitment,
    commitment: calculateCommitment(withoutCommitment),
  });
};

export const compileUniverseIndex = (
  universe: DailyUniverse,
): DailyUniverseIndex =>
  Object.freeze({
    schemaVersion: 1,
    today: FIRST_UNIVERSE_DATE,
    latest: FIRST_UNIVERSE_DATE,
    universes: Object.freeze([
      Object.freeze({
        dateUtc: universe.dateUtc,
        universeId: universe.universeId,
        universeNumber: universe.universeNumber,
        mode: universe.mode,
        commitment: universe.commitment,
      }),
    ]),
  });

const CAMPAIGN_PROVENANCE_NOTICE =
  "Este universo fue derivado de evidencia SamplerV2 directa preservada para este universo. Su resumen CHSH referencia explícitamente la evidencia EstimatorV2/CHSH compartida y fijada del universo #1; no afirma evidencia EstimatorV2 directa para este universo.";

/** Compiles a campaign universe (#2-#5) from its own accepted entropy bytes and direct Sampler evidence. */
export const compileCampaignUniverse = (
  evidence: VerifiedCampaignEvidence,
  sharedChsh: ChshSummary,
): DailyUniverse => {
  const identity = CAMPAIGN_UNIVERSE_IDENTITIES[evidence.universeNumber];
  if (evidence.title !== identity.title) {
    throw new Error(`Campaign evidence title does not match universe #${evidence.universeNumber}.`);
  }
  const selected = selectFirstPlayableCandidate(
    evidence.sourceEntropyHash,
    buildCandidate,
  );
  const candidate = selected.value;
  const resolutionPlan: ResolutionPlan = Object.freeze({
    schemaVersion: 1,
    algorithm: "SHA-256 counter mode",
    version: "colapso-daily-universe-resolution-v1",
    keyMaterialHex: candidate.resolutionKeyHex,
    keyMaterialHash: sha256Hex(Buffer.from(candidate.resolutionKeyHex, "hex")),
    derivationDomain: "resolution-plan/v1",
    streamDomain: "turn-resolution/v1",
    counterStart: 0,
    wordByteOrder: "big-endian",
    bytesProduced: 32,
    bytesConsumed: 32,
    clientDisclosure: CLIENT_DISCLOSURE,
  });
  const entropyExpansion: EntropyExpansionMetadata = Object.freeze({
    algorithm: "SHA-256 counter mode",
    version: "colapso-daily-universe-expansion-v1",
    inputMaterial: "accepted-entropy.json:entropy_bytes_hex",
    sourceEntropyHash: evidence.sourceEntropyHash,
    attemptDerivation: Object.freeze({
      domain: "universe-attempt",
      version: "v1",
      attemptIndex: selected.attemptIndex,
      initialHash: candidate.attemptHash,
    }),
    derivations: candidate.entropyDerivations,
    note:
      "La expansión extiende de forma determinista el material aceptado; no crea ni certifica entropía física nueva.",
  });
  const withoutCommitment: Omit<DailyUniverse, "commitment"> = {
    schemaVersion: DAILY_UNIVERSE_SCHEMA_VERSION,
    universeId: identity.universeId,
    universeNumber: evidence.universeNumber,
    dateUtc: identity.dateUtc,
    mode: "REAL",
    locale: "es-419",
    engineRulesVersion: V1_RULE_CONFIG.rulesVersion,
    attemptIndex: selected.attemptIndex,
    generatedAt: evidence.generatedAt,
    serializedInitialGameState: candidate.serializedInitialState,
    initialGameState: candidate.initialState,
    publicBoard: candidate.initialState.board,
    resolutionPlan,
    entangledPairs: candidate.initialState.pairs,
    sourceEntropyHash: evidence.sourceEntropyHash,
    entropyBitsAccepted: evidence.entropyBitsAccepted,
    entropyExpansionAlgorithm: "SHA-256 counter mode",
    entropyExpansion,
    evidenceRunId: evidence.evidencePath,
    backend: evidence.backend,
    jobIds: Object.freeze([evidence.job.jobId]),
    evidenceHashes: evidence.artifactHashes,
    bellSummary: evidence.bell,
    chshSummary: sharedChsh,
    scientificClassification: sharedChsh.classification,
    provenanceNotice: CAMPAIGN_PROVENANCE_NOTICE,
    clientDisclosure: CLIENT_DISCLOSURE,
  };
  return Object.freeze({
    ...withoutCommitment,
    commitment: calculateCommitment(withoutCommitment),
  });
};

/** Builds a campaign-aware public index from already-validated playable artifacts. */
export const compileCampaignUniverseIndex = (
  universes: readonly DailyUniverse[],
): DailyUniverseIndex => {
  if (universes.length === 0) {
    throw new Error("A campaign index requires at least one playable universe.");
  }
  const ordered = [...universes].sort(
    (left, right) => left.universeNumber - right.universeNumber,
  );
  if (new Set(ordered.map(({ universeNumber }) => universeNumber)).size !== ordered.length) {
    throw new Error("A campaign index cannot contain duplicate universe numbers.");
  }
  const latest = ordered.at(-1);
  if (latest === undefined) {
    throw new Error("A campaign index requires a latest universe.");
  }
  return Object.freeze({
    schemaVersion: 1,
    today: latest.dateUtc,
    latest: latest.dateUtc,
    universes: Object.freeze(ordered.map((universe) => Object.freeze({
      dateUtc: universe.dateUtc,
      universeId: universe.universeId,
      universeNumber: universe.universeNumber,
      mode: universe.mode,
      commitment: universe.commitment,
    }))),
  });
};
