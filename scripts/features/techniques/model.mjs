/**
 * Naruto D20 — Technique Data Model
 *
 * Bare TypeDataModel with a schema shaped to integrate with PF1e v11.11's
 * changes engine and sheet conventions, without inheriting PF1e's own
 * model classes (whose internals assume PF1e's full action pipeline).
 *
 * Changes integration: `changes` is a plain ArrayField; `hasChanges` returns
 * true so ItemPF#_prepareChanges constructs ItemChange instances from the
 * array automatically and populates `item.changes`.
 */

import { createActionId, isValidActionId } from "./action-ids.mjs";
import {
  applyTechniqueSystemDefaults,
  legacyAutomationToMaintenance,
} from "./defaults.mjs";

/** Complexity lookup — Appendix B, Table B-1. */
export const COMPLEXITY_TABLE = {
  "Extremely Easy": { learnMod: 1, successes: 1, skillMod: 0, performMod: -10 },
  "Very Easy": { learnMod: 1, successes: 1, skillMod: 0, performMod: -5 },
  Easy: { learnMod: 1, successes: 1, skillMod: 0, performMod: -1 },
  "E-Class": { learnMod: 1, successes: 1, skillMod: 0, performMod: 0 },
  "D-Class": { learnMod: 2, successes: 1, skillMod: 0, performMod: 1 },
  "C-Class": { learnMod: 3, successes: 2, skillMod: 1, performMod: 3 },
  "B-Class": { learnMod: 4, successes: 3, skillMod: 2, performMod: 5 },
  "A-Class": { learnMod: 5, successes: 4, skillMod: 3, performMod: 7 },
  "S-Class": { learnMod: 6, successes: 5, skillMod: 4, performMod: 10 },
  "SS-Class": { learnMod: 7, successes: 6, skillMod: 5, performMod: 15 },
  Epic: { learnMod: 15, successes: 8, skillMod: 8, performMod: 20 },
};

/** Mastery bonuses by step (0–5). Index = mastery step. See transcricao_tecnicas.md. */
export const MASTERY_PERFORM = [0, 1, 2, 3, 4, 6]; // bonus to Perform roll + threshold ranks
export const MASTERY_LEVEL = [0, 0, 1, 2, 3, 5]; // effective-level offset (acts as cl offset)
export const MASTERY_SAVES = [0, 1, 1, 2, 2, 3]; // bonus to saves vs the technique (situational)

/**
 * Successes required to *obtain* each mastery step (index = step being earned;
 * index 0 unused). Per learn_mechanics.md § Mastery table. Step 5's "2*" is a
 * footnote on the −2 learn-check penalty, not an extra success — kept as 2 here.
 */
export const MASTERY_SUCCESSES = [0, 1, 1, 1, 2, 2];

export const TECHNIQUE_DESCRIPTORS = [
  "*",
  "Acid",
  "Air",
  "Armed",
  "Armed or Punch",
  "Armor",
  "Chaotic",
  "Cold",
  "Combination",
  "Darkness",
  "Death",
  "Earth",
  "Electric",
  "Evil",
  "Fear",
  "Fire",
  "Force",
  "Good",
  "Grapple",
  "Hijutsu",
  "Kick",
  "Kick or Punch",
  "Kinjutsu",
  "Language-Dependent",
  "Lawful",
  "Light",
  "Lost Hijutsu",
  "Lost Kinjutsu",
  "Mind-Affecting",
  "Mind-Affecting Fear",
  "Negative Energy",
  "Poison",
  "Punch",
  "Punch or Kick",
  "Sleep",
  "Sonic",
  "Summoning",
  "Teleportation",
  "varies",
  "Varies",
  "Water",
  "Wind",
  "Wood",
];

function collectionHas(value, entry) {
  if (value instanceof Set) return value.has(entry);
  if (Array.isArray(value)) return value.includes(entry);
  return value?.[entry] === true || Object.values(value ?? {}).includes(entry);
}

