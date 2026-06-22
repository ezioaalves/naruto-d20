import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const SCRIPTS_DIR = path.join(ROOT, "scripts");

function walk(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(absolute);
    return entry.isFile() && entry.name.endsWith(".mjs") ? [absolute] : [];
  });
}

const files = walk(SCRIPTS_DIR);
const missing = [];

for (const file of files) {
  const source = fs.readFileSync(file, "utf8");
  const imports = [...source.matchAll(/from\s+["']([^"']+)["']/g)]
    .map((match) => match[1])
    .filter((specifier) => specifier.startsWith("."));

  for (const specifier of imports) {
    const resolved = path.resolve(path.dirname(file), specifier);
    const candidates = [resolved, `${resolved}.mjs`, path.join(resolved, "index.mjs")];
    if (!candidates.some((candidate) => fs.existsSync(candidate))) {
      missing.push(`${path.relative(ROOT, file)} -> ${specifier}`);
    }
  }
}

if (missing.length) {
  console.error("Missing relative ESM imports:");
  for (const entry of missing) console.error(`- ${entry}`);
  process.exit(1);
}

console.log(`Checked ${files.length} script modules; all relative imports resolve.`);
