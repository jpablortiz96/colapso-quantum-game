import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptDirectory, "..");
const secretsOnly = process.argv.includes("--secrets-only");
const ignoredDirectoryNames = new Set([
  ".git",
  "node_modules",
  "dist",
  "coverage",
  ".venv",
  ".aws-sam",
]);

const checks = [];

function relative(target) {
  return path.relative(root, target).split(path.sep).join("/") || ".";
}

function addCheck(label, ok, detail) {
  checks.push({ label, ok, detail });
}

function exists(relativePath) {
  return fs.existsSync(path.join(root, relativePath));
}

function isDirectory(relativePath) {
  const target = path.join(root, relativePath);
  return fs.existsSync(target) && fs.statSync(target).isDirectory();
}

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function isF1VerificationConfigured() {
  if (!exists("scripts/verify-f1.mjs")) {
    return false;
  }
  try {
    const rootPackage = JSON.parse(read("package.json"));
    return rootPackage.scripts?.["verify:f1"] === "node scripts/verify-f1.mjs";
  } catch {
    return false;
  }
}

function walk(directory, files = []) {
  if (!fs.existsSync(directory)) {
    return files;
  }

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && ignoredDirectoryNames.has(entry.name)) {
      continue;
    }

    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      walk(absolute, files);
    } else if (entry.isFile()) {
      files.push(absolute);
    }
  }

  return files;
}

function readableTextFiles() {
  return walk(root).filter((file) => {
    const stats = fs.statSync(file);
    if (stats.size > 1_000_000) {
      return false;
    }

    const sample = fs.readFileSync(file);
    return !sample.includes(0);
  });
}

