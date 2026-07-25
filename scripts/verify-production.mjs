import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptDirectory, "..");
const sourceOnly = process.argv.includes("--source-only");
const checks = [];
const visualAssetBaselineBytes = 18_677_985;
const allowedPublicVariables = new Set(["VITE_PUBLIC_SITE_URL"]);

function addCheck(label, ok, detail) {
  checks.push({ label, ok, detail });
}

function absolute(relativePath) {
  return path.join(root, relativePath);
}

function exists(relativePath) {
  return fs.existsSync(absolute(relativePath));
}

function read(relativePath) {
  return fs.readFileSync(absolute(relativePath), "utf8");
}

function walk(relativeDirectory) {
  const directory = absolute(relativeDirectory);
  if (!fs.existsSync(directory)) return [];
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const relativePath = path.join(relativeDirectory, entry.name);
    if (entry.isDirectory()) files.push(...walk(relativePath));
    else if (entry.isFile()) files.push(relativePath.split(path.sep).join("/"));
  }
  return files;
}

function formatBytes(bytes) {
  return `${(bytes / 1_048_576).toFixed(2)} MiB`;
}

function pngInfo(buffer) {
  if (buffer.length < 33 || buffer.toString("ascii", 1, 4) !== "PNG") return null;
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
    bitDepth: buffer[24],
    colorType: buffer[25],
  };
}

function webpInfo(buffer) {
  if (buffer.toString("ascii", 0, 4) !== "RIFF" || buffer.toString("ascii", 8, 12) !== "WEBP") return null;
  let offset = 12;
  while (offset + 8 <= buffer.length) {
    const type = buffer.toString("ascii", offset, offset + 4);
    const length = buffer.readUInt32LE(offset + 4);
    const data = offset + 8;
    if (type === "VP8X") {
      return {
        width: 1 + buffer[data + 4] + (buffer[data + 5] << 8) + (buffer[data + 6] << 16),
        height: 1 + buffer[data + 7] + (buffer[data + 8] << 8) + (buffer[data + 9] << 16),
        alpha: (buffer[data] & 16) !== 0,
      };
    }
    if (type === "VP8 ") return { width: buffer.readUInt16LE(data + 6) & 16_383, height: buffer.readUInt16LE(data + 8) & 16_383, alpha: false };
    if (type === "VP8L") {
      const packed = buffer.readUInt32LE(data + 1);
      return { width: (packed & 16_383) + 1, height: ((packed >> 14) & 16_383) + 1, alpha: true };
    }
    offset = data + length + (length & 1);
  }
  return null;
}

function paeth(left, up, upperLeft) {
  const prediction = left + up - upperLeft;
  const leftDistance = Math.abs(prediction - left);
  const upDistance = Math.abs(prediction - up);
  const upperLeftDistance = Math.abs(prediction - upperLeft);
  return leftDistance <= upDistance && leftDistance <= upperLeftDistance ? left : upDistance <= upperLeftDistance ? up : upperLeft;
}

function pngHasRealTransparency(buffer) {
  const info = pngInfo(buffer);
  if (info === null || info.bitDepth !== 8 || info.colorType !== 6) return false;
  const idat = [];
  let offset = 8;
  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    if (type === "IDAT") idat.push(buffer.subarray(offset + 8, offset + 8 + length));
    offset += length + 12;
  }
  const inflated = zlib.inflateSync(Buffer.concat(idat));
  const rowBytes = info.width * 4;
  let inputOffset = 0;
  let previous = Buffer.alloc(rowBytes);
  let hasTransparentPixel = false;
  let hasVisiblePixel = false;
  for (let row = 0; row < info.height; row += 1) {
    const filter = inflated[inputOffset];
    inputOffset += 1;
    const current = Buffer.alloc(rowBytes);
    for (let column = 0; column < rowBytes; column += 1) {
      const raw = inflated[inputOffset + column];
      const left = column >= 4 ? current[column - 4] : 0;
      const up = previous[column];
      const upperLeft = column >= 4 ? previous[column - 4] : 0;
      const predictor = filter === 1 ? left
        : filter === 2 ? up
          : filter === 3 ? Math.floor((left + up) / 2)
            : filter === 4 ? paeth(left, up, upperLeft)
              : 0;
      current[column] = (raw + predictor) & 255;
    }
    for (let alpha = 3; alpha < rowBytes; alpha += 4) {
      hasTransparentPixel ||= current[alpha] < 255;
      hasVisiblePixel ||= current[alpha] > 0;
    }
    inputOffset += rowBytes;
    previous = current;
  }
  return hasTransparentPixel && hasVisiblePixel;
}

