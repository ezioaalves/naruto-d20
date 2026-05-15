/**
 * Naruto D20 - Derived Data Calculations
 * Wraps the base Pathfinder 1e prepareDerivedData to calculate Shinobi statistics.
 */

export function registerDerivedDataWrapper() {
    const originalPrepareDerivedData = CONFIG.Actor.documentClass.prototype.prepareDerivedData;

    CONFIG.Actor.documentClass.prototype.prepareDerivedData = function() {
        // Run standard PF1e derived data preparation first
        originalPrepareDerivedData.call(this);

        // Only apply to characters and NPCs
        if (!["character", "npc"].includes(this.type)) return;

        // Ensure the flag structure exists in memory even if not saved to the DB yet
        this.flags["naruto-d20"] = this.flags["naruto-d20"] || {};
        const nData = this.flags["naruto-d20"];

        // 1. Initialize Default Chakra Resource Schema
        nData.chakra = foundry.utils.mergeObject({
            pool: { value: 0, maxBonus: 0 },
            reserve: { value: 0, maxBonus: 0 },
            nature: { primary: "", secondary: [] }
        }, nData.chakra || {});

        // 2. Initialize Learn Schema
        nData.learn = foundry.utils.mergeObject({
            ckc: { base: 0, abilityMod: 0, miscBonus: 0, total: 0, conditional: 0 },
            gnj: { base: 0, abilityMod: 0, miscBonus: 0, total: 0, conditional: 0 },
            nin: { base: 0, abilityMod: 0, miscBonus: 0, total: 0, conditional: 0 },
            tai: { base: 0, abilityMod: 0, miscBonus: 0, total: 0, conditional: 0 },
            fui: { base: 0, abilityMod: 0, miscBonus: 0, total: 0, conditional: 0 }
        }, nData.learn || {});

        // 3. Derived Calculations: Character Level Base
        const charLevel = this.system.details?.level?.value || this.system.details?.cr?.total || 0;
        
        // Map of skills to their relevant abilities
        const abilityMap = {
            ckc: "wis",
            gnj: "cha",
            nin: "int",
            tai: "str",
            fui: "int"
        };

        // Calculate Learn totals
        for (const [skillKey, abilityKey] of Object.entries(abilityMap)) {
            const learnData = nData.learn[skillKey];
            learnData.base = charLevel;
            
            // Get ability modifier from standard PF1e actor data
            const abilityMod = this.system.abilities?.[abilityKey]?.mod || 0;
            learnData.abilityMod = abilityMod;

            // Get buff bonus from the changes engine
            const buffBonus = foundry.utils.getProperty(this, `flags.naruto-d20.learn.${skillKey}.buffBonus`) || 0;
            learnData.buffBonus = buffBonus;

            // Compute total (Base + Ability Mod + Misc + Buffs)
            learnData.total = learnData.base + learnData.abilityMod + (learnData.miscBonus || 0) + buffBonus;
        }

        // 3.5 Dynamic Chakra Pool and Reserve Maximums
        const conMod = this.system.abilities?.con?.mod || 0;
        
        // Pool Max: 2 + ((2 + CON Mod) * Level) + Misc Max Bonus + Buffs
        const poolBuffBonus = foundry.utils.getProperty(this, "flags.naruto-d20.chakra.pool.maxBonus") || 0;
        nData.chakra.pool.max = 2 + ((2 + conMod) * charLevel) + poolBuffBonus;
        
        // Reserve Max: (2 * Level) + Misc Max Bonus + Buffs
        const reserveBuffBonus = foundry.utils.getProperty(this, "flags.naruto-d20.chakra.reserve.maxBonus") || 0;
        nData.chakra.reserve.max = (2 * charLevel) + reserveBuffBonus;

        // 4. Elemental Affinity Conditional Bonus
        // Progression: +1 at 1st, +2 at 6th, +3 at 11th, +4 at 16th, +5 at 21st
        // Formula is 1 + floor((Level - 1) / 5)
        let affinityBonus = 0;
        if (charLevel >= 1) {
            affinityBonus = 1 + Math.floor((charLevel - 1) / 5);
        }
        nData.learn.nin.conditional = affinityBonus;

        // 5. Energy Resistance Calculation
        if (nData.chakra.nature.primary) {
            // Resistance value: 5 at 10th, 10 at 15th, 15 at 20th
            let resValue = 0;
            if (charLevel >= 20) resValue = 15;
            else if (charLevel >= 15) resValue = 10;
            else if (charLevel >= 10) resValue = 5;

            if (resValue > 0) {
                // Determine the resistance type based on primary affinity (strong against)
                // Assuming traditional elemental cycle: Fire > Wind > Lightning > Earth > Water > Fire
                const strongAgainstMap = {
                    "fire": "wind",
                    "wind": "lightning",
                    "lightning": "earth",
                    "earth": "water",
                    "water": "fire"
                };

                const resElement = strongAgainstMap[nData.chakra.nature.primary.toLowerCase()];
                if (resElement) {
                    // Inject into the standard PF1e traits array
                    this.system.traits = this.system.traits || {};
                    let eres = this.system.traits.eres;
                    
                    if (Array.isArray(eres)) {
                        // PF1e v11+ uses an array of objects
                        const existingRes = eres.find(e => e.types && e.types.includes(resElement));
                        if (!existingRes) {
                            eres.push({
                                amount: resValue,
                                types: [resElement],
                                operator: true
                            });
                        }
                    } else if (typeof eres === "string") {
                        // Older PF1e versions used a flat string
                        if (!eres.toLowerCase().includes(resElement.toLowerCase())) {
                            this.system.traits.eres = eres ? `${eres}; ${resElement} ${resValue}` : `${resElement} ${resValue}`;
                        }
                    } else {
                        // If it's undefined or some other type, initialize it as an array
                        this.system.traits.eres = [{
                            amount: resValue,
                            types: [resElement],
                            operator: true
                        }];
                    }
                }
            }
        }
    };
}
