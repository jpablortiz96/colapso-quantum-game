import { describe, expect, it } from "vitest";
import {
  bytesFromHex,
  sha256Hex,
} from "./client";
import { publishedDailyUniverse } from "../daily-game/universe";
import { canonicalJson, canonicalUtf8Bytes } from "./serializer";

describe("browser-safe canonical serialization", () => {
  it("preserves the canonical UTF-8 bytes used by published artifacts", () => {
    const value = { z: "ñ", a: [-0, true] };
    const canonical = '{"a":[0,true],"z":"ñ"}';

    expect(canonicalJson(value)).toBe(canonical);
    expect(Array.from(canonicalUtf8Bytes(value))).toEqual(
      Array.from(new TextEncoder().encode(canonical)),
    );
  });

  it("reproduces the published F3 resolution-material hash without Buffer", () => {
    const { resolutionPlan } = publishedDailyUniverse;
    const material = bytesFromHex(resolutionPlan.keyMaterialHex, "Resolution-plan key material");

    expect(sha256Hex(material)).toBe(resolutionPlan.keyMaterialHash);
  });
});
