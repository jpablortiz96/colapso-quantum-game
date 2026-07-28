import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { bytesFromHex, sha256Hex } from "./entropy-expander";
import { canonicalJson, canonicalUtf8Bytes } from "./serializer";
import {
  CAMPAIGN_ID,
  CAMPAIGN_UNIVERSE_IDENTITIES,
  LOCKED_REAL_RUN_ID,
  type AvailableCampaignEvidence,
  type CampaignEvidenceUniverseNumber,
  type EvidenceJob,
  type PendingCampaignEvidence,
  type VerifiedCampaignEvidence,
  type VerifiedRealEvidence,
} from "./types";

const LOCKED_REQUIRED_FILES = [
  "sampler-runtime-raw.json",
  "estimator-runtime-raw.json",
  "entropy-derived.json",
  "bell-derived.json",
  "chsh-derived.json",
  "provenance.json",
  "manifest.json",
  "SHA256SUMS",
] as const;
const COMPLETE_JSON_FILES = [
  "accepted-entropy.json",
  "bell-derived.json",
  "manifest.json",
  "preflight.json",
  "result-structure.json",
  "sampler-raw.json",
  "sampler-runtime-raw.json",
  "submission.json",
  "verification-report.json",
] as const;
const MANIFEST_LINKED_FILES = [
  "accepted-entropy.json",
  "bell-derived.json",
  "result-structure.json",
  "sampler-raw.json",
  "sampler-runtime-raw.json",
  "verification-report.json",
] as const;
const PENDING_FILES = [
  "manifest.json",
  "preflight.json",
  "submission.json",
  "SHA256SUMS",
] as const;
const COMPLETE_NUMBERS = [2, 3, 4] as const;
const ALL_CAMPAIGN_NUMBERS = [2, 3, 4, 5] as const;
const SHA256_LINE = /^([a-f0-9]{64}) {2}([A-Za-z0-9][A-Za-z0-9._-]*\.json)$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const JOB_ID = /^[a-z0-9]{20}$/u;
const ACQUISITION_SCOPE = "ACQUISITION_EVIDENCE_INPUTS_NOT_COMPILED_BOARD" as const;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const readJsonRecord = (target: string): Record<string, unknown> => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(target, "utf8")) as unknown;
  } catch (error) {
    throw new Error(
      `Evidence JSON is unreadable: ${path.basename(target)} (${error instanceof Error ? error.message : String(error)}).`,
      { cause: error },
    );
  }
  if (!isRecord(parsed)) {
    throw new Error(`Evidence JSON must be an object: ${path.basename(target)}.`);
  }
  return parsed;
};

const requireString = (record: Record<string, unknown>, key: string): string => {
  const value = record[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Evidence field ${key} must be a non-empty string.`);
  }
  return value;
};

const requireNumber = (record: Record<string, unknown>, key: string): number => {
  const value = record[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Evidence field ${key} must be a finite number.`);
  }
  return value;
};

const requireArray = (record: Record<string, unknown>, key: string): unknown[] => {
  const value = record[key];
  if (!Array.isArray(value)) {
    throw new Error(`Evidence field ${key} must be an array.`);
  }
  return value;
};

const requireRecord = (record: Record<string, unknown>, key: string): Record<string, unknown> => {
  const value = record[key];
  if (!isRecord(value)) {
    throw new Error(`Evidence field ${key} must be an object.`);
  }
  return value;
};

const sameValues = (left: unknown, right: unknown): boolean =>
  canonicalJson(left) === canonicalJson(right);

const sameNames = (actual: readonly string[], expected: readonly string[]): boolean => {
  const left = [...actual].sort();
  const right = [...expected].sort();
  return left.length === right.length && left.every((name, index) => name === right[index]);
};

const sha256File = (target: string): string =>
  crypto.createHash("sha256").update(fs.readFileSync(target)).digest("hex");

