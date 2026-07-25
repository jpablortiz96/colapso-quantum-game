import type {
  EntropyContext,
  EntropySource,
  Result,
} from "../engine/index";
import type { ResolutionPlan } from "./types";

export const COUNTER_MODE_ALGORITHM = "SHA-256 counter mode" as const;
export const EXPANSION_VERSION = "colapso-daily-universe-expansion-v1" as const;
const ATTEMPT_PREFIX = "COLAPSO_DAILY_UNIVERSE_ATTEMPT_V1\0";
const EXPANSION_PREFIX = "COLAPSO_DAILY_UNIVERSE_EXPAND_V1\0";
const SHA256_HEX = /^[a-f0-9]{64}$/u;
const textEncoder = new TextEncoder();

const SHA256_INITIAL = new Uint32Array([
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
  0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
]);

const SHA256_CONSTANTS = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

export type EntropyExpansionError = Readonly<{
  kind: "ENTROPY_EXPANSION_ERROR";
  message: string;
}>;

const utf8 = (value: string): Uint8Array => textEncoder.encode(value);

const uint32be = (value: number): Uint8Array => {
  if (!Number.isInteger(value) || value < 0 || value > 0xffff_ffff) {
    throw new RangeError("Counter values must be uint32 integers.");
  }
  return new Uint8Array([
    value >>> 24,
    value >>> 16,
    value >>> 8,
    value,
  ]);
};

const concatenate = (chunks: readonly Uint8Array[]): Uint8Array => {
  const length = chunks.reduce((total, chunk) => total + chunk.length, 0);
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
};

const rotateRight = (value: number, bits: number): number =>
  (value >>> bits) | (value << (32 - bits));

/** Synchronous SHA-256 over bytes, identical to the former Node crypto digest. */
const hash = (...chunks: readonly Uint8Array[]): Uint8Array => {
  const message = concatenate(chunks);
  const bitLength = BigInt(message.length) * 8n;
  const zeroPadding = (64 - ((message.length + 1 + 8) % 64)) % 64;
  const padded = new Uint8Array(message.length + 1 + zeroPadding + 8);
  padded.set(message);
  padded[message.length] = 0x80;

  let remainingLength = bitLength;
  for (let index = 0; index < 8; index += 1) {
    padded[padded.length - 1 - index] = Number(remainingLength & 0xffn);
    remainingLength >>= 8n;
  }

  const state = new Uint32Array(SHA256_INITIAL);
  const words = new Uint32Array(64);
  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let index = 0; index < 16; index += 1) {
      const byteOffset = offset + index * 4;
      words[index] = (
        (padded[byteOffset]! << 24) |
        (padded[byteOffset + 1]! << 16) |
        (padded[byteOffset + 2]! << 8) |
        padded[byteOffset + 3]!
      ) >>> 0;
    }
    for (let index = 16; index < 64; index += 1) {
      const previous15 = words[index - 15]!;
      const previous2 = words[index - 2]!;
      const sigma0 = rotateRight(previous15, 7) ^ rotateRight(previous15, 18) ^ (previous15 >>> 3);
      const sigma1 = rotateRight(previous2, 17) ^ rotateRight(previous2, 19) ^ (previous2 >>> 10);
      words[index] = (words[index - 16]! + sigma0 + words[index - 7]! + sigma1) >>> 0;
    }

    let [a, b, c, d, e, f, g, h] = state;
    for (let index = 0; index < 64; index += 1) {
      const sigma1 = rotateRight(e!, 6) ^ rotateRight(e!, 11) ^ rotateRight(e!, 25);
      const choice = (e! & f!) ^ (~e! & g!);
      const temporary1 = (h! + sigma1 + choice + SHA256_CONSTANTS[index]! + words[index]!) >>> 0;
      const sigma0 = rotateRight(a!, 2) ^ rotateRight(a!, 13) ^ rotateRight(a!, 22);
      const majority = (a! & b!) ^ (a! & c!) ^ (b! & c!);
      const temporary2 = (sigma0 + majority) >>> 0;

      h = g;
      g = f;
      f = e;
      e = (d! + temporary1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temporary1 + temporary2) >>> 0;
    }

    state[0] = (state[0]! + a!) >>> 0;
    state[1] = (state[1]! + b!) >>> 0;
    state[2] = (state[2]! + c!) >>> 0;
    state[3] = (state[3]! + d!) >>> 0;
    state[4] = (state[4]! + e!) >>> 0;
    state[5] = (state[5]! + f!) >>> 0;
    state[6] = (state[6]! + g!) >>> 0;
    state[7] = (state[7]! + h!) >>> 0;
  }

  const digest = new Uint8Array(32);
  for (let index = 0; index < state.length; index += 1) {
    const word = state[index]!;
    const byteOffset = index * 4;
    digest[byteOffset] = word >>> 24;
    digest[byteOffset + 1] = word >>> 16;
    digest[byteOffset + 2] = word >>> 8;
    digest[byteOffset + 3] = word;
  }
  return digest;
};

