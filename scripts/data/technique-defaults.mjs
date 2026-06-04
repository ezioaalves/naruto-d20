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

  system.automation ??= {};
  system.automation.enabled ??= true;
  system.automation.targetMode ??= "auto";

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