const verifyHashManifest = (
  directory: string,
  expectedJsonFiles?: readonly string[],
): Readonly<Record<string, string>> => {
  const ledgerPath = path.join(directory, "SHA256SUMS");
  const entries = new Map<string, string>();
  const source = fs.readFileSync(ledgerPath, "utf8").trim();
  const lines = source.length === 0 ? [] : source.split(/\r?\n/u);
  for (const line of lines) {
    const matched = SHA256_LINE.exec(line);
    if (matched?.[1] === undefined || matched[2] === undefined || entries.has(matched[2])) {
      throw new Error("SHA256SUMS contains an invalid or duplicate entry.");
    }
    entries.set(matched[2], matched[1]);
  }
  const jsonFiles = fs.readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => entry.name)
    .sort();
  if (
    !sameNames([...entries.keys()], jsonFiles) ||
    (expectedJsonFiles !== undefined && !sameNames(jsonFiles, expectedJsonFiles))
  ) {
    throw new Error("SHA256SUMS must cover exactly the required JSON artifact inventory.");
  }
  for (const name of jsonFiles) {
    const expected = entries.get(name);
    if (expected === undefined || sha256File(path.join(directory, name)) !== expected) {
      throw new Error(`SHA-256 mismatch for ${name}.`);
    }
    readJsonRecord(path.join(directory, name));
  }
  return Object.freeze(
    Object.fromEntries(
      [...entries.entries()].sort(([left], [right]) => left.localeCompare(right)),
    ),
  );
};

const parseJob = (value: unknown): EvidenceJob => {
  if (!isRecord(value)) {
    throw new Error("Manifest job must be an object.");
  }
  const role = requireString(value, "role");
  const primitive = requireString(value, "primitive");
  const backend = requireString(value, "backend");
  const status = requireString(value, "status");
  if (
    (role !== "SAMPLER_ENTROPY_BELL" && role !== "ESTIMATOR_CHSH") ||
    (primitive !== "SamplerV2" && primitive !== "EstimatorV2") ||
    backend !== "ibm_fez" ||
    status !== "DONE"
  ) {
    throw new Error("Manifest job role, primitive, backend, or status is not the locked F2B record.");
  }
  const rawArtifacts = requireArray(value, "raw_artifacts");
  const runtimeRawArtifact = requireString(value, "runtime_raw_artifact");
  if (!rawArtifacts.includes(runtimeRawArtifact)) {
    throw new Error(`Manifest raw artifact link is missing for ${role}.`);
  }
  return Object.freeze({
    role,
    jobId: requireString(value, "job_id"),
    primitive,
    backend,
    status,
    runtimeRawArtifact,
    runtimeRawSha256: requireString(value, "runtime_raw_sha256"),
  }) as EvidenceJob;
};

export type ReadLockedEvidenceOptions = Readonly<{
  repositoryRoot: string;
  runId?: string;
}>;

