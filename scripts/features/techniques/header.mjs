/**
 * Naruto D20 — Technique stat-block header
 *
 * Single source of truth for the auto-generated technique "stat block" rendered
 * from `templates/item/technique-header.hbs`. Used both above the description on
 * the technique item sheet (as `topDescription`) and prepended into the chat-card
 * description via the `getDescription` wrap in `render-patch.mjs` — mirroring how
 * PF1e's `ItemSpellPF.getDescription` prepends `spell-header.hbs`.
 */

import { MODULE_ID } from "../../core/constants.mjs";
import { DISCIPLINE_SKILL_MAP } from "../actor-stats/skills.mjs";

// Component flag → abbreviation label. Order matters for the rendered string.
const COMPONENT_FIELDS = [
  ["compHandSeals", "NarutoD20.Technique.Components.HandSeals.Label"],
  ["compHalfSeals", "NarutoD20.Technique.Components.HalfSeals.Label"],
  ["compConcentration", "NarutoD20.Technique.Components.Concentration.Label"],
  ["compMobility", "NarutoD20.Technique.Components.Mobility.Label"],
  ["compFocus", "NarutoD20.Technique.Components.MaterialFocus.Label"],
  ["compEmpower", "NarutoD20.Technique.Components.Empower.Label"],
  ["compMastery", "NarutoD20.Technique.Components.Mastery.Label"],
  ["compExpendable", "NarutoD20.Technique.Components.Expendable.Label"],
  ["compPhysical", "NarutoD20.Technique.Components.PhysicalHealth.Label"],
  ["compXpCost", "NarutoD20.Technique.Components.XpCost.Label"],
];

/**
 * Build the template context for `technique-header.hbs` from a technique item.
 *
 * @param {Item} item - The technique item.
 * @returns {object} Header template data.
 */
export function buildTechniqueHeaderData(item) {
  const system = item.system;
  const derived = system.derived;
  const loc = (k) => game.i18n.localize(k);

  const components = COMPONENT_FIELDS.filter(([field]) => system[field])
    .map(([, key]) => loc(key))
    .join(", ");

  return {
    discipline: system.discipline || "—",
    rank: system.rank,
    complexity: system.complexity || "—",
    chakraCost: system.chakraCost ?? 0,
    learnDC: derived.learnDC,
    successes: derived.successes,
    hasPerform: !!DISCIPLINE_SKILL_MAP[system.discipline],
    threshold: derived.skillThreshold,
    performDC: derived.performDC,
    components,
  };
}

/**
 * Render the technique stat-block header to HTML.
 *
 * @param {Item} item - The technique item.
 * @param {object} [extra] - Extra template context (e.g. `{ chatcard: true }`).
 * @returns {Promise<string>} Rendered header HTML.
 */
export function renderTechniqueHeader(item, extra = {}) {
  return foundry.applications.handlebars.renderTemplate(
    `modules/${MODULE_ID}/templates/item/technique-header.hbs`,
    { ...buildTechniqueHeaderData(item), ...extra },
  );
}
