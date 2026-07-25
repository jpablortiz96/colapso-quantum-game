import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptDirectory, "..");
const engineDirectory = path.join(root, "frontend", "src", "engine");
const coverageSummaryPath = path.join(
  root,
  "frontend",
  "coverage",
  "coverage-summary.json",
);
const thresholds = Object.freeze({ lines: 95, branches: 90 });
const checks = [];

function relative(target) {
  return path.relative(root, target).split(path.sep).join("/") || ".";
}

function addCheck(label, ok, detail) {
  checks.push({ label, ok, detail });
}

function walk(directory, files = []) {
  if (!fs.existsSync(directory)) {
    return files;
  }
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      walk(absolute, files);
    } else if (entry.isFile()) {
      files.push(absolute);
    }
  }
  return files;
}

function generateFreshCoverage() {
  fs.rmSync(path.dirname(coverageSummaryPath), {
    recursive: true,
    force: true,
  });

  const npmExecPath = process.env.npm_execpath;
  const command =
    npmExecPath === undefined
      ? process.platform === "win32"
        ? "npm.cmd"
        : "npm"
      : process.execPath;
  const args = [
    ...(npmExecPath === undefined ? [] : [npmExecPath]),
    "run",
    "test:engine",
    "--workspace",
    "frontend",
    "--",
    "--coverage",
  ];
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: "inherit",
    shell: npmExecPath === undefined && process.platform === "win32",
  });
  const ok = result.error === undefined && result.status === 0;
  addCheck(
    "Fresh engine coverage run",
    ok,
    ok
      ? "Removed prior coverage output and regenerated it from the current source."
      : result.error?.message ??
          `Coverage command exited with status ${String(result.status)}${result.signal === null ? "." : ` after signal ${result.signal}.`}`,
  );
  return ok;
}