/** Reads only the explicit F2B real run and never writes to evidence. */
export const readLockedRealEvidence = (
  options: ReadLockedEvidenceOptions,
): VerifiedRealEvidence => {
  const runId = options.runId ?? LOCKED_REAL_RUN_ID;
  if (runId !== LOCKED_REAL_RUN_ID) {
    throw new Error(`F3 accepts only locked run ${LOCKED_REAL_RUN_ID}.`);
  }
  const directory = path.join(options.repositoryRoot, "evidence", "runs", "real", runId);
  if (!fs.statSync(directory, { throwIfNoEntry: false })?.isDirectory()) {
    throw new Error(`Locked evidence directory is unavailable: ${runId}.`);
  }
  for (const name of LOCKED_REQUIRED_FILES) {
    if (!fs.statSync(path.join(directory, name), { throwIfNoEntry: false })?.isFile()) {
      throw new Error(`Locked evidence artifact is missing: ${name}.`);
    }
  }
  const artifactHashes = verifyHashManifest(directory);
  const manifest = readJsonRecord(path.join(directory, "manifest.json"));
  if (
    requireString(manifest, "run_id") !== runId ||
    requireString(manifest, "state") !== "COMPLETE" ||
    requireString(manifest, "mode") !== "REAL"
  ) {
    throw new Error("Manifest is not a COMPLETE REAL locked evidence package.");
  }
  const jobs = requireArray(manifest, "jobs")
    .map(parseJob)
    .sort((left, right) => left.role.localeCompare(right.role));
  if (jobs.length !== 2 || new Set(jobs.map((job) => job.role)).size !== 2) {
    throw new Error("Manifest must contain exactly the two required job roles.");
  }
  const sampler = jobs.find((job) => job.role === "SAMPLER_ENTROPY_BELL");
  const estimator = jobs.find((job) => job.role === "ESTIMATOR_CHSH");
  if (sampler?.primitive !== "SamplerV2" || estimator?.primitive !== "EstimatorV2") {
    throw new Error("Manifest job primitives do not match the locked roles.");
  }
  const runtimeRaw = requireRecord(manifest, "runtime_raw_artifacts");
  for (const job of jobs) {
    if (
      runtimeRaw[job.runtimeRawArtifact] !== job.runtimeRawSha256 ||
      artifactHashes[job.runtimeRawArtifact] !== job.runtimeRawSha256
    ) {
      throw new Error(`Official runtime raw hash linkage failed for ${job.role}.`);
    }
  }

  const entropy = readJsonRecord(path.join(directory, "entropy-derived.json"));
  const entropyBitsAccepted = requireNumber(entropy, "accepted_byte_bits");
  const entropyBytesHex = requireString(entropy, "entropy_bytes_hex");
  const entropyBytes = bytesFromHex(entropyBytesHex, "Accepted entropy material");
  if (
    requireString(entropy, "mode") !== "REAL" ||
    entropyBitsAccepted !== 1024 ||
    entropyBytes.length * 8 !== entropyBitsAccepted ||
    requireString(entropy, "source_runtime_raw") !== sampler.runtimeRawArtifact ||
    requireString(entropy, "source_runtime_raw_sha256") !== sampler.runtimeRawSha256
  ) {
    throw new Error("Entropy artifact is not the locked 1,024-bit independent real-hardware source.");
  }

  const bell = readJsonRecord(path.join(directory, "bell-derived.json"));
  const chsh = readJsonRecord(path.join(directory, "chsh-derived.json"));
  const provenance = readJsonRecord(path.join(directory, "provenance.json"));
  const backend = requireRecord(provenance, "backend");
  if (
    requireString(bell, "mode") !== "REAL" ||
    requireString(chsh, "mode") !== "REAL" ||
    requireString(provenance, "run_id") !== runId ||
    requireString(provenance, "mode") !== "REAL" ||
    requireString(backend, "name") !== "ibm_fez"
  ) {
    throw new Error("Bell, CHSH, or provenance data is not the locked real record.");
  }

  return Object.freeze({
    runId,
    backend: "ibm_fez",
    backendVersion: requireString(backend, "version"),
    generatedAt: requireString(provenance, "completed_at_utc"),
    entropyBitsAccepted: 1024,
    entropyBytesHex,
    sourceEntropyHash: sha256Hex(entropyBytes),
    artifactHashes,
    jobs: Object.freeze(jobs),
    bell: Object.freeze({
      observedCorrelation: requireNumber(bell, "observed_correlation"),
      shots: requireNumber(bell, "shots"),
      interpretation: requireString(bell, "interpretation"),
    }),
    chsh: Object.freeze({
      witness: requireNumber(chsh, "witness"),
      standardError: requireNumber(chsh, "standard_error"),
      classification: requireString(chsh, "classification"),
      interpretation: requireString(chsh, "interpretation"),
      signConvention: requireString(chsh, "sign_convention"),
    }),
  });
};

type OperatorEntry = Readonly<{
  universeNumber: CampaignEvidenceUniverseNumber;
  backend: "ibm_fez";
  currentStatus: string;
  evidencePath: string;
  jobId: string;
  resultPreserved: boolean;
  submissionTimestamp: string;
}>;

