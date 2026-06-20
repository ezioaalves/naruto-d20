/**
 * One-shot importer: reads kaihou occupation source, applies the transform, and
 * writes naruto-d20 _source JSON split into two packs. Re-runnable (clears the
 * output dirs first). Run: `node tools/import-occupations.mjs`.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { transformOccupationDoc } from "./occupation-transform.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, "..");
const KAIHOU = path.resolve(ROOT, "..", "naruto-d20-kaihou", "packs", "_source", "occupations");

const GROUPS = [
  { srcSub: "Core", outPack: "occupations" },
  { srcSub: "Community Compendium", outPack: "occupations-community" },
];

function readJsonFilesRecursive(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...readJsonFilesRecursive(full));
    else if (entry.name.endsWith(".json")) out.push(full);
  }
  return out;
}

function run() {
  if (!fs.existsSync(KAIHOU)) {
    console.error(`Source not found: ${KAIHOU}`);
    process.exit(1);
  }

  for (const { srcSub, outPack } of GROUPS) {
    const srcDir = path.join(KAIHOU, srcSub);
    const outDir = path.join(ROOT, "packs", "_source", outPack);
    fs.rmSync(outDir, { recursive: true, force: true });
    fs.mkdirSync(outDir, { recursive: true });

    let count = 0;
    for (const file of readJsonFilesRecursive(srcDir)) {
      const doc = JSON.parse(fs.readFileSync(file, "utf8"));
      const transformed = transformOccupationDoc(doc);
      fs.writeFileSync(
        path.join(outDir, path.basename(file)),
        `${JSON.stringify(transformed, null, 2)}\n`,
      );
      count += 1;
    }
    console.log(`${outPack}: wrote ${count} occupations`);
  }
}

run();