function verifySourceMetadata() {
  const html = read("frontend/index.html");
  const title = "COLAPSO — Un universo cuántico jugable";
  const description = "Explora un universo generado a partir de evidencia de hardware cuántico real. Observa posibilidades, administra recursos y alcanza la salida.";
  const required = [
    '<html lang="es">',
    `<title>${title}</title>`,
    `content="${description}"`,
    'name="theme-color"',
    'property="og:title"',
    'name="twitter:card"',
    'rel="manifest"',
    'rel="canonical" href="%COLAPSO_PUBLIC_URL%"',
    'rel="preload" as="image" href="/assets/colapso/backgrounds/hero_quantum_bg.webp"',
  ];
  addCheck("Production metadata source", required.every((marker) => html.includes(marker)), "Spanish title, description, social metadata, optional canonical, manifest, and one hero preload are declared.");
  const preloadCount = html.match(/rel="preload"/gu)?.length ?? 0;
  addCheck("Single critical preload", preloadCount === 1, `${preloadCount} preload declaration(s).`);
}

function verifyManifestAndIdentity() {
  const manifestPath = "frontend/public/manifest.webmanifest";
  let manifest;
  try {
    manifest = JSON.parse(read(manifestPath));
  } catch {
    addCheck("Valid web manifest", false, "manifest.webmanifest is missing or invalid JSON.");
    return;
  }
  const expectedIcons = new Map([["192x192", "frontend/public/assets/colapso/icon-192.png"], ["512x512", "frontend/public/assets/colapso/icon-512.png"]]);
  const manifestValid = manifest.name?.startsWith("COLAPSO")
    && manifest.lang === "es"
    && manifest.theme_color === "#06152d"
    && Array.isArray(manifest.icons)
    && manifest.icons.length === 2;
  addCheck("Valid web manifest", manifestValid, manifestValid ? "Identity, language, colors, and two install icons are valid." : "Required manifest identity fields are missing.");

  const iconFindings = [];
  for (const [sizes, relativePath] of expectedIcons) {
    if (!exists(relativePath)) {
      iconFindings.push(`${sizes} missing`);
      continue;
    }
    const buffer = fs.readFileSync(absolute(relativePath));
    const info = pngInfo(buffer);
    const expected = Number.parseInt(sizes, 10);
    if (info?.width !== expected || info.height !== expected || !pngHasRealTransparency(buffer)) iconFindings.push(`${sizes} dimensions/alpha invalid`);
  }
  for (const [relativePath, expected] of [["frontend/public/assets/colapso/favicon-32.png", 32], ["frontend/public/assets/colapso/apple-touch-icon.png", 180]]) {
    const info = exists(relativePath) ? pngInfo(fs.readFileSync(absolute(relativePath))) : null;
    if (info?.width !== expected || info.height !== expected || !pngHasRealTransparency(fs.readFileSync(absolute(relativePath)))) iconFindings.push(`${expected}x${expected} identity icon invalid`);
  }
  addCheck("Transparent identity icons", iconFindings.length === 0, iconFindings.length === 0 ? "32, 180, 192, and 512 px PNG icons have real alpha transparency." : iconFindings.join("; "));
}

function referencedColapsoAssets(source) {
  return [...source.matchAll(/\/assets\/colapso\/[A-Za-z0-9_./-]+\.(?:png|webp)/gu)].map((match) => match[0]);
}

