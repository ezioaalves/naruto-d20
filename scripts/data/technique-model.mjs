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

/** Complexity lookup — Appendix B, Table B-1. */
export const COMPLEXITY_TABLE = {
    "Extremely Easy": { learnMod: 1,  successes: 1, skillMod: 0, performMod: -10 },
    "Very Easy":      { learnMod: 1,  successes: 1, skillMod: 0, performMod: -5  },
    "Easy":           { learnMod: 1,  successes: 1, skillMod: 0, performMod: -1  },
    "E-Class":        { learnMod: 1,  successes: 1, skillMod: 0, performMod: 0   },
    "D-Class":        { learnMod: 2,  successes: 1, skillMod: 0, performMod: 1   },
    "C-Class":        { learnMod: 3,  successes: 2, skillMod: 1, performMod: 3   },
    "B-Class":        { learnMod: 4,  successes: 3, skillMod: 2, performMod: 5   },
    "A-Class":        { learnMod: 5,  successes: 4, skillMod: 3, performMod: 7   },
    "S-Class":        { learnMod: 6,  successes: 5, skillMod: 4, performMod: 10  },
    "SS-Class":       { learnMod: 7,  successes: 6, skillMod: 5, performMod: 15  },
    "Epic":           { learnMod: 15, successes: 8, skillMod: 8, performMod: 20  }
};

/** Mastery bonuses by step (0–5). Index = mastery step. See transcricao_tecnicas.md. */
export const MASTERY_PERFORM = [0, 1, 2, 3, 4, 6]; // bonus to Perform roll + threshold ranks
export const MASTERY_LEVEL   = [0, 0, 1, 2, 3, 5]; // effective-level offset (acts as cl offset)

