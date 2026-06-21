/**
 * Occupation auto-apply / auto-revert.
 *
 * Apply (createItem): prompt selections, write class skills and the grant flag
 * onto the occupation feat, bump the actor's wealth/reputation hero stats, and
 * explicitly materialize chosen grant items.
 *
 * Revert (deleteItem): reverse wealth/reputation and delete only embedded items
 * that this occupation created, identified by flags.naruto-d20.occupationGrant.
 */
import { MODULE_ID } from "../../../core/constants.mjs";
import { wealthPath, reputationPath } from "../../../core/flag-paths.mjs";
import {
  FEAT_PACK_IDS,
  TECHNIQUE_PACK_IDS,
  buildEmbeddedGrantData,
  findCompendiumItemByName,
  normalizeItemName,
} from "../../../data/item-grants.mjs";
import { promptOccupationSelections } from "../../../ui/occupation-selector.mjs";

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
  { featDoc = null, techDoc = null, createdGrantIds = [], skippedExistingGrantNames = [] } = {},
) {
  const classSkills = {};
  for (const key of mergedClassSkillKeys(occupation, selections)) classSkills[key] = true;
  return {
    "system.classSkills": classSkills,
    "system.links.supplements": [],
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
      createdGrantIds,
      skippedExistingGrantNames,
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
    manualFeatOptions: occupation.manualFeatOptions ?? [],
    techniqueOptions,
  });
}

function findExistingOwnedItemByName(actor, name) {
  const target = normalizeItemName(name);
  if (!target) return null;
  return (
    Array.from(actor.items ?? []).find((item) => normalizeItemName(item.name) === target) ?? null
  );
}

export function findAppliedOccupationBySlug(actor, slug) {
  if (!slug) return null;

  return (
    Array.from(actor.items ?? []).find((item) => {
      const grant = item.flags?.[MODULE_ID]?.[OCCUPATION_GRANT_FLAG];
      return grant?.applied === true && grant.sourceOccupationSlug === slug;
    }) ?? null
  );
}

export function buildGrantDeletionIds(actor, grant) {
  const sourceId = grant?.sourceOccupationItemId;
  if (!sourceId) return [];

  return Array.from(actor.items ?? [])
    .filter(
      (item) =>
        item.id !== sourceId &&
        item.flags?.[MODULE_ID]?.[OCCUPATION_GRANT_FLAG]?.sourceOccupationItemId === sourceId,
    )
    .map((item) => item.id)
    .filter(Boolean);
}

async function createGrantItem(actor, doc, occupation, occupationItem, kind, grantName) {
  if (!doc) return { createdId: null, skippedExistingName: null };

  const existing = findExistingOwnedItemByName(actor, doc.name);
  if (existing) return { createdId: null, skippedExistingName: doc.name };

  const itemData = buildEmbeddedGrantData(doc, `flags.${MODULE_ID}.${OCCUPATION_GRANT_FLAG}`, {
    sourceOccupationSlug: occupation.slug,
    sourceOccupationItemId: occupationItem.id,
    grantKind: kind,
    grantName,
  });
  foundry.utils.setProperty(itemData, "flags.pf1.source", doc.uuid);

  const [created] = await actor.createEmbeddedDocuments("Item", [itemData], {
    _pf1NoSupplements: true,
  });
  return { createdId: created?.id ?? null, skippedExistingName: null };
}

export async function applyOccupationFromItem(actor, occupationItem, occupation) {
  if (occupationItem.getFlag?.(MODULE_ID, `${OCCUPATION_GRANT_FLAG}.applied`)) return;

  const existingOccupation = findAppliedOccupationBySlug(actor, occupation.slug);
  if (existingOccupation && existingOccupation.id !== occupationItem.id) {
    await occupationItem.delete();
    ui.notifications?.warn(
      game.i18n.format("NarutoD20.Occupation.AlreadyApplied", { name: occupationItem.name }),
    );
    return;
  }

  const selections = await resolveOccupationSelections(occupationItem, occupation);
  if (!selections) {
    await occupationItem.delete();
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

  const createdGrantIds = [];
  const skippedExistingGrantNames = [];
  const featGrant = await createGrantItem(
    actor,
    featDoc,
    occupation,
    occupationItem,
    "feat",
    selections.featName,
  );
  if (featGrant.createdId) createdGrantIds.push(featGrant.createdId);
  if (featGrant.skippedExistingName) skippedExistingGrantNames.push(featGrant.skippedExistingName);

  const techGrant = await createGrantItem(
    actor,
    techDoc,
    occupation,
    occupationItem,
    "technique",
    selections.techniqueName,
  );
  if (techGrant.createdId) createdGrantIds.push(techGrant.createdId);
  if (techGrant.skippedExistingName) skippedExistingGrantNames.push(techGrant.skippedExistingName);

  await occupationItem.update(
    buildOccupationItemUpdate(occupationItem, occupation, selections, {
      featDoc,
      techDoc,
      createdGrantIds,
      skippedExistingGrantNames,
    }),
  );

  const plan = planOccupationApplication(actor, occupation);
  if (Object.keys(plan.updates).length) await actor.update(plan.updates);

  const count =
    mergedClassSkillKeys(occupation, selections).length +
    createdGrantIds.length +
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
  const toDelete = buildGrantDeletionIds(actor, grant);
  if (toDelete.length) await actor.deleteEmbeddedDocuments("Item", toDelete, { render: false });
  if (Object.keys(updates).length) await actor.update(updates);
}