export const sha256Hex = (value: Uint8Array): string =>
  Array.from(hash(value), (byte) => byte.toString(16).padStart(2, "0")).join("");

export const bytesFromHex = (value: string, label: string): Uint8Array => {
  if (value.length === 0 || value.length % 2 !== 0 || !/^[a-f0-9]+$/iu.test(value)) {
    throw new Error(`${label} must be non-empty even-length hexadecimal.`);
  }
  const bytes = new Uint8Array(value.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
};

const sourceHashBytes = (sourceEntropyHash: string): Uint8Array => {
  if (!SHA256_HEX.test(sourceEntropyHash)) {
    throw new Error("Source entropy hash must be a lowercase SHA-256 digest.");
  }
  return bytesFromHex(sourceEntropyHash, "Source entropy hash");
};

/**
 * Produces the per-attempt key. It is deterministic retry material, not new
 * entropy: SHA256(prefix || sourceHash || "universe-attempt" || uint32be(i)).
 */
export const deriveAttemptKey = (
  sourceEntropyHash: string,
  attemptIndex: number,
): Uint8Array =>
  hash(
    utf8(ATTEMPT_PREFIX),
    sourceHashBytes(sourceEntropyHash),
    utf8("universe-attempt\0"),
    uint32be(attemptIndex),
  );

/**
 * Extends fixed input material with SHA-256 counter blocks. The caller records
 * the domain and bytes consumed; this does not increase physical entropy.
 */
export const expandCounterMode = (
  keyMaterial: Uint8Array,
  domain: string,
  counterStart: number,
  byteLength: number,
): Uint8Array => {
  if (keyMaterial.length !== 32) {
    throw new Error("Counter-mode key material must be exactly 32 bytes.");
  }
  if (!Number.isInteger(byteLength) || byteLength < 0) {
    throw new RangeError("Requested expansion length must be a non-negative integer.");
  }
  const blocks: Uint8Array[] = [];
  let counter = counterStart;
  let remaining = byteLength;
  while (remaining > 0) {
    blocks.push(hash(utf8(EXPANSION_PREFIX), keyMaterial, utf8(`${domain}\0`), uint32be(counter)));
    remaining -= 32;
    if (remaining > 0 && counter === 0xffff_ffff) {
      throw new RangeError("Counter-mode expansion exhausted the uint32 counter.");
    }
    counter += 1;
  }
  return concatenate(blocks).subarray(0, byteLength);
};

export class CounterModeEntropySource implements EntropySource<EntropyExpansionError> {
  readonly #keyMaterial: Uint8Array;
  readonly #domain: string;
  #counter: number;
  #buffer: Uint8Array<ArrayBufferLike> = new Uint8Array(0);
  #offset = 0;

  public constructor(
    keyMaterialHex: string,
    domain: string,
    counterStart = 0,
  ) {
    const keyMaterial = bytesFromHex(keyMaterialHex, "Resolution-plan key material");
    if (keyMaterial.length !== 32) {
      throw new Error("Resolution-plan key material must be exactly 32 bytes.");
    }
    this.#keyMaterial = keyMaterial;
    this.#domain = domain;
    this.#counter = counterStart;
  }

  public nextUint32(
    context: EntropyContext,
  ): Result<number, EntropyExpansionError> {
    void context;
    if (this.#offset + 4 > this.#buffer.length) {
      try {
        this.#buffer = expandCounterMode(this.#keyMaterial, this.#domain, this.#counter, 32);
        this.#offset = 0;
        if (this.#counter === 0xffff_ffff) {
          this.#counter = 0;
        } else {
          this.#counter += 1;
        }
      } catch (error) {
        return {
          ok: false,
          error: {
            kind: "ENTROPY_EXPANSION_ERROR",
            message: error instanceof Error ? error.message : String(error),
          },
        };
      }
    }
    const word = (
      (this.#buffer[this.#offset]! << 24) |
      (this.#buffer[this.#offset + 1]! << 16) |
      (this.#buffer[this.#offset + 2]! << 8) |
      this.#buffer[this.#offset + 3]!
    ) >>> 0;
    this.#offset += 4;
    return { ok: true, value: word };
  }
}

export const createResolutionEntropySource = (
  resolutionPlan: ResolutionPlan,
): CounterModeEntropySource =>
  new CounterModeEntropySource(
    resolutionPlan.keyMaterialHex,
    resolutionPlan.streamDomain,
    resolutionPlan.counterStart,
  );
