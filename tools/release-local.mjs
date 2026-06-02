/**
 * Simulate the GitHub release workflow locally in a temporary workspace.
 *
 * It stamps module.json, runs the same release gates, recompiles packs, and
 * builds the runtime-only module.zip without mutating the current repository.
 *
 * Usage:
 *   npm run release:local
 *   npm run release:local -- --version 1.0.0
 *   npm run release:local -- --version 1.0.0 --out /tmp/naruto-d20-release
 */

import { cp, mkdtemp, mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const DEFAULT_REPO = "ezioaalves/naruto-d20";
const RELEASE_FILES = [
  "module.json",
  "scripts",
  "templates",
  "styles",
  "lang",
  "packs",
  "icons",
  "README.md",
  "LICENSE",
];

function fail(message) {
  console.error(`\n✗ ${message}`);
  process.exit(1);
}

function run(command, args, cwd, env = process.env) {
  const display = [command, ...args].join(" ");
  console.log(`\n$ ${display}`);
  const result = spawnSync(command, args, {
    cwd,
    env,
    stdio: "inherit",
  });
  if (result.status !== 0) {
    fail(`command failed (${result.status ?? "signal"}): ${display}`);
  }
}

function parseArgs(argv) {
  const options = {
    version: null,
    tag: null,
    repo: null,
    out: null,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = argv[i + 1];
    const readValue = () => {
      if (!next || next.startsWith("--")) fail(`missing value for ${arg}`);
      i++;
      return next;
    };

    if (arg === "--version") options.version = readValue();
    else if (arg === "--tag") options.tag = readValue();
    else if (arg === "--repo") options.repo = readValue();
    else if (arg === "--out") options.out = readValue();
    else fail(`unknown argument: ${arg}`);
  }

  return options;
}

function deriveRepo(manifest) {
  const url = manifest.url;
  if (typeof url !== "string") return DEFAULT_REPO;
  const match = url.match(/github\.com\/([^/]+\/[^/]+?)(?:\.git|\/)?$/);
  return match?.[1] ?? DEFAULT_REPO;
}

async function copyWorkspace(targetDir) {
  await cp(ROOT, targetDir, {
    recursive: true,
    filter: (source) => {
      const relative = source.slice(ROOT.length).replace(/^\/+/, "");
      if (!relative) return true;
      if (relative === ".git" || relative.startsWith(".git/")) return false;
      if (relative === "node_modules" || relative.startsWith("node_modules/")) return false;
      return true;
    },
  });
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const manifest = JSON.parse(await readFile(join(ROOT, "module.json"), "utf8"));
  const version = options.version ?? manifest.version;
  const tag = options.tag ?? `v${version}`;
  const repo = options.repo ?? deriveRepo(manifest);

  if (!version) fail("could not determine release version");
  if (!existsSync(join(ROOT, "node_modules"))) {
    fail("node_modules/ is missing; run npm install first");
  }

  const baseOut = options.out
    ? resolve(options.out)
    : await mkdtemp(join(tmpdir(), "naruto-d20-release-"));
  await mkdir(baseOut, { recursive: true });

  const workDir = join(baseOut, "workspace");
  if (existsSync(workDir)) {
    fail(`output workspace already exists: ${workDir}`);
  }
  console.log(`Preparing temporary workspace at ${workDir}`);
  await copyWorkspace(workDir);
  await symlink(join(ROOT, "node_modules"), join(workDir, "node_modules"));

  const workManifestPath = join(workDir, "module.json");
  const workManifest = JSON.parse(await readFile(workManifestPath, "utf8"));
  workManifest.version = version;
  workManifest.download = `https://github.com/${repo}/releases/download/${tag}/module.zip`;
  await writeFile(workManifestPath, `${JSON.stringify(workManifest, null, 2)}\n`);

  console.log(`Stamped version=${version}`);
  console.log(`Stamped download=${workManifest.download}`);

  run("npm", ["run", "validate:manifest"], workDir);
  run("npm", ["run", "validate:compendia"], workDir);
  run("npm", ["run", "lint:css"], workDir);
  run("npm", ["run", "pack:all"], workDir);
  run("zip", ["-r", "module.zip", ...RELEASE_FILES, "-x", "packs/_source/*"], workDir);

  console.log(`\n✓ Local release ready`);
  console.log(`  Output directory: ${baseOut}`);
  console.log(`  Manifest: ${join(workDir, "module.json")}`);
  console.log(`  Zip: ${join(workDir, "module.zip")}`);
  console.log(`  Inspect zip: unzip -l ${join(workDir, "module.zip")}`);
}

await main();