/** Compute technique stats from persisted source fields. Never persist this result. */
export function computeTechniqueDerived(system = {}) {
  const c = COMPLEXITY_TABLE[system.complexity] ?? COMPLEXITY_TABLE["E-Class"];
  let { learnMod, successes } = c;
  const { skillMod, performMod } = c;
  const descriptors = system.descriptors ?? new Set();

  // Success modifiers from special descriptors. The same delta applies to
  // both learning and mastering (per learn_mechanics.md § Mastery).
  let successModifier = 0;
  if (system.isHijutsu || collectionHas(descriptors, "Hijutsu")) successModifier += 1;
  if (system.isKinjutsu || collectionHas(descriptors, "Kinjutsu")) successModifier += 2;
  if (system.isCombination || collectionHas(descriptors, "Combination")) {
    learnMod += 5;
    successModifier -= 2;
  }
  successes = Math.max(1, successes + successModifier);

  const rank = Math.max(1, Number(system.rank ?? 1) || 1);
  const mastery = Math.max(0, Math.min(5, Number(system.mastery ?? 0) || 0));

  return {
    learnDC: 10 + rank + learnMod,
    performDC: 10 + rank + performMod,
    successes,
    successModifier,
    skillThreshold: Math.max(1, rank + skillMod - 3),
    masteryPerform: MASTERY_PERFORM[mastery],
    masteryLevel: MASTERY_LEVEL[mastery],
    masterySaves: MASTERY_SAVES[mastery],
  };
}

