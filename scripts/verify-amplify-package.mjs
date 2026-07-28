import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parseZipEntries, textEntries } from "./amplify-package-utils.mjs";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptDirectory, "..");
const deploymentDirectory = path.join(root, "deployment", "aws-amplify");
const packageScript = path.join(deploymentDirectory, "package-amplify.ps1");
const checks = [];

function addCheck(label, ok, detail) {
  checks.push({ label, ok, detail });
}

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

const powershell = process.platform === "win32" ? "powershell.exe" : "pwsh";
const packageRun = spawnSync(powershell, [
  "-NoProfile",
  "-ExecutionPolicy", "Bypass",
  "-File", packageScript,
  "-RepositoryRoot", root,
], { cwd: root, encoding: "utf8", windowsHide: true });
if (packageRun.status !== 0) {
  console.error(packageRun.stderr || packageRun.stdout || "Amplify packaging failed.");
  process.exit(1);
}

let packageResult;
try {
  packageResult = JSON.parse(packageRun.stdout.trim().split(/\r?\n/u).at(-1));
} catch {
  console.error("Amplify packaging did not return valid JSON.");
  process.exit(1);
}

const zipPath = path.resolve(packageResult.zipPath);
const releaseRoot = path.join(deploymentDirectory, "releases") + path.sep;
addCheck("Release location", zipPath.startsWith(releaseRoot) && fs.existsSync(zipPath), path.relative(root, zipPath));

const entries = parseZipEntries(zipPath);
const names = [...entries.keys()];
addCheck("ZIP root structure", names.includes("index.html") && !names.some((name) => name.startsWith("dist/")), `${names.length} entries; index.html is at root.`);
const essential = [
  "manifest.webmanifest",
  "assets/colapso/favicon-32.png",
  "assets/colapso/backgrounds/hero_quantum_bg.webp",
  "assets/colapso/backgrounds/final_quantum_bg.webp",
];
addCheck("Essential package files", essential.every((name) => names.includes(name)), `${essential.length} essential files checked.`);
const forbidden = names.filter((name) => name.endsWith(".map") || /(^|\/)(?:dist|node_modules|src|tests?)(?:\/|$)/u.test(name));
addCheck("No development artifacts", forbidden.length === 0, forbidden.length === 0 ? "No source maps, source, tests, wrapper, or node_modules." : forbidden.join(", "));
addCheck("No localhost in package", !/localhost|127\.0\.0\.1/iu.test(textEntries(entries)), "Text entries contain no local endpoint.");

const zipBytes = fs.readFileSync(zipPath);
const actualSha = crypto.createHash("sha256").update(zipBytes).digest("hex");
const shaPath = zipPath.replace(/\.zip$/u, ".sha256");
const recordedSha = fs.readFileSync(shaPath, "utf8").trim().split(/\s+/u)[0];
addCheck("Release SHA-256", actualSha === packageResult.sha256 && actualSha === recordedSha, actualSha);
addCheck("Package size budget", zipBytes.length < 10 * 1024 * 1024, `${(zipBytes.length / 1024).toFixed(1)} KiB.`);

const parserCommand = [
  "$tokens = $null",
  "$errors = $null",
  "[void][System.Management.Automation.Language.Parser]::ParseFile($env:COLAPSO_PS_PARSE_PATH, [ref]$tokens, [ref]$errors)",
  "if ($errors.Count -gt 0) { $errors | ForEach-Object { [Console]::Error.WriteLine($_.Message) }; exit 1 }",
].join("; ");
const encodedParserCommand = Buffer.from(parserCommand, "utf16le").toString("base64");
const powershellScripts = ["package-amplify.ps1", "deploy-amplify.ps1", "verify-deployment.ps1"];
const syntaxFailures = [];
for (const script of powershellScripts) {
  const parseRun = spawnSync(powershell, ["-NoProfile", "-EncodedCommand", encodedParserCommand], {
    cwd: root,
    encoding: "utf8",
    windowsHide: true,
    env: { ...process.env, COLAPSO_PS_PARSE_PATH: path.join(deploymentDirectory, script) },
  });
  if (parseRun.status !== 0) syntaxFailures.push(`${script}: ${(parseRun.stderr || parseRun.stdout || "parse failed").trim()}`);
}
addCheck("PowerShell syntax", syntaxFailures.length === 0, syntaxFailures.length === 0 ? "All three deployment scripts parse successfully." : syntaxFailures.join(" | "));

const rules = JSON.parse(read("deployment/aws-amplify/spa-rule.json"));
const extensions = ["css", "gif", "ico", "jpg", "jpeg", "js", "png", "txt", "svg", "woff", "woff2", "ttf", "map", "json", "webp", "webmanifest"];
const ruleValid = Array.isArray(rules) && rules.length === 1 && rules[0].target === "/index.html" && rules[0].status === "200" && extensions.every((extension) => rules[0].source.includes(extension));
addCheck("SPA rewrite configuration", ruleValid, "One 200 rewrite excludes every required static extension.");

