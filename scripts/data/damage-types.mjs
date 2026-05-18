import { MODULE_ID } from "../constants.mjs";

const ICON_BASE = `modules/${MODULE_ID}/icons`;

/** Custom elemental damage types registered with pf1's damage registry. */
export const DAMAGE_TYPES = [
    { id: "earth", name: "Earth", category: "energy", resist: true, color: "#8B5A2B", img: `${ICON_BASE}/earth.svg` },
    { id: "water", name: "Water", category: "energy", resist: true, color: "#1E90FF", img: `${ICON_BASE}/water.svg` },
    { id: "wind",  name: "Wind",  category: "energy", resist: true, color: "#87CEEB", img: `${ICON_BASE}/wind.svg`  },
    { id: "holy",  name: "Holy",  category: "energy", resist: true, color: "#FFD700", img: `${ICON_BASE}/holy.svg`  },
];

/** Register each entry of DAMAGE_TYPES with pf1's damage registry. */
export function registerDamageTypes(registry) {
    for (const dt of DAMAGE_TYPES) {
        try {
            registry.register(MODULE_ID, dt.id, {
                name:     dt.name,
                category: dt.category,
                resist:   dt.resist,
                color:    dt.color,
                img:      dt.img,
            });
        } catch (err) {
            console.error(`Naruto D20 | Failed to register damage type "${dt.id}":`, err);
        }
    }
}
