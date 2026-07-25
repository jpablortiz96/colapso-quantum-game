import childProcess from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const directory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(directory, "..");
const date = "2026-07-22";
const runId = "real-20260721t205417z";
const jitiCli = path.join(root, "node_modules", "jiti", "lib", "jiti-cli.mjs");
const universeCli = path.join(root, "frontend", "src", "daily-universe", "cli.ts");
const checks = [];

function addCheck(label, ok, detail) {
  checks.push({ label, ok, detail });
}

function run(command, args) {
  const result = childProcess.spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    stdio: "pipe",
  });
  return {
    ok: result.status === 0 && result.error === undefined,
    detail: [result.stdout, result.stderr, result.error?.message]
      .filter((value) => typeof value === "string" && value.trim().length > 0)
      .join(" ")
      .trim(),
  };
}

function walk(directoryPath, files = []) {
  if (!fs.existsSync(directoryPath)) return files;
  for (const entry of fs.readdirSync(directoryPath, { withFileTypes: true })) {
    const absolute = path.join(directoryPath, entry.name);
    if (entry.isDirectory()) walk(absolute, files);
    else if (entry.isFile()) files.push(absolute);
  }
  return files;
}

function verifySpec() {
  const specDirectory = path.join(root, ".kiro", "specs", "daily-universe");
  const required = ["requirements.md", "design.md", "tasks.md"];
  const privateSpecPresent = fs.existsSync(path.join(root, ".kiro"));
  if (!privateSpecPresent) {
    const publicRecords = [
      "docs/ARCHITECTURE.md",
      "docs/EVIDENCE.md",
      "docs/QUANTUM_PROVENANCE.md",
    ];
    const missing = publicRecords.filter((name) => !fs.existsSync(path.join(root, name)));
    addCheck(
      "F3 design record",
      missing.length === 0,
      missing.length === 0
        ? "Published architecture, evidence, and quantum provenance records are present."
        : `Missing: ${missing.join(", ")}`,
    );
    return;
  }
  const missing = required.filter((name) => !fs.existsSync(path.join(specDirectory, name)));
  if (missing.length > 0) {
    addCheck("Complete F3 spec", false, `Missing: ${missing.join(", ")}`);
    return;
  }
  const requirements = fs.readFileSync(path.join(specDirectory, "requirements.md"), "utf8");
  const tasks = fs.readFileSync(path.join(specDirectory, "tasks.md"), "utf8");
  const requirementCount = requirements.match(/^### Requirement /gm)?.length ?? 0;
  const criterionCount = requirements.match(/^\d+\.\d+\s+/gm)?.length ?? 0;
  const unchecked = tasks.match(/^- \[ \]/gm)?.length ?? 0;
  const checkpoints = tasks.match(/Checkpoint /g)?.length ?? 0;
  addCheck(
    "Complete F3 spec",
    requirementCount <= 10 && criterionCount <= 35 && unchecked === 0 && checkpoints <= 2,
    `${requirementCount} requirements, ${criterionCount} criteria, ${unchecked} pending tasks, ${checkpoints} checkpoints.`,
  );
}

function verifyAvailability() {
  const required = [
    "scripts/verify-f1.mjs",
    "scripts/verify-f2b.mjs",
    "frontend/src/engine/index.ts",
    `evidence/runs/real/${runId}/manifest.json`,
    `evidence/runs/real/${runId}/SHA256SUMS`,
  ];
  const missing = required.filter((relative) => !fs.existsSync(path.join(root, relative)));
  addCheck(
    "F1 and F2 availability",
    missing.length === 0,
    missing.length === 0 ? "F1 public engine, F2B verifier, and locked evidence inputs are present." : `Missing: ${missing.join(", ")}`,
  );
}

function verifyUniverse() {
  const result = run(process.execPath, [jitiCli, universeCli, "verify"]);
  addCheck(
    "Published universe, commitment, evidence, and rules",
    result.ok,
    result.ok ? "universe:verify passed without regenerating the published artifact." : result.detail,
  );
}

function verifyRegeneration() {
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "colapso-f3-regen-"));
  try {
    const generatedPath = path.join(temporaryDirectory, `${date}.json`);
    const result = run(process.execPath, [
      jitiCli,
      universeCli,
      "build",
      "--date",
      date,
      "--run-id",
      runId,
      "--output",
      generatedPath,
    ]);
    const publishedPath = path.join(root, "frontend", "public", "data", "universes", `${date}.json`);
    const byteIdentical =
      result.ok &&
      fs.existsSync(publishedPath) &&
      fs.existsSync(generatedPath) &&
      fs.readFileSync(publishedPath).equals(fs.readFileSync(generatedPath));
    addCheck(
      "Byte-identical regeneration",
      byteIdentical,
      byteIdentical ? "Fresh offline build bytes exactly match the published universe." : result.detail || "Generated and published bytes differ.",
    );
  } finally {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
}

function verifyOfflineBoundary() {
  const source = walk(path.join(root, "frontend", "src", "daily-universe"))
    .filter((file) => file.endsWith(".ts") && !file.endsWith(".test.ts"))
    .map((file) => fs.readFileSync(file, "utf8"))
    .join("\n");
  const forbidden = /qiskit|aws-sdk|@aws-sdk|\bfetch\s*\(|XMLHttpRequest|WebSocket|https?:\/\/|Math\.random\s*\(/iu;
  addCheck(
    "Offline source boundary",
    !forbidden.test(source),
    !forbidden.test(source)
      ? "F3 source has no Qiskit/AWS SDK, network client, or ambient-randomness use."
      : "Forbidden provider, network, or ambient-randomness marker found in F3 source.",
  );
}

function verifySecrets() {
  const result = run(process.execPath, ["scripts/verify-step0.mjs", "--secrets-only"]);
  addCheck(
    "No secrets",
    result.ok,
    result.ok ? "Repository secret scan passed." : result.detail,
  );
}

function report() {
  const failures = checks.filter((check) => !check.ok);
  console.log("COLAPSO F3 verification");
  console.log("=".repeat(36));
  for (const check of checks) console.log(`${check.ok ? "PASS" : "FAIL"}  ${check.label}: ${check.detail}`);
  console.log("-".repeat(36));
  console.log(`F3 VERIFICATION: ${failures.length === 0 ? "PASS" : "FAIL"} (${checks.length - failures.length}/${checks.length} checks)`);
  return failures.length === 0 ? 0 : 1;
}

verifySpec();
verifyAvailability();
verifyUniverse();
verifyRegeneration();
verifyOfflineBoundary();
verifySecrets();
process.exitCode = report();
