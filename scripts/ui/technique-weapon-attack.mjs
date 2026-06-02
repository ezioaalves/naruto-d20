import { getTechniqueCasterLevel } from "../data/technique-rolldata.mjs";

const CONFIG_PREFIX = "weaponAttack";
const DEFAULT_FILTER = "meleeWeapon";
const SUPPORTED_MODES = new Set(["selected"]);
const SUPPORTED_FILTERS = new Set(["meleeWeapon", "rangedWeapon", "unarmedOnly", "meleeOrUnarmed"]);
const KNOWN_KEYS = new Set(["mode", "filter", "attackBonus", "damageBonus", "held", "charge"]);
const ISSUE_TEMPLATES = {
  Malformed: '"{prefix}" must be an object or use dotted "{prefix}.*" keys',
  UnknownField: 'unknown field "{field}"',
  MissingMode: 'missing "{field}" (expected "{expected}")',
  UnsupportedMode: 'unsupported "{field}" = "{value}" (expected "{expected}")',
  UnsupportedFilter: 'unsupported "{field}" = "{value}"; using "{fallback}"',
  InvalidBoolean: '"{field}" should be "true" or "false" (got "{value}")',
};

function formatIssueTemplate(template, data) {
  return template.replace(/\{(\w+)\}/g, (_, key) => String(data[key] ?? `{${key}}`));
}

function formatWeaponAttackIssue(key, data = {}) {
  const i18nKey = `NarutoD20.WeaponAttackIssues.${key}`;
  if (globalThis.game?.i18n?.format) return globalThis.game.i18n.format(i18nKey, data);
  return formatIssueTemplate(ISSUE_TEMPLATES[key] ?? key, data);
}

/**
 * Read the `system.flags.dictionary.weaponAttack` config in both supported
 * shapes — a nested object (`weaponAttack: { mode, filter, … }`) and dotted
 * keys (`"weaponAttack.mode"`, …) — with the nested object taking precedence.
 * Returns `{ present, values, keys, malformed }` so callers can validate.
 */
export function readWeaponAttackRaw(item) {
  const dict = item.system?.flags?.dictionary ?? {};
  const rawNested = dict[CONFIG_PREFIX];
  const nested = rawNested && typeof rawNested === "object" ? rawNested : null;
  const malformed = rawNested !== undefined && nested === null;

  const dottedKeys = Object.keys(dict).filter((k) => k.startsWith(`${CONFIG_PREFIX}.`));
  const present = malformed || nested !== null || dottedKeys.length > 0;

  const keys = new Set();
  const values = {};
  if (nested) {
    for (const k of Object.keys(nested)) {
      keys.add(k);
      values[k] = nested[k];
    }
  }
  for (const dk of dottedKeys) {
    const k = dk.slice(CONFIG_PREFIX.length + 1);
    keys.add(k);
    values[k] ??= dict[dk]; // nested wins (matches the original read() precedence)
  }
  return { present, values, keys, malformed };
}

/** Validate raw weaponAttack values, returning a usable config (or null) plus
 *  human-readable warnings naming the offending field. */
export function parseWeaponAttackConfig({ values, keys, malformed }) {
  const warnings = [];
  const str = (key) => String(values[key] ?? "").trim();
  const issue = (key, data = {}) => formatWeaponAttackIssue(key, data);

  if (malformed) warnings.push(issue("Malformed", { prefix: CONFIG_PREFIX }));
  for (const k of keys) {
    if (!KNOWN_KEYS.has(k))
      warnings.push(issue("UnknownField", { field: `${CONFIG_PREFIX}.${k}` }));
  }

  const mode = str("mode");
  if (!mode) {
    if (!malformed)
      warnings.push(issue("MissingMode", { field: `${CONFIG_PREFIX}.mode`, expected: "selected" }));
    return { config: null, warnings };
  }
  if (!SUPPORTED_MODES.has(mode)) {
    warnings.push(
      issue("UnsupportedMode", {
        field: `${CONFIG_PREFIX}.mode`,
        value: mode,
        expected: "selected",
      }),
    );
    return { config: null, warnings };
  }

  let filter = str("filter") || DEFAULT_FILTER;
  if (!SUPPORTED_FILTERS.has(filter)) {
    warnings.push(
      issue("UnsupportedFilter", {
        field: `${CONFIG_PREFIX}.filter`,
        value: filter,
        fallback: DEFAULT_FILTER,
      }),
    );
    filter = DEFAULT_FILTER;
  }

  const chargeRaw = str("charge").toLowerCase();
  if (chargeRaw && chargeRaw !== "true" && chargeRaw !== "false") {
    warnings.push(
      issue("InvalidBoolean", {
        field: `${CONFIG_PREFIX}.charge`,
        value: chargeRaw,
      }),
    );
  }

  return {
    config: {
      mode,
      filter,
      attackBonus: str("attackBonus"),
      damageBonus: str("damageBonus"),
      held: str("held"),
      charge: chargeRaw === "true",
    },
    warnings,
  };
}