const readOperatorEntries = (
  repositoryRoot: string,
): ReadonlyMap<CampaignEvidenceUniverseNumber, OperatorEntry> => {
  const state = readJsonRecord(
    path.join(repositoryRoot, "evidence", "campaign-acquisition-state.json"),
  );
  if (state.campaign_id !== CAMPAIGN_ID || state.schema_version !== 1) {
    throw new Error("Campaign operator state identity is invalid.");
  }
  const universes = requireArray(state, "universes");
  if (universes.length !== ALL_CAMPAIGN_NUMBERS.length) {
    throw new Error("Campaign operator state must contain exactly universes #2 through #5.");
  }
  const entries = new Map<CampaignEvidenceUniverseNumber, OperatorEntry>();
  for (const value of universes) {
    if (!isRecord(value)) {
      throw new Error("Campaign operator universe entry must be an object.");
    }
    const number = requireNumber(value, "universe_number");
    if (!ALL_CAMPAIGN_NUMBERS.includes(number as CampaignEvidenceUniverseNumber)) {
      throw new Error("Campaign operator state contains an unexpected universe number.");
    }
    const universeNumber = number as CampaignEvidenceUniverseNumber;
    if (entries.has(universeNumber)) {
      throw new Error("Campaign operator state contains duplicate universe entries.");
    }
    const backend = requireString(value, "backend");
    const jobId = requireString(value, "job_id");
    const resultPreserved = value.result_preserved;
    if (
      backend !== "ibm_fez" ||
      !JOB_ID.test(jobId) ||
      typeof resultPreserved !== "boolean"
    ) {
      throw new Error(`Campaign operator state for universe #${universeNumber} is malformed.`);
    }
    entries.set(universeNumber, Object.freeze({
      universeNumber,
      backend,
      currentStatus: requireString(value, "current_status"),
      evidencePath: requireString(value, "evidence_path"),
      jobId,
      resultPreserved,
      submissionTimestamp: requireString(value, "submission_timestamp"),
    }));
  }
  if (ALL_CAMPAIGN_NUMBERS.some((number) => !entries.has(number))) {
    throw new Error("Campaign operator state is missing a required universe entry.");
  }
  return entries;
};

const assertCompleteIdentity = (
  manifest: Record<string, unknown>,
  submission: Record<string, unknown>,
  universeNumber: CampaignEvidenceUniverseNumber,
): void => {
  const identity = CAMPAIGN_UNIVERSE_IDENTITIES[universeNumber];
  if (
    manifest.campaign_id !== CAMPAIGN_ID ||
    manifest.universe_number !== universeNumber ||
    manifest.title !== identity.title ||
    manifest.mode !== "REAL" ||
    manifest.hardware_execution !== "SEPARATE_RUNTIME_JOB" ||
    manifest.state !== "COMPLETE" ||
    manifest.board_generation_started !== false ||
    manifest.pending_submission_intent !== null ||
    submission.campaign_id !== CAMPAIGN_ID ||
    submission.universe_number !== universeNumber ||
    submission.title !== identity.title ||
    submission.primitive !== "SamplerV2" ||
    submission.shots !== 256 ||
    !sameValues(submission.sampler_publications, ["ENTROPY_HARVEST", "BELL_CORRELATION"]) ||
    submission.pending_submission_intent !== null ||
    !sameValues(manifest.attempts, submission.attempts) ||
    !sameValues(manifest.submission_errors, submission.submission_errors)
  ) {
    throw new Error(`Universe #${universeNumber} is not a COMPLETE REAL campaign package.`);
  }
};

const readDoneAttempt = (
  manifest: Record<string, unknown>,
  universeNumber: CampaignEvidenceUniverseNumber,
): Record<string, unknown> => {
  const attempts = requireArray(manifest, "attempts");
  const records = attempts.filter(isRecord);
  const done = records.filter((attempt) => attempt.status === "DONE");
  if (
    records.length !== attempts.length ||
    records.length < 1 ||
    records.length > 2 ||
    done.length !== 1 ||
    records.some((attempt, index) => attempt.attempt !== index + 1) ||
    (records.length === 2 && records[0]?.status === "DONE")
  ) {
    throw new Error(`Universe #${universeNumber} must contain exactly one valid DONE attempt.`);
  }
  const job = done[0];
  if (job === undefined) {
    throw new Error(`Universe #${universeNumber} DONE attempt is unavailable.`);
  }
  if (
    job.primitive !== "SamplerV2" ||
    job.backend !== "ibm_fez" ||
    job.status !== "DONE" ||
    job.shots !== 256 ||
    !JOB_ID.test(requireString(job, "job_id")) ||
    typeof job.completed_at_utc !== "string"
  ) {
    throw new Error(`Universe #${universeNumber} DONE SamplerV2 execution metadata is invalid.`);
  }
  return job;
};