function scanSecrets() {
  const privateKeyPrefix = "-----BEGIN " + "(?:RSA |EC |OPENSSH )?PRIVATE KEY-----";
  const patterns = [
    { name: "AWS access key", regex: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
    { name: "Private key", regex: new RegExp(privateKeyPrefix, "g") },
    { name: "GitHub token", regex: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}\b|\bgithub_pat_[A-Za-z0-9_]{40,}\b/g },
    { name: "Slack token", regex: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g },
    { name: "JWT", regex: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g },
    { name: "AWS secret assignment", regex: /\b(?:aws_secret_access_key|aws_session_token)\s*[:=]\s*["']?[A-Za-z0-9/+=]{20,}/gi },
    { name: "IBM token assignment", regex: /\b(?:IBM_QUANTUM_TOKEN|QISKIT_IBM_TOKEN)\s*=\s*(?!(?:replace|example|fake|test|<))[A-Za-z0-9_-]{16,}/gi },
  ];
  const findings = [];

  for (const file of readableTextFiles()) {
    const content = fs.readFileSync(file, "utf8");
    for (const pattern of patterns) {
      pattern.regex.lastIndex = 0;
      if (pattern.regex.test(content)) {
        findings.push(`${pattern.name} in ${relative(file)}`);
      }
    }
  }

  addCheck(
    "Secret scan",
    findings.length === 0,
    findings.length === 0
      ? "No common credential or private-key patterns found."
      : findings.join("; "),
  );
}

function verifyStructure() {
  if (!isDirectory(".kiro")) {
    const requiredPublicDirectories = [
      "frontend/src/engine",
      "frontend/src/components",
      "frontend/src/store",
      "backend/functions/api_handler",
      "backend/functions/quantum_harvest",
      "backend/functions/chsh_evidence",
      "backend/functions/pool_refill",
      "backend/tests",
      "docs/media/screenshots",
      "scripts",
      ".github/workflows",
    ];
    const missingPublicDirectories = requiredPublicDirectories.filter((directory) => !isDirectory(directory));
    addCheck(
      "Sanitized public structure",
      missingPublicDirectories.length === 0,
      missingPublicDirectories.length === 0 ? `${requiredPublicDirectories.length} public directories present.` : `Missing: ${missingPublicDirectories.join(", ")}`,
    );
    const requiredPublicDocs = [
      "README.md", "CONTRIBUTING.md", "SECURITY.md", "CHANGELOG.md",
      "docs/ARCHITECTURE.md", "docs/BUILT_WITH_KIRO.md", "docs/CLAIMS.md", "docs/EVIDENCE.md",
      "docs/GAMEPLAY.md", "docs/PRODUCTION_READINESS.md", "docs/QUANTUM_PROVENANCE.md",
    ];
    const missingPublicDocs = requiredPublicDocs.filter((document) => !exists(document));
    addCheck(
      "Public documentation",
      missingPublicDocs.length === 0,
      missingPublicDocs.length === 0 ? `${requiredPublicDocs.length} public documents present.` : `Missing: ${missingPublicDocs.join(", ")}`,
    );
    return;
  }

  const requiredDirectories = [
    ".kiro/steering",
    ".kiro/specs/game-engine",
    "frontend/src/engine",
    "frontend/src/components",
    "frontend/src/store",
    "frontend/src/modes",
    "backend/functions/api_handler",
    "backend/functions/quantum_harvest",
    "backend/functions/chsh_evidence",
    "backend/functions/pool_refill",
    "backend/tests",
    "docs",
    "scripts",
    ".github/workflows",
  ];
  const missing = requiredDirectories.filter((directory) => !isDirectory(directory));
  addCheck(
    "Required directories",
    missing.length === 0,
    missing.length === 0 ? `${requiredDirectories.length} directories present.` : `Missing: ${missing.join(", ")}`,
  );

  const steeringNames = [
    "product.md",
    "tech.md",
    "structure.md",
    "game-design.md",
    "quantum.md",
    "aws.md",
    "security.md",
    "evidence.md",
  ];
  const missingSteering = steeringNames.filter((name) => !exists(`.kiro/steering/${name}`));
  addCheck(
    "Steering files",
    missingSteering.length === 0,
    missingSteering.length === 0 ? "All 8 steering files present." : `Missing: ${missingSteering.join(", ")}`,
  );

  const alwaysSteering = ["product.md", "tech.md", "structure.md", "security.md"];
  const invalidAlways = alwaysSteering.filter(
    (name) => !/^---\s*\r?\ninclusion:\s*always\s*\r?\n---/m.test(read(`.kiro/steering/${name}`)),
  );
  addCheck(
    "Always-on steering front matter",
    invalidAlways.length === 0,
    invalidAlways.length === 0 ? "All required files use inclusion: always." : `Invalid: ${invalidAlways.join(", ")}`,
  );

  const specializedSteering = ["game-design.md", "quantum.md", "aws.md", "evidence.md"];
  const invalidSpecialized = specializedSteering.filter((name) => {
    const content = read(`.kiro/steering/${name}`);
    return !content.startsWith("---") || !content.includes("inclusion: fileMatch") || !content.includes("fileMatchPattern:");
  });
  addCheck(
    "Specialized steering front matter",
    invalidSpecialized.length === 0,
    invalidSpecialized.length === 0 ? "All specialized files use fileMatch inclusion." : `Invalid: ${invalidSpecialized.join(", ")}`,
  );

  const specNames = ["requirements.md", "design.md", "tasks.md"];
  const missingSpec = specNames.filter((name) => !exists(`.kiro/specs/game-engine/${name}`));
  addCheck(
    "Game-engine spec files",
    missingSpec.length === 0,
    missingSpec.length === 0 ? "requirements.md, design.md, and tasks.md present." : `Missing: ${missingSpec.join(", ")}`,
  );

  if (missingSpec.length === 0) {
    const empty = specNames.filter((name) => read(`.kiro/specs/game-engine/${name}`).trim().length < 500);
    addCheck(
      "Non-empty game-engine spec",
      empty.length === 0,
      empty.length === 0 ? "All three artifacts contain substantive content." : `Empty or too short: ${empty.join(", ")}`,
    );

    const requirements = read(".kiro/specs/game-engine/requirements.md");
    const requirementCount = requirements.match(/^### Requirement \d+:/gm)?.length ?? 0;
    const criterionCount = requirements.match(/^\d+\.\d+\s+/gm)?.length ?? 0;
    addCheck(
      "Spec requirement coverage",
      requirementCount === 26 && criterionCount >= 100,
      `${requirementCount} requirements and ${criterionCount} acceptance criteria found.`,
    );

    const tasks = read(".kiro/specs/game-engine/tasks.md");
    const uncheckedCount = tasks.match(/^- \[ \]/gm)?.length ?? 0;
    const checkedCount = tasks.match(/^- \[[xX]\]/gm)?.length ?? 0;
    const uncheckedCheckpointCount =
      tasks.match(/^- \[ \] Checkpoint [1-9]\b/gm)?.length ?? 0;
    const checkedCheckpointCount =
      tasks.match(/^- \[[xX]\] Checkpoint [1-9]\b/gm)?.length ?? 0;
    const f1Configured = isF1VerificationConfigured();
    const taskPlanOk = f1Configured
      ? uncheckedCount === 0 &&
        checkedCount === 39 &&
        uncheckedCheckpointCount === 0 &&
        checkedCheckpointCount === 9
      : uncheckedCount >= 20 &&
        uncheckedCheckpointCount === 9 &&
        checkedCount === 0;
    addCheck(
      "Spec task plan",
      taskPlanOk,
      f1Configured
        ? `${checkedCount}/39 completed items, ${checkedCheckpointCount}/9 completed checkpoints, ${uncheckedCount} pending.`
        : `${uncheckedCount} unchecked tasks, ${uncheckedCheckpointCount} checkpoints, ${checkedCount} prematurely checked.`,
    );
  }

  const requiredDocs = [
    "TASKBOARD.md",
    "ENVIRONMENT.md",
    "ARCHITECTURE.md",
    "CLAIMS.md",
    "EVIDENCE.md",
    "KIRO_WORKFLOW.md",
    "MANUAL_ACTIONS.md",
    "DECISIONS.md",
  ];
  const missingDocs = requiredDocs.filter((name) => !exists(`docs/${name}`));
  addCheck(
    "Required documentation",
    missingDocs.length === 0,
    missingDocs.length === 0 ? "All 8 required documents present." : `Missing: ${missingDocs.join(", ")}`,
  );
}

function verifyContent() {
  const files = readableTextFiles();
  const placeholderPatterns = [
    /TODO:\s*define mechanics/i,
    /TBD:\s*define mechanics/i,
    /INSERT[_ -]?SECRET/i,
    /replace this with (?:a )?real (?:token|secret|key)/i,
  ];
  const placeholderFindings = [];

  for (const file of files) {
    const content = fs.readFileSync(file, "utf8");
    if (placeholderPatterns.some((pattern) => pattern.test(content))) {
      placeholderFindings.push(relative(file));
    }
  }
  addCheck(
    "Critical placeholders",
    placeholderFindings.length === 0,
    placeholderFindings.length === 0 ? "No critical mechanics or secret placeholders found." : `Found in: ${placeholderFindings.join(", ")}`,
  );

  const claims = read("docs/CLAIMS.md").toLowerCase();
  const claimsCorrect =
    claims.includes("chsh") &&
    claims.includes("classical bound `2`") &&
    claims.includes("one-basis") &&
    claims.includes("does not establish") &&
    (claims.includes("publicly retrievable") || claims.includes("independently retrievable"));
  addCheck(
    "Scientific claims correction",
    claimsCorrect,
    claimsCorrect
      ? "CHSH bound, one-basis limitation, and Job ID access caveat documented."
      : "CLAIMS.md lacks one or more required CHSH/Job ID corrections.",
  );

  const shell = read("frontend/src/components/FoundationScreen.tsx");
  const shellCopyPresent = [
    "COLAPSO",
    "Observa antes de que el universo decida por ti.",
    "Foundation build",
  ].every((text) => shell.includes(text));
  addCheck(
    "Frontend foundation shell",
    shellCopyPresent,
    shellCopyPresent ? "Required temporary copy present." : "Required product shell copy is incomplete.",
  );
}

function verifyTooling() {
  addCheck(
    "Root lockfile",
    exists("package-lock.json"),
    exists("package-lock.json") ? "package-lock.json present." : "package-lock.json is missing; run npm install.",
  );

  let strict = false;
  try {
    const config = JSON.parse(read("frontend/tsconfig.app.json"));
    strict = config.compilerOptions?.strict === true;
  } catch {
    strict = false;
  }
  addCheck("TypeScript strict mode", strict, strict ? "strict: true confirmed." : "frontend/tsconfig.app.json is invalid or not strict.");

  let scriptsOk = false;
  let scriptDetail = "Unable to parse package manifests.";
  let exactVersions = false;
  try {
    const rootPackage = JSON.parse(read("package.json"));
    const frontendPackage = JSON.parse(read("frontend/package.json"));
    const requiredRootScripts = ["lint", "test", "build", "verify:step0", "scan:secrets"];
    const requiredFrontendScripts = ["lint", "test", "build", "test:engine"];
    const missingRoot = requiredRootScripts.filter((name) => typeof rootPackage.scripts?.[name] !== "string");
    const missingFrontend = requiredFrontendScripts.filter((name) => typeof frontendPackage.scripts?.[name] !== "string");
    scriptsOk = missingRoot.length === 0 && missingFrontend.length === 0;
    scriptDetail = scriptsOk
      ? "Root and frontend lint/test/build/verification scripts present."
      : `Missing root: ${missingRoot.join(", ") || "none"}; frontend: ${missingFrontend.join(", ") || "none"}.`;

    const versions = [
      ...Object.values(frontendPackage.dependencies ?? {}),
      ...Object.values(frontendPackage.devDependencies ?? {}),
    ];
    exactVersions = versions.length > 0 && versions.every((value) => /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(value));
  } catch {
    scriptsOk = false;
  }
  addCheck("Package scripts", scriptsOk, scriptDetail);
  addCheck(
    "Exact frontend dependency versions",
    exactVersions,
    exactVersions ? "All direct frontend dependencies are exact versions." : "An unpinned frontend dependency was found.",
  );
}

function verifyScope() {
  const engineDirectory = path.join(root, "frontend", "src", "engine");
  const engineFiles = walk(engineDirectory).map(relative).filter((file) => !file.endsWith("/.gitkeep"));
  const f1Configured = isF1VerificationConfigured();
  const publicApiPath = "frontend/src/engine/index.ts";
  const requiredPublicApiNames = [
    "V1_RULE_CONFIG",
    "generateInitialState",
    "processAction",
    "calculateScore",
    "serializeGameState",
    "deserializeGameState",
    "replayGame",
  ];
  const publicApiOk =
    exists(publicApiPath) &&
    requiredPublicApiNames.every((name) => read(publicApiPath).includes(name));
  const engineScopeOk = f1Configured
    ? engineFiles.length > 0 &&
      engineFiles.every((file) => file.endsWith(".ts")) &&
      publicApiOk
    : engineFiles.length === 0;
  addCheck(
    f1Configured ? "F1 game-engine implementation" : "No game-engine implementation",
    engineScopeOk,
    f1Configured
      ? engineScopeOk
        ? `${engineFiles.length} TypeScript engine files confined to frontend/src/engine with the required public API.`
        : "F1 engine files must be TypeScript under frontend/src/engine and expose the required public API."
      : engineFiles.length === 0
        ? "Engine directory contains only .gitkeep."
        : `Unexpected engine files: ${engineFiles.join(", ")}`,
  );

  const backendFunctionDirectory = path.join(root, "backend", "functions");
  const backendCode = walk(backendFunctionDirectory)
    .map(relative)
    .filter((file) => !file.endsWith("/.gitkeep"));
  addCheck(
    "No functional backend",
    backendCode.length === 0,
    backendCode.length === 0 ? "Reserved function directories contain no implementation." : `Unexpected backend code: ${backendCode.join(", ")}`,
  );

  const deployableCandidates = [
    "backend/template.yaml",
    "backend/template.yml",
    "template.yaml",
    "template.yml",
    "samconfig.toml",
    "infrastructure",
  ].filter(exists);
  addCheck(
    "No deployable infrastructure",
    deployableCandidates.length === 0,
    deployableCandidates.length === 0 ? "No SAM template, samconfig, or infrastructure directory present." : `Unexpected: ${deployableCandidates.join(", ")}`,
  );

  const frontendSourceFiles = walk(path.join(root, "frontend", "src"));
  const networkUsage = [];
  for (const file of frontendSourceFiles) {
    if (!/\.(?:ts|tsx|js|jsx)$/.test(file)) {
      continue;
    }
    const content = fs.readFileSync(file, "utf8");
    if (/\bfetch\s*\(|\bXMLHttpRequest\b|\bWebSocket\b|\baxios\b/.test(content)) {
      networkUsage.push(relative(file));
    }
  }
  addCheck(
    "No frontend network calls",
    networkUsage.length === 0,
    networkUsage.length === 0 ? "Frontend source contains no network client usage." : `Found in: ${networkUsage.join(", ")}`,
  );
}

function printReport() {
  const failures = checks.filter((check) => !check.ok);
  console.log("COLAPSO Step 0 verification");
  console.log("=".repeat(36));
  for (const check of checks) {
    console.log(`${check.ok ? "PASS" : "FAIL"}  ${check.label}: ${check.detail}`);
  }
  console.log("-".repeat(36));
  if (failures.length === 0) {
    console.log(`STEP 0 VERIFICATION: PASS (${checks.length}/${checks.length} checks)`);
    return 0;
  }
  console.error(`STEP 0 VERIFICATION: FAIL (${failures.length} of ${checks.length} checks failed)`);
  return 1;
}

scanSecrets();

if (!secretsOnly) {
  verifyStructure();
  verifyContent();
  verifyTooling();
  verifyScope();
}

process.exitCode = printReport();
