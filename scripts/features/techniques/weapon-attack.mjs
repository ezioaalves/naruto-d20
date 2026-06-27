import { getTechniqueCasterLevel } from "./rolldata.mjs";
import { setTechniqueSaveDCContext } from "./save-dc.mjs";
import { getActiveElements } from "../automation/maintenance/element-damage.mjs";
import {
  getTechniqueDamageTransformConfig,
  markTechniqueDamageTransform,
} from "../automation/combat/damage-transform.mjs";

function deepClone(value) {
  if (globalThis.foundry?.utils?.deepClone) return foundry.utils.deepClone(value);
  return structuredClone(value);
}

function getTechniqueAttackAdjustments(technique) {
  const raw = technique.system?.attackAdjustments ?? {};
  return {
    sizeBonus: Number(raw.sizeBonus ?? 0) || 0,
    critConfirmBonus: String(raw.critConfirmBonus ?? "").trim(),
  };
}

function applyTechniqueAttackAdjustments(actionUse, technique, cleanup) {
  const { sizeBonus, critConfirmBonus } = getTechniqueAttackAdjustments(technique);
  if (!sizeBonus && !critConfirmBonus) return;

  if (critConfirmBonus) {
    const previous = actionUse.shared.action.critConfirmBonus;
    actionUse.shared.action.critConfirmBonus = previous
      ? `${previous} + ${critConfirmBonus}`
      : critConfirmBonus;
    cleanup.push(() => {
      if (previous) actionUse.shared.action.critConfirmBonus = previous;
      else delete actionUse.shared.action.critConfirmBonus;
    });
  }

  if (sizeBonus) {
    const rollData = actionUse.shared.rollData;
    const previousSize = rollData.size;
    const itemSize = rollData.item?.size;
    rollData.size = (Number(previousSize) || 0) + sizeBonus;
    if (Number.isFinite(itemSize)) rollData.item.size = itemSize + sizeBonus;
    cleanup.push(() => {
      rollData.size = previousSize;
      if (Number.isFinite(itemSize)) rollData.item.size = itemSize;
    });
  }
}

function applyEmpowerDamage(actionUse, empower, cleanup) {
  if (!empower?.steps || !empower.damageFormula) return;

  if (empower.damageTypes?.length) {
    const parts = (actionUse.shared.action.damage.parts ??= []);
    const originalLength = parts.length;
    parts.push({ formula: empower.damageFormula, types: [...empower.damageTypes] });
    cleanup.push(() => parts.splice(originalLength, 1));
  } else {
    actionUse.shared.damageBonus.push(empower.damageFormula);
  }
}

/**
 * Pick the pf1 extraAttacks type for a technique that declares manual extra attacks.
 * `iteratives === false` forces "custom" (manual attacks, no BAB iteratives). Otherwise keep a
 * manual-capable original type, falling back to "advanced" when the original type can't hold
 * manual extras.
 */
export function chooseExtraAttacksType({ originalType, originalSupportsManual, iteratives }) {
  if (iteratives === false) return "custom";
  if (!originalSupportsManual) return "advanced";
  return originalType;
}

export function getTechniqueWeaponAttackConfig(item) {
  const wa = item.system?.weaponAttack;
  if (!wa?.enabled) return null;

  const suppressions = [];
  if (wa.suppressNaturalAttack) suppressions.push("naturalAttack");
  if (wa.suppressAbilityDamage) suppressions.push("abilityDamage");

  return {
    filter: wa.filter,
    damageMode: wa.damageMode,
    attackBonus: String(wa.attackBonus ?? ""),
    damageBonus: String(wa.damageBonus ?? ""),
    nonCritDamageBonus: String(wa.nonCritDamageBonus ?? ""),
    extraAttacks: (wa.extraAttacks ?? []).filter((e) => e.formula),
    held: wa.held ?? "",
    charge: wa.charge === true,
    iteratives: wa.iteratives !== false,
    suppressedBonuses: suppressions,
  };
}

