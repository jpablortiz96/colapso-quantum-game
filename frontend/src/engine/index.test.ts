import { describe, expect, it } from "vitest";

import * as engine from "./index";

const EXPECTED_RUNTIME_EXPORTS = Object.freeze([
  "V1_RULE_CONFIG",
  "analyzeRoutes",
  "calculateScore",
  "deserializeGameState",
  "deserializeGameStateDto",
  "generateInitialState",
  "processAction",
  "replayGame",
  "serializeGameState",
  "serializeGameStateToDto",
] as const);

describe("public engine API", () => {
  it("exports exactly the supported runtime surface", () => {
    expect(Object.keys(engine).sort()).toEqual([...EXPECTED_RUNTIME_EXPORTS].sort());
    expect(engine.V1_RULE_CONFIG).toMatchObject({
      rulesVersion: 1,
      boardSize: 7,
    });

    for (const exportName of EXPECTED_RUNTIME_EXPORTS.slice(1)) {
      expect(engine[exportName]).toBeTypeOf("function");
    }
  });
});
