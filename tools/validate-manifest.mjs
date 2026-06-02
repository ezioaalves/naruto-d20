/**
 * Validate the Foundry module manifest (module.json) for the Naruto D20 module.
 *
 * Intentionally lightweight: it parses module.json and confirms that every file
 * it references actually exists on disk, so a release never ships a manifest
 * that points Foundry at a missing script, stylesheet, language file, or pack.
 *
 * Usage:
 *   node tools/validate-manifest.mjs
 */

import { existsSync, readFileSync } from "fs";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const MANIFEST = join(ROOT, "module.json");

const errors = [];

if (!existsSync(MANIFEST)) {
  console.error("✗ module.json not found at repository root");
  process.exit(1);
}

let manifest;
try {
  manifest = JSON.parse(readFileSync(MANIFEST, "utf8"));
} catch (err) {
  console.error(`✗ module.json is not valid JSON: ${err.message}`);
  process.exit(1);
}

// Required top-level keys for Foundry to load the module at all.
for (const key of ["id", "title", "version", "compatibility"]) {
  if (manifest[key] === undefined || manifest[key] === null || manifest[key] === "") {
    errors.push(`missing required manifest field: "${key}"`);
  }
}

/** Record a referenced path that does not resolve to a file/dir on disk. */
const checkPath = (relPath, context) => {
  if (typeof relPath !== "string" || relPath === "") {
    errors.push(`${context}: empty or non-string path`);
    return;
  }
  if (!existsSync(join(ROOT, relPath))) {
    errors.push(`${context}: referenced path does not exist → ${relPath}`);
  }
};

for (const [i, p] of (manifest.esmodules ?? []).entries()) checkPath(p, `esmodules[${i}]`);
for (const [i, p] of (manifest.styles ?? []).entries()) checkPath(p, `styles[${i}]`);
for (const [i, l] of (manifest.languages ?? []).entries())
  checkPath(l?.path, `languages[${i}] (${l?.lang ?? "?"})`);
for (const [i, pack] of (manifest.packs ?? []).entries())
  checkPath(pack?.path, `packs[${i}] (${pack?.name ?? "?"})`);

if (errors.length) {
  console.error(`✗ module.json validation failed (${errors.length} issue(s)):`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}

console.log(
  `✓ module.json OK — ${manifest.esmodules?.length ?? 0} esmodule(s), ` +
    `${manifest.styles?.length ?? 0} style(s), ` +
    `${manifest.languages?.length ?? 0} language(s), ` +
    `${manifest.packs?.length ?? 0} pack(s) all present`,
);