export async function rollSelectedWeaponAttackWithTechnique({
  technique,
  techniqueAction,
  actor,
  config,
  event,
  token = null,
  empower = null,
}) {
  const selection = await selectTechniqueWeaponAttack(actor, technique, config);
  if (!selection) return null;

  const hook = (actionUse) => {
    if (actionUse.actor?.id !== actor.id) return;
    if (actionUse.item?.id !== selection.item.id) return;
    if (actionUse.action?.id !== selection.action.id) return;

    decorateActionUseChatData(actionUse, technique, techniqueAction);

    actionUse.shared.rollData.cl = getTechniqueCasterLevel(technique, actor);
    applyTechniqueSave(actionUse, technique, techniqueAction, cleanup);
    markTechniqueDamageTransform(actionUse, getTechniqueDamageTransformConfig(technique), cleanup);
    if (config.damageMode === "replace") {
      replaceActionDetails(actionUse, techniqueAction, cleanup);
      applyTechniqueElementDamageToActionUse(
        actionUse,
        getActiveElements(actor, technique),
        cleanup,
      );
    }
    applyTechniqueBonusSuppressions(actionUse, config.suppressedBonuses, cleanup);
    if (config.attackBonus) actionUse.shared.attackBonus.push(config.attackBonus);
    if (config.damageBonus) actionUse.shared.damageBonus.push(config.damageBonus);
    if (config.nonCritDamageBonus) {
      const nonCritParts = (actionUse.shared.action.damage.nonCritParts ??= []);
      const originalLength = nonCritParts.length;
      nonCritParts.push({ formula: config.nonCritDamageBonus, types: [] });
      cleanup.push(() => nonCritParts.splice(originalLength, 1));
    }

    applyTechniqueAttackAdjustments(actionUse, technique, cleanup);
    applyEmpowerDamage(actionUse, empower, cleanup);

    if (config.extraAttacks?.length) {
      const exAtk = actionUse.shared.action.extraAttacks;
      const originalType = exAtk?.type;
      const originalSupportsManual = pf1.config.extraAttacks[originalType]?.manual === true;
      exAtk.type = chooseExtraAttacksType({
        originalType,
        originalSupportsManual,
        iteratives: config.iteratives,
      });
      const manual = (exAtk.manual ??= []);
      const originalLength = manual.length;
      for (const atk of config.extraAttacks) manual.push(atk);
      cleanup.push(() => {
        exAtk.type = originalType;
        manual.splice(originalLength);
      });
    }
  };

  const cleanup = [];
  Hooks.on("pf1CreateActionUse", hook);
  try {
    const options = {};
    if (config.held) options.held = config.held;
    if (config.charge) options.charge = true;

    return await selection.item.use({
      actionId: selection.action.id,
      skipDialog: false,
      ev: event,
      token,
      options,
    });
  } finally {
    Hooks.off("pf1CreateActionUse", hook);
    for (const restore of cleanup.reverse()) restore();
  }
}

export function applyTechniqueBonusSuppressions(actionUse, suppressions = [], cleanup = []) {
  if (!suppressions?.length) return;

  const actions = [actionUse.shared?.action, actionUse.shared?.rollData?.action].filter(Boolean);
  const uniqueActions = Array.from(new Set(actions));
  if (suppressions.includes("abilityDamage")) {
    for (const action of uniqueActions) suppressAbilityDamage(action, cleanup);
  }
  if (suppressions.includes("naturalAttack")) {
    for (const action of uniqueActions) suppressNaturalAttackBonuses(action, cleanup);
  }
}

function suppressAbilityDamage(action, cleanup) {
  action.ability ??= {};
  const previous = action.ability.damage;
  action.ability.damage = "";
  cleanup.push(() => {
    action.ability.damage = previous;
  });
}

function suppressNaturalAttackBonuses(action, cleanup) {
  const previousAttackBonus = action.attackBonus;
  action.attackBonus = "";
  cleanup.push(() => {
    action.attackBonus = previousAttackBonus;
  });

  suppressNaturalAttackContexts(action, cleanup);

  const secondary = action.naturalAttack?.secondary;
  if (!secondary) return;

  const previousSecondaryAttackBonus = secondary.attackBonus;
  secondary.attackBonus = "0";
  cleanup.push(() => {
    secondary.attackBonus = previousSecondaryAttackBonus;
  });
}

