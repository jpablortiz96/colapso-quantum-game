import type { GameStateDto } from "../engine/index";

export const DAILY_UNIVERSE_SCHEMA_VERSION = 1 as const;
export const FIRST_UNIVERSE_DATE = "2026-07-22" as const;
export const FIRST_UNIVERSE_NUMBER = 1 as const;
export const LOCKED_REAL_RUN_ID = "real-20260721t205417z" as const;
export const CAMPAIGN_ID = "colapso-five-hardware-universes-v1" as const;
export const PINNED_FIRST_COMMITMENT =
  "bcff83aade29774587a84df10a9e168f5828e705728981d4eb8caf4075875579" as const;

export type UniverseNumber = 1 | 2 | 3 | 4 | 5;
export type PublishedUniverseNumber = 1 | 2 | 3 | 4;
export type CampaignEvidenceUniverseNumber = 2 | 3 | 4 | 5;

export const CAMPAIGN_UNIVERSE_IDENTITIES = Object.freeze({
  1: Object.freeze({
    title: "Origin Universe",
    dateUtc: "2026-07-22",
    universeId: "colapso-2026-07-22-001",
  }),
  2: Object.freeze({
    title: "Entangled Paths",
    dateUtc: "2026-07-23",
    universeId: "colapso-2026-07-23-002",
  }),
  3: Object.freeze({
    title: "The Void Protocol",
    dateUtc: "2026-07-24",
    universeId: "colapso-2026-07-24-003",
  }),
  4: Object.freeze({
    title: "Energy Crisis",
    dateUtc: "2026-07-25",
    universeId: "colapso-2026-07-25-004",
  }),
  5: Object.freeze({
    title: "Quantum Storm",
    dateUtc: "2026-07-26",
    universeId: "colapso-2026-07-26-005",
  }),
} as const satisfies Readonly<Record<UniverseNumber, Readonly<{
  title: string;
  dateUtc: string;
  universeId: string;
}>>>);

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
  runId: string;
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

export type CampaignDirectEvidence = Readonly<{
  campaignId: typeof CAMPAIGN_ID;
  evidencePath: string;
  jobId: string;
  primitive: "SamplerV2";
  backend: "ibm_fez";
  backendVersion: string;
  shots: 256;
  submittedAt: string;
  completedAt: string;
  runtimeRawSha256: string;
  canonicalRawSha256: string;
  acceptedEntropyArtifactSha256: string;
  manifestSha256: string;
  acquisitionCommitment: string;
  commitmentScope: "ACQUISITION_EVIDENCE_INPUTS_NOT_COMPILED_BOARD";
}>;

export type VerifiedCampaignEvidence = Readonly<{
  campaignId: typeof CAMPAIGN_ID;
  universeNumber: CampaignEvidenceUniverseNumber;
  title: string;
  evidencePath: string;
  backend: "ibm_fez";
  backendVersion: string;
  generatedAt: string;
  entropyBitsAccepted: 1024;
  entropyBytesHex: string;
  sourceEntropyHash: string;
  artifactHashes: Readonly<Record<string, string>>;
  job: EvidenceJob;
  bell: BellSummary;
  directEvidence: CampaignDirectEvidence;
}>;

export type PendingCampaignEvidence = Readonly<{
  campaignId: typeof CAMPAIGN_ID;
  universeNumber: 5;
  title: "Quantum Storm";
  evidencePath: "evidence/universe-005";
  jobId: string;
  primitive: "SamplerV2";
  backend: "ibm_fez";
  backendVersion: string;
  shots: 256;
  operatorStatus: "QUEUED";
  manifestState: "QUEUED";
  resultPreserved: false;
  artifactsEmpty: true;
  boardGenerationStarted: false;
}>;

export type AvailableCampaignEvidence = Readonly<{
  campaignId: typeof CAMPAIGN_ID;
  complete: readonly VerifiedCampaignEvidence[];
  pending: PendingCampaignEvidence;
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
  inputMaterial: string;
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
  universeNumber: UniverseNumber;
  dateUtc: string;
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
  evidenceRunId: string;
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
  today: string;
  latest: string;
  universes: readonly Readonly<{
    dateUtc: string;
    universeId: string;
    universeNumber: UniverseNumber;
    mode: "REAL";
    commitment: string;
  }>[];
}>;

export type DirectDualPrimitiveProvenance = Readonly<{
  kind: "DIRECT_DUAL_PRIMITIVE";
  directEvidence: Readonly<{
    evidenceRunId: string;
    backend: "ibm_fez";
    samplerJobId: string;
    estimatorJobId: string;
    artifactHashes: Readonly<Record<string, string>>;
  }>;
}>;

export type SharedChshReference = Readonly<{
  universeNumber: 1;
  universeId: "colapso-2026-07-22-001";
  evidenceRunId: typeof LOCKED_REAL_RUN_ID;
  primitive: "EstimatorV2";
  jobId: string;
  runtimeRawArtifact: "estimator-runtime-raw.json";
  runtimeRawSha256: string;
  chshArtifact: "chsh-derived.json";
  chshArtifactSha256: string;
  publishedCommitment: typeof PINNED_FIRST_COMMITMENT;
}>;

export type DirectSamplerSharedChshProvenance = Readonly<{
  kind: "DIRECT_SAMPLER_SHARED_CHSH";
  directEvidence: CampaignDirectEvidence;
  sharedChshReference: SharedChshReference;
}>;

export type PendingSamplerProvenance = Readonly<{
  kind: "PENDING_SAMPLER";
  pendingEvidence: PendingCampaignEvidence;
}>;

export type PlayableCampaignEntry = Readonly<{
  universeNumber: UniverseNumber;
  title: string;
  dateUtc: string;
  evidenceStatus: "verified";
  publicationStatus: "published";
  playable: true;
  artifact: DailyUniverse;
  provenance: DirectDualPrimitiveProvenance | DirectSamplerSharedChshProvenance;
}>;

export type BlockedCampaignEntry = Readonly<{
  universeNumber: 5;
  title: "Quantum Storm";
  dateUtc: "2026-07-26";
  evidenceStatus: "pending";
  publicationStatus: "blocked";
  playable: false;
  artifact: null;
  provenance: PendingSamplerProvenance;
}>;

export type CampaignEntry = PlayableCampaignEntry | BlockedCampaignEntry;

export type CampaignBundle = Readonly<{
  schemaVersion: 1;
  campaignId: typeof CAMPAIGN_ID;
  entries: readonly CampaignEntry[];
}>;