function verifyPublicAssets() {
  const sourceFiles = [
    "frontend/index.html",
    "frontend/src/index.css",
    "frontend/src/components/colapso-assets.ts",
  ];
  const references = new Set(sourceFiles.flatMap((file) => referencedColapsoAssets(read(file))));
  const missing = [...references].filter((url) => !exists(`frontend/public${url}`));
  addCheck("Source asset references", missing.length === 0, missing.length === 0 ? `${references.size} referenced COLAPSO assets exist.` : `Missing: ${missing.join(", ")}`);

  const assetFiles = walk("frontend/public/assets/colapso");
  const totalBytes = assetFiles.reduce((sum, file) => sum + fs.statSync(absolute(file)).size, 0);
  const oversized = assetFiles.filter((file) => fs.statSync(absolute(file)).size > 900 * 1024);
  const obsolete = assetFiles.filter((file) => /\.optimized\.|checkerboard|fx_(?:decoherence_pulse|collapse_burst)/iu.test(file));
  addCheck("Visual asset budget", totalBytes < 4 * 1_048_576 && oversized.length === 0, `${formatBytes(totalBytes)} current versus ${formatBytes(visualAssetBaselineBytes)} baseline; ${oversized.length} file(s) exceed 900 KiB.`);
  addCheck("No obsolete visual artifacts", obsolete.length === 0, obsolete.length === 0 ? "No temporary, checkerboard, or removed final-effect assets remain." : obsolete.join(", "));

  const expectedDimensions = new Map([
    ["frontend/public/assets/colapso/logo_colapso.webp", 512],
    ["frontend/public/assets/colapso/symbol_quantum_atom.webp", 256],
    ["frontend/public/assets/colapso/fx_selection_glow.webp", 256],
    ["frontend/public/assets/colapso/tile_path.webp", 256],
  ]);
  const invalidDimensions = [];
  for (const [file, expected] of expectedDimensions) {
    const info = exists(file) ? webpInfo(fs.readFileSync(absolute(file))) : null;
    if (info?.width !== expected || info.height !== expected) invalidDimensions.push(file);
  }
  addCheck("Optimized image dimensions", invalidDimensions.length === 0, invalidDimensions.length === 0 ? "Hero art remains 512 px and non-critical square art is 256 px." : invalidDimensions.join(", "));
}

