import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptDirectory, "..");
const backend = path.join(root, "backend");
const sourceDirectory = path.join(backend, "src", "colapso_quantum");
const coveragePath = path.join(backend, "coverage.json");
const evidenceDirectory = path.join(root, "evidence", "runs", "simulated");
const minimumCombinedCoverage = 0.75;
const checks = [];

function relative(target) {
  return path.relative(root, target).split(path.sep).join("/") || ".";
}

function addCheck(label, ok, detail) {
  checks.push({ label, ok, detail });
}

function read(target) {
  return fs.readFileSync(target, "utf8");
}

function walk(directory, files = []) {
  if (!fs.existsSync(directory)) return files;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(target, files);
    else if (entry.isFile()) files.push(target);
  }
  return files;
}

function sha256File(target) {
  return crypto.createHash("sha256").update(fs.readFileSync(target)).digest("hex");
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalize(value[key])]),
    );
  }
  return value;
}

function sha256Canonical(value) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(canonicalize(value)), "utf8")
    .digest("hex");
}

function verifyDesignRecordAndModules() {
  const privateSteeringDirectory = path.join(root, ".kiro");
  const tasksPath = path.join(privateSteeringDirectory, "specs", "quantum-service", "tasks.md");
  const specificationPaths = [
    path.join(privateSteeringDirectory, "specs", "quantum-service", "requirements.md"),
    path.join(privateSteeringDirectory, "specs", "quantum-service", "design.md"),
    tasksPath,
  ];
  const publicDocumentationPaths = [
    path.join(root, "docs", "QUANTUM_PROVENANCE.md"),
    path.join(root, "docs", "EVIDENCE.md"),
    path.join(backend, "README.md"),
  ];
  const isPrivateSourceTree = fs.existsSync(privateSteeringDirectory);
  const designRecordPaths = isPrivateSourceTree ? specificationPaths : publicDocumentationPaths;
  const missingDesignRecords = designRecordPaths.filter((target) => !fs.existsSync(target));
  addCheck(
    "F2A design record",
    missingDesignRecords.length === 0,
    missingDesignRecords.length === 0
      ? isPrivateSourceTree
        ? "Private requirements, design, and task records are present."
        : "Published provenance, evidence, and backend documentation are present."
      : `Missing: ${missingDesignRecords.map(relative).join(", ")}`,
  );

  if (isPrivateSourceTree && fs.existsSync(tasksPath)) {
    const tasks = read(tasksPath);
    const checked = tasks.match(/^- \[[xX]\]/gm)?.length ?? 0;
    const unchecked = tasks.match(/^- \[ \]/gm)?.length ?? 0;
    addCheck(
      "F2A task completion",
      checked === 10 && unchecked === 0,
      `${checked}/10 checked items and ${unchecked} pending items.`,
    );
  }

  const requiredModules = [
    "__init__.py",
    "models.py",
    "circuits.py",
    "entropy.py",
    "chsh.py",
    "evidence.py",
    "service.py",
    "cli.py",
    "providers/base.py",
    "providers/aer.py",
    "providers/ibm_runtime.py",
  ];
  const missingModules = requiredModules.filter(
    (module) => !fs.existsSync(path.join(sourceDirectory, module)),
  );
  addCheck(
    "Quantum module set",
    missingModules.length === 0,
    missingModules.length === 0
      ? `${requiredModules.length} required Python modules present.`
      : `Missing: ${missingModules.join(", ")}`,
  );
}

