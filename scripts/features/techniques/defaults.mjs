const LEGACY_MAINTENANCE_KEYS = [
  "stanceMode",
  "stanceUpkeep",
  "elementChoice",
  "upkeepFormula",
  "upkeepMode",
  "upkeepWaiverStep",
  "elementDoubleStep",
];

export function legacyAutomationToMaintenance(automation = {}) {
  if (!LEGACY_MAINTENANCE_KEYS.some((key) => Object.hasOwn(automation, key))) return null;

  const upkeep = automation.stanceUpkeep === true;
  const element = automation.elementChoice === true;
  const choice = automation.stanceMode === true ? "mode" : "";
  const policy = automation.upkeepMode === "forced" ? "forced" : "prompt";

  return {
    enabled: upkeep || element || Boolean(choice),
    resource: upkeep ? "hp" : "",
    cost: upkeep ? String(automation.upkeepFormula ?? "1d4") : "",
    policy,
    interval: 1,
    waiver: upkeep && policy === "prompt" ? "step" : "",
    waiverStep: Number(automation.upkeepWaiverStep ?? 2) || 0,
    freeRounds: 5,
    choice,
    element,
    elementDoubleStep: Number(automation.elementDoubleStep ?? 5) || 0,
  };
}

export function applyTechniqueSystemDefaults(system, { collectionType = "array" } = {}) {
  system.description ??= {};
  system.description.value ??= "";
  system.description.summary ??= "";
  system.description.instructions ??= "";

  system.flags ??= {};
  system.flags.boolean ??= {};
  system.flags.dictionary ??= {};

  system.links ??= {};
  system.links.prerequisites ??= [];
  system.links.supplements ??= [];
  system.links.children ??= [];

  system.tags = normalizeCollection(system.tags, collectionType);
  system.descriptors = normalizeCollection(system.descriptors, collectionType);
  system.changes ??= [];
  system.actions ??= [];
  system.uses ??= {};
  system.uses.value ??= null;
  system.uses.max ??= null;
  system.uses.maxFormula ??= "";
  system.uses.per ??= "";
  system.uses.autoDeductChargesCost ??= "";
  system.uses.rechargeFormula ??= "";

  addDescriptorFlag(system, "isHijutsu", "Hijutsu");
  addDescriptorFlag(system, "isKinjutsu", "Kinjutsu");
  addDescriptorFlag(system, "isCombination", "Combination");

  system.learning ??= {};
  system.learning.learned ??= false;
  system.learning.progress ??= 0;
  system.learning.attemptsUsed ??= 0;
  system.learning.failureInsight ??= 0;
  system.learning.trainingBlocks ??= 0;
  system.learning.chakraSpent ??= 0;
  system.learning.lastTrainingAt ??= 0;
  system.learning.actionPointBonus ??= 0;
  system.learning.selectedDiscipline ??= "";

  // Keep these in sync with the automation schema in technique-model.mjs. The
  // synckit normalizer fills missing keys on both sides of the diff, so an
  // unedited sheet open/close (which persists the full cleaned automation block)
  // does not falsely flag a technique whose source JSON predates a field.
  // GUARD: a test introspects the schema and fails if any automation.maintenance
  // field is missing here ("backfills every automation.maintenance field
  // declared in the schema" in tests/helpers.test.mjs). Add new maintenance
  // fields to BOTH places.
  system.automation ??= {};
  system.automation.enabled ??= true;
  system.automation.targetMode ??= "auto";
  system.automation.damageTransform ??= {};
  const dt = system.automation.damageTransform;
  dt.enabled ??= false;
  dt.multiplier ??= 1;
  dt.damageType ??= "";
  system.automation.empower ??= {};
  const e = system.automation.empower;
  e.enabled ??= false;
  e.mode ??= "damageBonus";
  e.costPerStep ??= 1;
  e.formulaPerStep ??= "1d6";
  e.damageTypes ??= [];
  e.maxStepsFormula ??= "";
  e.performIncreaseEvery ??= 0;
  e.performIncreaseAmount ??= 0;
  system.automation.maintenance ??= {};
  const m = system.automation.maintenance;
  m.enabled ??= false;
  m.resource ??= "";
  m.cost ??= "1d4";
  m.policy ??= "prompt";
  m.interval ??= 1;
  m.waiver ??= "";
  m.waiverStep ??= 2;
  m.freeRounds ??= 5;
  m.choice ??= "";
  m.allowStanceStacking ??= false;
  m.heal ??= "";
  m.clearConditions ??= "";
  m.element ??= false;
  m.elementDoubleStep ??= 5;

  return system;
}

function normalizeCollection(value, collectionType) {
  const values =
    value instanceof Set
      ? Array.from(value)
      : Array.isArray(value)
        ? value
        : Object.values(value ?? {});
  return collectionType === "set" ? new Set(values) : values;
}

function addDescriptorFlag(system, flag, descriptor) {
  if (!system[flag]) return;
  if (system.descriptors instanceof Set) {
    system.descriptors.add(descriptor);
  } else if (!system.descriptors.includes(descriptor)) {
    system.descriptors.push(descriptor);
  }
}