function suppressNaturalAttackContexts(action, cleanup) {
  const item = action.item;
  if (typeof item?.getContextChanges !== "function") return;

  const previousGetContextChanges = item.getContextChanges;
  item.getContextChanges = function narutoTechniqueGetContextChanges(contexts, ...args) {
    if (Array.isArray(contexts)) {
      return previousGetContextChanges.call(
        this,
        contexts.filter((context) => context !== "nattack"),
        ...args,
      );
    }
    return previousGetContextChanges.call(this, contexts, ...args);
  };
  cleanup.push(() => {
    item.getContextChanges = previousGetContextChanges;
  });
}

export function applyTechniqueElementDamageToActionUse(actionUse, elements, cleanup = []) {
  if (!Array.isArray(elements) || !elements.length) return;

  const actions = [actionUse.shared?.action, actionUse.shared?.rollData?.action].filter(Boolean);
  const uniqueActions = Array.from(new Set(actions));
  for (const action of uniqueActions)
    applyTechniqueElementDamageToAction(action, elements, cleanup);
}

function applyTechniqueElementDamageToAction(action, elements, cleanup) {
  action.damage ??= {};
  const parts = (action.damage.parts ??= []);
  if (!parts.length) return;

  const snapshot = deepClone(parts);
  const first = parts[0];
  if (elements.length >= 2) {
    first.formula = "1d6";
    first.types = [elements[0]];
    parts.splice(1, 0, { formula: "1d6", types: [elements[1]] });
  } else {
    first.types = [elements[0]];
  }

  cleanup.push(() => {
    action.damage.parts = deepClone(snapshot);
  });
}

function decorateActionUseChatData(actionUse, technique, techniqueAction) {
  if (actionUse.getMessageData.__narutoTechniqueDecorated) return;

  const getMessageData = actionUse.getMessageData;
  actionUse.getMessageData = async function narutoTechniqueGetMessageData(...args) {
    const result = await getMessageData.apply(this, args);
    await applyTechniqueChatData(this, technique, techniqueAction);
    return result;
  };
  actionUse.getMessageData.__narutoTechniqueDecorated = true;
}

async function applyTechniqueChatData(actionUse, technique, techniqueAction) {
  const templateData = actionUse.shared.templateData;
  if (!templateData) return;

  const itemChatData = await technique.getChatData({
    actionId: techniqueAction.id,
    chatcard: true,
    rollData: actionUse.shared.rollData,
  });

  const identified = Boolean(actionUse.shared.rollData.item?.identified ?? true);
  templateData.actionId = techniqueAction.id;
  templateData.name = identified
    ? `${technique.name} (${techniqueAction.name})`
    : technique.getName(true);
  templateData.description = identified
    ? itemChatData.identifiedDescription
    : itemChatData.unidentifiedDescription;
  templateData.actionDescription = itemChatData.actionDescription;
  templateData.item = technique.toObject();
  templateData.action = techniqueAction;
  templateData.header = {
    ...(templateData.header ?? {}),
    image: techniqueAction.img || technique.img,
  };

  const info = templateData.properties?.find((p) => p.css === "common-notes");
  if (info) {
    const techniqueProperties = (itemChatData.properties ?? []).map((text) => ({ text }));
    const selectedOnly = (info.value ?? []).filter(
      (note) => !techniqueProperties.some((p) => p.text === note.text),
    );
    info.value = [...techniqueProperties, ...selectedOnly];
  }

  const metadata = actionUse.shared.chatData?.system;
  if (metadata) {
    metadata.item = {
      ...(metadata.item ?? {}),
      id: technique.id,
      name: technique.name,
      description: itemChatData.identifiedDescription,
      identified,
    };
    metadata.action = {
      ...(metadata.action ?? {}),
      id: techniqueAction.id,
      name: techniqueAction.name,
      description: itemChatData.actionDescription,
    };
  }
}

