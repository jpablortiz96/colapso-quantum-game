import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, isAbsolute, join, normalize, relative, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const requireFreshHistory = process.argv.includes("--require-fresh-history");
const exactInternalFiles = new Set([
  "AGENTS.md",
  "docs/DECISIONS.md",
  "docs/ENVIRONMENT.md",
  "docs/F1_EXECUTION_LOG.md",
  "docs/KIRO_WORKFLOW.md",
  "docs/MANUAL_ACTIONS.md",
  "docs/TASKBOARD.md",
]);
const expectedPrivateInternalFiles = new Set([
  ".kiro/specs/daily-universe/design.md",
  ".kiro/specs/daily-universe/requirements.md",
  ".kiro/specs/daily-universe/tasks.md",
  ".kiro/specs/frontend-daily-game/design.md",
  ".kiro/specs/frontend-daily-game/requirements.md",
  ".kiro/specs/frontend-daily-game/tasks.md",
  ".kiro/specs/game-engine/design.md",
  ".kiro/specs/game-engine/requirements.md",
  ".kiro/specs/game-engine/tasks.md",
  ".kiro/specs/quantum-service/design.md",
  ".kiro/specs/quantum-service/requirements.md",
  ".kiro/specs/quantum-service/tasks.md",
  ".kiro/steering/aws.md",
  ".kiro/steering/evidence.md",
  ".kiro/steering/game-design.md",
  ".kiro/steering/product.md",
  ".kiro/steering/quantum.md",
  ".kiro/steering/security.md",
  ".kiro/steering/structure.md",
  ".kiro/steering/tech.md",
  ...exactInternalFiles,
]);
const requiredFiles = [
  "README.md", "LICENSE", "CHANGELOG.md", "CONTRIBUTING.md", "SECURITY.md",
  "docs/ARCHITECTURE.md", "docs/BUILT_WITH_KIRO.md", "docs/CLAIMS.md", "docs/EVIDENCE.md",
  "docs/GAMEPLAY.md", "docs/PRODUCTION_READINESS.md", "docs/QUANTUM_PROVENANCE.md",
  "docs/media/readme-hero.svg", "docs/media/system-architecture.svg",
  "docs/media/quantum-pipeline.svg", "docs/media/kiro-engineering-workflow.svg",
  "scripts/capture-production-screenshots.mjs", "scripts/verify-public-media.mjs",
  "scripts/verify-public-repository.mjs", "scripts/build-public-mirror.ps1",
  ".github/workflows/ci.yml", ".github/ISSUE_TEMPLATE/bug_report.yml",
  ".github/ISSUE_TEMPLATE/feature_request.yml", ".github/ISSUE_TEMPLATE/config.yml",
  ".github/PULL_REQUEST_TEMPLATE.md",
];
const textExtensions = new Set(["", ".cjs", ".css", ".html", ".js", ".json", ".jsx", ".md", ".mjs", ".ps1", ".py", ".toml", ".ts", ".tsx", ".txt", ".webmanifest", ".yml", ".yaml"]);
const generatedPathPatterns = [
  /(^|\/)node_modules\//,
  /(^|\/)dist\//,
  /(^|\/)coverage\//,
  /(^|\/)(?:__pycache__|\.pytest_cache|\.ruff_cache|\.venv|venv)\//,
  /^deployment\/aws-amplify\/(?:\.deployment-state\.json|\.staging\/|releases\/)/,
  /(?:^|\/)coverage\.json$/,
  /(?:^|\/)\.coverage$/,
  /\.map$/,
  /\.zip$/i,
];
const excludedReferenceNames = [...exactInternalFiles].map((path) => path.split("/").at(-1));

let checks = 0;
const failures = [];

function check(condition, label, detail = "") {
  checks += 1;
  if (condition) console.log(`PASS  ${label}${detail ? `: ${detail}` : ""}`);
  else {
    const message = `${label}${detail ? `: ${detail}` : ""}`;
    failures.push(message);
    console.error(`FAIL  ${message}`);
  }
}