function verifyLockAndCoverage() {
  const pyprojectPath = path.join(backend, "pyproject.toml");
  const lockPath = path.join(backend, "uv.lock");
  const exactRequirements = [
    "pydantic==2.13.4",
    "qiskit==2.5.0",
    "qiskit-aer==0.17.2",
    "qiskit-ibm-runtime==0.48.0",
    "pytest==9.1.1",
    "pytest-cov==7.1.0",
    "ruff==0.15.22",
  ];
  const lockPackages = [
    "pydantic",
    "qiskit",
    "qiskit-aer",
    "qiskit-ibm-runtime",
    "pytest",
    "pytest-cov",
    "ruff",
  ];
  const pyproject = fs.existsSync(pyprojectPath) ? read(pyprojectPath) : "";
  const lock = fs.existsSync(lockPath) ? read(lockPath) : "";
  const lockOk =
    exactRequirements.every((requirement) => pyproject.includes(requirement)) &&
    lockPackages.every((name) => new RegExp(`name = "${name}"`).test(lock));
  addCheck(
    "Pinned Python lock",
    lockOk,
    lockOk
      ? "Python 3.12 project and all seven direct dependencies are pinned and locked."
      : "pyproject.toml or uv.lock is missing an expected exact dependency.",
  );

  const thresholdOk =
    pyproject.includes("--cov-fail-under=75") && pyproject.includes("fail_under = 75");
  addCheck(
    "Coverage policy",
    thresholdOk,
    thresholdOk
      ? "A 75% combined line-and-branch clean-run gate is explicit."
      : "The expected 75% combined coverage gate is missing.",
  );

  if (!fs.existsSync(coveragePath)) {
    addCheck(
      "Fresh Python coverage",
      false,
      "Missing backend/coverage.json; run `pytest` in backend first.",
    );
    return;
  }

  let coverage;
  try {
    coverage = JSON.parse(read(coveragePath));
  } catch (error) {
    addCheck(
      "Fresh Python coverage",
      false,
      `coverage.json is invalid: ${error instanceof Error ? error.message : String(error)}`,
    );
    return;
  }

  const relevantFiles = [
    ...walk(sourceDirectory).filter((target) => target.endsWith(".py")),
    ...walk(path.join(backend, "tests")).filter((target) => target.endsWith(".py")),
    pyprojectPath,
  ];
  const coverageModifiedAt = fs.statSync(coveragePath).mtimeMs;
  const newestInput = Math.max(...relevantFiles.map((target) => fs.statSync(target).mtimeMs));
  const combinedRate = Number(coverage?.totals?.percent_covered) / 100;
  const fresh = coverageModifiedAt >= newestInput;
  const adequate = Number.isFinite(combinedRate) && combinedRate >= minimumCombinedCoverage;
  addCheck(
    "Fresh Python coverage",
    fresh && adequate,
    Number.isFinite(combinedRate)
      ? `${(combinedRate * 100).toFixed(2)}% combined coverage; artifact is ${fresh ? "fresh" : "older than source/tests"}.`
      : "Coverage totals are incomplete.",
  );
}

