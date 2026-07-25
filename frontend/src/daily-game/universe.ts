import type { DailyUniverse } from "../daily-universe/client";
import publishedArtifact from "./published-universe.json";

/** The F3 artifact is copied byte-for-byte by scripts/sync-f4a-universe.mjs. */
export const publishedDailyUniverse = publishedArtifact as unknown as DailyUniverse;
