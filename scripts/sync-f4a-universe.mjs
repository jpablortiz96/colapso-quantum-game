import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const directory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(directory, "..");
const source = path.join(root, "frontend", "public", "data", "universes", "2026-07-22.json");
const target = path.join(root, "frontend", "src", "daily-game", "published-universe.json");
const checkOnly = process.argv.includes("--check");

if (!fs.existsSync(source)) {
  throw new Error(`Missing published F3 universe: ${source}`);
}

const sourceBytes = fs.readFileSync(source);

if (checkOnly) {
  const synchronized = fs.existsSync(target) && fs.readFileSync(target).equals(sourceBytes);
  if (!synchronized) {
    throw new Error("F4A source universe is missing or differs from the F3 published artifact. Run npm run universe:sync-f4a.");
  }
  console.log("F4A universe source is byte-identical to the F3 artifact.");
} else {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, sourceBytes);
  console.log("F4A universe source synchronized from the F3 published artifact.");
}
