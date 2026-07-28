import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { assertCampaignBundle } from "./campaign";
import {
  compileCampaignUniverse,
  compileCampaignUniverseIndex,
} from "./compiler";
import { hasValidCommitment } from "./commitment";
import {
  readAvailableCampaignEvidence,
  readFinalizableCampaignEvidence,
  readLockedRealEvidence,
} from "./evidence-reader";
import { canonicalJson, canonicalUtf8Bytes } from "./serializer";
import {
  CAMPAIGN_ID,
  CAMPAIGN_UNIVERSE_IDENTITIES,
  LOCKED_REAL_RUN_ID,
  PINNED_FIRST_COMMITMENT,
  type AvailableCampaignEvidence,
  type CampaignBundle,
  type CampaignEntry,
  type DailyUniverse,
  type DailyUniverseIndex,
  type PendingCampaignEvidence,
  type SharedChshReference,
  type VerifiedCampaignEvidence,
  type VerifiedRealEvidence,
} from "./types";
import { verifyPublishedUniverse } from "./verifier";

const SHARED_ESTIMATOR_RUNTIME_ARTIFACT = "estimator-runtime-raw.json" as const;
const SHARED_CHSH_ARTIFACT = "chsh-derived.json" as const;

type CampaignPaths = Readonly<{
  publicDirectory: string;
  pinnedPublic: string;
  pinnedSource: string;
  publicCampaign: string;
  publicIndex: string;
  sourceCampaign: string;
}>;

