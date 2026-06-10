import { test, expect } from "../fixtures.mjs";

/**
 * manual-qa.md → "Auto-buffs".
 *
 * The lookup + apply + refresh-not-duplicate behaviour is tested directly
 * against the `naruto-d20.technique-buffs` pack (guaranteed present). The
 * end-to-end performTechnique→buff steps (self / selected / no-target) are
 * discovery-based and skip cleanly when the actor has no technique whose name
 * resolves to a buff.
 */
const BUFF_PACK = "naruto-d20.technique-buffs";

test.describe("Auto-buff lookup & application", () => {
  test("6 — findBuffByName returns an exact match for a pack entry", async ({ page }) => {
    const r = await page.evaluate(async (BUFF_PACK) => {
      const api = game.modules.get("naruto-d20").api;
      const pack = game.packs.get(BUFF_PACK);
      const index = await pack.getIndex();
      // Pick an entry with a plain name (no " (variant)" suffix) for an exact hit.
      const entry = index.contents.find((e) => !e.name.includes("(")) ?? index.contents[0];
      const match = await api.findBuffByName(entry.name);
      return { name: entry.name, hasExact: Boolean(match?.exact) };
    }, BUFF_PACK);

    expect(r.hasExact).toBe(true);
  });

  test("1/5 — applying a buff stamps sourceId and re-applying refreshes (no duplicate)", async ({
    page,
  }) => {
    const r = await page.evaluate(async (BUFF_PACK) => {
      const api = game.modules.get("naruto-d20").api;
      const actor = api.getActor();
      await api.clearAutomationBuffs(actor);

      const pack = game.packs.get(BUFF_PACK);
      const index = await pack.getIndex();
      const entry = index.contents.find((e) => !e.name.includes("(")) ?? index.contents[0];
      const buffDoc = await pack.getDocument(entry._id);

      await api.applyBuffToTarget(buffDoc, actor, {});
      const afterFirst = api.listBuffs(actor).filter((b) => b.sourceId === buffDoc.uuid);

      // Re-apply the same source → should refresh in place, not stack.
      await api.applyBuffToTarget(buffDoc, actor, {});
      const afterSecond = api.listBuffs(actor).filter((b) => b.sourceId === buffDoc.uuid);

      const cleaned = await api.clearAutomationBuffs(actor);
      return {
        firstCount: afterFirst.length,
        secondCount: afterSecond.length,
        active: afterSecond[0]?.active ?? false,
        cleaned,
      };
    }, BUFF_PACK);

    expect(r.firstCount).toBe(1);
    expect(r.secondCount).toBe(1); // refreshed, not duplicated
    expect(r.active).toBe(true);
  });
});

test.describe("Auto-buff end-to-end (discovery)", () => {
  test("2 — targetMode 'self' applies the buff to the caster", async ({ page }) => {
    const r = await page.evaluate(async () => {
      const api = game.modules.get("naruto-d20").api;
      const actor = api.getActor();

      // A technique with automation enabled whose name resolves to a buff.
      let pick = null;
      for (const i of actor.items) {
        if (i.type !== "naruto-d20.technique") continue;
        if (!i.system?.automation?.enabled) continue;
        const match = await api.findBuffByName(i.name);
        if (match?.exact?.length || match?.variants?.length) {
          pick = i;
          break;
        }
      }
      if (!pick) return { skip: true };

      await api.setSetting("automaticBuffs", true);
      await api.setSetting("buffTargetFiltering", "respectTechnique");
      await api.clearAutomationBuffs(actor);
      const prevMode = pick.system.automation.targetMode;
      await pick.update({ "system.automation.targetMode": "self" });

      const firstAction = pick.actions?.contents?.[0] ?? Array.from(pick.actions ?? [])[0];
      await api.applyTechniqueBuff(pick, actor, firstAction);
      const buffs = api.listBuffs(actor).filter((b) => b.sourceId);

      // restore + cleanup
      await pick.update({ "system.automation.targetMode": prevMode });
      await api.clearAutomationBuffs(actor);
      return { skip: false, applied: buffs.length };
    });

    test.skip(r.skip, "No automation technique with a matching buff on the actor");
    expect(r.applied).toBeGreaterThan(0);
  });

  test("4 — targetMode 'selected' with no target warns and applies nothing", async ({ page }) => {
    const r = await page.evaluate(async () => {
      const api = game.modules.get("naruto-d20").api;
      const actor = api.getActor();

      let pick = null;
      for (const i of actor.items) {
        if (i.type !== "naruto-d20.technique") continue;
        if (!i.system?.automation?.enabled) continue;
        const match = await api.findBuffByName(i.name);
        if (match?.exact?.length || match?.variants?.length) {
          pick = i;
          break;
        }
      }
      if (!pick) return { skip: true };

      await api.setSetting("automaticBuffs", true);
      await api.setSetting("buffTargetFiltering", "respectTechnique");
      await api.clearAutomationBuffs(actor);
      api.clearTargets();
      const prevMode = pick.system.automation.targetMode;
      await pick.update({ "system.automation.targetMode": "selected" });

      const spy = api.spyNotifications();
      const firstAction = pick.actions?.contents?.[0] ?? Array.from(pick.actions ?? [])[0];
      await api.applyTechniqueBuff(pick, actor, firstAction);
      spy.restore();
      const buffs = api.listBuffs(actor).filter((b) => b.sourceId);

      await pick.update({ "system.automation.targetMode": prevMode });
      await api.clearAutomationBuffs(actor);
      return { skip: false, warnings: spy.warnings.length, applied: buffs.length };
    });

    test.skip(r.skip, "No automation technique with a matching buff on the actor");
    expect(r.warnings).toBeGreaterThan(0);
    expect(r.applied).toBe(0);
  });
});
