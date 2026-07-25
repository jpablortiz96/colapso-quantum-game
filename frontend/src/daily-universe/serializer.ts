import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const textEncoder = new TextEncoder();

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const normalize = (value: unknown): unknown => {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError("Canonical JSON cannot serialize non-finite numbers.");
    }
    return Object.is(value, -0) ? 0 : value;
  }
  if (Array.isArray(value)) {
    return value.map(normalize);
  }
  if (isRecord(value)) {
    const normalized: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      normalized[key] = normalize(value[key]);
    }
    return normalized;
  }
  throw new TypeError(`Canonical JSON cannot serialize ${typeof value}.`);
};

/** Returns UTF-8 JSON with recursive sorted keys and no optional whitespace. */
export const canonicalJson = (value: unknown): string => JSON.stringify(normalize(value));

export const canonicalUtf8Bytes = (value: unknown): Uint8Array =>
  textEncoder.encode(canonicalJson(value));

export const writeCanonicalJsonAtomically = (
  destination: string,
  value: unknown,
): Uint8Array => {
  const bytes = canonicalUtf8Bytes(value);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  const temporary = `${destination}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(temporary, bytes);
    fs.renameSync(temporary, destination);
  } finally {
    if (fs.existsSync(temporary)) {
      fs.unlinkSync(temporary);
    }
  }
  return bytes;
};