const campaignPaths = (repositoryRoot: string): CampaignPaths => {
  const publicDirectory = path.join(
    repositoryRoot,
    "frontend",
    "public",
    "data",
    "universes",
  );
  return Object.freeze({
    publicDirectory,
    pinnedPublic: path.join(publicDirectory, "2026-07-22.json"),
    pinnedSource: path.join(
      repositoryRoot,
      "frontend",
      "src",
      "daily-game",
      "published-universe.json",
    ),
    publicCampaign: path.join(publicDirectory, "campaign.json"),
    publicIndex: path.join(publicDirectory, "index.json"),
    sourceCampaign: path.join(
      repositoryRoot,
      "frontend",
      "src",
      "daily-game",
      "published-campaign.json",
    ),
  });
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const parseJsonObject = (source: string, label: string): Record<string, unknown> => {
  const parsed: unknown = JSON.parse(source) as unknown;
  if (!isRecord(parsed)) {
    throw new Error(`${label} must be a JSON object.`);
  }
  return parsed;
};

const loadPinnedArtifact = (repositoryRoot: string): DailyUniverse => {
  const paths = campaignPaths(repositoryRoot);
  const publicBytes = fs.readFileSync(paths.pinnedPublic);
  const sourceBytes = fs.readFileSync(paths.pinnedSource);
  if (!publicBytes.equals(sourceBytes)) {
    throw new Error("Pinned universe #1 public and compatibility artifacts are not byte-identical.");
  }
  const source = publicBytes.toString("utf8");
  const parsed = parseJsonObject(source, "Pinned universe #1") as unknown as DailyUniverse;
  if (canonicalJson(parsed) !== source) {
    throw new Error("Pinned universe #1 bytes are not canonical JSON.");
  }
  if (
    parsed.universeNumber !== 1 ||
    parsed.universeId !== CAMPAIGN_UNIVERSE_IDENTITIES[1].universeId ||
    parsed.dateUtc !== CAMPAIGN_UNIVERSE_IDENTITIES[1].dateUtc ||
    parsed.commitment !== PINNED_FIRST_COMMITMENT ||
    !hasValidCommitment(parsed)
  ) {
    throw new Error("Pinned universe #1 identity or commitment is invalid.");
  }
  const verification = verifyPublishedUniverse(repositoryRoot, paths.pinnedPublic);
  if (!verification.ok) {
    throw new Error(`Pinned universe #1 verification failed: ${verification.issues.join("; ")}`);
  }
  return parsed;
};

const requireLockedJob = (
  evidence: VerifiedRealEvidence,
  role: "SAMPLER_ENTROPY_BELL" | "ESTIMATOR_CHSH",
) => {
  const job = evidence.jobs.find((candidate) => candidate.role === role);
  if (job === undefined) {
    throw new Error(`Locked universe #1 evidence is missing ${role}.`);
  }
  return job;
};

const sharedChshReference = (
  pinned: DailyUniverse,
  locked: VerifiedRealEvidence,
): SharedChshReference => {
  const estimator = requireLockedJob(locked, "ESTIMATOR_CHSH");
  const runtimeRawSha256 = locked.artifactHashes[SHARED_ESTIMATOR_RUNTIME_ARTIFACT];
  const chshArtifactSha256 = locked.artifactHashes[SHARED_CHSH_ARTIFACT];
  if (
    estimator.primitive !== "EstimatorV2" ||
    estimator.runtimeRawArtifact !== SHARED_ESTIMATOR_RUNTIME_ARTIFACT ||
    runtimeRawSha256 === undefined ||
    estimator.runtimeRawSha256 !== runtimeRawSha256 ||
    chshArtifactSha256 === undefined ||
    pinned.commitment !== PINNED_FIRST_COMMITMENT
  ) {
    throw new Error("Locked universe #1 shared CHSH reference is invalid.");
  }
  return Object.freeze({
    universeNumber: 1,
    universeId: "colapso-2026-07-22-001",
    evidenceRunId: LOCKED_REAL_RUN_ID,
    primitive: "EstimatorV2",
    jobId: estimator.jobId,
    runtimeRawArtifact: SHARED_ESTIMATOR_RUNTIME_ARTIFACT,
    runtimeRawSha256,
    chshArtifact: SHARED_CHSH_ARTIFACT,
    chshArtifactSha256,
    publishedCommitment: PINNED_FIRST_COMMITMENT,
  });
};

const createCampaignBundle = (
  pinned: DailyUniverse,
  locked: VerifiedRealEvidence,
  compiled: readonly DailyUniverse[],
  directEvidence: readonly VerifiedCampaignEvidence[],
  pending?: PendingCampaignEvidence,
): CampaignBundle => {
  const sampler = requireLockedJob(locked, "SAMPLER_ENTROPY_BELL");
  const estimator = requireLockedJob(locked, "ESTIMATOR_CHSH");
  const sharedReference = sharedChshReference(pinned, locked);
  const entries: CampaignEntry[] = [Object.freeze({
    universeNumber: 1,
    title: "Origin Universe",
    dateUtc: "2026-07-22",
    evidenceStatus: "verified",
    publicationStatus: "published",
    playable: true,
    artifact: pinned,
    provenance: Object.freeze({
      kind: "DIRECT_DUAL_PRIMITIVE",
      directEvidence: Object.freeze({
        evidenceRunId: locked.runId,
        backend: "ibm_fez",
        samplerJobId: sampler.jobId,
        estimatorJobId: estimator.jobId,
        artifactHashes: locked.artifactHashes,
      }),
    }),
  })];
  for (const artifact of compiled) {
    const evidence = directEvidence.find(
      (candidate) => candidate.universeNumber === artifact.universeNumber,
    );
    if (evidence === undefined) {
      throw new Error(`Compiled universe #${artifact.universeNumber} has no direct evidence metadata.`);
    }
    entries.push(Object.freeze({
      universeNumber: artifact.universeNumber,
      title: CAMPAIGN_UNIVERSE_IDENTITIES[artifact.universeNumber].title,
      dateUtc: artifact.dateUtc,
      evidenceStatus: "verified",
      publicationStatus: "published",
      playable: true,
      artifact,
      provenance: Object.freeze({
        kind: "DIRECT_SAMPLER_SHARED_CHSH",
        directEvidence: evidence.directEvidence,
        sharedChshReference: sharedReference,
      }),
    }));
  }
  if (pending !== undefined) {
    entries.push(Object.freeze({
      universeNumber: 5,
      title: "Quantum Storm",
      dateUtc: "2026-07-26",
      evidenceStatus: "pending",
      publicationStatus: "blocked",
      playable: false,
      artifact: null,
      provenance: Object.freeze({
        kind: "PENDING_SAMPLER",
        pendingEvidence: pending,
      }),
    }));
  }
  const bundle: CampaignBundle = Object.freeze({
    schemaVersion: 1,
    campaignId: CAMPAIGN_ID,
    entries: Object.freeze(entries),
  });
  assertCampaignBundle(bundle);
  return bundle;
};

export type PreparedCampaign = Readonly<{
  pinned: DailyUniverse;
  lockedEvidence: VerifiedRealEvidence;
  campaignEvidence: AvailableCampaignEvidence;
  compiled: readonly DailyUniverse[];
  playable: readonly DailyUniverse[];
  bundle: CampaignBundle;
  index: DailyUniverseIndex;
}>;

/** Validates and compiles all currently publishable campaign artifacts in memory. */
export const prepareAvailableCampaign = (repositoryRoot: string): PreparedCampaign => {
  const pinned = loadPinnedArtifact(repositoryRoot);
  const lockedEvidence = readLockedRealEvidence({ repositoryRoot });
  const campaignEvidence = readAvailableCampaignEvidence(repositoryRoot);
  const compiled = Object.freeze(campaignEvidence.complete.map((evidence) =>
    compileCampaignUniverse(evidence, lockedEvidence.chsh)));
  const playable = Object.freeze([pinned, ...compiled]);
  const bundle = createCampaignBundle(
    pinned,
    lockedEvidence,
    compiled,
    campaignEvidence.complete,
    campaignEvidence.pending,
  );
  return Object.freeze({
    pinned,
    lockedEvidence,
    campaignEvidence,
    compiled,
    playable,
    bundle,
    index: compileCampaignUniverseIndex(playable),
  });
};

type Output = Readonly<{
  destination: string;
  bytes: Uint8Array;
}>;

type TransactionState = {
  destination: string;
  temporary: string;
  backup: string;
  hadOriginal: boolean;
  backedUp: boolean;
  promoted: boolean;
};

const tryRemoveTransactionFile = (target: string): void => {
  try {
    if (fs.existsSync(target)) {
      fs.unlinkSync(target);
    }
  } catch {
    // Publication is already committed; retain an undeletable backup for manual recovery.
  }
};

const writeOutputsTransactionally = (outputs: readonly Output[]): void => {
  const transactionId = `${process.pid}-${Date.now()}`;
  const states: TransactionState[] = outputs.map(({ destination }) => ({
    destination,
    temporary: `${destination}.${transactionId}.tmp`,
    backup: `${destination}.${transactionId}.bak`,
    hadOriginal: fs.existsSync(destination),
    backedUp: false,
    promoted: false,
  }));
  let committed = false;
  try {
    outputs.forEach(({ bytes }, index) => {
      const state = states[index];
      if (state === undefined) {
        throw new Error("Campaign transaction staging state is unavailable.");
      }
      fs.mkdirSync(path.dirname(state.destination), { recursive: true });
      fs.writeFileSync(state.temporary, bytes, { flag: "wx" });
    });
    for (const state of states) {
      if (state.hadOriginal) {
        fs.renameSync(state.destination, state.backup);
        state.backedUp = true;
      }
      fs.renameSync(state.temporary, state.destination);
      state.promoted = true;
    }
    committed = true;
  } catch (error) {
    const rollbackIssues: string[] = [];
    for (const state of [...states].reverse()) {
      try {
        if (state.promoted && fs.existsSync(state.destination)) {
          fs.unlinkSync(state.destination);
        }
        if (state.backedUp && fs.existsSync(state.backup)) {
          fs.renameSync(state.backup, state.destination);
        }
      } catch (rollbackError) {
        rollbackIssues.push(
          `${state.destination}: ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`,
        );
      }
    }
    if (rollbackIssues.length > 0) {
      throw new Error(
        `Campaign publication failed and rollback was incomplete: ${rollbackIssues.join("; ")}`,
        { cause: error },
      );
    }
    throw error;
  } finally {
    for (const state of states) {
      tryRemoveTransactionFile(state.temporary);
      if (committed) {
        tryRemoveTransactionFile(state.backup);
      }
    }
  }
};

const outputsForCampaign = (
  repositoryRoot: string,
  compiled: readonly DailyUniverse[],
  bundle: CampaignBundle,
  index: DailyUniverseIndex,
): readonly Output[] => {
  const paths = campaignPaths(repositoryRoot);
  const outputs: Output[] = compiled.map((universe) => ({
    destination: path.join(paths.publicDirectory, `${universe.dateUtc}.json`),
    bytes: canonicalUtf8Bytes(universe),
  }));
  const campaignBytes = canonicalUtf8Bytes(bundle);
  outputs.push(
    { destination: paths.publicCampaign, bytes: campaignBytes },
    { destination: paths.publicIndex, bytes: canonicalUtf8Bytes(index) },
    { destination: paths.sourceCampaign, bytes: campaignBytes },
  );
  return Object.freeze(outputs);
};

export type CampaignBuildResult = Readonly<{
  bundle: CampaignBundle;
  commitments: Readonly<Record<string, string>>;
}>;

/** Validates everything first, then transactionally publishes #2-#4 and the current bundle. */
export const buildAvailableCampaign = (repositoryRoot: string): CampaignBuildResult => {
  const prepared = prepareAvailableCampaign(repositoryRoot);
  writeOutputsTransactionally(outputsForCampaign(
    repositoryRoot,
    prepared.compiled,
    prepared.bundle,
    prepared.index,
  ));
  return Object.freeze({
    bundle: prepared.bundle,
    commitments: Object.freeze(Object.fromEntries(
      prepared.compiled.map((universe) => [String(universe.universeNumber), universe.commitment]),
    )),
  });
};

export type PreparedFinalizedCampaign = Readonly<{
  pinned: DailyUniverse;
  lockedEvidence: VerifiedRealEvidence;
  campaignEvidence: readonly VerifiedCampaignEvidence[];
  compiled: readonly DailyUniverse[];
  playable: readonly DailyUniverse[];
  bundle: CampaignBundle;
  index: DailyUniverseIndex;
}>;

/** Strictly validates and compiles the complete five-universe campaign in memory. */
export const prepareFinalizedCampaign = (
  repositoryRoot: string,
): PreparedFinalizedCampaign => {
  const campaignEvidence = readFinalizableCampaignEvidence(repositoryRoot);
  const pinned = loadPinnedArtifact(repositoryRoot);
  const lockedEvidence = readLockedRealEvidence({ repositoryRoot });
  const compiled = Object.freeze(campaignEvidence.map((evidence) =>
    compileCampaignUniverse(evidence, lockedEvidence.chsh)));
  const playable = Object.freeze([pinned, ...compiled]);
  return Object.freeze({
    pinned,
    lockedEvidence,
    campaignEvidence,
    compiled,
    playable,
    bundle: createCampaignBundle(pinned, lockedEvidence, compiled, campaignEvidence),
    index: compileCampaignUniverseIndex(playable),
  });
};

export type CampaignVerification = Readonly<{
  ok: boolean;
  issues: readonly string[];
  bundle?: CampaignBundle;
}>;

const verifyCanonicalFile = (
  target: string,
  expected: unknown,
  label: string,
  issues: string[],
): string | undefined => {
  try {
    const source = fs.readFileSync(target, "utf8");
    if (source !== canonicalJson(expected)) {
      issues.push(`${label} does not equal deterministic canonical output.`);
    }
    return source;
  } catch (error) {
    issues.push(`${label} is unreadable: ${error instanceof Error ? error.message : String(error)}.`);
    return undefined;
  }
};

const verificationFailure = (
  issues: readonly string[],
  error?: unknown,
): CampaignVerification => Object.freeze({
  ok: false,
  issues: Object.freeze([
    ...issues,
    ...(error === undefined
      ? []
      : [error instanceof Error ? error.message : String(error)]),
  ]),
});

const verifyPreparedPublication = (
  repositoryRoot: string,
  compiled: readonly DailyUniverse[],
  bundle: CampaignBundle,
  index: DailyUniverseIndex,
  issues: string[],
): void => {
  const paths = campaignPaths(repositoryRoot);
  for (const universe of compiled) {
    if (!hasValidCommitment(universe)) {
      issues.push(`Universe #${universe.universeNumber} deterministic commitment is invalid.`);
    }
    verifyCanonicalFile(
      path.join(paths.publicDirectory, `${universe.dateUtc}.json`),
      universe,
      `Published universe #${universe.universeNumber}`,
      issues,
    );
  }
  const publicCampaign = verifyCanonicalFile(
    paths.publicCampaign,
    bundle,
    "Public campaign bundle",
    issues,
  );
  const sourceCampaign = verifyCanonicalFile(
    paths.sourceCampaign,
    bundle,
    "Source campaign bundle",
    issues,
  );
  verifyCanonicalFile(paths.publicIndex, index, "Public universe index", issues);
  if (
    publicCampaign !== undefined &&
    sourceCampaign !== undefined &&
    publicCampaign !== sourceCampaign
  ) {
    issues.push("Public and source campaign bundles are not byte-identical.");
  }
  if (publicCampaign !== undefined) {
    const parsed = parseJsonObject(publicCampaign, "Public campaign bundle");
    assertCampaignBundle(parsed);
    if (!Array.isArray(parsed.entries)) {
      issues.push("Public campaign entries are unavailable.");
    }
  }
};

const successfulVerification = (bundle: CampaignBundle): CampaignVerification =>
  Object.freeze({ ok: true, issues: Object.freeze([]), bundle });

/** Read-only verification of pinned #1, #2-#4, and the fail-closed pending #5 gate. */
export const verifyAvailableCampaign = (repositoryRoot: string): CampaignVerification => {
  const issues: string[] = [];
  try {
    const prepared = prepareAvailableCampaign(repositoryRoot);
    verifyPreparedPublication(
      repositoryRoot,
      prepared.compiled,
      prepared.bundle,
      prepared.index,
      issues,
    );
    const fifth = prepared.bundle.entries[4];
    if (
      fifth?.universeNumber !== 5 ||
      fifth.playable !== false ||
      fifth.artifact !== null ||
      fifth.evidenceStatus !== "pending" ||
      fifth.publicationStatus !== "blocked"
    ) {
      issues.push("Universe #5 is not fail-closed behind the pending null-artifact gate.");
    }
    return issues.length === 0
      ? successfulVerification(prepared.bundle)
      : verificationFailure(issues);
  } catch (error) {
    return verificationFailure(issues, error);
  }
};

/** Read-only strict verification of the complete five-universe publication. */
export const verifyFinalizedCampaign = (repositoryRoot: string): CampaignVerification => {
  const issues: string[] = [];
  try {
    const prepared = prepareFinalizedCampaign(repositoryRoot);
    verifyPreparedPublication(
      repositoryRoot,
      prepared.compiled,
      prepared.bundle,
      prepared.index,
      issues,
    );
    if (
      prepared.bundle.entries.length !== 5 ||
      prepared.bundle.entries.some((entry) =>
        !entry.playable ||
        entry.artifact === null ||
        entry.evidenceStatus !== "verified" ||
        entry.publicationStatus !== "published")
    ) {
      issues.push("The finalized campaign must contain exactly five verified playable artifacts.");
    }
    return issues.length === 0
      ? successfulVerification(prepared.bundle)
      : verificationFailure(issues);
  } catch (error) {
    return verificationFailure(issues, error);
  }
};

/** Verifies the publication appropriate to the operator state without weakening strict evidence checks. */
export const verifyCampaign = (repositoryRoot: string): CampaignVerification => {
  try {
    readFinalizableCampaignEvidence(repositoryRoot);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.startsWith("Campaign finalization blocked:")) {
      return verifyAvailableCampaign(repositoryRoot);
    }
    return verificationFailure([], error);
  }
  return verifyFinalizedCampaign(repositoryRoot);
};

/** Strict finalizer: it performs no writes unless #2-#5 are all COMPLETE and preserved. */
export const finalizeCampaign = (repositoryRoot: string): CampaignBuildResult => {
  const prepared = prepareFinalizedCampaign(repositoryRoot);
  writeOutputsTransactionally(outputsForCampaign(
    repositoryRoot,
    prepared.compiled,
    prepared.bundle,
    prepared.index,
  ));
  return Object.freeze({
    bundle: prepared.bundle,
    commitments: Object.freeze(Object.fromEntries(
      prepared.compiled.map((universe) => [String(universe.universeNumber), universe.commitment]),
    )),
  });
};