function reportWeaponAttackWarnings(item, warnings) {
  if (!warnings.length) return;
  const issues = warnings.join("; ");
  console.warn(`naruto-d20 | weaponAttack config on "${item.name}": ${issues}`);
  ui.notifications.warn(
    game.i18n.format("NarutoD20.Notifications.WeaponAttackConfig", { name: item.name, issues }),
  );
}

export function getTechniqueWeaponAttackConfig(item) {
  const raw = readWeaponAttackRaw(item);
  if (!raw.present) return null; // no weaponAttack config → normal technique flow

  const { config, warnings } = parseWeaponAttackConfig(raw);
  reportWeaponAttackWarnings(item, warnings);
  return config;
}

export async function rollSelectedWeaponAttackWithTechnique({ technique, actor, config, event }) {
  const selection = await selectTechniqueWeaponAttack(actor, technique, config);
  if (!selection) return null;

  const hook = (actionUse) => {
    if (actionUse.actor?.id !== actor.id) return;
    if (actionUse.item?.id !== selection.item.id) return;
    if (actionUse.action?.id !== selection.action.id) return;

    actionUse.shared.rollData.cl = getTechniqueCasterLevel(technique, actor);
    if (config.attackBonus) actionUse.shared.attackBonus.push(config.attackBonus);
    if (config.damageBonus) actionUse.shared.damageBonus.push(config.damageBonus);
  };

  Hooks.on("pf1CreateActionUse", hook);
  try {
    const options = {};
    if (config.held) options.held = config.held;
    if (config.charge) options.charge = true;

    return await selection.item.use({
      actionId: selection.action.id,
      skipDialog: false,
      ev: event,
      options,
    });
  } finally {
    Hooks.off("pf1CreateActionUse", hook);
  }
}

async function selectTechniqueWeaponAttack(actor, technique, config) {
  const choices = collectTechniqueWeaponAttackChoices(actor, config.filter);
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

function collectTechniqueWeaponAttackChoices(actor, filter) {
  const choices = [];

  if (filter === "unarmedOnly") {
    const attackItems = actor.itemTypes?.attack ?? actor.items.filter((i) => i.type === "attack");
    for (const item of attackItems) {
      addItemAttackChoices(choices, item, "attack", false);
    }
    return choices;
  }

  if (filter === "rangedWeapon") {
    const weaponItems = actor.itemTypes?.weapon ?? actor.items.filter((i) => i.type === "weapon");
    for (const item of weaponItems) {
      if (item.system?.equipped !== true) continue;
      addItemAttackChoices(choices, item, "weapon", true);
    }
    return choices;
  }

  // meleeWeapon (default) and meleeOrUnarmed
  const weaponItems = actor.itemTypes?.weapon ?? actor.items.filter((i) => i.type === "weapon");
  for (const item of weaponItems) {
    if (item.system?.equipped !== true) continue;
    addItemAttackChoices(choices, item, "weapon", false);
  }

  if (filter === "meleeOrUnarmed") {
    const attackItems = actor.itemTypes?.attack ?? actor.items.filter((i) => i.type === "attack");
    for (const item of attackItems) {
      addItemAttackChoices(choices, item, "attack", false);
    }
  }

  return choices;
}

function addItemAttackChoices(choices, item, kind, rangedOnly) {
  for (const action of item.actions ?? []) {
    if (!action.hasAttack) continue;
    if (rangedOnly && !action.isRanged) continue;
    if (!rangedOnly && action.isRanged) continue;
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
