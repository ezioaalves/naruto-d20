import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const COMMUNITY_DIR = new URL("../packs/_source/occupations-community/", import.meta.url);

test("community occupations keep named advanced bloodlines grantable instead of manual", () => {
  const offenders = [];

  for (const filename of readdirSync(COMMUNITY_DIR)) {
    const doc = JSON.parse(readFileSync(join(COMMUNITY_DIR.pathname, filename), "utf8"));
    const manualFeatOptions = doc.flags?.["naruto-d20"]?.occupation?.manualFeatOptions ?? [];

    for (const option of manualFeatOptions) {
      if (/^Advanced Bloodline \(.+\)$/.test(String(option))) offenders.push(`${filename}: ${option}`);
    }
  }

  assert.deepEqual(offenders, []);
});
