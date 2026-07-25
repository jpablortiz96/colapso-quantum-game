import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { publishedDailyUniverse } from "./daily-game/universe";
import { deserializeGameState } from "./engine";

describe("browser frontend entry", () => {
  afterEach(() => {
    cleanup();
    document.body.replaceChildren();
  });

  it("loads the real #001 entry in jsdom and deserializes its published state", async () => {
    const deserialized = deserializeGameState(publishedDailyUniverse.serializedInitialGameState);
    expect(deserialized.ok).toBe(true);
    if (!deserialized.ok) return;
    expect(deserialized.value.rulesVersion).toBe(1);
    expect(deserialized.value.board).toHaveLength(49);

    const root = document.createElement("div");
    root.id = "root";
    document.body.append(root);
    await import("./main");

    expect(
      await screen.findByRole(
        "heading",
        { name: "Observa antes de que el universo decida por ti." },
        { timeout: 5_000 },
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("Real quantum universe")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "COMENZAR A JUGAR" })).toBeInTheDocument();
  });
});
