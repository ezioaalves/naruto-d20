import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { MODULE_ID, TECHNIQUE_ITEM_TYPE } from "../scripts/core/constants.mjs";
import { applyTechniqueSystemDefaults } from "../scripts/features/techniques/defaults.mjs";
import {
  findConflictingStanceBuffs,
  getTrackedStanceSourceTechnique,
  maintenanceFacets,
  STANCE_SOURCE_TECHNIQUE_ID_FLAG,
} from "../scripts/features/automation/maintenance/buffs.mjs";

function technique({ id, name, subtype = "Stance", allowStanceStacking = false } = {}) {
  return {
    id,
    _id: id,
    name,
    type: TECHNIQUE_ITEM_TYPE,
    system: {
      subtype,
      automation: {
        maintenance: {
          allowStanceStacking,
        },
      },
    },
  };
}

function buff({
  id,
  name,
  stanceSourceTechniqueId = null,
  maintenanceSourceTechniqueId = null,
} = {}) {
  const flags = { [MODULE_ID]: {} };
  if (stanceSourceTechniqueId) {
    flags[MODULE_ID][STANCE_SOURCE_TECHNIQUE_ID_FLAG] = stanceSourceTechniqueId;
  }
  if (maintenanceSourceTechniqueId) {
    flags[MODULE_ID].maintenanceBuff = { sourceTechniqueId: maintenanceSourceTechniqueId };
  }
  return {
    id,
    _id: id,
    name,
    type: "buff",
    flags,
  };
}

describe("stance stacking automation", () => {
  it("defaults maintenance.allowStanceStacking to false", () => {
    const system = applyTechniqueSystemDefaults({
      automation: {
        maintenance: {
          enabled: true,
        },
      },
    });

    assert.equal(system.automation.maintenance.allowStanceStacking, false);
    assert.equal(maintenanceFacets({ system }).allowStanceStacking, false);
  });

  it("finds only conflicting exclusive stance buffs", () => {
    const exclusive = technique({ id: "stance-a", name: "Stance A" });
    const stackable = technique({
      id: "stance-b",
      name: "Stance B",
      allowStanceStacking: true,
    });
    const activating = technique({ id: "stance-c", name: "Stance C" });
    const actor = {
      items: [
        exclusive,
        stackable,
        activating,
        buff({ id: "buff-a", name: "Stance A", stanceSourceTechniqueId: "stance-a" }),
        buff({ id: "buff-b", name: "Stance B", stanceSourceTechniqueId: "stance-b" }),
      ],
    };

    const result = findConflictingStanceBuffs(actor, activating).map((item) => item.id);
    assert.deepEqual(result, ["buff-a"]);
  });

  it("does not remove other stances when the activating stance is stackable", () => {
    const exclusive = technique({ id: "stance-a", name: "Stance A" });
    const stackable = technique({
      id: "stance-b",
      name: "Stance B",
      allowStanceStacking: true,
    });
    const actor = {
      items: [
        exclusive,
        stackable,
        buff({ id: "buff-a", name: "Stance A", stanceSourceTechniqueId: "stance-a" }),
      ],
    };

    assert.deepEqual(findConflictingStanceBuffs(actor, stackable), []);
  });

  it("can recover a legacy generic stance buff by matching its name to the source technique", () => {
    const legacyTechnique = technique({ id: "stance-a", name: "Legacy Stance" });
    const legacyBuff = buff({ id: "buff-a", name: "Legacy Stance" });
    const actor = { items: [legacyTechnique, legacyBuff] };

    assert.equal(getTrackedStanceSourceTechnique(actor, legacyBuff)?.id, "stance-a");
  });

  it("resolves maintenance stance buffs through maintenanceBuff.sourceTechniqueId", () => {
    const maintenanceTechnique = technique({ id: "stance-a", name: "Maintained Stance" });
    const maintenanceBuff = buff({
      id: "buff-a",
      name: "Maintained Stance (Dexterity)",
      maintenanceSourceTechniqueId: "stance-a",
    });
    const actor = { items: [maintenanceTechnique, maintenanceBuff] };

    assert.equal(getTrackedStanceSourceTechnique(actor, maintenanceBuff)?.id, "stance-a");
  });
});
