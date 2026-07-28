import {
  assertCampaignBundle,
  type CampaignBundle,
  type PlayableCampaignEntry,
  type UniverseNumber,
} from "../daily-universe/client";
import publishedCampaignArtifact from "./published-campaign.json";
import publishedArtifact from "./published-universe.json";

const campaignCandidate: unknown = publishedCampaignArtifact;
assertCampaignBundle(campaignCandidate);

const pinnedCandidate = publishedArtifact;
const firstEntry = campaignCandidate.entries[0];
if (
  firstEntry?.playable !== true ||
  JSON.stringify(firstEntry.artifact) !== JSON.stringify(pinnedCandidate)
) {
  throw new Error("Published campaign universe #1 is not equal to the pinned compatibility artifact.");
}

export const publishedCampaign: CampaignBundle = campaignCandidate;
export const campaignEntries = publishedCampaign.entries;
/** Compatibility export for the original F3/F4A universe. */
export const publishedDailyUniverse = firstEntry.artifact;

const universeDisplayTitles: Readonly<Record<UniverseNumber, string>> = Object.freeze({
  1: "Primer Colapso",
  2: "Rutas Entrelazadas",
  3: "Protocolo del Vacío",
  4: "Crisis de Energía",
  5: "Tormenta Cuántica",
});

export function getUniverseDisplayTitle(universeNumber: UniverseNumber): string {
  return universeDisplayTitles[universeNumber];
}

export function universeRoutePath(universeNumber: UniverseNumber): string {
  const basePath = import.meta.env.BASE_URL.endsWith("/")
    ? import.meta.env.BASE_URL
    : `${import.meta.env.BASE_URL}/`;
  return `${basePath}universe/${String(universeNumber).padStart(3, "0")}`;
}

export function universeNumberFromPathname(pathname: string): UniverseNumber | null {
  const basePath = import.meta.env.BASE_URL.endsWith("/")
    ? import.meta.env.BASE_URL
    : `${import.meta.env.BASE_URL}/`;
  if (!pathname.startsWith(basePath)) return null;
  const match = /^universe\/(00[1-5])\/?$/u.exec(pathname.slice(basePath.length));
  if (match?.[1] === undefined) return null;
  return Number.parseInt(match[1], 10) as UniverseNumber;
}

export const getPlayableCampaignEntry = (
  universeNumber: UniverseNumber,
): PlayableCampaignEntry | undefined => {
  const entry = campaignEntries.find(
    (candidate) => candidate.universeNumber === universeNumber,
  );
  return entry?.playable === true ? entry : undefined;
};

export { assertCampaignBundle };
