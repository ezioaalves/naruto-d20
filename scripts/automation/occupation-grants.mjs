/**
 * Occupation auto-apply / auto-revert.
 *
 * Apply (createItem): prompt selections, write class skills + supplements + the
 * grant flag onto the occupation feat, bump the actor's wealth/reputation hero
 * stats, and materialize the chosen feat as a PF1e supplement (flags.pf1.source).
 *
 * Revert (deleteItem): reverse wealth/reputation only. The granted feat is removed
 * by this module's existing supplement cascade (automation/feat-grants.mjs), which
 * deletes embedded items whose flags.pf1.source matches the occupation's
 * system.links.supplements when the occupation feat is deleted.
 */
import { MODULE_ID } from "../constants.mjs";
import { wealthPath, reputationPath } from "../flag-paths.mjs";
import {
  FEAT_PACK_IDS,
  TECHNIQUE_PACK_IDS,
  buildEmbeddedGrantData,
  findCompendiumItemByName,
  linkRowFromDocument,
  normalizeItemName,
} from "../data/item-grants.mjs";
import { promptOccupationSelections } from "../ui/occupation-selector.mjs";

const OCCUPATION_FLAG = "occupation";
const OCCUPATION_GRANT_FLAG = "occupationGrant";

export function registerOccupationAutoApply() {
  Hooks.on("createItem", async (item, _options, userId) => {
    if (game.user?.id !== userId) return;
    const actor = item.actor ?? (item.parent?.documentName === "Actor" ? item.parent : null);
    if (!actor) return;
    const occupation = item.getFlag?.(MODULE_ID, OCCUPATION_FLAG);
    if (!occupation?.slug) return;
    await applyOccupationFromItem(actor, item, occupation);
  });
}

export function registerOccupationAutoRevert() {
  Hooks.on("deleteItem", async (item, _options, userId) => {
    if (game.user?.id !== userId) return;
    const actor = item.actor ?? (item.parent?.documentName === "Actor" ? item.parent : null);
    if (!actor) return;
    const grant = item.getFlag?.(MODULE_ID, OCCUPATION_GRANT_FLAG);
    if (!grant?.applied) return;
    await revertOccupationFromItem(actor, grant);
  });
}

export function fixedClassSkillKeys(occupation) {
  return (occupation.fixedClassSkills ?? []).map((option) => option.key).filter(Boolean);
}

export function mergedClassSkillKeys(occupation, selections) {
  return [...new Set([...fixedClassSkillKeys(occupation), ...(selections?.classSkillKeys ?? [])])];
}

export function planOccupationApplication(actor, occupation) {
  const updates = {};
  const wealthBonus = Number(occupation.wealthBonus ?? 0) || 0;
  if (wealthBonus) {
    const current = Number(foundry.utils.getProperty(actor, wealthPath) ?? 0) || 0;
    updates[wealthPath] = current + wealthBonus;
  }
  const reputationBonus = Number(occupation.reputationBonus ?? 0) || 0;
  if (reputationBonus) {
    const current = Number(foundry.utils.getProperty(actor, reputationPath) ?? 0) || 0;
    updates[reputationPath] = current + reputationBonus;
  }
  return { updates, creates: [], deletes: [] };
}

export function buildOccupationItemUpdate(
  occupationItem,
  occupation,
  selections,
  featDoc,
  techDoc,
) {
  const classSkills = {};
  for (const key of mergedClassSkillKeys(occupation, selections)) classSkills[key] = true;
  const links = [featDoc, techDoc].filter(Boolean).map((doc) => linkRowFromDocument(doc));
  return {
    "system.classSkills": classSkills,
    "system.links.supplements": links,
    [`flags.${MODULE_ID}.${OCCUPATION_GRANT_FLAG}`]: {
      applied: true,
      sourceOccupationSlug: occupation.slug,
      selectedClassSkillKeys: selections.classSkillKeys ?? [],
      selectedFeatName: selections.featName ?? null,
      selectedFeatUuid: featDoc?.uuid ?? null,
      selectedTechniqueName: selections.techniqueName ?? null,
      selectedTechniqueUuid: techDoc?.uuid ?? null,
      wealthBonus: occupation.wealthBonus ?? 0,
      reputationBonus: occupation.reputationBonus ?? 0,
      sourceOccupationItemId: occupationItem.id,
    },
  };
}

