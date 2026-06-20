import test from "node:test";
import assert from "node:assert/strict";

// Minimal Foundry shim for the pure-ish helpers (planOccupationApplication uses
// foundry.utils.getProperty).
globalThis.foundry ??= {};
globalThis.foundry.utils ??= {};
globalThis.foundry.utils.getProperty = (obj, path) =>
  path.split(".").reduce((o, k) => (o == null ? undefined : o[k]), obj);

const {
  fixedClassSkillKeys,
  mergedClassSkillKeys,
  planOccupationApplication,
  buildOccupationItemUpdate,
  buildGrantDeletionIds,
  findAppliedOccupationBySlug,
} = await import("../scripts/automation/occupation-grants.mjs");

test("fixedClassSkillKeys extracts keys", () => {
  assert.deepEqual(fixedClassSkillKeys({ fixedClassSkills: [{ key: "tai" }, { key: "nin" }] }), [
    "tai",
    "nin",
  ]);
});

test("mergedClassSkillKeys merges fixed + chosen without duplicates", () => {
  const occupation = { fixedClassSkills: [{ key: "tai" }] };
  const selections = { classSkillKeys: ["tai", "ste"] };
  assert.deepEqual(mergedClassSkillKeys(occupation, selections), ["tai", "ste"]);
});

test("planOccupationApplication adds wealth and reputation bonuses additively", () => {
  const actor = { flags: { "naruto-d20": { wealth: 2, reputation: 0 } } };
  const plan = planOccupationApplication(actor, { wealthBonus: 1, reputationBonus: 3 });
  assert.equal(plan.updates["flags.naruto-d20.wealth"], 3);
  assert.equal(plan.updates["flags.naruto-d20.reputation"], 3);
});

test("planOccupationApplication omits zero bonuses", () => {
  const actor = { flags: { "naruto-d20": { wealth: 5 } } };
  const plan = planOccupationApplication(actor, { wealthBonus: 0, reputationBonus: 0 });
  assert.deepEqual(plan.updates, {});
});

test("buildOccupationItemUpdate sets class skills, empty links, and grant flag", () => {
  const occupation = {
    slug: "academy-student",
    wealthBonus: 1,
    reputationBonus: 0,
    fixedClassSkills: [],
  };
  const selections = { classSkillKeys: ["ste", "nin"], featName: "Genin", techniqueName: null };
  const update = buildOccupationItemUpdate({ id: "abc" }, occupation, selections, {
    featDoc: null,
    techDoc: null,
    createdGrantIds: [],
    skippedExistingGrantNames: [],
  });
  assert.deepEqual(update["system.classSkills"], { ste: true, nin: true });
  assert.deepEqual(update["system.links.supplements"], []);
  const grant = update["flags.naruto-d20.occupationGrant"];
  assert.equal(grant.applied, true);
  assert.equal(grant.sourceOccupationSlug, "academy-student");
  assert.equal(grant.selectedFeatName, "Genin");
  assert.equal(grant.wealthBonus, 1);
  assert.equal(grant.sourceOccupationItemId, "abc");
});

test("buildOccupationItemUpdate records created grant ids without relying on supplements", () => {
  const update = buildOccupationItemUpdate(
    { id: "occ1" },
    { slug: "uchiha-clan", wealthBonus: 1, reputationBonus: 1, fixedClassSkills: [] },
    { classSkillKeys: ["nin"], featName: "Genin", techniqueName: "Goukakyuu no Jutsu" },
    {
      createdGrantIds: ["feat1", "tech1"],
      skippedExistingGrantNames: [],
      featDoc: { uuid: "Compendium.naruto-d20.feats.Item.genin" },
      techDoc: { uuid: "Compendium.naruto-d20.techniques.Item.fireball" },
    },
  );

  assert.deepEqual(update["system.classSkills"], { nin: true });
  assert.deepEqual(update["system.links.supplements"], []);
  const grant = update["flags.naruto-d20.occupationGrant"];
  assert.deepEqual(grant.createdGrantIds, ["feat1", "tech1"]);
  assert.deepEqual(grant.skippedExistingGrantNames, []);
  assert.equal(grant.selectedTechniqueName, "Goukakyuu no Jutsu");
  assert.equal(grant.selectedTechniqueUuid, "Compendium.naruto-d20.techniques.Item.fireball");
});

test("buildGrantDeletionIds deletes only grants owned by the removed occupation item", () => {
  const actor = {
    items: [
      {
        id: "feat1",
        flags: { "naruto-d20": { occupationGrant: { sourceOccupationItemId: "occ1" } } },
      },
      {
        id: "tech1",
        flags: { "naruto-d20": { occupationGrant: { sourceOccupationItemId: "occ1" } } },
      },
      {
        id: "existing",
        flags: { "naruto-d20": { occupationGrant: { sourceOccupationItemId: "other" } } },
      },
      {
        id: "occ1",
        flags: { "naruto-d20": { occupationGrant: { sourceOccupationItemId: "occ1" } } },
      },
      { id: "unrelated", flags: {} },
    ],
  };

  assert.deepEqual(buildGrantDeletionIds(actor, { sourceOccupationItemId: "occ1" }), [
    "feat1",
    "tech1",
  ]);
});

test("findAppliedOccupationBySlug finds an existing applied occupation item", () => {
  const actor = {
    items: [
      {
        id: "occ1",
        flags: {
          "naruto-d20": {
            occupationGrant: { applied: true, sourceOccupationSlug: "academy-student" },
          },
        },
      },
      {
        id: "occ2",
        flags: {
          "naruto-d20": {
            occupationGrant: { applied: false, sourceOccupationSlug: "uchiha-clan" },
          },
        },
      },
    ],
  };

  assert.equal(findAppliedOccupationBySlug(actor, "academy-student")?.id, "occ1");
  assert.equal(findAppliedOccupationBySlug(actor, "uchiha-clan"), null);
});