export function createTechniqueDataModel() {
  class TechniqueDataModel extends foundry.abstract.TypeDataModel {
    static defineSchema() {
      const fields = foundry.data.fields;
      const opt = { required: false };

      const linkRow = () =>
        new fields.SchemaField({
          _id: new fields.StringField({
            required: true,
            blank: false,
            initial: () => foundry.utils.randomID(8),
          }),
          uuid: new fields.StringField({ required: true, blank: false }),
          name: new fields.StringField({ ...opt, blank: true, initial: "" }),
          img: new fields.StringField({ ...opt, blank: true, initial: "" }),
        });

      return {
        // ── Description block ──────────────────────────────────
        description: new fields.SchemaField(
          {
            value: new fields.HTMLField({ ...opt, blank: true, initial: "" }),
            summary: new fields.StringField({ ...opt, blank: true, initial: "" }),
            instructions: new fields.HTMLField({ ...opt, blank: true, initial: "" }),
          },
          opt,
        ),

        // ── Advanced tab ───────────────────────────────────────
        tag: new fields.StringField({ ...opt, blank: true, initial: "" }),
        tags: new fields.SetField(new fields.StringField({ blank: false, required: true }), opt),
        flags: new fields.SchemaField(
          {
            boolean: new fields.ObjectField(opt),
            dictionary: new fields.ObjectField(opt),
          },
          opt,
        ),
        showInQuickbar: new fields.BooleanField({ ...opt, initial: false }),
        showInCombat: new fields.BooleanField({ ...opt, initial: false }),

        // ── Script Calls ───────────────────────────────────────
        // Matches ItemScriptCall schema so PF1e's ItemPF._prepareScriptCalls
        // can populate item.scriptCalls Collection from this array.
        scriptCalls: new fields.ArrayField(
          new fields.SchemaField({
            _id: new fields.StringField({
              required: true,
              blank: false,
              initial: () => foundry.utils.randomID(8),
            }),
            name: new fields.StringField({ required: true, initial: "New Script Call" }),
            img: new fields.StringField({ ...opt, blank: true, initial: "" }),
            type: new fields.StringField({ required: true, blank: false, initial: "script" }),
            value: new fields.StringField({ required: true, blank: true, initial: "" }),
            category: new fields.StringField({ ...opt, blank: true, initial: "" }),
            hidden: new fields.BooleanField({ ...opt, initial: false }),
          }),
          { ...opt, initial: [] },
        ),

        // ── Changes tab ────────────────────────────────────────
        // Plain array of Change-shaped rows. PF1e (v11.11) reads
        // `system.changes` directly as an array and constructs
        // `pf1.components.ItemChange` instances in ItemPF#_prepareChanges.
        active: new fields.BooleanField({ ...opt, initial: false }),
        changes: new fields.ArrayField(
          new fields.SchemaField({
            _id: new fields.StringField({
              required: true,
              blank: false,
              initial: () => foundry.utils.randomID(8),
            }),
            target: new fields.StringField({ ...opt, blank: true, initial: "" }),
            operator: new fields.StringField({
              ...opt,
              blank: false,
              initial: "add",
              choices: ["add", "set"],
            }),
            formula: new fields.StringField({ ...opt, blank: true, initial: "0" }),
            type: new fields.StringField({ ...opt, blank: true, initial: "untyped" }),
            priority: new fields.NumberField({ ...opt, integer: true, initial: 0 }),
            flavor: new fields.StringField({ ...opt, blank: true, initial: "" }),
          }),
          { ...opt, initial: [] },
        ),

        // ── Links tab ──────────────────────────────────────────
        links: new fields.SchemaField(
          {
            prerequisites: new fields.ArrayField(linkRow(), opt),
            supplements: new fields.ArrayField(linkRow(), opt),
            children: new fields.ArrayField(linkRow(), opt),
          },
          opt,
        ),

        // ── Naruto-specific (unchanged) ────────────────────────
        discipline: new fields.StringField({ ...opt, blank: true, initial: "Ninjutsu" }),
        subtype: new fields.StringField({ ...opt, blank: true, initial: "" }),
        descriptors: new fields.SetField(
          new fields.StringField({ blank: false, required: true }),
          opt,
        ),
        rank: new fields.NumberField({
          required: true,
          integer: true,
          initial: 1,
          min: 1,
          max: 15,
        }),
        complexity: new fields.StringField({ ...opt, blank: true, initial: "E-Class" }),
        mastery: new fields.NumberField({
          required: true,
          integer: true,
          initial: 0,
          min: 0,
          max: 5,
        }),

        learning: new fields.SchemaField(
          {
            learned: new fields.BooleanField({ ...opt, initial: false }),
            // True when the technique was learned by spending Empathy Points
            // (bypassing the learn-check progression) rather than by training.
            learnedViaEmpathy: new fields.BooleanField({ ...opt, initial: false }),
            progress: new fields.NumberField({ ...opt, integer: true, initial: 0, min: 0 }),
            // GM override for the target progress required to learn this
            // technique, in the *current* training mode's units. Null → fall
            // back to the rules-derived, mode-scaled value.
            successesOverride: new fields.NumberField({
              ...opt,
              integer: true,
              nullable: true,
              initial: null,
              min: 1,
            }),
            attemptsUsed: new fields.NumberField({ ...opt, integer: true, initial: 0, min: 0 }),
            failureInsight: new fields.NumberField({
              ...opt,
              integer: true,
              initial: 0,
              min: 0,
              max: 5,
            }),
            trainingBlocks: new fields.NumberField({ ...opt, integer: true, initial: 0, min: 0 }),
            chakraSpent: new fields.NumberField({ ...opt, integer: true, initial: 0, min: 0 }),
            lastTrainingAt: new fields.NumberField({ ...opt, integer: true, initial: 0, min: 0 }),
            selectedDiscipline: new fields.StringField({ ...opt, blank: true, initial: "" }),
            actionPointBonus: new fields.NumberField({
              ...opt,
              integer: true,
              initial: 0,
              min: 0,
              max: 6,
            }),
          },
          opt,
        ),

        // In-progress tracking for *mastering* the current step. The achieved
        // step lives in `mastery`; this holds the run toward `mastery + 1`.
        masteryLearning: new fields.SchemaField(
          {
            progress: new fields.NumberField({ ...opt, integer: true, initial: 0, min: 0 }),
            successesOverride: new fields.NumberField({
              ...opt,
              integer: true,
              nullable: true,
              initial: null,
              min: 1,
            }),
            attemptsUsed: new fields.NumberField({ ...opt, integer: true, initial: 0, min: 0 }),
            failureInsight: new fields.NumberField({
              ...opt,
              integer: true,
              initial: 0,
              min: 0,
              max: 5,
            }),
            trainingBlocks: new fields.NumberField({ ...opt, integer: true, initial: 0, min: 0 }),
            chakraSpent: new fields.NumberField({ ...opt, integer: true, initial: 0, min: 0 }),
            lastTrainingAt: new fields.NumberField({ ...opt, integer: true, initial: 0, min: 0 }),
            actionPointBonus: new fields.NumberField({
              ...opt,
              integer: true,
              initial: 0,
              min: 0,
              max: 6,
            }),
          },
          opt,
        ),

        isHijutsu: new fields.BooleanField({ ...opt, initial: false }),
        isKinjutsu: new fields.BooleanField({ ...opt, initial: false }),
        isCombination: new fields.BooleanField({ ...opt, initial: false }),

        chakraCost: new fields.NumberField({ required: true, integer: true, initial: 1, min: 0 }),

        activation: new fields.StringField({ ...opt, blank: true, initial: "standard" }),
        range: new fields.StringField({ ...opt, blank: true, initial: "" }),
        target: new fields.StringField({ ...opt, blank: true, initial: "" }),
        area: new fields.StringField({ ...opt, blank: true, initial: "" }),
        duration: new fields.StringField({ ...opt, blank: true, initial: "" }),
        save: new fields.StringField({ ...opt, blank: true, initial: "" }),
        chakraResistance: new fields.BooleanField({ ...opt, initial: false }),

        compHandSeals: new fields.BooleanField({ ...opt, initial: false }),
        compHalfSeals: new fields.BooleanField({ ...opt, initial: false }),
        compConcentration: new fields.BooleanField({ ...opt, initial: false }),
        compMobility: new fields.BooleanField({ ...opt, initial: false }),
        compFocus: new fields.BooleanField({ ...opt, initial: false }),
        compEmpower: new fields.BooleanField({ ...opt, initial: false }),
        compMastery: new fields.BooleanField({ ...opt, initial: false }),
        compExpendable: new fields.BooleanField({ ...opt, initial: false }),
        compPhysical: new fields.BooleanField({ ...opt, initial: false }),
        compXpCost: new fields.BooleanField({ ...opt, initial: false }),

        performMiscBonus: new fields.NumberField({ ...opt, integer: true, initial: 0 }),

        attackAdjustments: new fields.SchemaField(
          {
            sizeBonus: new fields.NumberField({ ...opt, integer: true, initial: 0 }),
            critConfirmBonus: new fields.StringField({ ...opt, blank: true, initial: "" }),
          },
          opt,
        ),

        // ObjectField rows let PF1e's ItemAction sheet persist arbitrary
        // fields (damage, attack, save, etc.) without schema stripping.
        actions: new fields.ArrayField(new fields.ObjectField(), { ...opt, initial: [] }),

        // PF1e-compatible limited-use fields. Rank mastery uses this for the
        // once-per-day free activation/maintenance charge restored by PF1e rest.
        uses: new fields.SchemaField(
          {
            value: new fields.NumberField({ ...opt, integer: true, nullable: true, initial: null }),
            max: new fields.NumberField({ ...opt, integer: true, nullable: true, initial: null }),
            maxFormula: new fields.StringField({ ...opt, blank: true, initial: "" }),
            per: new fields.StringField({ ...opt, blank: true, initial: "" }),
            autoDeductChargesCost: new fields.StringField({ ...opt, blank: true, initial: "" }),
            rechargeFormula: new fields.StringField({ ...opt, blank: true, initial: "" }),
          },
          opt,
        ),

        // ── Buff Automation ────────────────────────────────────
        automation: new fields.SchemaField(
          {
            enabled: new fields.BooleanField({ ...opt, initial: true }),
            targetMode: new fields.StringField({
              ...opt,
              blank: false,
              initial: "auto",
              choices: ["auto", "self", "selected"],
            }),
            empower: new fields.SchemaField(
              {
                enabled: new fields.BooleanField({ ...opt, initial: false }),
                mode: new fields.StringField({
                  ...opt,
                  blank: false,
                  initial: "damageBonus",
                  choices: ["damageBonus"],
                }),
                costPerStep: new fields.NumberField({ ...opt, integer: true, initial: 1, min: 1 }),
                formulaPerStep: new fields.StringField({ ...opt, blank: true, initial: "1d6" }),
                damageTypes: new fields.ArrayField(
                  new fields.StringField({ blank: false, required: true }),
                  { ...opt, initial: [] },
                ),
                maxStepsFormula: new fields.StringField({ ...opt, blank: true, initial: "" }),
                performIncreaseEvery: new fields.NumberField({
                  ...opt,
                  integer: true,
                  initial: 0,
                  min: 0,
                }),
                performIncreaseAmount: new fields.NumberField({
                  ...opt,
                  integer: true,
                  initial: 0,
                  min: 0,
                }),
              },
              opt,
            ),
            maintenance: new fields.SchemaField(
              {
                // Turn-start maintenance on/off. A maintained buff expires at turn start;
                // the engine then runs cost/waiver/choice before refreshing or ending it.
                enabled: new fields.BooleanField({ ...opt, initial: false }),
                // Cost resource paid each turn to keep the buff. "" = no cost (e.g. Champuru).
                resource: new fields.StringField({
                  ...opt,
                  blank: true,
                  initial: "",
                  choices: ["", "chakra", "hp", "chakraDamage"],
                }),
                // Cost amount: an HP roll formula ("1d4", "2") or a flat chakra amount ("1").
                cost: new fields.StringField({ ...opt, blank: true, initial: "1d4" }),
                // "prompt": dialog to pay or end. "forced": auto-pay with a guard (end if it
                // would drop HP below 1 / chakra cannot be paid). Never waived under "forced".
                policy: new fields.StringField({
                  ...opt,
                  blank: false,
                  initial: "prompt",
                  choices: ["prompt", "forced"],
                }),
                // Rounds the refresh duration lasts (ranks use 5/2/1; HP/mode use 1).
                interval: new fields.NumberField({ ...opt, integer: true, initial: 1, min: 1 }),
                // Mastery waiver: "step" waives the cost silently at mastery >= waiverStep;
                // "freeUse" offers a daily charge of `freeRounds` free rounds as a prompt button.
                waiver: new fields.StringField({
                  ...opt,
                  blank: true,
                  initial: "",
                  choices: ["", "step", "freeUse"],
                }),
                waiverStep: new fields.NumberField({ ...opt, integer: true, initial: 2, min: 0 }),
                freeRounds: new fields.NumberField({ ...opt, integer: true, initial: 5, min: 1 }),
                // Per-turn choice. "mode": keep/switch/break between named variant buffs (Dex/Str).
                choice: new fields.StringField({
                  ...opt,
                  blank: true,
                  initial: "",
                  choices: ["", "mode"],
                }),
                heal: new fields.StringField({ ...opt, blank: true, initial: "" }),
                clearConditions: new fields.StringField({ ...opt, blank: true, initial: "" }),
                // Entry-time element selection (chosen once on entry, reused while active).
                element: new fields.BooleanField({ ...opt, initial: false }),
                // Mastery step at/above which two elements are chosen (1d6 + 1d6).
                elementDoubleStep: new fields.NumberField({
                  ...opt,
                  integer: true,
                  initial: 5,
                  min: 0,
                }),
              },
              opt,
            ),
          },
          opt,
        ),

        // ── Content Source ─────────────────────────────────────
        // PF1e-compatible content-source array. Each entry is a
        // freeform object with optional title, pages, edition, id,
        // publisher, date, errata fields.
        sources: new fields.ArrayField(new fields.ObjectField(), { ...opt, initial: [] }),
      };
    }

    static migrateData(source) {
      const automation = source.automation ?? {};
      const maintenance = legacyAutomationToMaintenance(automation);
      if (maintenance && !automation.maintenance) automation.maintenance = maintenance;
      for (const key of [
        "stanceMode",
        "stanceUpkeep",
        "elementChoice",
        "upkeepFormula",
        "upkeepMode",
        "upkeepWaiverStep",
        "elementDoubleStep",
      ]) {
        delete automation[key];
      }
      source.automation = automation;

      // Legacy: description was a plain HTMLField string.
      if (typeof source.description === "string") {
        source.description = { value: source.description, summary: "", instructions: "" };
      }

      // Migrate action id → _id (PF1e's ItemAction convention).
      if (Array.isArray(source.actions)) {
        for (const a of source.actions) {
          if (!a) continue;
          if (a.id && !a._id) {
            a._id = a.id;
            delete a.id;
          }
          if (!isValidActionId(a._id)) {
            a._id = createActionId();
          }
        }
      }

      // Migrate flags.boolean from SetField array to ObjectField object.
      if (Array.isArray(source.flags?.boolean)) {
        const obj = {};
        for (const k of source.flags.boolean) if (typeof k === "string") obj[k] = true;
        source.flags.boolean = obj;
      }

      return super.migrateData(source);
    }

    prepareBaseData() {
      applyTechniqueSystemDefaults(this, { collectionType: "set" });

      if (!this.tag && this.parent?.name) {
        try {
          this.tag = pf1.utils.createTag(this.parent.name);
        } catch {
          /* pf1 not ready */
        }
      }
    }

    /**
     * ItemPF.isActive reads `this.system.isActive`. Returning `this.active`
     * means our changes are only collected by the actor when the toggle
     * on the Changes tab is on.
     */
    get isActive() {
      return this.active === true;
    }

    // PF1e's ActorSheetPF._prepareItem sets system.isActive for display state.
    // Silently accept the write so it doesn't throw — actual toggle lives on `active`.
    set isActive(_v) {}

    /**
     * ItemPF.hasChanges reads `this.system.hasChanges`. Must be true for
     * PF1e's ItemPF#_prepareChanges to populate `item.changes` from our
     * `system.changes` array.
     */
    get hasChanges() {
      return true;
    }

    static COMPLEXITY_TABLE = COMPLEXITY_TABLE;

    /** Computed stats from rank + complexity. Never stored. */
    get derived() {
      return computeTechniqueDerived(this);
    }
  }

  return TechniqueDataModel;
}