async function resolveOccupationSelections(occupationItem, occupation) {
  const skillSelectCount = Number(occupation.skillSelectCount ?? 0) || 0;
  const featOptions = occupation.featOptions ?? [];
  const techniqueOptions = occupation.techniqueOptions ?? [];
  const needsSkill = skillSelectCount > 0;
  const needsFeat = featOptions.length > 1;
  const needsTechnique = techniqueOptions.length > 1;

  if (!needsSkill && !needsFeat && !needsTechnique) {
    return {
      classSkillKeys: [],
      featName: featOptions[0] ?? null,
      techniqueName: techniqueOptions[0] ?? null,
    };
  }

  return promptOccupationSelections(occupationItem, {
    classSkillOptions: occupation.classSkillOptions ?? [],
    skillSelectCount,
    featOptions,
    techniqueOptions,
  });
}

function actorHasNamedItem(actor, name) {
  const target = normalizeItemName(name);
  return Array.from(actor.items ?? []).some((item) => normalizeItemName(item.name) === target);
}

export async function applyOccupationFromItem(actor, occupationItem, occupation) {
  if (occupationItem.getFlag?.(MODULE_ID, `${OCCUPATION_GRANT_FLAG}.applied`)) return;

  const selections = await resolveOccupationSelections(occupationItem, occupation);
  if (!selections) {
    ui.notifications?.warn(
      game.i18n.format("NarutoD20.Occupation.Cancelled", { name: occupationItem.name }),
    );
    return;
  }

  const featDoc = selections.featName
    ? await findCompendiumItemByName(selections.featName, FEAT_PACK_IDS, "feat")
    : null;
  if (selections.featName && !featDoc) {
    ui.notifications?.warn(
      game.i18n.format("NarutoD20.Occupation.FeatNotFound", {
        name: occupationItem.name,
        feat: selections.featName,
      }),
    );
  }
  const techDoc = selections.techniqueName
    ? await findCompendiumItemByName(selections.techniqueName, TECHNIQUE_PACK_IDS)
    : null;
  if (selections.techniqueName && !techDoc) {
    ui.notifications?.warn(
      game.i18n.format("NarutoD20.Occupation.TechniqueNotFound", {
        name: occupationItem.name,
        technique: selections.techniqueName,
      }),
    );
  }

  await occupationItem.update(
    buildOccupationItemUpdate(occupationItem, occupation, selections, featDoc, techDoc),
  );

  const plan = planOccupationApplication(actor, occupation);
  if (Object.keys(plan.updates).length) await actor.update(plan.updates);

  if (featDoc && !actorHasNamedItem(actor, featDoc.name)) {
    const featData = buildEmbeddedGrantData(
      featDoc,
      `flags.${MODULE_ID}.${OCCUPATION_GRANT_FLAG}`,
      {
        sourceOccupationSlug: occupation.slug,
        sourceOccupationItemId: occupationItem.id,
        grantKind: "feat",
        grantName: selections.featName,
      },
    );
    foundry.utils.setProperty(featData, "flags.pf1.source", featDoc.uuid);
    await actor.createEmbeddedDocuments("Item", [featData], { _pf1NoSupplements: true });
  }

  const count =
    mergedClassSkillKeys(occupation, selections).length +
    (featDoc ? 1 : 0) +
    (occupation.wealthBonus ? 1 : 0) +
    (occupation.reputationBonus ? 1 : 0);
  ui.notifications?.info(
    game.i18n.format("NarutoD20.Occupation.Applied", { name: occupationItem.name, count }),
  );
}

export async function revertOccupationFromItem(actor, grant) {
  const updates = {};
  const wealthBonus = Number(grant.wealthBonus ?? 0) || 0;
  if (wealthBonus) {
    const current = Number(foundry.utils.getProperty(actor, wealthPath) ?? 0) || 0;
    updates[wealthPath] = current - wealthBonus;
  }
  const reputationBonus = Number(grant.reputationBonus ?? 0) || 0;
  if (reputationBonus) {
    const current = Number(foundry.utils.getProperty(actor, reputationPath) ?? 0) || 0;
    updates[reputationPath] = current - reputationBonus;
  }
  if (Object.keys(updates).length) await actor.update(updates);
}