function applyTechniqueSave(actionUse, technique, techniqueAction, cleanup) {
  if (!techniqueAction?.save?.type) return;

  const selectedAction = actionUse.shared.action;
  const selectedRollAction = actionUse.shared.rollData?.action;
  if (!selectedAction || !selectedRollAction) return;

  const actionSave = cloneSave(selectedAction.save);
  const rollSave = cloneSave(selectedRollAction.save);
  selectedAction.save = cloneSave(techniqueAction.save);
  selectedRollAction.save = cloneSave(techniqueAction.save);

  const clearDCContext = setTechniqueSaveDCContext(selectedAction, technique, techniqueAction);
  const dcBonus = actionUse.shared.rollData.dcBonus ?? 0;
  actionUse.shared.rollData.dc = selectedAction.getDC(actionUse.shared.rollData) - dcBonus;
  cleanup.push(() => {
    clearDCContext();
    selectedAction.save = actionSave;
    selectedRollAction.save = rollSave;
  });
}

function replaceActionDetails(actionUse, techniqueAction, cleanup) {
  const selectedAction = actionUse.shared.action;
  const selectedRollAction = actionUse.shared.rollData?.action;
  if (!selectedAction || !selectedRollAction || !techniqueAction) return;

  const actionSnapshot = {
    damage: cloneDamage(selectedAction.damage),
    ability: cloneDamageAbility(selectedAction.ability),
    notes: cloneNotes(selectedAction.notes),
    range: foundry.utils.deepClone(selectedAction.range ?? {}),
    target: foundry.utils.deepClone(selectedAction.target ?? {}),
    touch: selectedAction.touch,
  };
  const rollSnapshot = {
    damage: cloneDamage(selectedRollAction.damage),
    ability: cloneDamageAbility(selectedRollAction.ability),
    notes: cloneNotes(selectedRollAction.notes),
    range: foundry.utils.deepClone(selectedRollAction.range ?? {}),
    target: foundry.utils.deepClone(selectedRollAction.target ?? {}),
    touch: selectedRollAction.touch,
  };

  applyActionReplacement(selectedAction, techniqueAction);
  applyActionReplacement(selectedRollAction, techniqueAction);

  cleanup.push(() => {
    restoreActionReplacement(selectedAction, actionSnapshot);
    restoreActionReplacement(selectedRollAction, rollSnapshot);
  });
}

function applyActionReplacement(targetAction, sourceAction) {
  targetAction.damage ??= {};
  targetAction.ability ??= {};
  targetAction.notes ??= {};

  targetAction.damage.parts = foundry.utils.deepClone(sourceAction.damage?.parts ?? []);
  targetAction.damage.critParts = foundry.utils.deepClone(sourceAction.damage?.critParts ?? []);
  targetAction.damage.nonCritParts = foundry.utils.deepClone(
    sourceAction.damage?.nonCritParts ?? [],
  );
  targetAction.touch = sourceAction.touch === true;

  const sourceAbility = sourceAction.ability ?? {};
  targetAction.ability.damage = sourceAbility.damage ?? "";
  targetAction.ability.damageMult = sourceAbility.damageMult ?? null;
  targetAction.ability.critRange = sourceAbility.critRange ?? 20;
  targetAction.ability.critMult = sourceAbility.critMult ?? 2;

  targetAction.notes.effect = foundry.utils.deepClone(sourceAction.notes?.effect ?? []);
  targetAction.notes.footer = foundry.utils.deepClone(sourceAction.notes?.footer ?? []);
  targetAction.range = foundry.utils.deepClone(sourceAction.range ?? {});
  targetAction.target = foundry.utils.deepClone(sourceAction.target ?? {});
}