const calculateAcquisitionCommitment = (
  universeNumber: CampaignEvidenceUniverseNumber,
  runtimeRawSha256: string,
  canonicalRawSha256: string,
  acceptedEntropySha256: string,
): string =>
  crypto.createHash("sha256").update(canonicalUtf8Bytes({
    domain: "COLAPSO_UNIVERSE_ACQUISITION_V1",
    campaign_id: CAMPAIGN_ID,
    universe_number: universeNumber,
    runtime_raw_sha256: runtimeRawSha256,
    canonical_raw_sha256: canonicalRawSha256,
    accepted_entropy_sha256: acceptedEntropySha256,
  })).digest("hex");

const readCompleteCampaignEvidenceInternal = (
  repositoryRoot: string,
  universeNumber: CampaignEvidenceUniverseNumber,
  operator: OperatorEntry,
): VerifiedCampaignEvidence => {
  const evidencePath = `evidence/universe-${String(universeNumber).padStart(3, "0")}`;
  const directory = path.join(repositoryRoot, ...evidencePath.split("/"));
  if (!fs.statSync(directory, { throwIfNoEntry: false })?.isDirectory()) {
    throw new Error(`Campaign evidence directory is unavailable for universe #${universeNumber}.`);
  }
  const artifactHashes = verifyHashManifest(directory, COMPLETE_JSON_FILES);
  const manifest = readJsonRecord(path.join(directory, "manifest.json"));
  const submission = readJsonRecord(path.join(directory, "submission.json"));
  assertCompleteIdentity(manifest, submission, universeNumber);
  const job = readDoneAttempt(manifest, universeNumber);
  const jobId = requireString(job, "job_id");
  const submittedAt = requireString(job, "submitted_at_utc");
  const completedAt = requireString(job, "completed_at_utc");
  const backendVersion = requireString(job, "backend_version");
  if (
    operator.currentStatus !== "DONE" ||
    operator.resultPreserved !== true ||
    operator.backend !== "ibm_fez" ||
    operator.evidencePath !== evidencePath ||
    operator.jobId !== jobId ||
    operator.submissionTimestamp !== submittedAt
  ) {
    throw new Error(`Universe #${universeNumber} operator state does not match its preserved DONE job.`);
  }

  const preflight = readJsonRecord(path.join(directory, "preflight.json"));
  if (
    preflight.backend !== "ibm_fez" ||
    preflight.backend_version !== backendVersion ||
    preflight.hardware_backend !== true ||
    preflight.shots_per_job !== 256
  ) {
    throw new Error(`Universe #${universeNumber} preflight backend metadata is invalid.`);
  }

  const runtimeRawSha256 = artifactHashes["sampler-runtime-raw.json"];
  const canonicalRawSha256 = artifactHashes["sampler-raw.json"];
  const acceptedEntropySha256 = artifactHashes["accepted-entropy.json"];
  const manifestSha256 = artifactHashes["manifest.json"];
  if (
    runtimeRawSha256 === undefined ||
    canonicalRawSha256 === undefined ||
    acceptedEntropySha256 === undefined ||
    manifestSha256 === undefined
  ) {
    throw new Error(`Universe #${universeNumber} primary evidence hashes are unavailable.`);
  }
  const manifestArtifacts = requireRecord(manifest, "artifacts");
  if (
    !sameNames(Object.keys(manifestArtifacts), MANIFEST_LINKED_FILES) ||
    MANIFEST_LINKED_FILES.some((name) => manifestArtifacts[name] !== artifactHashes[name]) ||
    manifest.runtime_raw_sha256 !== runtimeRawSha256 ||
    manifest.canonical_raw_sha256 !== canonicalRawSha256 ||
    manifest.accepted_entropy_sha256 !== acceptedEntropySha256
  ) {
    throw new Error(`Universe #${universeNumber} manifest hash linkage is invalid.`);
  }
  const acquisitionCommitment = calculateAcquisitionCommitment(
    universeNumber,
    runtimeRawSha256,
    canonicalRawSha256,
    acceptedEntropySha256,
  );
  if (
    manifest.universe_commitment !== acquisitionCommitment ||
    manifest.commitment_scope !== ACQUISITION_SCOPE
  ) {
    throw new Error(`Universe #${universeNumber} acquisition commitment is invalid.`);
  }

  const entropy = readJsonRecord(path.join(directory, "accepted-entropy.json"));
  const entropyBytesHex = requireString(entropy, "entropy_bytes_hex");
  const entropyBytes = bytesFromHex(entropyBytesHex, `Universe #${universeNumber} entropy`);
  if (
    entropy.mode !== "REAL" ||
    entropy.accepted_byte_bits !== 1024 ||
    entropyBytes.length !== 128 ||
    entropy.shots !== 256 ||
    entropy.workload !== "ENTROPY_HARVEST" ||
    entropy.source_runtime_raw !== "sampler-runtime-raw.json" ||
    entropy.source_runtime_raw_sha256 !== runtimeRawSha256 ||
    entropy.source_sampler_record !== "sampler-raw.json"
  ) {
    throw new Error(`Universe #${universeNumber} entropy is not the linked 1,024-bit runtime source.`);
  }

  const bell = readJsonRecord(path.join(directory, "bell-derived.json"));
  if (
    bell.mode !== "REAL" ||
    bell.shots !== 256 ||
    bell.workload !== "BELL_CORRELATION" ||
    bell.source_runtime_raw !== "sampler-runtime-raw.json" ||
    bell.source_runtime_raw_sha256 !== runtimeRawSha256 ||
    bell.source_sampler_record !== "sampler-raw.json"
  ) {
    throw new Error(`Universe #${universeNumber} Bell summary is not linked to the same runtime raw record.`);
  }

  const samplerRaw = readJsonRecord(path.join(directory, "sampler-raw.json"));
  const pubs = requireArray(samplerRaw, "pubs");
  const byWorkload = new Map<string, Record<string, unknown>>();
  for (const pub of pubs) {
    if (isRecord(pub) && typeof pub.workload === "string") {
      byWorkload.set(pub.workload, pub);
    }
  }
  const entropyPub = byWorkload.get("ENTROPY_HARVEST");
  const bellPub = byWorkload.get("BELL_CORRELATION");
  const entropyCombined = entropyPub === undefined ? undefined : requireRecord(entropyPub, "combined");
  const bellCombined = bellPub === undefined ? undefined : requireRecord(bellPub, "combined");
  if (
    samplerRaw.mode !== "REAL" ||
    samplerRaw.source_runtime_raw !== "sampler-runtime-raw.json" ||
    samplerRaw.source_runtime_raw_sha256 !== runtimeRawSha256 ||
    pubs.length !== 2 ||
    entropyCombined?.num_shots !== 256 ||
    entropyCombined.num_bits !== 4 ||
    bellCombined?.num_shots !== 256 ||
    bellCombined.num_bits !== 2
  ) {
    throw new Error(`Universe #${universeNumber} canonical Sampler result structure is invalid.`);
  }

  const resultStructure = readJsonRecord(path.join(directory, "result-structure.json"));
  if (resultStructure.mode !== "REAL" || resultStructure.role !== "SAMPLER_ENTROPY_BELL") {
    throw new Error(`Universe #${universeNumber} result structure identity is invalid.`);
  }

  const report = readJsonRecord(path.join(directory, "verification-report.json"));
  const checks = requireRecord(report, "checks");
  if (
    report.campaign_id !== CAMPAIGN_ID ||
    report.universe_number !== universeNumber ||
    report.job_id !== jobId ||
    report.backend !== "ibm_fez" ||
    report.shots !== 256 ||
    report.state !== "EVIDENCE_ACQUIRED" ||
    report.runtime_raw_sha256 !== runtimeRawSha256 ||
    report.canonical_raw_sha256 !== canonicalRawSha256 ||
    report.accepted_entropy_sha256 !== acceptedEntropySha256 ||
    report.universe_commitment !== acquisitionCommitment ||
    report.commitment_scope !== ACQUISITION_SCOPE ||
    checks.accepted_entropy_linked_to_raw !== true ||
    checks.canonical_result_preserved !== true ||
    checks.raw_preserved_before_parsing !== true ||
    checks.real_hardware !== true ||
    checks.separate_runtime_job !== true ||
    checks.board_generation_started !== false
  ) {
    throw new Error(`Universe #${universeNumber} verification report is invalid.`);
  }

  if (![runtimeRawSha256, canonicalRawSha256, acceptedEntropySha256, manifestSha256, acquisitionCommitment].every((digest) => SHA256.test(digest))) {
    throw new Error(`Universe #${universeNumber} contains a malformed SHA-256 digest.`);
  }

  return Object.freeze({
    campaignId: CAMPAIGN_ID,
    universeNumber,
    title: CAMPAIGN_UNIVERSE_IDENTITIES[universeNumber].title,
    evidencePath,
    backend: "ibm_fez",
    backendVersion,
    generatedAt: completedAt,
    entropyBitsAccepted: 1024,
    entropyBytesHex,
    sourceEntropyHash: sha256Hex(entropyBytes),
    artifactHashes,
    job: Object.freeze({
      role: "SAMPLER_ENTROPY_BELL",
      jobId,
      primitive: "SamplerV2",
      backend: "ibm_fez",
      status: "DONE",
      runtimeRawArtifact: "sampler-runtime-raw.json",
      runtimeRawSha256,
    }),
    bell: Object.freeze({
      observedCorrelation: requireNumber(bell, "observed_correlation"),
      shots: 256,
      interpretation: requireString(bell, "interpretation"),
    }),
    directEvidence: Object.freeze({
      campaignId: CAMPAIGN_ID,
      evidencePath,
      jobId,
      primitive: "SamplerV2",
      backend: "ibm_fez",
      backendVersion,
      shots: 256,
      submittedAt,
      completedAt,
      runtimeRawSha256,
      canonicalRawSha256,
      acceptedEntropyArtifactSha256: acceptedEntropySha256,
      manifestSha256,
      acquisitionCommitment,
      commitmentScope: ACQUISITION_SCOPE,
    }),
  });
};