export function createTechniqueDataModel() {

    class TechniqueDataModel extends foundry.abstract.TypeDataModel {

        static defineSchema() {
            const fields = foundry.data.fields;
            const opt = { required: false };

            const linkRow = () => new fields.SchemaField({
                _id:  new fields.StringField({ required: true, blank: false, initial: () => foundry.utils.randomID(8) }),
                uuid: new fields.StringField({ required: true, blank: false }),
                name: new fields.StringField({ ...opt, blank: true, initial: "" }),
                img:  new fields.StringField({ ...opt, blank: true, initial: "" }),
            });

            return {
                // ── Description block ──────────────────────────────────
                description: new fields.SchemaField({
                    value:        new fields.HTMLField({   ...opt, blank: true, initial: "" }),
                    summary:      new fields.StringField({ ...opt, blank: true, initial: "" }),
                    instructions: new fields.HTMLField({   ...opt, blank: true, initial: "" }),
                }, opt),

                // ── Advanced tab ───────────────────────────────────────
                tag:   new fields.StringField({ ...opt, blank: true, initial: "" }),
                tags:  new fields.SetField(new fields.StringField({ blank: false, required: true }), opt),
                flags: new fields.SchemaField({
                    boolean:    new fields.ObjectField(opt),
                    dictionary: new fields.ObjectField(opt),
                }, opt),
                showInQuickbar: new fields.BooleanField({ ...opt, initial: false }),
                showInCombat:   new fields.BooleanField({ ...opt, initial: false }),

                // ── Script Calls ───────────────────────────────────────
                // Matches ItemScriptCall schema so PF1e's ItemPF._prepareScriptCalls
                // can populate item.scriptCalls Collection from this array.
                scriptCalls: new fields.ArrayField(
                    new fields.SchemaField({
                        _id:      new fields.StringField({ required: true, blank: false, initial: () => foundry.utils.randomID(8) }),
                        name:     new fields.StringField({ required: true, initial: "New Script Call" }),
                        img:      new fields.StringField({ ...opt, blank: true, initial: "" }),
                        type:     new fields.StringField({ required: true, blank: false, initial: "script" }),
                        value:    new fields.StringField({ required: true, blank: true, initial: "" }),
                        category: new fields.StringField({ ...opt, blank: true, initial: "" }),
                        hidden:   new fields.BooleanField({ ...opt, initial: false }),
                    }),
                    { ...opt, initial: [] }
                ),

                // ── Changes tab ────────────────────────────────────────
                // Plain array of Change-shaped rows. PF1e (v11.11) reads
                // `system.changes` directly as an array and constructs
                // `pf1.components.ItemChange` instances in ItemPF#_prepareChanges.
                active: new fields.BooleanField({ ...opt, initial: false }),
                changes: new fields.ArrayField(
                    new fields.SchemaField({
                        _id:      new fields.StringField({ required: true, blank: false, initial: () => foundry.utils.randomID(8) }),
                        target:   new fields.StringField({ ...opt, blank: true, initial: "" }),
                        operator: new fields.StringField({ ...opt, blank: false, initial: "add", choices: ["add", "set"] }),
                        formula:  new fields.StringField({ ...opt, blank: true, initial: "0" }),
                        type:     new fields.StringField({ ...opt, blank: true, initial: "untyped" }),
                        priority: new fields.NumberField({ ...opt, integer: true, initial: 0 }),
                        flavor:   new fields.StringField({ ...opt, blank: true, initial: "" }),
                    }),
                    { ...opt, initial: [] }
                ),

                // ── Links tab ──────────────────────────────────────────
                links: new fields.SchemaField({
                    prerequisites: new fields.ArrayField(linkRow(), opt),
                    supplements:   new fields.ArrayField(linkRow(), opt),
                    children:      new fields.ArrayField(linkRow(), opt),
                }, opt),

                // ── Naruto-specific (unchanged) ────────────────────────
                discipline:    new fields.StringField({  ...opt, blank: true, initial: "Ninjutsu" }),
                subtype:       new fields.StringField({  ...opt, blank: true, initial: "" }),
                rank:          new fields.NumberField({  required: true, integer: true, initial: 1, min: 1, max: 15 }),
                complexity:    new fields.StringField({  ...opt, blank: true, initial: "E-Class" }),
                mastery:       new fields.NumberField({  required: true, integer: true, initial: 0, min: 0, max: 5 }),

                isHijutsu:     new fields.BooleanField({ ...opt, initial: false }),
                isKinjutsu:    new fields.BooleanField({ ...opt, initial: false }),
                isCombination: new fields.BooleanField({ ...opt, initial: false }),

                chakraCost:    new fields.NumberField({  required: true, integer: true, initial: 1, min: 0 }),

                activation: new fields.StringField({ ...opt, blank: true, initial: "standard" }),
                range:      new fields.StringField({ ...opt, blank: true, initial: "" }),
                target:     new fields.StringField({ ...opt, blank: true, initial: "" }),
                area:       new fields.StringField({ ...opt, blank: true, initial: "" }),
                duration:   new fields.StringField({ ...opt, blank: true, initial: "" }),
                save:       new fields.StringField({ ...opt, blank: true, initial: "" }),

                compHandSeals:     new fields.BooleanField({ ...opt, initial: false }),
                compHalfSeals:     new fields.BooleanField({ ...opt, initial: false }),
                compConcentration: new fields.BooleanField({ ...opt, initial: false }),
                compMobility:      new fields.BooleanField({ ...opt, initial: false }),
                compFocus:         new fields.BooleanField({ ...opt, initial: false }),
                compEmpower:       new fields.BooleanField({ ...opt, initial: false }),
                compMastery:       new fields.BooleanField({ ...opt, initial: false }),
                compExpendable:    new fields.BooleanField({ ...opt, initial: false }),
                compPhysical:      new fields.BooleanField({ ...opt, initial: false }),
                compXpCost:        new fields.BooleanField({ ...opt, initial: false }),

                performMiscBonus: new fields.NumberField({ ...opt, integer: true, initial: 0 }),

                // ObjectField rows let PF1e's ItemAction sheet persist arbitrary
                // fields (damage, attack, save, etc.) without schema stripping.
                actions: new fields.ArrayField(
                    new fields.ObjectField(),
                    { ...opt, initial: [] }
                ),

                // ── Buff Automation ────────────────────────────────────
                automation: new fields.SchemaField({
                    enabled: new fields.BooleanField({ ...opt, initial: true }),
                }, opt),
            };
        }

        static migrateData(source) {
            // Legacy: description was a plain HTMLField string.
            if (typeof source.description === "string") {
                source.description = { value: source.description, summary: "", instructions: "" };
            }

            // Migrate action id → _id (PF1e's ItemAction convention).
            if (Array.isArray(source.actions)) {
                for (const a of source.actions) {
                    if (!a) continue;
                    if (a.id && !a._id) { a._id = a.id; delete a.id; }
                    else if (!a._id || typeof a._id !== "string") { a._id = foundry.utils.randomID(8); }
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
            this.description ??= {};
            this.description.value ??= "";
            this.description.summary ??= "";
            this.description.instructions ??= "";

            this.flags ??= {};
            this.flags.boolean ??= {};
            this.flags.dictionary ??= {};

            this.links ??= {};
            this.links.prerequisites ??= [];
            this.links.supplements ??= [];
            this.links.children ??= [];

            this.tags ??= new Set();
            this.changes ??= [];

            this.automation ??= {};
            this.automation.enabled ??= true;

            if (!this.tag && this.parent?.name) {
                try { this.tag = pf1.utils.createTag(this.parent.name); }
                catch { /* pf1 not ready */ }
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
            const c = COMPLEXITY_TABLE[this.complexity] ?? COMPLEXITY_TABLE["E-Class"];
            let { learnMod, successes, skillMod, performMod } = c;

            if (this.isHijutsu)     successes += 1;
            if (this.isKinjutsu)    successes += 2;
            if (this.isCombination) { learnMod += 5; successes = Math.max(1, successes - 2); }

            const m = Math.max(0, Math.min(5, this.mastery ?? 0));

            return {
                learnDC:        10 + this.rank + learnMod,
                performDC:      10 + this.rank + performMod,
                successes,
                skillThreshold: Math.max(1, this.rank + skillMod - 3),
                masteryPerform: MASTERY_PERFORM[m],
                masteryLevel:   MASTERY_LEVEL[m],
            };
        }
    }

    return TechniqueDataModel;
}
