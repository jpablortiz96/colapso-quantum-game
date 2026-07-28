import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const directory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(directory, "..");
const publicDirectory = path.join(root, "frontend", "public", "data", "universes");
const universeSource = path.join(publicDirectory, "2026-07-22.json");
const universeTarget = path.join(root, "frontend", "src", "daily-game", "published-universe.json");
const campaignSource = path.join(publicDirectory, "campaign.json");
const campaignTarget = path.join(root, "frontend", "src", "daily-game", "published-campaign.json");
const checkOnly = process.argv.includes("--check");

const normalize = (value) => {
  if (value === null || typeof value === "string" || typeof value === "boolean" || typeof value === "number") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(normalize);
  }
  if (typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, normalize(value[key])]));
  }
  throw new Error(`Campaign JSON contains unsupported ${typeof value}.`);
};

const canonicalJson = (source, label) => {
  let parsed;
  try {
    parsed = JSON.parse(source);
  } catch (error) {
    throw new Error(`${label} is invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  return JSON.stringify(normalize(parsed));
};

for (const source of [universeSource, campaignSource]) {
  if (!fs.existsSync(source)) {
    throw new Error(`Missing published artifact: ${source}`);
  }
}

const universeBytes = fs.readFileSync(universeSource);
const campaignBytes = fs.readFileSync(campaignSource);
const publicCampaignText = campaignBytes.toString("utf8");
const canonicalCampaign = canonicalJson(publicCampaignText, "Public campaign bundle");
if (publicCampaignText !== canonicalCampaign) {
  throw new Error("Public campaign bundle is not canonical JSON.");
}

if (checkOnly) {
  const universeSynchronized = fs.existsSync(universeTarget) && fs.readFileSync(universeTarget).equals(universeBytes);
  if (!universeSynchronized) {
    throw new Error("F4A source universe is missing or differs byte-for-byte from pinned universe #1.");
  }
  if (!fs.existsSync(campaignTarget)) {
    throw new Error("Source campaign bundle is missing. Run npm run universe:sync-f4a.");
  }
  const targetCampaignText = fs.readFileSync(campaignTarget, "utf8");
  if (
    targetCampaignText !== canonicalJson(targetCampaignText, "Source campaign bundle") ||
    targetCampaignText !== canonicalCampaign
  ) {
    throw new Error("Source campaign bundle differs from the canonical public campaign bundle.");
  }
  console.log("Pinned universe #1 is byte-identical and the campaign bundles are canonically equal.");
} else {
  fs.mkdirSync(path.dirname(universeTarget), { recursive: true });
  fs.writeFileSync(universeTarget, universeBytes);
  fs.writeFileSync(campaignTarget, campaignBytes);
  console.log("Pinned universe #1 and the canonical campaign bundle were synchronized.");
}
