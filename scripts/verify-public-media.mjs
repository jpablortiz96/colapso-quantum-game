import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const screenshotDirectory = join(repositoryRoot, "docs", "media", "screenshots");
const screenshots = new Map([
  ["01-hero.webp", [1440, 1100]],
  ["02-quantum-provenance.webp", [1440, 1100]],
  ["03-explorer-mode.webp", [1440, 1100]],
  ["04-decoherence-alert.webp", [1440, 1100]],
  ["05-guided-journey.webp", [1440, 1100]],
  ["06-final-result.webp", [1440, 1100]],
  ["07-mobile.webp", [390, 844]],
]);
const svgs = new Map([
  ["readme-hero.svg", [1600, 600]],
  ["system-architecture.svg", [1600, 900]],
  ["quantum-pipeline.svg", [1600, 900]],
  ["kiro-engineering-workflow.svg", [1600, 900]],
]);

let checks = 0;
const failures = [];

function check(condition, label, detail = "") {
  checks += 1;
  if (condition) {
    console.log(`PASS  ${label}${detail ? `: ${detail}` : ""}`);
  } else {
    failures.push(`${label}${detail ? `: ${detail}` : ""}`);
    console.error(`FAIL  ${label}${detail ? `: ${detail}` : ""}`);
  }
}

function webpDimensions(buffer) {
  if (buffer.length < 30 || buffer.toString("ascii", 0, 4) !== "RIFF" || buffer.toString("ascii", 8, 12) !== "WEBP") {
    throw new Error("not a RIFF WebP file");
  }
  let offset = 12;
  while (offset + 8 <= buffer.length) {
    const type = buffer.toString("ascii", offset, offset + 4);
    const length = buffer.readUInt32LE(offset + 4);
    const data = offset + 8;
    if (data + length > buffer.length) throw new Error(`invalid ${type} chunk length`);
    if (type === "VP8X" && length >= 10) {
      return [1 + buffer.readUIntLE(data + 4, 3), 1 + buffer.readUIntLE(data + 7, 3)];
    }
    if (type === "VP8 " && length >= 10) {
      if (buffer[data + 3] !== 0x9d || buffer[data + 4] !== 0x01 || buffer[data + 5] !== 0x2a) throw new Error("invalid VP8 frame signature");
      return [buffer.readUInt16LE(data + 6) & 0x3fff, buffer.readUInt16LE(data + 8) & 0x3fff];
    }
    if (type === "VP8L" && length >= 5) {
      if (buffer[data] !== 0x2f) throw new Error("invalid VP8L frame signature");
      const b1 = buffer[data + 1];
      const b2 = buffer[data + 2];
      const b3 = buffer[data + 3];
      const b4 = buffer[data + 4];
      return [1 + b1 + ((b2 & 0x3f) << 8), 1 + (b2 >> 6) + (b3 << 2) + ((b4 & 0x0f) << 10)];
    }
    offset = data + length + (length % 2);
  }
  throw new Error("no supported WebP image chunk");
}

function webpChunks(buffer) {
  const chunks = [];
  let offset = 12;
  while (offset + 8 <= buffer.length) {
    const type = buffer.toString("ascii", offset, offset + 4);
    const length = buffer.readUInt32LE(offset + 4);
    chunks.push(type);
    offset += 8 + length + (length % 2);
  }
  return chunks;
}

check(existsSync(screenshotDirectory), "Screenshot directory exists", relative(repositoryRoot, screenshotDirectory));
if (existsSync(screenshotDirectory)) {
  const actual = readdirSync(screenshotDirectory).filter((name) => !name.startsWith(".")).sort();
  check(JSON.stringify(actual) === JSON.stringify([...screenshots.keys()].sort()), "Screenshot set is exact", `${actual.length} files`);
}

const screenshotHashes = new Set();
for (const [name, expected] of screenshots) {
  const path = join(screenshotDirectory, name);
  check(existsSync(path), `${name} exists`);
  if (!existsSync(path)) continue;
  const buffer = readFileSync(path);
  let dimensions;
  let chunks = [];
  try {
    dimensions = webpDimensions(buffer);
    chunks = webpChunks(buffer);
  } catch (error) {
    failures.push(`${name} WebP parse: ${error.message}`);
    console.error(`FAIL  ${name} WebP parse: ${error.message}`);
    continue;
  }
  check(dimensions[0] === expected[0] && dimensions[1] === expected[1], `${name} dimensions`, `${dimensions[0]}x${dimensions[1]}`);
  check(buffer.length >= 20_000 && buffer.length <= 2_000_000, `${name} file budget`, `${buffer.length} bytes`);
  check(!chunks.some((chunk) => ["EXIF", "XMP ", "ICCP"].includes(chunk)), `${name} has no metadata chunk`, chunks.join(","));
  screenshotHashes.add(createHash("sha256").update(buffer).digest("hex"));
}
check(screenshotHashes.size === screenshots.size, "Screenshots are unique", `${screenshotHashes.size}/${screenshots.size}`);

for (const [name, [width, height]] of svgs) {
  const path = join(repositoryRoot, "docs", "media", name);
  check(existsSync(path), `${name} exists`);
  if (!existsSync(path)) continue;
  const source = readFileSync(path, "utf8");
  check(source.includes(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"`) && source.includes(`viewBox="0 0 ${width} ${height}"`), `${name} dimensions`, `${width}x${height}`);
  check(/<title id="title">[^<]+<\/title>/.test(source) && /<desc id="desc">[^<]+<\/desc>/.test(source), `${name} accessible title and description`);
  check(source.trimEnd().endsWith("</svg>"), `${name} has a complete SVG root`);
  check(!/<script\b|<foreignObject\b|(?:href|xlink:href)=["'](?:https?:|data:)/i.test(source), `${name} is self-contained and script-free`);
}

const kiroSvg = readFileSync(join(repositoryRoot, "docs", "media", "kiro-engineering-workflow.svg"), "utf8");
check(kiroSvg.includes("not an official Kiro logo"), "Kiro artwork carries an explicit non-official-logo disclaimer");

const readme = readFileSync(join(repositoryRoot, "README.md"), "utf8");
for (const name of [...screenshots.keys(), ...svgs.keys()]) {
  check(readme.includes(name), `README references ${name}`);
}

if (failures.length > 0) {
  console.error(`\nPublic media verification failed (${failures.length}/${checks} checks).`);
  process.exitCode = 1;
} else {
  console.log(`\nPublic media verification passed (${checks}/${checks} checks).`);
}
