import { Buffer } from "node:buffer";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  CAMPAIGN_UNIVERSE_IDENTITIES,
  FIRST_UNIVERSE_DATE,
  PINNED_FIRST_COMMITMENT,
  assertCampaignBundle,
  canonicalJson,
  canonicalUtf8Bytes,
  compileCampaignUniverse,
  compileDailyUniverse,
  deriveAttemptKey,
  expandCounterMode,
  finalizeCampaign,
  hasValidCommitment,
  prepareFinalizedCampaign,
  readFinalizableCampaignEvidence,
  readLockedRealEvidence,
  selectFirstPlayableCandidate,
  sha256Hex,
  verifyCampaign,
  verifyFinalizedCampaign,
  verifyPublishedUniverse,
  writeCanonicalJsonAtomically,
} from "./index";
import { analyzeRoutes, deserializeGameStateDto } from "../engine/index";

const directory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(directory, "../../..");
const sourceEvidenceDirectory = path.join(
  repositoryRoot,
  "evidence",
  "runs",
  "real",
  "real-20260721t205417z",
);

const evidence = (): ReturnType<typeof readLockedRealEvidence> =>
  readLockedRealEvidence({ repositoryRoot });

const universe = () => compileDailyUniverse(evidence(), FIRST_UNIVERSE_DATE);

const temporaryRepositoryWithEvidence = (): string => {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "colapso-f3-"));
  const destination = path.join(
    temporaryRoot,
    "evidence",
    "runs",
    "real",
    "real-20260721t205417z",
  );
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.cpSync(sourceEvidenceDirectory, destination, { recursive: true });
  return temporaryRoot;
};

const replaceSum = (directoryPath: string, name: string): void => {
  const digest = crypto
    .createHash("sha256")
    .update(fs.readFileSync(path.join(directoryPath, name)))
    .digest("hex");
  const sumsPath = path.join(directoryPath, "SHA256SUMS");
  const next = fs
    .readFileSync(sumsPath, "utf8")
    .split(/\r?\n/u)
    .map((line) => (line.endsWith(`  ${name}`) ? `${digest}  ${name}` : line))
    .join("\n");
  fs.writeFileSync(sumsPath, next);
};

const validState = () => {
  const result = deserializeGameStateDto(universe().initialGameState);
  if (!result.ok) {
    throw new Error(result.error.message);
  }
  return result.value;
};

