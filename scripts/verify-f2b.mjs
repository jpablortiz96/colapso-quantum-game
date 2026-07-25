import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptDirectory, "..");
const sourceDirectory = path.join(root, "backend", "src", "colapso_quantum");
const testPath = path.join(root, "backend", "tests", "test_f2b_real.py");
const realRunsDirectory = path.join(root, "evidence", "runs", "real");
const checks = [];

function addCheck(label, ok, detail) {
  checks.push({ label, ok, detail });
}

function read(target) {
  return fs.readFileSync(target, "utf8");
}

function sha256File(target) {
  return crypto.createHash("sha256").update(fs.readFileSync(target)).digest("hex");
}

function verifyOfflineBoundary() {
  const providerPath = path.join(sourceDirectory, "providers", "ibm_runtime.py");
  const cliPath = path.join(sourceDirectory, "cli.py");
  const evidencePath = path.join(sourceDirectory, "real_evidence.py");
  const needed = [providerPath, cliPath, evidencePath, testPath];
  const missing = needed.filter((target) => !fs.existsSync(target));
  addCheck(
    "F2B module and fake-test set",
    missing.length === 0,
    missing.length === 0 ? "Separate real evidence, IBM boundary, CLI, and fake-only test modules are present." : `Missing: ${missing.join(", ")}`,
  );
  if (missing.length > 0) return;

  const provider = read(providerPath);
  const cli = read(cliPath);
  const tests = read(testPath);
  const source = [provider, cli, read(evidencePath), tests].join("\n");
  const required = [
    "AUTHENTICATED_OPEN_PLAN",
    "ibm_quantum_platform",
    "SAMPLER_ENTROPY_BELL",
    "ESTIMATOR_CHSH",
    "SHA256SUMS",
    "POLL_INTERVAL_NOT_ELAPSED",
    "REAL_WITH_UNCERTAINTY",
  ];
  addCheck(
    "Open Plan bounded job controls",
    required.every((marker) => source.includes(marker)) && cli.includes("real-preflight") && cli.includes("real-submit") && cli.includes("real-retrieve"),
    "CLI and source declare the authenticated Open Plan gate, exactly two named workloads, bounded polling, raw-first hashes, and real uncertainty label.",
  );
  const noAccountPersistence = !/save_account\s*\(/.test(source);
  const noAws = !/\baws\b/i.test(source);
  const fakeOnlyTests = tests.includes("service_factory=") && !tests.includes("QiskitRuntimeService(");
  addCheck(
    "Offline and secret boundary",
    noAccountPersistence && noAws && fakeOnlyTests,
    noAccountPersistence && noAws && fakeOnlyTests
      ? "Verifier performs no provider action; tests inject fakes; no account save or AWS integration is present."
      : "A forbidden account save, AWS integration, or non-fake Runtime test marker was found.",
  );
}

function verifyRealEvidence() {
  if (!fs.existsSync(realRunsDirectory)) {
    addCheck("Real evidence packages", true, "No real package exists yet; this offline verifier neither authenticates nor submits work.");
    return;
  }
  const failures = [];
  const packages = fs.readdirSync(realRunsDirectory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(realRunsDirectory, entry.name));
  for (const directory of packages) {
    try {
      const required = ["manifest.json", "preflight.json", "submission.json", "SHA256SUMS"];
      if (!required.every((name) => fs.existsSync(path.join(directory, name)))) throw new Error("required file missing");
      const manifest = JSON.parse(read(path.join(directory, "manifest.json")));
      const submission = JSON.parse(read(path.join(directory, "submission.json")));
      if (manifest.mode !== "REAL" || !["PREPARED", "SUBMITTED", "PARTIAL", "COMPLETE"].includes(manifest.state)) throw new Error("manifest mode or state invalid");
      if (submission.maximum_real_jobs !== 2 || (manifest.jobs ?? []).length > 2 || (submission.jobs ?? []).length > 2) throw new Error("more than two jobs recorded");
      const sums = new Map();
      for (const line of read(path.join(directory, "SHA256SUMS")).trim().split("\n")) {
        const [digest, name] = line.split("  ");
        if (!/^[a-f0-9]{64}$/.test(digest) || !name?.endsWith(".json") || sums.has(name)) throw new Error("invalid SHA256SUMS line");
        sums.set(name, digest);
      }
      const jsonFiles = fs.readdirSync(directory).filter((name) => name.endsWith(".json"));
      if (sums.size !== jsonFiles.length || !jsonFiles.every((name) => sums.get(name) === sha256File(path.join(directory, name)))) throw new Error("SHA256SUMS mismatch");
      const serialized = jsonFiles.map((name) => read(path.join(directory, name))).join("\n");
      if (/(?:token|authorization|password|api[_-]?key)\s*[":=]/i.test(serialized)) throw new Error("secret-bearing key found");
    } catch (error) {
      failures.push(`${path.basename(directory)}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  addCheck(
    "Real evidence packages",
    failures.length === 0,
    failures.length === 0 ? `${packages.length} locally stored real-run package(s) validate without provider access.` : failures.join("; "),
  );
}

function report() {
  const failures = checks.filter((check) => !check.ok);
  console.log("COLAPSO F2B offline verification");
  console.log("=".repeat(36));
  for (const check of checks) console.log(`${check.ok ? "PASS" : "FAIL"}  ${check.label}: ${check.detail}`);
  console.log("-".repeat(36));
  console.log(`F2B VERIFICATION: ${failures.length === 0 ? "PASS" : "FAIL"} (${checks.length - failures.length}/${checks.length} checks)`);
  return failures.length === 0 ? 0 : 1;
}

verifyOfflineBoundary();
verifyRealEvidence();
process.exitCode = report();
