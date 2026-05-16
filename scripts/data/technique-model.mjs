/**
 * Naruto D20 — Technique Data Model
 *
 * Defines the schema for all fields stored in system.* on a technique Item.
 * Registered during the Foundry "init" hook via CONFIG.Item.dataModels.
 *
 * Field layout mirrors your existing JSON data:
 *   - flags.naruto.rank        → system.rank
 *   - flags.naruto.type        → system.discipline  ("type" is a reserved word)
 *   - flags.naruto.subtype     → system.subtype
 *   - flags.naruto.chakraCost  → system.chakraCost
 *   - system.description       → system.description  (kept as-is)
 *   - system.components.value  → system.components   (comma string → individual booleans)
 *   - system.level             → system.spellLevel    (PF1e spell level, kept for compat)
 *   - system.range.value       → system.range
 *   - system.target.value      → system.target
 *   - system.area.value        → system.area
 *   - system.duration.value    → system.duration
 *   - system.save.description  → system.save
 *   - system.activation.type   → system.activation
 *
 * Derived / computed fields (set by the sheet, not stored):
 *   - learnDC   = 10 + rank + complexityLearnMod
 *   - performDC = 10 + rank + complexityPerformMod
 *   - successes = complexitySuccesses
 *   - skillThreshold = rank + complexitySkillMod
 */

const { StringField, NumberField, BooleanField, HTMLField } = foundry.data.fields;

export class TechniqueDataModel extends foundry.abstract.TypeDataModel {

    static defineSchema() {
        return {
            // Core identity
            description: new HTMLField({ required: false, initial: "" }),
            discipline: new StringField({ required: false, blank: true, initial: "Ninjutsu", nullable: true }),
            subtype: new StringField({ required: false, initial: "" }),

            // Power level
            rank: new NumberField({ required: true, integer: true, initial: 1, min: 1, max: 15 }),
            complexity: new StringField({ required: false, blank: true, initial: "E-Class", nullable: true }),
            isHijutsu: new BooleanField({ initial: false }),
            isKinjutsu: new BooleanField({ initial: false }),
            isCombination: new BooleanField({ initial: false }),

            // Resource cost
            chakraCost: new NumberField({ required: true, integer: true, initial: 1, min: 0 }),

            // Action economy
            activation: new StringField({ required: false, blank: true, initial: "standard", nullable: true }),

            // Targeting
            range:    new StringField({ required: false, initial: "" }),
            target:   new StringField({ required: false, initial: "" }),
            area:     new StringField({ required: false, initial: "" }),
            duration: new StringField({ required: false, initial: "" }),
            save:     new StringField({ required: false, initial: "" }),

            // Components — each is a separate boolean for easy checkbox binding
            compHandSeals:    new BooleanField({ initial: false }),
            compHalfSeals:    new BooleanField({ initial: false }),
            compConcentration:new BooleanField({ initial: false }),
            compMobility:     new BooleanField({ initial: false }),
            compFocus:        new BooleanField({ initial: false }),
            compEmpower:      new BooleanField({ initial: false }),
            compMastery:      new BooleanField({ initial: false }),
            compExpendable:   new BooleanField({ initial: false }),
            compPhysical:     new BooleanField({ initial: false }),
            compXpCost:       new BooleanField({ initial: false }),

            // Misc bonus to Perform checks (hand-entered, like miscBonus on learn checks)
            performMiscBonus: new NumberField({ required: false, integer: true, initial: 0 }),

            // Legacy PF1e spell level — kept so existing spells imported from your JSON
            // don't lose their level data. Not shown prominently on the sheet.
            spellLevel: new NumberField({ required: false, integer: true, initial: 0, min: 0 })
        };
    }

    /**
     * Complexity lookup tables — derived from Appendix B, Table B-1.
     * Used by the sheet to display computed DCs without storing them.
     */
    static COMPLEXITY_TABLE = {
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

    /** Returns computed stats derived from rank + complexity. Never stored. */
    get derived() {
        const c = TechniqueDataModel.COMPLEXITY_TABLE[this.complexity]
            ?? TechniqueDataModel.COMPLEXITY_TABLE["E-Class"];

        let { learnMod, successes, skillMod, performMod } = c;

        // Special type modifiers (Appendix B)
        if (this.isHijutsu)   { successes += 1; }
        if (this.isKinjutsu)  { successes += 2; }
        if (this.isCombination) { learnMod += 5; successes = Math.max(1, successes - 2); }

        return {
            learnDC:        10 + this.rank + learnMod,
            performDC:      10 + this.rank + performMod,
            successes:      successes,
            skillThreshold: this.rank + skillMod
        };
    }
}
