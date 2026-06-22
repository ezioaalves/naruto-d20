const TRANSFORM_PROPERTY = "__narutoD20DamageTransform";
const REPEAT_PROPERTY = "__narutoD20DamageTransformRepeat";
const MULTIPLIED_PART_TYPES = new Set(["normal", "crit"]);
let rollDamagePatchInstalled = false;

export function normalizeTechniqueDamageTransform(raw) {
  if (!raw?.enabled) return null;

  const multiplier = Math.max(1, Math.floor(Number(raw.multiplier ?? 1) || 1));
  const damageType = String(raw.damageType ?? "").trim();
  const label = String(raw.label ?? "").trim();
  if (multiplier <= 1 && !damageType) return null;

  return { enabled: true, multiplier, damageType, label };
}

export function getTechniqueDamageTransformConfig(item) {
  return normalizeTechniqueDamageTransform(item?.system?.automation?.damageTransform);
}

export function markTechniqueDamageTransform(actionUse, config, cleanup = []) {
  if (!config) return;

  const action = actionUse?.shared?.action;
  if (!action) return;

  const previous = action[TRANSFORM_PROPERTY];
  action[TRANSFORM_PROPERTY] = config;
  cleanup.push(() => {
    if (previous === undefined) delete action[TRANSFORM_PROPERTY];
    else action[TRANSFORM_PROPERTY] = previous;
  });
}

export function techniqueDamageTransformRepeatCount(config) {
  const multiplier = Math.max(1, Math.floor(Number(config?.multiplier ?? 1) || 1));
  return Math.max(0, multiplier - 1);
}

export function applyTechniqueDamageTransformToParts(
  parts,
  config,
  { repeatOnlyMultiplied = false } = {},
) {
  if (!Array.isArray(parts) || !config) return;

  const multiplier = Math.max(1, Math.floor(Number(config.multiplier ?? 1) || 1));
  const damageType = String(config.damageType ?? "").trim();
  if (multiplier <= 1 && !damageType) return;

  const transformed = [];
  for (const part of parts) {
    if (repeatOnlyMultiplied && !MULTIPLIED_PART_TYPES.has(part?.type)) continue;

    const current = cloneDamageRollPart(part);
    if (damageType) current.damageType = [damageType];
    transformed.push(current);
  }

  parts.splice(0, parts.length, ...transformed);
}

export function registerTechniqueDamageTransforms() {
  installDamageRollMultiplierPatch();

  Hooks.on("pf1PreDamageRoll", (action, _rollData, parts) => {
    applyTechniqueDamageTransformToParts(parts, action?.[TRANSFORM_PROPERTY], {
      repeatOnlyMultiplied: action?.[REPEAT_PROPERTY] === true,
    });
  });
}

function installDamageRollMultiplierPatch() {
  if (rollDamagePatchInstalled) return;
  const ItemAction = globalThis.pf1?.components?.ItemAction;
  const original = ItemAction?.prototype?.rollDamage;
  if (typeof original !== "function") return;

  rollDamagePatchInstalled = true;
  ItemAction.prototype.rollDamage = async function narutoD20RollDamageWithTransform(options = {}) {
    const config = this?.[TRANSFORM_PROPERTY];
    const repeatCount = techniqueDamageTransformRepeatCount(config);
    const rolls = await original.call(this, options);
    if (!repeatCount || this?.[REPEAT_PROPERTY]) return rolls;

    const repeated = [...rolls];
    const previous = this[REPEAT_PROPERTY];
    this[REPEAT_PROPERTY] = true;
    try {
      for (let i = 0; i < repeatCount; i++) {
        repeated.push(...(await original.call(this, options)));
      }
    } finally {
      if (previous === undefined) delete this[REPEAT_PROPERTY];
      else this[REPEAT_PROPERTY] = previous;
    }

    return repeated;
  };
}

function cloneDamageRollPart(part) {
  return {
    ...part,
    extra: Array.isArray(part?.extra) ? [...part.extra] : [],
    damageType: Array.isArray(part?.damageType) ? [...part.damageType] : part?.damageType,
  };
}