/** Strictly reads one COMPLETE, preserved campaign package without modifying it. */
export const readCompleteCampaignEvidence = (
  repositoryRoot: string,
  universeNumber: CampaignEvidenceUniverseNumber,
): VerifiedCampaignEvidence => {
  const operator = readOperatorEntries(repositoryRoot).get(universeNumber);
  if (operator === undefined) {
    throw new Error(`Campaign operator state is missing universe #${universeNumber}.`);
  }
  return readCompleteCampaignEvidenceInternal(repositoryRoot, universeNumber, operator);
};

const readPendingUniverseFive = (
  repositoryRoot: string,
  operator: OperatorEntry,
): PendingCampaignEvidence => {
  const evidencePath = "evidence/universe-005" as const;
  const directory = path.join(repositoryRoot, "evidence", "universe-005");
  const presentFiles = fs.readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name);
  if (!sameNames(presentFiles, PENDING_FILES)) {
    throw new Error("Universe #5 pending evidence inventory must contain exactly three JSON files and SHA256SUMS.");
  }
  verifyHashManifest(directory, ["manifest.json", "preflight.json", "submission.json"]);
  const manifest = readJsonRecord(path.join(directory, "manifest.json"));
  const submission = readJsonRecord(path.join(directory, "submission.json"));
  const preflight = readJsonRecord(path.join(directory, "preflight.json"));
  const attempts = requireArray(manifest, "attempts");
  const attempt = attempts[0];
  if (!isRecord(attempt)) {
    throw new Error("Universe #5 pending attempt is missing.");
  }
  const manifestArtifacts = requireRecord(manifest, "artifacts");
  if (
    manifest.campaign_id !== CAMPAIGN_ID ||
    manifest.universe_number !== 5 ||
    manifest.title !== "Quantum Storm" ||
    manifest.mode !== "REAL" ||
    manifest.hardware_execution !== "SEPARATE_RUNTIME_JOB" ||
    manifest.state !== "QUEUED" ||
    manifest.board_generation_started !== false ||
    Object.keys(manifestArtifacts).length !== 0 ||
    attempts.length !== 1 ||
    attempt.attempt !== 1 ||
    attempt.status !== "QUEUED" ||
    attempt.primitive !== "SamplerV2" ||
    attempt.backend !== "ibm_fez" ||
    attempt.backend_version !== "2" ||
    attempt.shots !== 256 ||
    attempt.completed_at_utc !== null ||
    submission.campaign_id !== CAMPAIGN_ID ||
    submission.universe_number !== 5 ||
    submission.title !== "Quantum Storm" ||
    submission.primitive !== "SamplerV2" ||
    submission.shots !== 256 ||
    !sameValues(submission.sampler_publications, ["ENTROPY_HARVEST", "BELL_CORRELATION"]) ||
    !sameValues(manifest.attempts, submission.attempts) ||
    preflight.backend !== "ibm_fez" ||
    preflight.backend_version !== "2" ||
    preflight.hardware_backend !== true ||
    preflight.shots_per_job !== 256 ||
    operator.universeNumber !== 5 ||
    operator.currentStatus !== "QUEUED" ||
    operator.resultPreserved !== false ||
    operator.backend !== "ibm_fez" ||
    operator.evidencePath !== evidencePath ||
    operator.jobId !== attempt.job_id ||
    operator.submissionTimestamp !== attempt.submitted_at_utc
  ) {
    throw new Error("Universe #5 pending evidence does not match the exact queued fail-closed state.");
  }
  return Object.freeze({
    campaignId: CAMPAIGN_ID,
    universeNumber: 5,
    title: "Quantum Storm",
    evidencePath,
    jobId: operator.jobId,
    primitive: "SamplerV2",
    backend: "ibm_fez",
    backendVersion: "2",
    shots: 256,
    operatorStatus: "QUEUED",
    manifestState: "QUEUED",
    resultPreserved: false,
    artifactsEmpty: true,
    boardGenerationStarted: false,
  });
};

