import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import {
  FIRST_UNIVERSE_DATE,
  LOCKED_REAL_RUN_ID,
  buildAvailableCampaign,
  compileDailyUniverse,
  compileUniverseIndex,
  finalizeCampaign,
  readLockedRealEvidence,
  verifyCampaign,
  verifyPublishedUniverse,
  writeCanonicalJsonAtomically,
} from "./index";

const directory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(directory, "../../..");

type CommandOptions = Readonly<{
  dateUtc: string;
  runId: string;
  output?: string;
}>;

const parseOptions = (argumentsList: readonly string[]): CommandOptions => {
  let dateUtc: string = FIRST_UNIVERSE_DATE;
  let runId: string = LOCKED_REAL_RUN_ID;
  let output: string | undefined;
  for (let index = 0; index < argumentsList.length; index += 1) {
    const option = argumentsList[index];
    const value = argumentsList[index + 1];
    if (option === "--date" && value !== undefined) {
      dateUtc = value;
      index += 1;
    } else if (option === "--run-id" && value !== undefined) {
      runId = value;
      index += 1;
    } else if (option === "--output" && value !== undefined) {
      output = path.resolve(repositoryRoot, value);
      index += 1;
    } else {
      throw new Error(`Unsupported CLI option: ${option ?? ""}.`);
    }
  }
  return Object.freeze({ dateUtc, runId, output });
};

const requireNoOptions = (command: string): void => {
  if (process.argv.length > 3) {
    throw new Error(`${command} accepts no options.`);
  }
};

const defaultUniversePath = (dateUtc: string): string =>
  path.join(repositoryRoot, "frontend", "public", "data", "universes", `${dateUtc}.json`);

const build = (options: CommandOptions): void => {
  const evidence = readLockedRealEvidence({
    repositoryRoot,
    runId: options.runId,
  });
  const universe = compileDailyUniverse(evidence, options.dateUtc);
  const universePath = options.output ?? defaultUniversePath(options.dateUtc);
  writeCanonicalJsonAtomically(universePath, universe);
  if (options.output === undefined) {
    const indexPath = path.join(repositoryRoot, "frontend", "public", "data", "universes", "index.json");
    writeCanonicalJsonAtomically(indexPath, compileUniverseIndex(universe));
  }
  console.log(`Built ${universe.universeId} with commitment ${universe.commitment}.`);
};

const verify = (): void => {
  const verification = verifyPublishedUniverse(repositoryRoot);
  if (!verification.ok) {
    throw new Error(verification.issues.join("; "));
  }
  console.log(`Verified ${verification.universe?.universeId ?? "daily universe"} commitment ${verification.universe?.commitment ?? ""}.`);
};

const campaignBuild = (): void => {
  const result = buildAvailableCampaign(repositoryRoot);
  const commitments = Object.entries(result.commitments)
    .map(([number, commitment]) => `#${number}=${commitment}`)
    .join(", ");
  console.log(`Built evidence-derived campaign artifacts: ${commitments}.`);
};

const campaignVerify = (): void => {
  const verification = verifyCampaign(repositoryRoot);
  if (!verification.ok) {
    throw new Error(verification.issues.join("; "));
  }
  const finalized = verification.bundle?.entries.every((entry) => entry.playable) ?? false;
  console.log(
    finalized
      ? "Verified all five finalized campaign artifacts."
      : "Verified campaign #1-#4 artifacts and the pending #5 publication gate.",
  );
};

const campaignFinalize = (): void => {
  const result = finalizeCampaign(repositoryRoot);
  console.log(`Finalized ${result.bundle.entries.length} campaign entries.`);
};

const main = (): void => {
  const command = process.argv[2];
  if (command === "build") {
    build(parseOptions(process.argv.slice(3)));
    return;
  }
  if (command === "verify") {
    requireNoOptions("universe:verify");
    verify();
    return;
  }
  if (command === "campaign-build") {
    requireNoOptions("campaign-build");
    campaignBuild();
    return;
  }
  if (command === "campaign-verify") {
    requireNoOptions("campaign-verify");
    campaignVerify();
    return;
  }
  if (command === "campaign-finalize") {
    requireNoOptions("campaign-finalize");
    campaignFinalize();
    return;
  }
  throw new Error(
    "Usage: cli.ts <build|verify|campaign-build|campaign-verify|campaign-finalize> [--date YYYY-MM-DD --run-id RUN_ID --output PATH].",
  );
};

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
