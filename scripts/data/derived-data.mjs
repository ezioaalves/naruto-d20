import { MODULE_ID } from "../constants.mjs";
import { LEARN_KEYS, resolveSkillAbility } from "./skills.mjs";

/**
 * Naruto D20 — Derived Data Calculations
 *
 * Two functions registered as PF1e hooks in main.mjs:
 *   prepareBaseActorData   → pf1PrepareBaseActorData  (resets computed fields so the
 *                            changes engine writes buff bonuses onto a clean slate)
 *   prepareDerivedActorData → pf1PrepareDerivedActorData (reads buff values after the
 *                            changes engine ran and computes all totals)
 *
 * Hook sequence guaranteed by PF1e:
 *   [1] pf1PrepareBaseActorData  — our schema init, buff values reset to 0
 *   [2] PF1e changes engine      — writes buffBonus values via pf1GetChangeFlat paths
 *   [3] pf1PrepareDerivedActorData — our calculations read the committed buff values
 */

/**
 * Ensure the naruto-d20 flag schema exists and reset all computed fields.
 * Called during pf1PrepareBaseActorData — before the changes engine runs.
 * @param {Actor} actor
 */
export function prepareBaseActorData(actor) {
  if (!["character", "npc"].includes(actor.type)) return;

  actor.flags[MODULE_ID] ??= {};
  const nData = actor.flags[MODULE_ID];

  // Chakra resources — keep stored values, reset computed bonus (changes engine will write it)
  nData.eps ??= 0;

  nData.chakra ??= {};
  nData.chakra.pool ??= {};
  nData.chakra.reserve ??= {};
  nData.chakra.nature ??= { primary: "", secondary: [] };
  nData.chakra.pool.value ??= 0;
  nData.chakra.pool.temp ??= 0; // temporary chakra (from Tap Reserves) — preserved, never reset
  nData.chakra.reserve.value ??= 0;
  nData.chakra.pool.maxBonus = 0;
  nData.chakra.reserve.maxBonus = 0;

  // Learn skills
  nData.learn ??= {};
  for (const key of LEARN_KEYS) {
    nData.learn[key] ??= {};
    const s = nData.learn[key];
    s.miscBonus ??= 0; // user-entered, preserve
    // Reset computed fields — will be filled in prepareDerivedActorData
    s.base = 0;
    s.abilityMod = 0;
    s.buffBonus = 0; // changes engine overwrites this in step [2]
    s.synergyBonus = 0;
    s.total = 0;
    s.conditional = 0;
  }

  // Technique DC bonuses — reset so the changes engine writes onto a clean slate.
  // "all" = global, discipline keys = per-type (read on demand in ItemAction#getDC).
  nData.techniqueDC ??= {};
  for (const k of ["all", ...LEARN_KEYS]) {
    nData.techniqueDC[k] ??= {};
    nData.techniqueDC[k].buffBonus = 0;
  }
}

/**
 * Compute all derived Shinobi statistics after the PF1e changes engine has run.
 * Called during pf1PrepareDerivedActorData — buff bonuses are already committed.
 * @param {Actor} actor
 */
export function prepareDerivedActorData(actor) {
  if (!["character", "npc"].includes(actor.type)) return;

  const nData = actor.flags[MODULE_ID];
  if (!nData) return;

  const charLevel = actor.system.details?.level?.value || actor.system.details?.cr?.total || 0;
  const conMod = actor.system.abilities?.con?.mod || 0;

  // Governing ability per discipline: read from the Skills-tab selector,
  // fall back to the canonical mapping in NARUTO_SKILLS. abilitiesShort
  // gives us localized 3-letter labels (Str/Des/Con/...) for the chat card.
  const abilityLabels = pf1.config?.abilitiesShort ?? {};

  for (const [key, s] of Object.entries(nData.learn)) {
    if (!s) continue;
    const abilityKey = resolveSkillAbility(actor, key);
    s.ability = abilityKey;
    s.abilityLabel = abilityLabels[abilityKey] ?? abilityKey;
    s.base = charLevel;
    s.abilityMod = actor.system.abilities?.[abilityKey]?.mod || 0;
    s.synergyBonus = (actor.system.skills[key]?.rank ?? 0) >= 2 ? 2 : 0;
    // buffBonus was written by the changes engine between the two hooks
    s.total =
      s.base +
      s.abilityMod +
      (Number(s.miscBonus) || 0) +
      (Number(s.buffBonus) || 0) +
      s.synergyBonus;
  }

  // Chakra maximums — conMod allowed to go negative (reduces pool)
  nData.chakra.pool.max = 2 + (2 + conMod) * charLevel + (Number(nData.chakra.pool.maxBonus) || 0);
  nData.chakra.reserve.max = 2 * charLevel + (Number(nData.chakra.reserve.maxBonus) || 0);

  // Elemental affinity: +1 Ninjutsu conditional per 5 levels starting at 1st.
  // The bonus is situational and applies only when learning a Ninjutsu
  // technique matching the actor's primary affinity, so it is kept out of
  // learn.nin.total.
  const primaryAffinity = String(nData.chakra.nature?.primary ?? "").trim();
  nData.learn.nin.conditional =
    primaryAffinity && charLevel >= 1 ? 1 + Math.floor((charLevel - 1) / 5) : 0;

  // Energy resistance from primary elemental affinity (5 at 10th, 10 at 15th, 15 at 20th)
  _applyElementalResistance(actor, nData, charLevel);
}

// ── Private helpers ───────────────────────────────────────────────────────

const ELEMENTAL_STRONG_AGAINST = {
  fire: "wind",
  wind: "lightning",
  lightning: "earth",
  earth: "water",
  water: "fire",
};

function _applyElementalResistance(actor, nData, charLevel) {
  const primary = nData.chakra.nature?.primary?.toLowerCase();
  if (!primary) return;

  let resValue = 0;
  if (charLevel >= 20) resValue = 15;
  else if (charLevel >= 15) resValue = 10;
  else if (charLevel >= 10) resValue = 5;
  if (!resValue) return;

  const resElement = ELEMENTAL_STRONG_AGAINST[primary];
  if (!resElement) return;

  actor.system.traits ??= {};
  const eres = actor.system.traits.eres;

  if (Array.isArray(eres)) {
    if (!eres.find((e) => e.types?.includes(resElement))) {
      eres.push({ amount: resValue, types: [resElement], operator: true });
    }
  } else if (typeof eres === "string") {
    if (!eres.toLowerCase().includes(resElement)) {
      actor.system.traits.eres = eres
        ? `${eres}; ${resElement} ${resValue}`
        : `${resElement} ${resValue}`;
    }
  } else {
    actor.system.traits.eres = [{ amount: resValue, types: [resElement], operator: true }];
  }
}