describe("daily universe compiler", () => {
  it("accepts the locked complete REAL evidence package", () => {
    const source = evidence();
    expect(source.runId).toBe("real-20260721t205417z");
    expect(source.backend).toBe("ibm_fez");
    expect(source.jobs).toHaveLength(2);
    expect(source.entropyBitsAccepted).toBe(1024);
  });

  it("rejects altered evidence hashes", () => {
    const temporaryRoot = temporaryRepositoryWithEvidence();
    try {
      const entropyPath = path.join(
        temporaryRoot,
        "evidence",
        "runs",
        "real",
        "real-20260721t205417z",
        "entropy-derived.json",
      );
      fs.appendFileSync(entropyPath, " ");
      expect(() => readLockedRealEvidence({ repositoryRoot: temporaryRoot })).toThrow("SHA-256 mismatch");
    } finally {
      fs.rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });

  it("rejects simulated evidence even when its hash manifest is updated", () => {
    const temporaryRoot = temporaryRepositoryWithEvidence();
    try {
      const runDirectory = path.join(
        temporaryRoot,
        "evidence",
        "runs",
        "real",
        "real-20260721t205417z",
      );
      const manifestPath = path.join(runDirectory, "manifest.json");
      const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as Record<string, unknown>;
      manifest.mode = "SIMULATED";
      fs.writeFileSync(manifestPath, JSON.stringify(manifest));
      replaceSum(runDirectory, "manifest.json");
      expect(() => readLockedRealEvidence({ repositoryRoot: temporaryRoot })).toThrow("COMPLETE REAL");
    } finally {
      fs.rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });

  it("uses only independent entropy bytes as source material", () => {
    const source = evidence();
    expect(source.sourceEntropyHash).toBe(
      sha256Hex(Buffer.from(source.entropyBytesHex, "hex")),
    );
    expect(universe().entropyExpansion.inputMaterial).toBe(
      "entropy-derived.json:entropy_bytes_hex",
    );
    expect(universe().sourceEntropyHash).not.toBe(
      sha256Hex(Buffer.from(canonicalJson(source.bell), "utf8")),
    );
  });

  it("expands entropy deterministically in counter mode", () => {
    const attemptKey = deriveAttemptKey(evidence().sourceEntropyHash, 0);
    expect(expandCounterMode(attemptKey, "initial-state/v1", 0, 64)).toEqual(
      expandCounterMode(attemptKey, "initial-state/v1", 0, 64),
    );
  });

  it("produces identical universe bytes from identical input", () => {
    expect(canonicalUtf8Bytes(universe())).toEqual(canonicalUtf8Bytes(universe()));
  });

  it("produces an identical commitment from identical input", () => {
    expect(universe().commitment).toBe(universe().commitment);
  });

  it("builds a 7 by 7 board", () => {
    expect(validState().board).toHaveLength(49);
  });

  it("keeps entry and exit collapsed and traversable", () => {
    const state = validState();
    const entry = state.board.find((cell) => cell.coordinate.row === 6 && cell.coordinate.col === 0);
    const exit = state.board.find((cell) => cell.coordinate.row === 0 && cell.coordinate.col === 6);
    expect(entry).toMatchObject({ kind: "COLLAPSED", outcome: "FLOOR" });
    expect(exit).toMatchObject({ kind: "COLLAPSED", outcome: "FLOOR" });
  });

  it("creates three to five pairwise-disjoint entangled pairs", () => {
    const pairs = validState().pairs;
    const members = pairs.flatMap((pair) => [
      `${pair.memberA.row},${pair.memberA.col}`,
      `${pair.memberB.row},${pair.memberB.col}`,
    ]);
    expect(pairs.length).toBeGreaterThanOrEqual(3);
    expect(pairs.length).toBeLessThanOrEqual(5);
    expect(new Set(members).size).toBe(members.length);
  });

  it("uses engine-valid normalized distributions", () => {
    for (const cell of validState().board) {
      if (cell.kind === "UNRESOLVED") {
        expect(cell.distribution.reduce((sum, value) => sum + value, 0)).toBeCloseTo(1, 12);
      }
    }
  });

  it("has a legal potential route according to the public F1 route API", () => {
    expect(analyzeRoutes(validState()).legalPotentialRoute).toBe(true);
  });

  it("selects retries deterministically without manually changing a candidate", () => {
    const sourceHash = evidence().sourceEntropyHash;
    const attempts: string[] = [];
    const selected = selectFirstPlayableCandidate(sourceHash, (attemptIndex, attemptKey) => {
      attempts.push(Buffer.from(attemptKey).toString("hex"));
      return attemptIndex === 2 ? attempts[attemptIndex] ?? null : null;
    });
    expect(selected.attemptIndex).toBe(2);
    expect(attempts).toEqual([
      Buffer.from(deriveAttemptKey(sourceHash, 0)).toString("hex"),
      Buffer.from(deriveAttemptKey(sourceHash, 1)).toString("hex"),
      Buffer.from(deriveAttemptKey(sourceHash, 2)).toString("hex"),
    ]);
  });

  it("serializes canonical JSON with sorted keys and no optional whitespace", () => {
    expect(canonicalJson({ z: 1, a: { b: 2, a: -0 } })).toBe('{"a":{"a":0,"b":2},"z":1}');
  });

  it("rejects a modified commitment", () => {
    const compiled = universe();
    expect(hasValidCommitment({ ...compiled, commitment: "0".repeat(64) })).toBe(false);
  });

  it("contains no ambient Math.random use in compiler source", () => {
    const source = fs.readdirSync(directory)
      .filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"))
      .map((name) => fs.readFileSync(path.join(directory, name), "utf8"))
      .join("\n");
    expect(source).not.toMatch(/Math\.random\s*\(/u);
  });

  it("contains no provider SDK, AWS SDK, or network-client use", () => {
    const source = fs.readdirSync(directory)
      .filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"))
      .map((name) => fs.readFileSync(path.join(directory, name), "utf8"))
      .join("\n");
    const forbidden = new RegExp(
      [
        "qiskit",
        "aws-sdk",
        "\\bfetch\\s*\\(",
        "XML" + "HttpRequest",
        "Web" + "Socket",
        "https?:\\/\\/",
      ].join("|"),
      "iu",
    );
    expect(source).not.toMatch(forbidden);
  });

  it("regenerates exact canonical bytes for a published-style artifact", () => {
    const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "colapso-f3-published-"));
    try {
      const target = path.join(temporaryDirectory, `${FIRST_UNIVERSE_DATE}.json`);
      const compiled = universe();
      const written = writeCanonicalJsonAtomically(target, compiled);
      expect(Buffer.compare(fs.readFileSync(target), Buffer.from(written))).toBe(0);
      expect(written).toEqual(canonicalUtf8Bytes(compileDailyUniverse(evidence(), FIRST_UNIVERSE_DATE)));
    } finally {
      fs.rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  });

  it("verifies a generated published file without regeneration", () => {
    const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "colapso-f3-verify-"));
    try {
      const target = path.join(
        temporaryRoot,
        "frontend",
        "public",
        "data",
        "universes",
        `${FIRST_UNIVERSE_DATE}.json`,
      );
      writeCanonicalJsonAtomically(target, universe());
      fs.mkdirSync(path.join(temporaryRoot, "evidence", "runs", "real"), { recursive: true });
      fs.cpSync(path.join(repositoryRoot, "evidence", "runs", "real", "real-20260721t205417z"), path.join(temporaryRoot, "evidence", "runs", "real", "real-20260721t205417z"), { recursive: true });
      expect(verifyPublishedUniverse(temporaryRoot, target).ok).toBe(true);
    } finally {
      fs.rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });

  it("strictly validates and deterministically compiles campaign evidence #2-#5", () => {
    const complete = readFinalizableCampaignEvidence(repositoryRoot);
    const locked = evidence();
    expect(complete.map(({ universeNumber }) => universeNumber)).toEqual([2, 3, 4, 5]);

    for (const source of complete) {
      expect(Object.keys(source.artifactHashes)).toHaveLength(9);
      expect(source.job).toMatchObject({
        primitive: "SamplerV2",
        status: "DONE",
        backend: "ibm_fez",
      });
      expect(source.directEvidence).toMatchObject({
        jobId: source.job.jobId,
        shots: 256,
        commitmentScope: "ACQUISITION_EVIDENCE_INPUTS_NOT_COMPILED_BOARD",
      });
      expect(source.sourceEntropyHash).toBe(
        sha256Hex(Buffer.from(source.entropyBytesHex, "hex")),
      );

      const compiled = compileCampaignUniverse(source, locked.chsh);
      const identity = CAMPAIGN_UNIVERSE_IDENTITIES[source.universeNumber];
      expect(compiled).toMatchObject({
        universeNumber: source.universeNumber,
        universeId: identity.universeId,
        dateUtc: identity.dateUtc,
        sourceEntropyHash: source.sourceEntropyHash,
        chshSummary: locked.chsh,
      });
      expect(compiled.jobIds).toEqual([source.job.jobId]);
      expect(compiled.entropyExpansion.inputMaterial).toBe(
        "accepted-entropy.json:entropy_bytes_hex",
      );
      expect(compiled.provenanceNotice).toContain("SamplerV2 directa");
      expect(compiled.provenanceNotice).toContain("compartida y fijada del universo #1");
      expect(canonicalUtf8Bytes(compiled)).toEqual(
        canonicalUtf8Bytes(compileCampaignUniverse(source, locked.chsh)),
      );
    }
  });

  it("builds an exact finalized five-entry campaign from preserved evidence", () => {
    const prepared = prepareFinalizedCampaign(repositoryRoot);
    expect(() => assertCampaignBundle(prepared.bundle)).not.toThrow();
    expect(prepared.bundle.entries).toHaveLength(5);
    expect(prepared.bundle.entries.map(({ provenance }) => provenance.kind)).toEqual([
      "DIRECT_DUAL_PRIMITIVE",
      "DIRECT_SAMPLER_SHARED_CHSH",
      "DIRECT_SAMPLER_SHARED_CHSH",
      "DIRECT_SAMPLER_SHARED_CHSH",
      "DIRECT_SAMPLER_SHARED_CHSH",
    ]);
    expect(prepared.bundle.entries.every((entry) =>
      entry.playable &&
      entry.artifact !== null &&
      entry.evidenceStatus === "verified" &&
      entry.publicationStatus === "published"
    )).toBe(true);

    const first = prepared.bundle.entries[0];
    expect(first?.playable).toBe(true);
    if (first?.playable !== true) {
      throw new Error("Campaign entry #1 must be playable.");
    }
    const pinnedPublic = fs.readFileSync(path.join(
      repositoryRoot,
      "frontend",
      "public",
      "data",
      "universes",
      "2026-07-22.json",
    ));
    const pinnedSource = fs.readFileSync(path.join(
      repositoryRoot,
      "frontend",
      "src",
      "daily-game",
      "published-universe.json",
    ));
    expect(pinnedPublic).toEqual(pinnedSource);
    expect(Buffer.from(canonicalUtf8Bytes(first.artifact))).toEqual(pinnedPublic);
    expect(first.artifact.commitment).toBe(PINNED_FIRST_COMMITMENT);

    const fifth = prepared.bundle.entries[4];
    expect(fifth).toMatchObject({
      universeNumber: 5,
      title: "Quantum Storm",
      evidenceStatus: "verified",
      publicationStatus: "published",
      playable: true,
      provenance: {
        kind: "DIRECT_SAMPLER_SHARED_CHSH",
        directEvidence: {
          jobId: "d9juap0ii2cc73efdch0",
          primitive: "SamplerV2",
        },
      },
    });
    expect(fifth?.artifact?.commitment).toBe(
      "c4cfc1afeb0da6b7223fa1a994bf240883a465d18c9a3acf48234696badf2a56",
    );
  });

  it("rejects artifact/playability inconsistency at the browser-safe boundary", () => {
    const invalid = JSON.parse(canonicalJson(prepareFinalizedCampaign(repositoryRoot).bundle)) as {
      entries: Array<Record<string, unknown>>;
    };
    const fifth = invalid.entries[4];
    if (fifth === undefined) {
      throw new Error("Campaign entry #5 is unavailable.");
    }
    fifth.artifact = null;
    expect(() => assertCampaignBundle(invalid)).toThrow("Invalid campaign bundle");
  });

  it("verifies the finalized campaign read-only and finalizes idempotently", () => {
    const outputPaths = [
      "frontend/public/data/universes/2026-07-22.json",
      "frontend/public/data/universes/2026-07-23.json",
      "frontend/public/data/universes/2026-07-24.json",
      "frontend/public/data/universes/2026-07-25.json",
      "frontend/public/data/universes/2026-07-26.json",
      "frontend/public/data/universes/campaign.json",
      "frontend/public/data/universes/index.json",
      "frontend/src/daily-game/published-universe.json",
      "frontend/src/daily-game/published-campaign.json",
    ].map((relative) => path.join(repositoryRoot, ...relative.split("/")));
    const before = outputPaths.map((target) => Object.freeze({
      bytes: fs.readFileSync(target),
      modified: fs.statSync(target).mtimeMs,
    }));

    expect(verifyFinalizedCampaign(repositoryRoot)).toMatchObject({ ok: true, issues: [] });
    expect(verifyCampaign(repositoryRoot)).toMatchObject({ ok: true, issues: [] });
    outputPaths.forEach((target, index) => {
      expect(fs.readFileSync(target)).toEqual(before[index]?.bytes);
      expect(fs.statSync(target).mtimeMs).toBe(before[index]?.modified);
    });

    const finalized = finalizeCampaign(repositoryRoot);
    expect(finalized.bundle.entries).toHaveLength(5);
    expect(finalized.commitments["5"]).toBe(
      "c4cfc1afeb0da6b7223fa1a994bf240883a465d18c9a3acf48234696badf2a56",
    );
  });
});
