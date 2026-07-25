import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { bytesFromHex, sha256Hex } from "./entropy-expander";
import {
  LOCKED_REAL_RUN_ID,
  type EvidenceJob,
  type VerifiedRealEvidence,
} from "./types";

const REQUIRED_FILES = [
  "sampler-runtime-raw.json",
  "estimator-runtime-raw.json",
  "entropy-derived.json",
  "bell-derived.json",
  "chsh-derived.json",
  "provenance.json",
  "manifest.json",
  "SHA256SUMS",
] as const;
const SHA256_LINE = /^([a-f0-9]{64}) {2}([A-Za-z0-9][A-Za-z0-9._-]*\.json)$/u;

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

const sha256File = (target: string): string =>
  crypto.createHash("sha256").update(fs.readFileSync(target)).digest("hex");

const verifyHashManifest = (directory: string): Readonly<Record<string, string>> => {
  const entries = new Map<string, string>();
  const lines = fs.readFileSync(path.join(directory, "SHA256SUMS"), "utf8").trim().split(/\r?\n/u);
  for (const line of lines) {
    const matched = SHA256_LINE.exec(line);
    if (matched?.[1] === undefined || matched[2] === undefined || entries.has(matched[2])) {
      throw new Error("SHA256SUMS contains an invalid or duplicate entry.");
    }
    entries.set(matched[2], matched[1]);
  }
  const jsonFiles = fs.readdirSync(directory)
    .filter((name) => name.endsWith(".json"))
    .sort();
  if (entries.size !== jsonFiles.length) {
    throw new Error("SHA256SUMS must cover exactly every JSON artifact.");
  }
  for (const name of jsonFiles) {
    const expected = entries.get(name);
    if (expected === undefined || sha256File(path.join(directory, name)) !== expected) {
      throw new Error(`SHA-256 mismatch for ${name}.`);
    }
  }
  return Object.freeze(Object.fromEntries([...entries.entries()].sort(([left], [right]) => left.localeCompare(right))));
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
  for (const name of REQUIRED_FILES) {
    if (!fs.statSync(path.join(directory, name), { throwIfNoEntry: false })?.isFile()) {
      throw new Error(`Locked evidence artifact is missing: ${name}.`);
    }
  }
  const artifactHashes = verifyHashManifest(directory);
  const manifest = readJsonRecord(path.join(directory, "manifest.json"));
  if (requireString(manifest, "run_id") !== runId || requireString(manifest, "state") !== "COMPLETE" || requireString(manifest, "mode") !== "REAL") {
    throw new Error("Manifest is not a COMPLETE REAL locked evidence package.");
  }
  const jobs = requireArray(manifest, "jobs").map(parseJob).sort((left, right) => left.role.localeCompare(right.role));
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
    if (runtimeRaw[job.runtimeRawArtifact] !== job.runtimeRawSha256 || artifactHashes[job.runtimeRawArtifact] !== job.runtimeRawSha256) {
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