function verifySourceSecurityAndPersistence() {
  const files = [
    "frontend/src/main.tsx",
    "frontend/src/App.tsx",
    "frontend/src/components/AppErrorBoundary.tsx",
    "frontend/src/components/DailyGame.tsx",
    "frontend/src/components/LazyModuleBoundary.tsx",
    "frontend/src/components/MissionControlV2.tsx",
    "frontend/src/components/OnboardingPresentation.tsx",
    "frontend/src/components/ProductionRuntime.tsx",
    "frontend/src/components/ProvenanceModal.tsx",
    "frontend/src/production/preferences.ts",
    "frontend/src/store/daily-game-store.ts",
  ];
  const source = files.map(read).join("\n");
  const forbidden = [
    ["network client", /\bfetch\s*\(|\bXMLHttpRequest\b|\bWebSocket\b|\baxios\b/u],
    ["unsafe HTML", /dangerouslySetInnerHTML/u],
    ["dynamic evaluation", /\beval\s*\(|new\s+Function\s*\(/u],
    ["localhost", /\blocalhost\b|127\.0\.0\.1/u],
  ].filter(([, pattern]) => pattern.test(source)).map(([label]) => label);
  addCheck("Frontend production security", forbidden.length === 0, forbidden.length === 0 ? "No network client, unsafe HTML, eval, or localhost in production surfaces." : `Found: ${forbidden.join(", ")}`);

  const publicVariableSource = `${source}\n${read("frontend/vite.config.ts")}`;
  const publicVariables = new Set([...publicVariableSource.matchAll(/\bVITE_[A-Z0-9_]+\b/gu)].map((match) => match[0]));
  const disallowedVariables = [...publicVariables].filter((name) => !allowedPublicVariables.has(name));
  addCheck("Public environment allowlist", disallowedVariables.length === 0, disallowedVariables.length === 0 ? `${[...publicVariables].join(", ") || "No"} public variable(s); only deployment URL is permitted.` : `Disallowed: ${disallowedVariables.join(", ")}`);

  const preferences = read("frontend/src/production/preferences.ts");
  const store = read("frontend/src/store/daily-game-store.ts");
  const persistenceMarkers = ["version", "mute", "reducedMotion", "tutorialCompleted", "lastMode", "audioConsent"];
  const forbiddenPersistedAuthority = /localStorage\.(?:setItem|getItem)[\s\S]{0,120}(?:gameState|transcript|score|resolutionPlan|commitment)/u.test(store);
  addCheck("Non-authoritative versioned preferences", persistenceMarkers.every((marker) => preferences.includes(marker)) && !forbiddenPersistedAuthority, "Only validated presentation preferences are serialized; F1 state is not persistence authority.");
}

function verifyWiring() {
  const packageJson = JSON.parse(read("package.json"));
  const vite = read("frontend/vite.config.ts");
  const docsPresent = exists("docs/PRODUCTION_READINESS.md");
  addCheck("Production verifier wiring", packageJson.scripts?.["verify:production"] === "node scripts/verify-production.mjs", "npm run verify:production points to the reproducible verifier.");
  addCheck("Production sourcemaps disabled", /sourcemap:\s*false/u.test(vite), "Vite explicitly disables public production sourcemaps.");
  addCheck("Production readiness documentation", docsPresent, docsPresent ? "docs/PRODUCTION_READINESS.md is present." : "Production readiness documentation is missing.");
}

function verifyBuiltArtifact() {
  const distRoot = "frontend/dist";
  if (!exists(`${distRoot}/index.html`)) {
    addCheck("Production build artifact", false, "frontend/dist/index.html is missing; run npm run build first.");
    return;
  }
  const files = walk(distRoot);
  const textFiles = files.filter((file) => /\.(?:css|html|js|json|webmanifest)$/u.test(file));
  const content = textFiles.map((file) => read(file)).join("\n");
  const sourceMaps = files.filter((file) => file.endsWith(".map"));
  const jsFiles = files.filter((file) => file.endsWith(".js"));
  const oversizedJs = jsFiles.filter((file) => fs.statSync(absolute(file)).size > 650 * 1024);
  const totalJs = jsFiles.reduce((sum, file) => sum + fs.statSync(absolute(file)).size, 0);
  addCheck("Production build artifact", true, `${files.length} files in frontend/dist.`);
  addCheck("No public sourcemaps", sourceMaps.length === 0, sourceMaps.length === 0 ? "No .map files are public." : sourceMaps.join(", "));
  addCheck("JavaScript bundle budget", oversizedJs.length === 0 && totalJs < 2.5 * 1_048_576, `${jsFiles.length} chunks, ${formatBytes(totalJs)} total; ${oversizedJs.length} chunk(s) exceed 650 KiB.`);
  addCheck("Built bundle has no localhost", !/\blocalhost\b|127\.0\.0\.1/u.test(content), "No localhost reference is present in the built artifact.");
  addCheck("Built bundle has no source placeholders", !content.includes("%COLAPSO_PUBLIC_URL%"), "Optional canonical placeholder was resolved or removed.");
  addCheck("Production stack details removed", !content.includes("Información técnica de desarrollo") && !content.includes("COLAPSO render failure"), "Development-only error details were tree-shaken.");

  const commonSecretPatterns = [
    /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/u,
    /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u,
    /\b(?:github_pat_|ghp_)[A-Za-z0-9_]{30,}\b/u,
    /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/u,
  ];
  addCheck("Built bundle credential scan", !commonSecretPatterns.some((pattern) => pattern.test(content)), "No common credential pattern is present in dist.");

  const builtReferences = new Set(referencedColapsoAssets(content));
  const missingReferences = [...builtReferences].filter((url) => !exists(`${distRoot}${url}`));
  const essentialBuiltFiles = [
    "manifest.webmanifest",
    "assets/colapso/icon-192.png",
    "assets/colapso/icon-512.png",
    "assets/colapso/backgrounds/hero_quantum_bg.webp",
    "assets/colapso/backgrounds/final_quantum_bg.webp",
  ].filter((file) => !exists(`${distRoot}/${file}`));
  addCheck("Built asset references", missingReferences.length === 0 && essentialBuiltFiles.length === 0, missingReferences.length === 0 && essentialBuiltFiles.length === 0 ? `${builtReferences.size} referenced COLAPSO assets and all essential files exist.` : `Missing: ${[...missingReferences, ...essentialBuiltFiles].join(", ")}`);

  const index = read(`${distRoot}/index.html`);
  const canonical = index.match(/<link rel="canonical" href="([^"]+)"/u)?.[1] ?? null;
  const canonicalValid = canonical === null || (canonical.startsWith("https://") && !/localhost|127\.0\.0\.1/u.test(canonical));
  addCheck("Safe optional canonical", canonicalValid, canonical === null ? "No deployment URL configured; canonical metadata was safely omitted." : `Canonical configured as ${canonical}.`);
}

verifySourceMetadata();
verifyManifestAndIdentity();
verifyPublicAssets();
verifySourceSecurityAndPersistence();
verifyWiring();
if (!sourceOnly) verifyBuiltArtifact();

const failures = checks.filter((check) => !check.ok);
console.log("COLAPSO production verification");
console.log("=".repeat(40));
for (const check of checks) console.log(`${check.ok ? "PASS" : "FAIL"}  ${check.label}: ${check.detail}`);
console.log("-".repeat(40));
console.log(`PRODUCTION VERIFICATION: ${failures.length === 0 ? "PASS" : "FAIL"} (${checks.length - failures.length}/${checks.length} checks)`);
process.exitCode = failures.length === 0 ? 0 : 1;
