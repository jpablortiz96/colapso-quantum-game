import crypto from "node:crypto";
import { canonicalUtf8Bytes } from "./serializer";
import type { DailyUniverse } from "./types";

export const calculateCommitment = (
  universe: Omit<DailyUniverse, "commitment"> | DailyUniverse,
): string => {
  const withoutCommitment: Record<string, unknown> = { ...universe };
  delete withoutCommitment.commitment;
  return crypto
    .createHash("sha256")
    .update(canonicalUtf8Bytes(withoutCommitment))
    .digest("hex");
};

export const hasValidCommitment = (universe: DailyUniverse): boolean =>
  /^[a-f0-9]{64}$/u.test(universe.commitment) &&
  calculateCommitment(universe) === universe.commitment;