/** Reads #2-#4 as strict COMPLETE packages and #5 as the exact pending gate. All reads are pure. */
export const readAvailableCampaignEvidence = (
  repositoryRoot: string,
): AvailableCampaignEvidence => {
  const operators = readOperatorEntries(repositoryRoot);
  const complete = COMPLETE_NUMBERS.map((universeNumber) => {
    const operator = operators.get(universeNumber);
    if (operator === undefined) {
      throw new Error(`Campaign operator state is missing universe #${universeNumber}.`);
    }
    return readCompleteCampaignEvidenceInternal(repositoryRoot, universeNumber, operator);
  });
  const pendingOperator = operators.get(5);
  if (pendingOperator === undefined) {
    throw new Error("Campaign operator state is missing universe #5.");
  }
  return Object.freeze({
    campaignId: CAMPAIGN_ID,
    complete: Object.freeze(complete),
    pending: readPendingUniverseFive(repositoryRoot, pendingOperator),
  });
};

/** Requires every package #2-#5 to be COMPLETE and preserved before finalization can write. */
export const readFinalizableCampaignEvidence = (
  repositoryRoot: string,
): readonly VerifiedCampaignEvidence[] => {
  const operators = readOperatorEntries(repositoryRoot);
  const universeFive = operators.get(5);
  if (
    universeFive === undefined ||
    universeFive.currentStatus !== "DONE" ||
    universeFive.resultPreserved !== true
  ) {
    const status = universeFive?.currentStatus ?? "MISSING";
    const preserved = universeFive?.resultPreserved ?? false;
    throw new Error(
      `Campaign finalization blocked: universe #5 is ${status} and result_preserved=${String(preserved)}; COMPLETE preserved evidence is required.`,
    );
  }
  return Object.freeze(ALL_CAMPAIGN_NUMBERS.map((universeNumber) => {
    const operator = operators.get(universeNumber);
    if (operator === undefined) {
      throw new Error(`Campaign operator state is missing universe #${universeNumber}.`);
    }
    return readCompleteCampaignEvidenceInternal(repositoryRoot, universeNumber, operator);
  }));
};
