import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const directory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(directory, "..");
const checks = [];

function addCheck(label, ok, detail) {
  checks.push({ label, ok, detail });
}

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function exists(relativePath) {
  return fs.existsSync(path.join(root, relativePath));
}

function toRelative(absolutePath) {
  return path.relative(root, absolutePath).split(path.sep).join("/");
}

function isSourceFile(relativePath) {
  return /\.(?:ts|tsx|js|jsx)$/u.test(relativePath);
}

function resolveRelativeImport(fromRelativePath, specifier) {
  const base = path.resolve(root, path.dirname(fromRelativePath), specifier);
  const candidates = path.extname(base).length > 0
    ? [base]
    : [
      base,
      `${base}.ts`,
      `${base}.tsx`,
      `${base}.js`,
      `${base}.jsx`,
      path.join(base, "index.ts"),
      path.join(base, "index.tsx"),
    ];
  const target = candidates.find((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile());
  return target === undefined ? null : toRelative(target);
}

function importsFromSource(source) {
  const specifiers = new Set();
  const fromPattern = /\b(?:import|export)(?:\s+type)?[\s\S]*?\s+from\s+["']([^"']+)["']/gu;
  const sideEffectPattern = /^\s*import\s+["']([^"']+)["']/gmu;
  for (const match of source.matchAll(fromPattern)) specifiers.add(match[1]);
  for (const match of source.matchAll(sideEffectPattern)) specifiers.add(match[1]);
  return [...specifiers].filter((specifier) => typeof specifier === "string");
}

function browserImportGraph() {
  const pending = ["frontend/src/main.tsx"];
  const visited = new Set();
  const nodeImports = [];

  while (pending.length > 0) {
    const current = pending.pop();
    if (current === undefined || visited.has(current) || !exists(current)) continue;
    visited.add(current);
    for (const specifier of importsFromSource(read(current))) {
      if (specifier.startsWith("node:")) {
        nodeImports.push(`${current} → ${specifier}`);
      } else if (specifier.startsWith(".")) {
        const resolved = resolveRelativeImport(current, specifier);
        if (resolved !== null && isSourceFile(resolved)) pending.push(resolved);
      }
    }
  }

  return { nodeImports, visited };
}

function verifySpec() {
  const base = ".kiro/specs/frontend-daily-game";
  const required = ["requirements.md", "design.md", "tasks.md"];
  const privateSpecPresent = exists(".kiro");
  if (!privateSpecPresent) {
    const publicRecords = ["README.md", "docs/ARCHITECTURE.md", "docs/GAMEPLAY.md"];
    const missing = publicRecords.filter((name) => !exists(name));
    addCheck(
      "F4A design record",
      missing.length === 0,
      missing.length === 0
        ? "Published overview, architecture, and gameplay records are present."
        : `Missing: ${missing.join(", ")}`,
    );
    return;
  }
  const missing = required.filter((name) => !exists(path.join(base, name)));
  if (missing.length > 0) {
    addCheck("Compact complete F4A spec", false, `Missing: ${missing.join(", ")}`);
    return;
  }
  const requirements = read(path.join(base, "requirements.md"));
  const tasks = read(path.join(base, "tasks.md"));
  const requirementCount = requirements.match(/^### Requirement /gm)?.length ?? 0;
  const criterionCount = requirements.match(/^\d+\.\d+\s+/gm)?.length ?? 0;
  const taskCount = tasks.match(/^- \[[xX ]\]/gm)?.length ?? 0;
  const unchecked = tasks.match(/^- \[ \]/gm)?.length ?? 0;
  const checkpoints = tasks.match(/Checkpoint /g)?.length ?? 0;
  const valid = requirementCount <= 10 && criterionCount <= 40 && taskCount <= 10 && unchecked === 0 && checkpoints <= 2;
  addCheck("Compact complete F4A spec", valid, `${requirementCount} requirements, ${criterionCount} criteria, ${taskCount} tasks, ${unchecked} pending, ${checkpoints} checkpoints.`);
}

function verifyUniverseSync() {
  const source = path.join(root, "frontend/public/data/universes/2026-07-22.json");
  const target = path.join(root, "frontend/src/daily-game/published-universe.json");
  const byteIdentical = fs.existsSync(source) && fs.existsSync(target) && fs.readFileSync(source).equals(fs.readFileSync(target));
  addCheck("F3 source artifact synchronization", byteIdentical, byteIdentical ? "The Vite source JSON exactly matches the published F3 artifact." : "The generated source JSON is missing or stale.");
}

function verifyPublicApiBoundary() {
  const files = [
    "frontend/src/daily-game/universe.ts",
    "frontend/src/store/daily-game-store.ts",
    "frontend/src/components/DailyGame.tsx",
    "frontend/src/daily-universe/client.ts",
  ];
  const missing = files.filter((file) => !exists(file));
  const source = missing.length === 0 ? files.map(read).join("\n") : "";
  const usesPublicBarrels = source.includes('from "../engine"') && source.includes('from "../daily-universe/client"');
  const privateEngineImport = /from\s+["'][^"']*engine\/(?!index)[^"']*["']/u.test(source);
  const privateUniverseImport = /from\s+["'][^"']*daily-universe\/(?!client(?:["']|\/))[^"']*["']/u.test(source);
  const valid = missing.length === 0 && usesPublicBarrels && !privateEngineImport && !privateUniverseImport;
  addCheck("Public F1/F3 API boundary", valid, missing.length > 0 ? `Missing: ${missing.join(", ")}` : valid ? "F4A imports F1 and the browser-safe F3 public barrel only." : "Private F1/F3 import or missing public-barrel import found.");
}

function verifyBrowserCompatibility() {
  const { nodeImports, visited } = browserImportGraph();
  const clientEntryReached = visited.has("frontend/src/daily-universe/client.ts");
  const valid = clientEntryReached && nodeImports.length === 0;
  addCheck("Browser client has no node:* imports", valid, valid ? `${visited.size} client modules reachable from main.tsx without node:* imports.` : nodeImports.length > 0 ? nodeImports.join("; ") : "The browser-safe F3 client entry is not reachable from main.tsx.");
}

function verifyLocalBoundary() {
  const files = [
    "frontend/src/App.tsx",
    "frontend/src/components/DailyGame.tsx",
    "frontend/src/daily-game/universe.ts",
    "frontend/src/store/daily-game-store.ts",
  ];
  const source = files.filter(exists).map(read).join("\n");
  const forbidden = /\bfetch\s*\(|\bXMLHttpRequest\b|\bWebSocket\b|\baxios\b|Math\.random\s*\(|https?:\/\//u;
  addCheck("Local deterministic frontend boundary", files.every(exists) && !forbidden.test(source), !forbidden.test(source) ? "No frontend network client, URL, or ambient randomness in F4A source." : "Forbidden network or ambient-randomness marker found in F4A source.");
}

function verifyIntegration() {
  const app = exists("frontend/src/App.tsx") ? read("frontend/src/App.tsx") : "";
  const component = exists("frontend/src/components/DailyGame.tsx") ? read("frontend/src/components/DailyGame.tsx") : "";
  const packageJson = exists("package.json") ? JSON.parse(read("package.json")) : {};
  const valid = app.includes("DailyGame") && component.includes("COMENZAR A JUGAR") && component.includes('openPanel("MODES")') && component.includes("Procedencia cuántica") && packageJson.scripts?.["verify:f4a"] === "node scripts/verify-f4a.mjs";
  addCheck("Playable entry and verification wiring", valid, valid ? "The daily game entry, explicit Spanish mode-selection flow, provenance panel, and root verifier script are configured." : "F4A entry UI or verify:f4a script is incomplete.");
}

function verifyPremiumOnboarding() {
  const files = [
    "frontend/src/components/DailyGame.tsx",
    "frontend/src/components/PremiumTour.tsx",
    "frontend/src/components/game-sound.ts",
    "frontend/src/store/daily-game-store.ts",
  ];
  const frontendPackage = exists("frontend/package.json") ? JSON.parse(read("frontend/package.json")) : {};
  const source = files.filter(exists).map(read).join("\n");
  const hasPinnedDependencies = frontendPackage.dependencies?.["driver.js"] === "1.8.0"
    && frontendPackage.dependencies?.howler === "2.2.4"
    && frontendPackage.dependencies?.["framer-motion"] === "12.42.2";
  const valid = files.every(exists)
    && source.includes('from "driver.js"')
    && source.includes('from "howler"')
    && source.includes("smoothScroll")
    && source.includes("data-tour")
    && source.includes("toggleSound")
    && hasPinnedDependencies;
  addCheck("Premium local onboarding presentation", valid, valid ? "Driver.js tour, local Howler tones, Framer motion, contextual controls, and exact dependencies are wired without changing F1/F3." : "Premium tour, audio, motion, controls, or exact dependency wiring is incomplete.");
}

function report() {
  const failures = checks.filter((check) => !check.ok);
  console.log("COLAPSO F4A verification");
  console.log("=".repeat(36));
  for (const check of checks) console.log(`${check.ok ? "PASS" : "FAIL"}  ${check.label}: ${check.detail}`);
  console.log("-".repeat(36));
  console.log(`F4A VERIFICATION: ${failures.length === 0 ? "PASS" : "FAIL"} (${checks.length - failures.length}/${checks.length} checks)`);
  return failures.length === 0 ? 0 : 1;
}

verifySpec();
verifyUniverseSync();
verifyPublicApiBoundary();
verifyBrowserCompatibility();
verifyLocalBoundary();
verifyIntegration();
verifyPremiumOnboarding();
process.exitCode = report();