function git(args, options = {}) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], ...options }).trim();
}

function isInternal(path) {
  return path.startsWith(".kiro/") || exactInternalFiles.has(path);
}

function isText(path) {
  return textExtensions.has(extname(path).toLowerCase());
}

function markdownTargets(source) {
  const targets = [];
  const markdown = /!?\[[^\]]*\]\(([^)\s]+)(?:\s+["'][^"']*["'])?\)/g;
  const html = /<(?:a|img)\b[^>]*(?:href|src)=["']([^"']+)["']/gi;
  for (const match of source.matchAll(markdown)) targets.push(match[1]);
  for (const match of source.matchAll(html)) targets.push(match[1]);
  return targets;
}

let tracked = [];
try {
  tracked = git(["ls-files", "-z", "--cached", "--others", "--exclude-standard"], { encoding: "utf8" }).split("\0").filter(Boolean).map((path) => path.replaceAll("\\", "/"));
  check(tracked.length > 0, "Git public-candidate inventory is available", `${tracked.length} files`);
} catch (error) {
  check(false, "Git tracked-file inventory is available", error.message);
}

const internal = tracked.filter(isInternal).sort();
const publicFiles = tracked.filter((path) => !isInternal(path)).sort();
if (internal.length > 0) {
  const exact = internal.length === expectedPrivateInternalFiles.size && internal.every((path) => expectedPrivateInternalFiles.has(path));
  check(exact, "Private source tree has only the approved internal exclusion set", `${internal.length}/${expectedPrivateInternalFiles.size}`);
} else {
  check(true, "Public tree contains no internal artifacts");
}

for (const path of requiredFiles) check(publicFiles.includes(path), `Required public file is tracked`, path);

const generated = publicFiles.filter((path) => generatedPathPatterns.some((pattern) => pattern.test(path)) || (/^\.env(?:\.|$)/.test(path) && path !== ".env.example"));
check(generated.length === 0, "No generated, local-state, archive, source-map, or environment file is tracked", generated.join(", "));

const missing = publicFiles.filter((path) => !existsSync(join(root, ...path.split("/"))));
check(missing.length === 0, "Every tracked public file exists in the working tree", missing.join(", "));

const textFiles = publicFiles.filter(isText).filter((path) => existsSync(join(root, ...path.split("/"))) && statSync(join(root, ...path.split("/"))).size <= 5_000_000);
const privacyFindings = [];
const excludedReferences = [];
const brokenLinks = [];
const emailPattern = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const secretPatterns = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\b(?:ghp_|github_pat_)[A-Za-z0-9_]{20,}/,
  /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/,
  /X-Amz-(?:Credential|Signature)=/i,
];