function restoreActionReplacement(targetAction, snapshot) {
  targetAction.damage ??= {};
  targetAction.ability ??= {};
  targetAction.notes ??= {};

  targetAction.damage.parts = foundry.utils.deepClone(snapshot.damage.parts);
  targetAction.damage.critParts = foundry.utils.deepClone(snapshot.damage.critParts);
  targetAction.damage.nonCritParts = foundry.utils.deepClone(snapshot.damage.nonCritParts);
  targetAction.touch = snapshot.touch;

  targetAction.ability.damage = snapshot.ability.damage;
  targetAction.ability.damageMult = snapshot.ability.damageMult;
  targetAction.ability.critRange = snapshot.ability.critRange;
  targetAction.ability.critMult = snapshot.ability.critMult;
  targetAction.notes.effect = foundry.utils.deepClone(snapshot.notes.effect);
  targetAction.notes.footer = foundry.utils.deepClone(snapshot.notes.footer);
  targetAction.range = foundry.utils.deepClone(snapshot.range);
  targetAction.target = foundry.utils.deepClone(snapshot.target);
}

function cloneDamage(damage) {
  damage ??= {};
  return {
    parts: foundry.utils.deepClone(damage.parts ?? []),
    critParts: foundry.utils.deepClone(damage.critParts ?? []),
    nonCritParts: foundry.utils.deepClone(damage.nonCritParts ?? []),
  };
}

function cloneDamageAbility(ability) {
  ability ??= {};
  return {
    damage: ability.damage ?? "",
    damageMult: ability.damageMult ?? null,
    critRange: ability.critRange ?? 20,
    critMult: ability.critMult ?? 2,
  };
}

function cloneSave(save) {
  return foundry.utils.deepClone(save ?? {});
}

function cloneNotes(notes) {
  notes ??= {};
  return {
    effect: foundry.utils.deepClone(notes.effect ?? []),
    footer: foundry.utils.deepClone(notes.footer ?? []),
  };
}

/**
 * Lowercased descriptors that mean the technique strikes with an unarmed/natural
 * attack. `"Armed or Punch"` carries both an unarmed (punch) and an armed sense
 * and is handled in deriveAttackCategories.
 */
const UNARMED_DESCRIPTORS = new Set(["kick", "punch", "kick or punch", "punch or kick"]);

function normalizeDescriptorSet(descriptors) {
  const out = new Set();
  const add = (v) => {
    if (typeof v === "string") out.add(v.trim().toLowerCase());
  };
  if (descriptors instanceof Set || Array.isArray(descriptors)) {
    for (const d of descriptors) add(d);
  } else if (descriptors && typeof descriptors === "object") {
    for (const [k, v] of Object.entries(descriptors)) if (v === true) add(k);
  }
  return out;
}

/**
 * Derive which attack categories a technique may roll from its descriptors.
 * Unarmed descriptors (kick/punch variants) → natural attacks; `"Armed"` →
 * weapon attacks; `"Armed or Punch"` → both. Returns `{ allowUnarmed, allowArmed }`;
 * both false means the descriptors give no signal (caller falls back to filter).
 */
export function deriveAttackCategories(descriptors) {
  const set = normalizeDescriptorSet(descriptors);
  const hasArmedOrPunch = set.has("armed or punch");
  let allowUnarmed = hasArmedOrPunch;
  for (const d of UNARMED_DESCRIPTORS) {
    if (set.has(d)) {
      allowUnarmed = true;
      break;
    }
  }
  const allowArmed = set.has("armed") || hasArmedOrPunch;
  return { allowUnarmed, allowArmed };
}

/** Map a weaponAttack.filter value to unarmed/armed categories (fallback when
 *  descriptors give no signal). */
function categoriesFromFilter(filter) {
  if (filter === "unarmedOnly") return { allowUnarmed: true, allowArmed: false };
  if (filter === "meleeOrUnarmed") return { allowUnarmed: true, allowArmed: true };
  // meleeWeapon / rangedWeapon (and anything else) → armed weapons only
  return { allowUnarmed: false, allowArmed: true };
}

