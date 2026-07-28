import {
  CAMPAIGN_ID,
  CAMPAIGN_UNIVERSE_IDENTITIES,
  LOCKED_REAL_RUN_ID,
  PINNED_FIRST_COMMITMENT,
  type CampaignBundle,
  type UniverseNumber,
} from "./types";

const SHA256 = /^[a-f0-9]{64}$/u;
const ISO_DATE_TIME = /^\d{4}-\d{2}-\d{2}T/u;
const SHARED_ESTIMATOR_JOB_ID = "d9ftp0kinv1c73arre9g";
const SHARED_ESTIMATOR_RUNTIME_SHA256 =
  "37c2b070651bef4d1663866e7dce132ac0efa1687c010e07d2554f9ce60266af";
const SHARED_CHSH_ARTIFACT_SHA256 =
  "e9f1bb47b1528dc46d4ac2f90dd40f9f1118ba7acc134cc6c9e04cc542a09f6e";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const fail = (message: string): never => {
  throw new Error(`Invalid campaign bundle: ${message}`);
};

const record = (value: unknown, label: string): Record<string, unknown> => {
  if (!isRecord(value)) {
    return fail(`${label} must be an object.`);
  }
  return value;
};

const exactKeys = (
  value: Record<string, unknown>,
  expected: readonly string[],
  label: string,
): void => {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (
    actual.length !== wanted.length ||
    actual.some((key, index) => key !== wanted[index])
  ) {
    fail(`${label} has unexpected or missing fields.`);
  }
};

const stringField = (
  value: Record<string, unknown>,
  key: string,
  label: string,
): string => {
  const field = value[key];
  if (typeof field !== "string" || field.length === 0) {
    return fail(`${label}.${key} must be a non-empty string.`);
  }
  return field;
};

const assertHashRecord = (value: unknown, label: string): void => {
  const hashes = record(value, label);
  if (Object.keys(hashes).length === 0) {
    fail(`${label} must not be empty.`);
  }
  for (const [name, digest] of Object.entries(hashes)) {
    if (!name.endsWith(".json") || typeof digest !== "string" || !SHA256.test(digest)) {
      fail(`${label} contains an invalid artifact hash.`);
    }
  }
};

const assertArtifact = (
  value: unknown,
  universeNumber: UniverseNumber,
): Record<string, unknown> => {
  const artifact = record(value, `entry #${universeNumber} artifact`);
  const identity = CAMPAIGN_UNIVERSE_IDENTITIES[universeNumber];
  if (
    artifact.schemaVersion !== 1 ||
    artifact.universeNumber !== universeNumber ||
    artifact.universeId !== identity.universeId ||
    artifact.dateUtc !== identity.dateUtc ||
    artifact.mode !== "REAL" ||
    artifact.backend !== "ibm_fez" ||
    artifact.entropyBitsAccepted !== 1024 ||
    typeof artifact.sourceEntropyHash !== "string" ||
    !SHA256.test(artifact.sourceEntropyHash) ||
    typeof artifact.commitment !== "string" ||
    !SHA256.test(artifact.commitment) ||
    !Array.isArray(artifact.jobIds) ||
    !isRecord(artifact.bellSummary) ||
    !isRecord(artifact.chshSummary) ||
    !Array.isArray(artifact.publicBoard) ||
    !isRecord(artifact.initialGameState)
  ) {
    fail(`entry #${universeNumber} artifact identity or required fields are invalid.`);
  }
  if (universeNumber === 1 && artifact.commitment !== PINNED_FIRST_COMMITMENT) {
    fail("entry #1 does not contain the pinned commitment.");
  }
  return artifact;
};

