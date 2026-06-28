import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import {
  hasLegacyWeaponAttack,
  migrateLegacyWeaponAttack,
} from "../scripts/features/techniques/weapon-attack-migrate.mjs";

const dir = "packs/_source/techniques";
let changed = 0;
for (const file of readdirSync(dir)) {
  if (!file.endsWith(".json")) continue;
  const path = join(dir, file);
  const doc = JSON.parse(readFileSync(path, "utf8"));
  const wa = doc.system?.weaponAttack;
  const hasLegacyStrings = Boolean(
    wa && typeof wa === "object" && ("damageBonus" in wa || "nonCritDamageBonus" in wa),
  );
  if (!doc.system || (!hasLegacyWeaponAttack(doc.system) && !hasLegacyStrings)) continue;
  migrateLegacyWeaponAttack(doc.system);
  writeFileSync(path, JSON.stringify(doc, null, 2) + "\n", "utf8");
  changed += 1;
}
console.log(`migrated ${changed} technique source files`);