async function selectTechniqueWeaponAttack(actor, technique, config) {
  // The filter is the explicit UI configuration; use it as the authoritative source.
  // Before the weapon-attack UI existed, descriptors were the primary signal and the
  // filter was a fallback. Now that the filter is user-configured, descriptors would
  // override an intentional filter change (e.g. switching from "unarmedOnly" to
  // "meleeOrUnarmed" on a "Punch" technique had no effect).
  const categories = categoriesFromFilter(config.filter);
  const choices = collectTechniqueWeaponAttackChoices(actor, {
    allowUnarmed: categories.allowUnarmed,
    allowArmed: categories.allowArmed,
    weaponFilter: config.filter,
  });
  if (!choices.length) {
    ui.notifications.warn(
      game.i18n.format("NarutoD20.Notifications.NoWeaponAttack", {
        actor: actor.name,
        name: technique.name,
      }),
    );
    return null;
  }

  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    const content = renderWeaponAttackSelectorContent(choices);
    const dialog = new Dialog({
      title: game.i18n.format("NarutoD20.App.ChooseAttack", { name: technique.name }),
      content,
      buttons: {
        roll: {
          label: game.i18n.localize("PF1.Roll"),
          callback: (html) => {
            const index = Number(html.find("input[name='weapon-attack-choice']:checked").val());
            finish(Number.isInteger(index) ? choices[index] : null);
          },
        },
        cancel: {
          label: game.i18n.localize("Cancel"),
          callback: () => finish(null),
        },
      },
      default: "roll",
      close: () => finish(null),
    });
    dialog.render(true);
  });
}

function collectTechniqueWeaponAttackChoices(actor, { allowUnarmed, allowArmed, weaponFilter }) {
  const choices = [];
  const attackItems = actor.itemTypes?.attack ?? actor.items.filter((i) => i.type === "attack");

  // Unarmed: natural/unarmed attack items only (PF1e stamps subType "natural").
  if (allowUnarmed) {
    for (const item of attackItems) {
      if (item.system?.subType !== "natural") continue;
      addItemAttackChoices(choices, item, "attack", "any");
    }
  }

  // Armed: equipped weapons + weapon-derived attack items (subType "weapon").
  // Descriptors can't express melee vs ranged, so the weaponAttack.filter does.
  if (allowArmed) {
    const rangeMode = weaponFilter === "rangedWeapon" ? "ranged" : "melee";
    const weaponItems = actor.itemTypes?.weapon ?? actor.items.filter((i) => i.type === "weapon");
    for (const item of weaponItems) {
      if (item.system?.equipped !== true) continue;
      addItemAttackChoices(choices, item, "weapon", rangeMode);
    }
    for (const item of attackItems) {
      if (item.system?.subType !== "weapon") continue;
      addItemAttackChoices(choices, item, "attack", rangeMode);
    }
  }

  return choices;
}

/** rangeMode: "melee" (exclude ranged) | "ranged" (only ranged) | "any". */
function addItemAttackChoices(choices, item, kind, rangeMode) {
  for (const action of item.actions ?? []) {
    if (!action.hasAttack) continue;
    if (rangeMode === "melee" && action.isRanged) continue;
    if (rangeMode === "ranged" && !action.isRanged) continue;
    choices.push({ item, action, kind });
  }
}

function renderWeaponAttackSelectorContent(choices) {
  const rows = choices
    .map(({ item, action, kind }, index) => {
      const checked = index === 0 ? "checked" : "";
      const actionName =
        action.name && action.name !== item.name ? ` - ${escapeHTML(action.name)}` : "";
      const kindLabel = game.i18n.localize(
        kind === "weapon" ? "NarutoD20.App.KindWeapon" : "NarutoD20.App.KindAttack",
      );
      return `
            <label style="display:flex; align-items:center; gap:6px; margin:3px 0; cursor:pointer;">
                <input type="radio" name="weapon-attack-choice" value="${index}" ${checked} style="flex-shrink:0; margin:0;">
                <img src="${escapeHTML(item.img)}" width="28" height="28" style="border:0; flex-shrink:0; object-fit:contain;">
                <span style="line-height:1.2;">
                    <strong style="display:block; font-size:0.85em;">${escapeHTML(item.name)}${actionName}</strong>
                    <small style="color:#888;">${kindLabel}</small>
                </span>
            </label>
        `;
    })
    .join("");

  return `<form><div class="form-group stacked">${rows}</div></form>`;
}

function escapeHTML(value) {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (char) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[char],
  );
}