const assertDirectEvidence = (
  value: unknown,
  universeNumber: UniverseNumber,
): void => {
  const direct = record(value, `entry #${universeNumber} direct evidence`);
  exactKeys(
    direct,
    [
      "campaignId",
      "evidencePath",
      "jobId",
      "primitive",
      "backend",
      "backendVersion",
      "shots",
      "submittedAt",
      "completedAt",
      "runtimeRawSha256",
      "canonicalRawSha256",
      "acceptedEntropyArtifactSha256",
      "manifestSha256",
      "acquisitionCommitment",
      "commitmentScope",
    ],
    `entry #${universeNumber} direct evidence`,
  );
  if (
    direct.campaignId !== CAMPAIGN_ID ||
    direct.evidencePath !== `evidence/universe-${String(universeNumber).padStart(3, "0")}` ||
    direct.primitive !== "SamplerV2" ||
    direct.backend !== "ibm_fez" ||
    direct.shots !== 256 ||
    direct.commitmentScope !== "ACQUISITION_EVIDENCE_INPUTS_NOT_COMPILED_BOARD" ||
    !ISO_DATE_TIME.test(stringField(direct, "submittedAt", "direct evidence")) ||
    !ISO_DATE_TIME.test(stringField(direct, "completedAt", "direct evidence"))
  ) {
    fail(`entry #${universeNumber} direct evidence identity is invalid.`);
  }
  for (const key of [
    "runtimeRawSha256",
    "canonicalRawSha256",
    "acceptedEntropyArtifactSha256",
    "manifestSha256",
    "acquisitionCommitment",
  ] as const) {
    if (!SHA256.test(stringField(direct, key, "direct evidence"))) {
      fail(`entry #${universeNumber} direct evidence ${key} is invalid.`);
    }
  }
  stringField(direct, "jobId", "direct evidence");
  stringField(direct, "backendVersion", "direct evidence");
};

const assertSharedChshReference = (value: unknown, universeNumber: UniverseNumber): void => {
  const shared = record(value, `entry #${universeNumber} shared CHSH reference`);
  exactKeys(
    shared,
    [
      "universeNumber",
      "universeId",
      "evidenceRunId",
      "primitive",
      "jobId",
      "runtimeRawArtifact",
      "runtimeRawSha256",
      "chshArtifact",
      "chshArtifactSha256",
      "publishedCommitment",
    ],
    `entry #${universeNumber} shared CHSH reference`,
  );
  if (
    shared.universeNumber !== 1 ||
    shared.universeId !== CAMPAIGN_UNIVERSE_IDENTITIES[1].universeId ||
    shared.evidenceRunId !== LOCKED_REAL_RUN_ID ||
    shared.primitive !== "EstimatorV2" ||
    shared.jobId !== SHARED_ESTIMATOR_JOB_ID ||
    shared.runtimeRawArtifact !== "estimator-runtime-raw.json" ||
    shared.runtimeRawSha256 !== SHARED_ESTIMATOR_RUNTIME_SHA256 ||
    shared.chshArtifact !== "chsh-derived.json" ||
    shared.chshArtifactSha256 !== SHARED_CHSH_ARTIFACT_SHA256 ||
    shared.publishedCommitment !== PINNED_FIRST_COMMITMENT
  ) {
    fail(`entry #${universeNumber} shared CHSH reference is not the pinned #1 record.`);
  }
};

const assertPlayableEntry = (
  entry: Record<string, unknown>,
  universeNumber: UniverseNumber,
): void => {
  exactKeys(
    entry,
    [
      "universeNumber",
      "title",
      "dateUtc",
      "evidenceStatus",
      "publicationStatus",
      "playable",
      "artifact",
      "provenance",
    ],
    `entry #${universeNumber}`,
  );
  const identity = CAMPAIGN_UNIVERSE_IDENTITIES[universeNumber];
  if (
    entry.universeNumber !== universeNumber ||
    entry.title !== identity.title ||
    entry.dateUtc !== identity.dateUtc ||
    entry.evidenceStatus !== "verified" ||
    entry.publicationStatus !== "published" ||
    entry.playable !== true
  ) {
    fail(`entry #${universeNumber} publication identity is invalid.`);
  }
  const artifact = assertArtifact(entry.artifact, universeNumber);
  const provenance = record(entry.provenance, `entry #${universeNumber} provenance`);
  if (universeNumber === 1) {
    exactKeys(provenance, ["kind", "directEvidence"], "entry #1 provenance");
    const direct = record(provenance.directEvidence, "entry #1 direct evidence");
    exactKeys(
      direct,
      [
        "evidenceRunId",
        "backend",
        "samplerJobId",
        "estimatorJobId",
        "artifactHashes",
      ],
      "entry #1 direct evidence",
    );
    if (
      provenance.kind !== "DIRECT_DUAL_PRIMITIVE" ||
      direct.evidenceRunId !== LOCKED_REAL_RUN_ID ||
      direct.backend !== "ibm_fez" ||
      direct.estimatorJobId !== SHARED_ESTIMATOR_JOB_ID ||
      !Array.isArray(artifact.jobIds) ||
      !artifact.jobIds.includes(direct.samplerJobId) ||
      !artifact.jobIds.includes(direct.estimatorJobId)
    ) {
      fail("entry #1 direct dual-primitive provenance is invalid.");
    }
    assertHashRecord(direct.artifactHashes, "entry #1 artifact hashes");
    return;
  }
  exactKeys(
    provenance,
    ["kind", "directEvidence", "sharedChshReference"],
    `entry #${universeNumber} provenance`,
  );
  if (provenance.kind !== "DIRECT_SAMPLER_SHARED_CHSH") {
    fail(`entry #${universeNumber} provenance kind is invalid.`);
  }
  assertDirectEvidence(provenance.directEvidence, universeNumber);
  assertSharedChshReference(provenance.sharedChshReference, universeNumber);
  const direct = provenance.directEvidence as Record<string, unknown>;
  if (
    !Array.isArray(artifact.jobIds) ||
    artifact.jobIds.length !== 1 ||
    artifact.jobIds[0] !== direct.jobId
  ) {
    fail(`entry #${universeNumber} must expose only its direct SamplerV2 job.`);
  }
};

