import { describe, expect, it } from "vitest";

import {
  Mulberry32,
  createSeedPrng,
  fnv1aUtf8,
  utf8Bytes,
} from "./seed-prng";

describe("UTF-8 FNV-1a", () => {
  it("matches independently published 32-bit FNV-1a vectors", () => {
    expect(fnv1aUtf8("")).toBe(0x811c_9dc5);
    expect(fnv1aUtf8("a")).toBe(0xe40c_292c);
    expect(fnv1aUtf8("foobar")).toBe(0xbf9c_f968);
    expect(fnv1aUtf8("hello")).toBe(0x4f9f_2cab);
  });

  it("encodes Unicode as UTF-8 without normalization", () => {
    expect(utf8Bytes("é")).toEqual([0xc3, 0xa9]);
    expect(utf8Bytes("量子")).toEqual([0xe9, 0x87, 0x8f, 0xe5, 0xad, 0x90]);
    expect(fnv1aUtf8("é")).toBe(0x1e9d_e8c1);
    expect(fnv1aUtf8("e\u0301")).toBe(0xfa9b_c71f);
    expect(fnv1aUtf8("量子")).toBe(0xc3b4_8d58);
    expect(fnv1aUtf8("é")).not.toBe(fnv1aUtf8("e\u0301"));
  });
});

describe("Mulberry32", () => {
  it("matches the exact uint32 stream for initial state zero", () => {
    const prng = new Mulberry32(0);
    expect(Array.from({ length: 5 }, () => prng.nextUint32())).toEqual([
      1_144_304_738, 1_416_247, 958_946_056, 627_933_444, 2_007_157_716,
    ]);
  });

  it("matches an independent nonzero-state vector", () => {
    const prng = new Mulberry32(1);
    expect(Array.from({ length: 5 }, () => prng.nextUint32())).toEqual([
      2_693_262_067, 11_749_833, 2_265_367_787, 4_213_581_821,
      4_159_151_403,
    ]);
  });

  it("rejects states outside uint32", () => {
    expect(() => new Mulberry32(-1)).toThrow(RangeError);
    expect(() => new Mulberry32(0x1_0000_0000)).toThrow(RangeError);
    expect(() => new Mulberry32(1.25)).toThrow(RangeError);
  });
});

describe("seeded PRNG construction", () => {
  it("hashes the seed once and yields the known stream", () => {
    const result = createSeedPrng("colapso", 1);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error.message);
    }
    expect(Array.from({ length: 5 }, () => result.value.nextUint32())).toEqual([
      939_715_310, 3_117_700_924, 3_084_701_112, 3_312_762_714,
      1_887_280_214,
    ]);
  });

  it("returns typed errors for empty and malformed seeds", () => {
    const empty = createSeedPrng("");
    expect(empty).toMatchObject({
      ok: false,
      error: { kind: "INVALID_SEED", reason: "EMPTY_SEED" },
    });

    for (const malformed of [null, 7, "\ud800", "\udc00"]) {
      const result = createSeedPrng(malformed);
      expect(result).toMatchObject({
        ok: false,
        error: { kind: "INVALID_SEED", reason: "MALFORMED_SEED" },
      });
    }
  });

  it("returns a typed unsupported-rules error", () => {
    expect(createSeedPrng("valid", 2)).toMatchObject({
      ok: false,
      error: { kind: "UNSUPPORTED_RULES_VERSION", received: 2 },
    });
  });

  it("keeps canonically equivalent Unicode seeds behaviorally distinct", () => {
    const composed = createSeedPrng("é");
    const decomposed = createSeedPrng("e\u0301");
    expect(composed.ok).toBe(true);
    expect(decomposed.ok).toBe(true);
    if (composed.ok && decomposed.ok) {
      expect(composed.value.nextUint32()).not.toBe(
        decomposed.value.nextUint32(),
      );
    }
  });
});
