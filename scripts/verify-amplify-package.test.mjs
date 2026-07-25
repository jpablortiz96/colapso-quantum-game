import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { latestRelease, parseZipEntries, textEntries } from "./amplify-package-utils.mjs";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptDirectory, "..");
const deploymentDirectory = path.join(root, "deployment", "aws-amplify");
const release = latestRelease(path.join(deploymentDirectory, "releases"));
const entries = parseZipEntries(release.path);
const names = [...entries.keys()];
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

test("1. ZIP contains only deployable artifact structure", () => {
  assert.ok(names.includes("manifest.webmanifest"));
  assert.ok(names.includes("assets/colapso/backgrounds/hero_quantum_bg.webp"));
  assert.ok(!names.some((name) => /(^|\/)(?:node_modules|src|tests?)(?:\/|$)/u.test(name)));
});

test("2. index.html is at ZIP root without dist wrapper", () => {
  assert.ok(names.includes("index.html"));
  assert.ok(!names.some((name) => name.startsWith("dist/")));
});

test("3. ZIP contains no public sourcemaps", () => {
  assert.equal(names.filter((name) => name.endsWith(".map")).length, 0);
  assert.doesNotMatch(textEntries(entries), /sourceMappingURL/iu);
});

test("4. ZIP contains no localhost reference", () => {
  assert.doesNotMatch(textEntries(entries), /localhost|127\.0\.0\.1/iu);
});

test("5. SPA rule is a 200 rewrite excluding required extensions", () => {
  const rules = JSON.parse(read("deployment/aws-amplify/spa-rule.json"));
  assert.equal(rules.length, 1);
  assert.deepEqual({ target: rules[0].target, status: rules[0].status }, { target: "/index.html", status: "200" });
  for (const extension of ["css", "gif", "ico", "jpg", "jpeg", "js", "png", "txt", "svg", "woff", "woff2", "ttf", "map", "json", "webp", "webmanifest"]) assert.ok(rules[0].source.includes(extension));
});

test("6. custom headers declare security and cache policies", () => {
  const headers = read("deployment/aws-amplify/custom-headers.yml");
  for (const name of ["Strict-Transport-Security", "X-Content-Type-Options", "X-Frame-Options", "Referrer-Policy", "Permissions-Policy", "Content-Security-Policy"]) assert.ok(headers.includes(name));
  assert.ok(headers.includes("max-age=31536000, immutable"));
  assert.ok(headers.includes("no-cache, no-store, must-revalidate"));
});

test("7. CSP supports actual local runtime resources without external origins", () => {
  const headers = read("deployment/aws-amplify/custom-headers.yml");
  assert.ok(headers.includes("style-src 'self' 'unsafe-inline'"));
  assert.ok(headers.includes("img-src 'self' data: blob:"));
  assert.ok(headers.includes("media-src 'self' data: blob:"));
  assert.ok(headers.includes("connect-src 'self'"));
  assert.doesNotMatch(headers, /unsafe-eval|https?:\/\//u);
});

test("8. local deployment state and releases are ignored", () => {
  const gitignore = read(".gitignore");
  assert.ok(gitignore.includes("deployment/aws-amplify/.deployment-state.json"));
  assert.ok(gitignore.includes("deployment/aws-amplify/releases/"));
  assert.ok(gitignore.includes("deployment/aws-amplify/.staging/"));
});

test("9. release ZIP has a matching SHA-256 sidecar", () => {
  const expected = fs.readFileSync(release.path.replace(/\.zip$/u, ".sha256"), "utf8").trim().split(/\s+/u)[0];
  const actual = crypto.createHash("sha256").update(fs.readFileSync(release.path)).digest("hex");
  assert.equal(actual, expected);
});

test("10. deployment script is idempotent and non-destructive", () => {
  const script = read("deployment/aws-amplify/deploy-amplify.ps1");
  assert.ok(script.includes("length(apps[?name=='$AppName'])"));
  assert.ok(script.includes("Reused Amplify app"));
  assert.ok(script.includes("Reused Amplify branch"));
  assert.doesNotMatch(script, /amplify["'\s,]+(?:delete-app|delete-branch|delete-job)/iu);
});

test("11. canonical build uses the real process-scoped public URL", () => {
  const script = read("deployment/aws-amplify/deploy-amplify.ps1");
  const packageScript = read("deployment/aws-amplify/package-amplify.ps1");
  assert.ok(script.includes("$env:VITE_PUBLIC_SITE_URL = $PublicSiteUrl"));
  assert.ok(script.includes("-PublicSiteUrl $PublicSiteUrl"));
  assert.ok(packageScript.includes("canonical URL in the package does not match PublicSiteUrl"));
});

test("12. post-deployment verifier covers delivery and policy", () => {
  const verifier = read("deployment/aws-amplify/verify-deployment.ps1");
  for (const marker of ["HTTPS URL", "Professional title", "SPA rewrite routing", "Security headers", "Hashed asset cache policy", "Product HTTP smoke", "No public sourcemaps"]) assert.ok(verifier.includes(marker));
});