const assertPendingEntry = (entry: Record<string, unknown>): void => {
  exactKeys(
    entry,
    [
      "universeNumber",
      "title",
      "dateUtc",
      "evidenceStatus",
      "publicationStatus",
      "playable",
      "artifact",
      "provenance",
    ],
    "entry #5",
  );
  if (
    entry.universeNumber !== 5 ||
    entry.title !== CAMPAIGN_UNIVERSE_IDENTITIES[5].title ||
    entry.dateUtc !== CAMPAIGN_UNIVERSE_IDENTITIES[5].dateUtc ||
    entry.evidenceStatus !== "pending" ||
    entry.publicationStatus !== "blocked" ||
    entry.playable !== false ||
    entry.artifact !== null
  ) {
    fail("entry #5 pending publication gate is invalid.");
  }
  const provenance = record(entry.provenance, "entry #5 provenance");
  exactKeys(provenance, ["kind", "pendingEvidence"], "entry #5 provenance");
  if (provenance.kind !== "PENDING_SAMPLER") {
    fail("entry #5 pending provenance kind is invalid.");
  }
  const pending = record(provenance.pendingEvidence, "entry #5 pending evidence");
  exactKeys(
    pending,
    [
      "campaignId",
      "universeNumber",
      "title",
      "evidencePath",
      "jobId",
      "primitive",
      "backend",
      "backendVersion",
      "shots",
      "operatorStatus",
      "manifestState",
      "resultPreserved",
      "artifactsEmpty",
      "boardGenerationStarted",
    ],
    "entry #5 pending evidence",
  );
  if (
    pending.campaignId !== CAMPAIGN_ID ||
    pending.universeNumber !== 5 ||
    pending.title !== "Quantum Storm" ||
    pending.evidencePath !== "evidence/universe-005" ||
    pending.jobId !== "d9juap0ii2cc73efdch0" ||
    pending.primitive !== "SamplerV2" ||
    pending.backend !== "ibm_fez" ||
    pending.backendVersion !== "2" ||
    pending.shots !== 256 ||
    pending.operatorStatus !== "QUEUED" ||
    pending.manifestState !== "QUEUED" ||
    pending.resultPreserved !== false ||
    pending.artifactsEmpty !== true ||
    pending.boardGenerationStarted !== false
  ) {
    fail("entry #5 pending evidence does not match the fail-closed queued record.");
  }
};

/** Browser-safe runtime assertion. Invalid campaign data always fails closed. */
export function assertCampaignBundle(value: unknown): asserts value is CampaignBundle {
  const bundle = record(value, "bundle");
  exactKeys(bundle, ["schemaVersion", "campaignId", "entries"], "bundle");
  if (bundle.schemaVersion !== 1 || bundle.campaignId !== CAMPAIGN_ID) {
    fail("schema or campaign identity is invalid.");
  }
  const entries = Array.isArray(bundle.entries)
    ? bundle.entries
    : fail("entries must be an array.");
  if (entries.length !== 5) {
    fail("exactly five entries are required.");
  }
  entries.forEach((valueEntry: unknown, index: number) => {
    const universeNumber = (index + 1) as UniverseNumber;
    const entry = record(valueEntry, `entry #${universeNumber}`);
    if (entry.universeNumber !== universeNumber) {
      fail("entries must be ordered uniquely from universe #1 through #5.");
    }
    if (universeNumber === 5 && entry.playable === false) {
      assertPendingEntry(entry);
    } else {
      assertPlayableEntry(entry, universeNumber);
    }
  });
}

export const isCampaignBundle = (value: unknown): value is CampaignBundle => {
  try {
    assertCampaignBundle(value);
    return true;
  } catch {
    return false;
  }
};