function canonicalPath(target) {
  const normalized = path.normalize(path.resolve(target));
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function verifyCoverage() {
  if (!fs.existsSync(coverageSummaryPath)) {
    addCheck(
      "Coverage summary",
      false,
      `Missing ${relative(coverageSummaryPath)}; run the engine coverage suite first.`,
    );
    return;
  }

  let summary;
  try {
    summary = JSON.parse(fs.readFileSync(coverageSummaryPath, "utf8"));
  } catch (error) {
    addCheck(
      "Coverage summary",
      false,
      `Invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
    return;
  }

  const typeOnlyFiles = new Set([
    canonicalPath(path.join(engineDirectory, "types.ts")),
    canonicalPath(path.join(engineDirectory, "errors.ts")),
  ]);
  const expectedFiles = new Set(
    walk(engineDirectory)
      .filter(
        (file) =>
          file.endsWith(".ts") &&
          !file.endsWith(".test.ts") &&
          !file.endsWith(".property.test.ts") &&
          !typeOnlyFiles.has(canonicalPath(file)),
      )
      .map(canonicalPath),
  );
  const reportedFiles = new Set(
    Object.keys(summary)
      .filter((key) => key !== "total")
      .map(canonicalPath),
  );
  const missingFiles = [...expectedFiles].filter(
    (file) => !reportedFiles.has(file),
  );
  const unexpectedFiles = [...reportedFiles].filter(
    (file) => !expectedFiles.has(file),
  );
  addCheck(
    "Coverage module set",
    expectedFiles.size > 0 &&
      missingFiles.length === 0 &&
      unexpectedFiles.length === 0,
    missingFiles.length === 0 && unexpectedFiles.length === 0
      ? `${reportedFiles.size} engine production modules reported; only types.ts and errors.ts are type-only exclusions.`
      : `Missing: ${missingFiles.map(relative).join(", ") || "none"}; unexpected: ${unexpectedFiles.map(relative).join(", ") || "none"}.`,
  );

  for (const [metricName, threshold] of Object.entries(thresholds)) {
    const metric = summary?.total?.[metricName];
    const valid =
      typeof metric === "object" &&
      metric !== null &&
      Number.isInteger(metric.total) &&
      metric.total > 0 &&
      Number.isInteger(metric.covered) &&
      metric.covered >= 0 &&
      metric.covered <= metric.total &&
      typeof metric.pct === "number" &&
      Number.isFinite(metric.pct);
    addCheck(
      `${metricName[0].toUpperCase()}${metricName.slice(1)} coverage`,
      valid && metric.pct >= threshold,
      valid
        ? `${metric.pct.toFixed(2)}% (${metric.covered}/${metric.total}), threshold ${threshold}%.`
        : `Missing or invalid total.${metricName} metrics.`,
    );
  }
}

function importSpecifiers(content) {
  const specifiers = [];
  const pattern = /\bfrom\s+["']([^"']+)["']|\bimport\s+["']([^"']+)["']/g;
  for (const match of content.matchAll(pattern)) {
    specifiers.push(match[1] ?? match[2]);
  }
  return specifiers;
}

function resolveEngineImport(sourceFile, specifier, productionFiles) {
  const base = path.resolve(path.dirname(sourceFile), specifier);
  const candidates = [base, `${base}.ts`, path.join(base, "index.ts")];
  return candidates.find((candidate) => productionFiles.has(candidate)) ?? null;
}

function findCycle(graph) {
  const visiting = new Set();
  const visited = new Set();
  const stack = [];

  function visit(node) {
    if (visiting.has(node)) {
      const start = stack.indexOf(node);
      return [...stack.slice(start), node];
    }
    if (visited.has(node)) {
      return null;
    }
    visiting.add(node);
    stack.push(node);
    for (const dependency of graph.get(node) ?? []) {
      const cycle = visit(dependency);
      if (cycle !== null) {
        return cycle;
      }
    }
    stack.pop();
    visiting.delete(node);
    visited.add(node);
    return null;
  }

  for (const node of graph.keys()) {
    const cycle = visit(node);
    if (cycle !== null) {
      return cycle;
    }
  }
  return null;
}

function verifyBoundary() {
  const productionFiles = new Set(
    walk(engineDirectory).filter(
      (file) =>
        file.endsWith(".ts") &&
        !file.endsWith(".test.ts") &&
        !file.endsWith(".property.test.ts"),
    ),
  );
  if (productionFiles.size === 0) {
    addCheck("Pure engine boundary", false, "No engine production files found.");
    return;
  }

  const externalImports = [];
  const forbiddenUsage = [];
  const graph = new Map();
  const forbiddenPatterns = [
    ["React/DOM", /\b(?:React|document|window|HTMLElement)\b/],
    ["network", /\b(?:fetch|XMLHttpRequest|WebSocket|EventSource|axios)\b/],
    ["storage", /\b(?:localStorage|sessionStorage|indexedDB)\b/],
    ["cloud/quantum provider", /\b(?:AWS|IBM|Qiskit|qiskit|provider)\b/],
    ["timer/clock/random", /\b(?:setTimeout|setInterval|Date\.now|performance\.now|Math\.random|crypto\.getRandomValues)\b/],
  ];

  for (const file of productionFiles) {
    const content = fs.readFileSync(file, "utf8");
    const dependencies = [];
    for (const specifier of importSpecifiers(content)) {
      if (!specifier.startsWith(".")) {
        externalImports.push(`${relative(file)} -> ${specifier}`);
        continue;
      }
      const dependency = resolveEngineImport(file, specifier, productionFiles);
      if (dependency !== null) {
        dependencies.push(dependency);
      }
    }
    graph.set(file, dependencies);

    for (const [name, pattern] of forbiddenPatterns) {
      if (pattern.test(content)) {
        forbiddenUsage.push(`${name} in ${relative(file)}`);
      }
    }
  }

  addCheck(
    "Relative-only engine imports",
    externalImports.length === 0,
    externalImports.length === 0
      ? `${productionFiles.size} production files use only relative imports.`
      : externalImports.join("; "),
  );
  addCheck(
    "Forbidden engine dependencies",
    forbiddenUsage.length === 0,
    forbiddenUsage.length === 0
      ? "No React, DOM, network, storage, cloud/provider, timer, clock, or platform-random usage found."
      : forbiddenUsage.join("; "),
  );

  const cycle = findCycle(graph);
  addCheck(
    "Acyclic engine imports",
    cycle === null,
    cycle === null
      ? "No production import cycle found."
      : cycle.map(relative).join(" -> "),
  );
}

function printReport() {
  const failures = checks.filter((check) => !check.ok);
  console.log("COLAPSO F1 verification");
  console.log("=".repeat(36));
  for (const check of checks) {
    console.log(`${check.ok ? "PASS" : "FAIL"}  ${check.label}: ${check.detail}`);
  }
  console.log("-".repeat(36));
  if (failures.length === 0) {
    console.log(`F1 VERIFICATION: PASS (${checks.length}/${checks.length} checks)`);
    return 0;
  }
  console.error(`F1 VERIFICATION: FAIL (${failures.length} of ${checks.length} checks failed)`);
  return 1;
}

if (generateFreshCoverage()) {
  verifyCoverage();
}
verifyBoundary();
process.exitCode = printReport();