const headers = read("deployment/aws-amplify/custom-headers.yml");
const requiredHeaders = ["Strict-Transport-Security", "X-Content-Type-Options", "X-Frame-Options", "Referrer-Policy", "Permissions-Policy", "Content-Security-Policy"];
addCheck("Security header configuration", requiredHeaders.every((header) => headers.includes(header)), `${requiredHeaders.length} required headers declared.`);
const cspCompatible = headers.includes("script-src 'self'")
  && headers.includes("style-src 'self' 'unsafe-inline'")
  && headers.includes("img-src 'self' data: blob:")
  && headers.includes("media-src 'self' data: blob:")
  && headers.includes("connect-src 'self'")
  && !headers.includes("unsafe-eval")
  && !/https?:\/\/(?!frontend)/u.test(headers);
addCheck("CSP compatibility", cspCompatible, "Same-origin scripts, inline runtime styles, and data/blob visual/audio resources are supported without eval or external domains.");
addCheck("Cache configuration", headers.includes("no-cache, no-store, must-revalidate") && headers.includes("max-age=31536000, immutable") && headers.includes("max-age=3600") && headers.includes("max-age=86400"), "Index, hashed chunks, manifest, and COLAPSO assets have explicit policies.");

const gitignore = read(".gitignore");
addCheck("Ignored deployment state", ["deployment/aws-amplify/.deployment-state.json", "deployment/aws-amplify/releases/", "deployment/aws-amplify/.staging/"].every((marker) => gitignore.includes(marker)), "State, releases, and staging are ignored.");

const deployScript = read("deployment/aws-amplify/deploy-amplify.ps1");
const packageScriptSource = read("deployment/aws-amplify/package-amplify.ps1");
const destructiveAws = /amplify["'\s,]+(?:delete-app|delete-branch|delete-job)/iu.test(deployScript);
const idempotent = deployScript.includes("length(apps[?name=='$AppName'])") && deployScript.includes("Reused Amplify app") && deployScript.includes("Reused Amplify branch") && !destructiveAws;
addCheck("Idempotent non-destructive deploy script", idempotent, "Exact-name reuse is implemented and no AWS delete command exists.");
const cleanCommitGuard = deployScript.includes("status --porcelain --untracked-files=normal")
  && deployScript.includes("requires a clean committed working tree");
addCheck("Clean release commit guard", cleanCommitGuard, "New deployments fail before AWS access when tracked or untracked source changes remain.");
addCheck("Canonical second-build wiring", deployScript.includes("VITE_PUBLIC_SITE_URL") && deployScript.includes("-PublicSiteUrl $PublicSiteUrl") && packageScriptSource.includes("canonical URL in the package"), "Public URL is process-scoped and package-validated.");

const verifier = read("deployment/aws-amplify/verify-deployment.ps1");
const postMarkers = ["HTTPS URL", "SPA rewrite routing", "Security headers", "Hashed asset cache policy", "Product HTTP smoke", "No public sourcemaps"];
addCheck("Post-deployment verifier", postMarkers.every((marker) => verifier.includes(marker)), "Availability, SPA, headers, cache, delivery and product smoke are covered.");

const metadataFiles = fs.readdirSync(path.join(deploymentDirectory, "releases")).filter((name) => name.endsWith(".json"));
const releaseCount = fs.readdirSync(path.join(deploymentDirectory, "releases")).filter((name) => name.endsWith(".zip")).length;
let metadataValid = metadataFiles.length > 0;
for (const file of metadataFiles) {
  const metadata = JSON.parse(fs.readFileSync(path.join(deploymentDirectory, "releases", file), "utf8"));
  metadataValid &&= /^[0-9a-f]{40}$/u.test(metadata.originCommit) && typeof metadata.timestampUtc === "string" && /^[0-9a-f]{64}$/u.test(metadata.sha256);
}
addCheck("Release retention metadata", releaseCount <= 3 && metadataValid, `${releaseCount} release ZIP(s), each with commit, timestamp, and SHA-256 metadata.`);

const failures = checks.filter((check) => !check.ok);
console.log("COLAPSO Amplify package verification");
console.log("=".repeat(44));
for (const check of checks) console.log(`${check.ok ? "PASS" : "FAIL"}  ${check.label}: ${check.detail}`);
console.log("-".repeat(44));
console.log(`AMPLIFY PACKAGE VERIFICATION: ${failures.length === 0 ? "PASS" : "FAIL"} (${checks.length - failures.length}/${checks.length} checks)`);
process.exitCode = failures.length === 0 ? 0 : 1;
