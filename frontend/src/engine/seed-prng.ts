import { RULES_VERSION } from "./constants";
import type {
  InvalidSeedError,
  UnsupportedRulesVersionError,
} from "./errors";
import type { Result } from "./types";

const FNV_OFFSET_BASIS = 2_166_136_261;
const FNV_PRIME = 16_777_619;
const MULBERRY32_INCREMENT = 0x6d2b_79f5;
const REPLACEMENT_CODE_POINT = 0xfffd;

export type SeedPrngError = InvalidSeedError | UnsupportedRulesVersionError;
export type SeedPrngResult = Result<Mulberry32, SeedPrngError>;

const hasUnpairedSurrogate = (value: string): boolean => {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) {
        return true;
      }
      index += 1;
    } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      return true;
    }
  }
  return false;
};

const appendUtf8CodePoint = (bytes: number[], codePoint: number): void => {
  if (codePoint <= 0x7f) {
    bytes.push(codePoint);
  } else if (codePoint <= 0x7ff) {
    bytes.push(0xc0 | (codePoint >>> 6), 0x80 | (codePoint & 0x3f));
  } else if (codePoint <= 0xffff) {
    bytes.push(
      0xe0 | (codePoint >>> 12),
      0x80 | ((codePoint >>> 6) & 0x3f),
      0x80 | (codePoint & 0x3f),
    );
  } else {
    bytes.push(
      0xf0 | (codePoint >>> 18),
      0x80 | ((codePoint >>> 12) & 0x3f),
      0x80 | ((codePoint >>> 6) & 0x3f),
      0x80 | (codePoint & 0x3f),
    );
  }
};

export const utf8Bytes = (value: string): readonly number[] => {
  const bytes: number[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const first = value.charCodeAt(index);
    let codePoint = first;

    if (first >= 0xd800 && first <= 0xdbff) {
      const second = value.charCodeAt(index + 1);
      if (second >= 0xdc00 && second <= 0xdfff) {
        codePoint =
          0x1_0000 + ((first - 0xd800) << 10) + (second - 0xdc00);
        index += 1;
      } else {
        codePoint = REPLACEMENT_CODE_POINT;
      }
    } else if (first >= 0xdc00 && first <= 0xdfff) {
      codePoint = REPLACEMENT_CODE_POINT;
    }

    appendUtf8CodePoint(bytes, codePoint);
  }
  return Object.freeze(bytes);
};

export const fnv1aUtf8 = (value: string): number => {
  let hash = FNV_OFFSET_BASIS;
  for (const byte of utf8Bytes(value)) {
    hash = Math.imul(hash ^ byte, FNV_PRIME) >>> 0;
  }
  return hash >>> 0;
};

export class Mulberry32 {
  #state: number;

  public constructor(initialState: number) {
    if (
      !Number.isInteger(initialState) ||
      initialState < 0 ||
      initialState > 0xffff_ffff
    ) {
      throw new RangeError("Mulberry32 state must be an unsigned 32-bit integer.");
    }
    this.#state = initialState >>> 0;
  }

  public nextUint32(): number {
    this.#state = (this.#state + MULBERRY32_INCREMENT) >>> 0;
    let value = this.#state;
    value = Math.imul(value ^ (value >>> 15), value | 1) >>> 0;
    value =
      (value ^
        ((value + Math.imul(value ^ (value >>> 7), value | 61)) >>> 0)) >>>
      0;
    return (value ^ (value >>> 14)) >>> 0;
  }
}

export const validateSeed = (
  seed: unknown,
): Result<string, InvalidSeedError> => {
  if (typeof seed !== "string") {
    return {
      ok: false,
      error: {
        kind: "INVALID_SEED",
        reason: "MALFORMED_SEED",
        message: "Seed must be a string.",
      },
    };
  }
  if (seed.length === 0) {
    return {
      ok: false,
      error: {
        kind: "INVALID_SEED",
        reason: "EMPTY_SEED",
        message: "Seed must not be empty.",
      },
    };
  }
  if (hasUnpairedSurrogate(seed)) {
    return {
      ok: false,
      error: {
        kind: "INVALID_SEED",
        reason: "MALFORMED_SEED",
        message: "Seed must contain only valid Unicode scalar values.",
      },
    };
  }
  return { ok: true, value: seed };
};

export const createSeedPrng = (
  seed: unknown,
  rulesVersion: number = RULES_VERSION,
): SeedPrngResult => {
  const seedResult = validateSeed(seed);
  if (!seedResult.ok) {
    return seedResult;
  }
  if (rulesVersion !== RULES_VERSION) {
    return {
      ok: false,
      error: {
        kind: "UNSUPPORTED_RULES_VERSION",
        received: rulesVersion,
        message: `Unsupported rules version ${rulesVersion}.`,
      },
    };
  }
  return {
    ok: true,
    value: new Mulberry32(fnv1aUtf8(seedResult.value)),
  };
};

export const createSeededPrng = createSeedPrng;
