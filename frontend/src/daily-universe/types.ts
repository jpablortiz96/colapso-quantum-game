import type { GameStateDto } from "../engine/index";

export const DAILY_UNIVERSE_SCHEMA_VERSION = 1 as const;
export const FIRST_UNIVERSE_DATE = "2026-07-22" as const;
export const FIRST_UNIVERSE_NUMBER = 1 as const;
export const LOCKED_REAL_RUN_ID = "real-20260721t205417z" as const;

export type EvidenceJob = Readonly<{
  role: "SAMPLER_ENTROPY_BELL" | "ESTIMATOR_CHSH";
  jobId: string;
  primitive: "SamplerV2" | "EstimatorV2";
  backend: "ibm_fez";
  status: "DONE";
  runtimeRawArtifact: string;
  runtimeRawSha256: string;
}>;

export type BellSummary = Readonly<{
  observedCorrelation: number;
  shots: number;
  interpretation: string;
}>;

export type ChshSummary = Readonly<{
  witness: number;
  standardError: number;
  classification: string;
  interpretation: string;
  signConvention: string;
}>;

export type VerifiedRealEvidence = Readonly<{
  runId: typeof LOCKED_REAL_RUN_ID;
  backend: "ibm_fez";
  backendVersion: string;
  generatedAt: string;
  entropyBitsAccepted: 1024;
  entropyBytesHex: string;
  sourceEntropyHash: string;
  artifactHashes: Readonly<Record<string, string>>;
  jobs: readonly EvidenceJob[];
  bell: BellSummary;
  chsh: ChshSummary;
}>;

export type EntropyDerivation = Readonly<{
  domain: string;
  version: "v1";
  counterStart: number;
  bytesProduced: number;
  bytesConsumed: number;
  materialHash: string;
}>;

export type EntropyExpansionMetadata = Readonly<{
  algorithm: "SHA-256 counter mode";
  version: "colapso-daily-universe-expansion-v1";
  inputMaterial: "entropy-derived.json:entropy_bytes_hex";
  sourceEntropyHash: string;
  attemptDerivation: Readonly<{
    domain: "universe-attempt";
    version: "v1";
    attemptIndex: number;
    initialHash: string;
  }>;
  derivations: readonly EntropyDerivation[];
  note: string;
}>;

export type ResolutionPlan = Readonly<{
  schemaVersion: 1;
  algorithm: "SHA-256 counter mode";
  version: "colapso-daily-universe-resolution-v1";
  keyMaterialHex: string;
  keyMaterialHash: string;
  derivationDomain: "resolution-plan/v1";
  streamDomain: "turn-resolution/v1";
  counterStart: 0;
  wordByteOrder: "big-endian";
  bytesProduced: 32;
  bytesConsumed: 32;
  clientDisclosure: string;
}>;

export type DailyUniverse = Readonly<{
  schemaVersion: typeof DAILY_UNIVERSE_SCHEMA_VERSION;
  universeId: string;
  universeNumber: typeof FIRST_UNIVERSE_NUMBER;
  dateUtc: typeof FIRST_UNIVERSE_DATE;
  mode: "REAL";
  locale: "es-419";
  engineRulesVersion: 1;
  attemptIndex: number;
  generatedAt: string;
  serializedInitialGameState: string;
  initialGameState: GameStateDto;
  publicBoard: GameStateDto["board"];
  resolutionPlan: ResolutionPlan;
  entangledPairs: GameStateDto["pairs"];
  sourceEntropyHash: string;
  entropyBitsAccepted: 1024;
  entropyExpansionAlgorithm: "SHA-256 counter mode";
  entropyExpansion: EntropyExpansionMetadata;
  evidenceRunId: typeof LOCKED_REAL_RUN_ID;
  backend: "ibm_fez";
  jobIds: readonly string[];
  evidenceHashes: Readonly<Record<string, string>>;
  bellSummary: BellSummary;
  chshSummary: ChshSummary;
  scientificClassification: string;
  provenanceNotice: string;
  clientDisclosure: string;
  commitment: string;
}>;

export type DailyUniverseIndex = Readonly<{
  schemaVersion: 1;
  today: typeof FIRST_UNIVERSE_DATE;
  latest: typeof FIRST_UNIVERSE_DATE;
  universes: readonly Readonly<{
    dateUtc: typeof FIRST_UNIVERSE_DATE;
    universeId: string;
    universeNumber: typeof FIRST_UNIVERSE_NUMBER;
    mode: "REAL";
    commitment: string;
  }>[];
}>;