function verifyEvidencePackages() {
  if (!fs.existsSync(evidenceDirectory)) {
    addCheck("Simulated evidence packages", false, "No simulated evidence directory exists.");
    return;
  }
  const packages = fs
    .readdirSync(evidenceDirectory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(evidenceDirectory, entry.name));
  const failures = [];

  for (const packageDirectory of packages) {
    try {
      const manifestPath = path.join(packageDirectory, "manifest.json");
      const hashesPath = path.join(packageDirectory, "hashes.json");
      const manifest = JSON.parse(read(manifestPath));
      const hashes = JSON.parse(read(hashesPath));
      const { manifest_sha256: manifestHash, ...manifestBase } = manifest;
      if (manifest.mode !== "SIMULATED" || manifestHash !== sha256Canonical(manifestBase)) {
        throw new Error("manifest mode or canonical hash is invalid");
      }
      if (!Array.isArray(manifest.provenance) || manifest.provenance.length === 0) {
        throw new Error("manifest has no provenance");
      }
      for (const provenance of manifest.provenance) {
        if (
          provenance.mode !== "SIMULATED" ||
          provenance.verification_status !== "SIMULATED" ||
          provenance.job_id !== null
        ) {
          throw new Error("provenance does not remain visibly simulated");
        }
      }
      const artifactHashes = {
        ...(manifest.raw_artifacts ?? {}),
        ...(manifest.derived_artifacts ?? {}),
      };
      if (
        Object.keys(manifest.raw_artifacts ?? {}).length === 0 ||
        Object.keys(manifest.derived_artifacts ?? {}).length === 0
      ) {
        throw new Error("manifest does not link raw and derived artifacts");
      }
      for (const [name, expectedHash] of Object.entries(artifactHashes)) {
        if (sha256File(path.join(packageDirectory, name)) !== expectedHash) {
          throw new Error(`artifact hash mismatch for ${name}`);
        }
      }
      const expectedHashes = {
        ...artifactHashes,
        "manifest.json": sha256File(manifestPath),
      };
      if (JSON.stringify(canonicalize(hashes)) !== JSON.stringify(canonicalize(expectedHashes))) {
        throw new Error("hashes.json does not exactly link package files");
      }
    } catch (error) {
      failures.push(
        `${path.basename(packageDirectory)}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  addCheck(
    "Simulated evidence packages",
    packages.length >= 2 && failures.length === 0,
    failures.length === 0
      ? `${packages.length} hash-linked packages are visibly SIMULATED.`
      : failures.join("; ") || "At least two packages are required.",
  );
}

function verifyBoundaries() {
  const source = walk(sourceDirectory)
    .filter((target) => target.endsWith(".py"))
    .map((target) => read(target))
    .join("\n");
  const entropySource = read(path.join(sourceDirectory, "entropy.py"));
  const serviceSource = read(path.join(sourceDirectory, "service.py"));
  const cliSource = read(path.join(sourceDirectory, "cli.py"));
  const ibmSource = read(path.join(sourceDirectory, "providers", "ibm_runtime.py"));
  const dryRunTests = read(path.join(backend, "tests", "test_ibm_runtime.py"));

  const separatedFlows =
    entropySource.includes("independent_qubits") &&
    entropySource.includes("Bell-pair outcomes are correlated") &&
    serviceSource.includes("harvest_entropy") &&
    serviceSource.includes("sample_bell") &&
    serviceSource.includes("estimate_chsh");
  addCheck(
    "Quantum-flow separation",
    separatedFlows,
    separatedFlows
      ? "Independent entropy, Bell correlation, and CHSH estimation remain separate flows."
      : "Required entropy/Bell/CHSH separation markers are missing.",
  );

  const noAws = !/\baws\b/i.test(source);
  const noHardCodedToken = !/\b(?:token|api[_-]?key)\s*=\s*["'][^"']{12,}["']/i.test(source);
  addCheck(
    "No AWS or embedded credential",
    noAws && noHardCodedToken,
    noAws && noHardCodedToken
      ? "F2A source contains neither AWS integration nor a hard-coded credential."
      : "AWS integration or a credential-like literal was found in F2A source.",
  );

  const dryRunBlock =
    cliSource.match(
      /if args\.command == "real-dry-run":([\s\S]*?)\n\s*if args\.command == "real-preflight":/,
    )?.[1] ?? "";
  const ibmDryRunIsIsolated =
    !/^from qiskit_ibm_runtime/m.test(ibmSource) &&
    dryRunBlock.includes("IbmRuntimeProvider().dry_run") &&
    !/(?:_runtime_provider|real_preflight|submit_|_create_service)/.test(dryRunBlock) &&
    dryRunTests.includes("dry-run must not create service") &&
    dryRunTests.includes("assert not created") &&
    dryRunTests.includes("assert not plan.submits_jobs");
  addCheck(
    "IBM dry-run boundary",
    ibmDryRunIsIsolated,
    ibmDryRunIsIsolated
      ? "Dry-run remains credential-free and cannot initialize or submit Runtime work; later F2B commands stay separate."
      : "The dry-run command or its tests no longer prove the credential-free no-submission boundary.",
  );

  const f1Files = [
    path.join(root, "scripts", "verify-f1.mjs"),
    path.join(root, "frontend", "src", "engine", "index.ts"),
  ];
  let f1Changed = true;
  try {
    f1Changed =
      execFileSync("git", ["status", "--short", "--", "frontend/src/engine"], {
        cwd: root,
        encoding: "utf8",
      }).trim().length > 0;
  } catch {
    f1Changed = true;
  }
  addCheck(
    "F1 availability and isolation",
    f1Files.every((target) => fs.existsSync(target)) && !f1Changed,
    !f1Changed
      ? "F1 verifier/API are present and no engine source is modified by F2A."
      : "F1 files are missing or frontend/src/engine has uncommitted changes.",
  );
}

function printReport() {
  const failures = checks.filter((check) => !check.ok);
  console.log("COLAPSO F2A verification");
  console.log("=".repeat(36));
  for (const check of checks) {
    console.log(`${check.ok ? "PASS" : "FAIL"}  ${check.label}: ${check.detail}`);
  }
  console.log("-".repeat(36));
  if (failures.length === 0) {
    console.log(`F2A VERIFICATION: PASS (${checks.length}/${checks.length} checks)`);
    return 0;
  }
  console.error(`F2A VERIFICATION: FAIL (${failures.length} of ${checks.length} checks failed)`);
  return 1;
}

verifyDesignRecordAndModules();
verifyLockAndCoverage();
verifyEvidencePackages();
verifyBoundaries();
process.exitCode = printReport();