for (const path of textFiles) {
  const absolute = join(root, ...path.split("/"));
  const source = readFileSync(absolute, "utf8");
  if (/C:\\Users\\|[A-Za-z]:\\qorchestra(?:\\|$)|file:\/\/\/|\/(?:Users|home)\/[A-Za-z0-9._-]+\//i.test(source)) privacyFindings.push(`${path}: workstation path`);
  const emails = source.match(emailPattern) ?? [];
  for (const email of emails) {
    if (!email.endsWith("@users.noreply.github.com")) privacyFindings.push(`${path}: email-shaped value`);
  }
  if (/git@(?:github|gitlab|bitbucket)|ssh:\/\//i.test(source)) privacyFindings.push(`${path}: private Git URL`);
  if (secretPatterns.some((pattern) => pattern.test(source))) privacyFindings.push(`${path}: credential-shaped value`);
  if (!new Set(["scripts/build-public-mirror.ps1", "scripts/verify-public-repository.mjs", "scripts/verify-step0.mjs"]).has(path)) {
    for (const name of excludedReferenceNames) {
      if (source.includes(name)) excludedReferences.push(`${path} -> ${name}`);
    }
  }
  if (extname(path).toLowerCase() !== ".md") continue;
  for (const target of markdownTargets(source)) {
    if (/^(?:https?:|mailto:|#)/i.test(target)) continue;
    const clean = decodeURIComponent(target.split("#", 1)[0].split("?", 1)[0]);
    if (!clean) continue;
    const resolved = normalize(resolve(dirname(absolute), clean));
    const inside = relative(root, resolved);
    if (inside.startsWith("..") || isAbsolute(inside) || !existsSync(resolved)) brokenLinks.push(`${path} -> ${target}`);
  }
}

check(privacyFindings.length === 0, "Public candidate contains no personal path, email, private remote, or credential value", privacyFindings.join("; "));
check(excludedReferences.length === 0, "Public candidate does not reference excluded internal documents", excludedReferences.join("; "));
check(brokenLinks.length === 0, "Relative Markdown links and images resolve", brokenLinks.join("; "));

const readme = readFileSync(join(root, "README.md"), "utf8");
for (const required of [
  "https://production.d333fud52cy2ho.amplifyapp.com",
  "docs/media/readme-hero.svg",
  "docs/QUANTUM_PROVENANCE.md",
  "docs/BUILT_WITH_KIRO.md",
  "STATISTICALLY_SUPPORTED_ABOVE_CLASSICAL_LIMIT",
  "no anti-cheat",
  "single-basis correlation",
]) check(readme.toLowerCase().includes(required.toLowerCase()), "README includes required public narrative", required);

const license = readFileSync(join(root, "LICENSE"), "utf8");
check(/MIT License/.test(license) && /Copyright \(c\) 2026 COLAPSO contributors/.test(license), "MIT license is present and unchanged");

const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
check(typeof packageJson.scripts?.["verify:public-repo"] === "string", "Package exposes verify:public-repo");
check(typeof packageJson.scripts?.["verify:media"] === "string", "Package exposes verify:media");
check(packageJson.engines?.node === ">=22.0.0", "Node engine floor remains explicit", packageJson.engines?.node);

const workflow = readFileSync(join(root, ".github", "workflows", "ci.yml"), "utf8");
for (const required of ["contents: read", "branches: [main]", "concurrency:", "npm run verify:public-repo", "npm run verify:amplify-package", "npm run verify:production"]) {
  check(workflow.includes(required), "CI contains required gate", required);
}
check(!/aws-actions|configure-aws-credentials|amplify deploy/i.test(workflow), "CI cannot deploy to AWS");

if (requireFreshHistory) {
  let count = "";
  let branch = "";
  let subject = "";
  let identities = [];
  let status = "dirty";
  try {
    count = git(["rev-list", "--count", "HEAD"]);
    branch = git(["branch", "--show-current"]);
    subject = git(["log", "-1", "--pretty=%s"]);
    identities = git(["log", "--format=%an%x00%ae%x00%cn%x00%ce"]).split("\0").filter(Boolean);
    status = git(["status", "--porcelain"]);
  } catch (error) {
    failures.push(`Fresh-history inspection failed: ${error.message}`);
  }
  check(count === "1", "Public history contains exactly one commit", count);
  check(branch === "main", "Public default branch candidate is main", branch);
  check(subject === "feat: release COLAPSO quantum game", "Public root commit message is exact", subject);
  check(identities.length === 4 && identities[0] === "jpablortiz96" && identities[2] === "jpablortiz96" && identities[1] === "75102646+jpablortiz96@users.noreply.github.com" && identities[3] === identities[1], "Public commit uses the GitHub noreply identity");
  check(status === "", "Public mirror working tree is clean", status);
  check(internal.length === 0, "Fresh public history contains no internal tracked artifact");
}

if (failures.length > 0) {
  console.error(`\nPublic repository verification failed (${failures.length}/${checks} checks).`);
  process.exitCode = 1;
} else {
  console.log(`\nPublic repository verification passed (${checks}/${checks} checks).`);
}
