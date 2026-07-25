import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

export function parseZipEntries(zipPath) {
  const buffer = fs.readFileSync(zipPath);
  const entries = new Map();
  let offset = 0;
  while (offset <= buffer.length - 46) {
    const signature = buffer.readUInt32LE(offset);
    if (signature !== 0x02014b50) {
      offset += 1;
      continue;
    }
    const compressionMethod = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const uncompressedSize = buffer.readUInt32LE(offset + 24);
    const fileNameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localHeaderOffset = buffer.readUInt32LE(offset + 42);
    const rawName = buffer.subarray(offset + 46, offset + 46 + fileNameLength).toString("utf8");
    if (rawName.includes("\\")) throw new Error(`ZIP entry ${rawName} uses a non-portable backslash separator.`);
    const name = rawName.replaceAll("\\", "/");
    const localNameLength = buffer.readUInt16LE(localHeaderOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localHeaderOffset + 28);
    const dataOffset = localHeaderOffset + 30 + localNameLength + localExtraLength;
    const compressed = buffer.subarray(dataOffset, dataOffset + compressedSize);
    let content = null;
    if (!name.endsWith("/")) {
      if (compressionMethod === 0) content = Buffer.from(compressed);
      else if (compressionMethod === 8) content = zlib.inflateRawSync(compressed);
      else throw new Error(`Unsupported ZIP compression method ${compressionMethod} for ${name}.`);
      if (content.length !== uncompressedSize) throw new Error(`ZIP size mismatch for ${name}.`);
    }
    entries.set(name, content);
    offset += 46 + fileNameLength + extraLength + commentLength;
  }
  if (entries.size === 0) throw new Error("No central-directory entries were found in the ZIP.");
  return entries;
}

export function latestRelease(releaseDirectory) {
  const releases = fs.readdirSync(releaseDirectory)
    .filter((name) => /^colapso-.*\.zip$/u.test(name))
    .map((name) => ({ name, path: path.join(releaseDirectory, name), mtime: fs.statSync(path.join(releaseDirectory, name)).mtimeMs }))
    .sort((left, right) => right.mtime - left.mtime);
  if (releases.length === 0) throw new Error("No Amplify release ZIP exists.");
  return releases[0];
}

export function textEntries(entries) {
  return [...entries.entries()]
    .filter(([name, content]) => content !== null && /\.(?:css|html|js|json|txt|webmanifest)$/u.test(name))
    .map(([, content]) => content.toString("utf8"))
    .join("\n");
}
