/**
 * Naruto D20 — Technique Item Sheet
 *
 * V1 ItemSheet — kept on the legacy API surface deliberately. AppV2 +
 * ActionItemSheetPF inheritance broke the render to "header only"; this
 * is the simplest working baseline. Layout mirrors PF1e's spell sheet
 * (grid: sidebar + sheet-navigation + primary-body).
 */

import { MODULE_ID } from "../../core/constants.mjs";
import { DISCIPLINE_SKILL_MAP } from "../actor-stats/skills.mjs";
import { COMPLEXITY_TABLE, TECHNIQUE_DESCRIPTORS } from "./model.mjs";
import { attemptLearnTechnique, buildLearningView } from "./learn.mjs";
import { attemptMasterTechnique, buildMasteryView } from "./master.mjs";
import { canAffordTechnique, performTechnique } from "./use.mjs";
import { renderTechniqueHeader } from "./header.mjs";
import {
  applyWeaponAttackPreset,
  buildWeaponAttackFormData,
  buildWeaponAttackSummary,
  damagePartRowsFromForm,
  extractIndexedRows,
  extraAttacksArrayFromText,
  replaceDamagePartTypes,
  WEAPON_ATTACK_DAMAGE_MODE_CHOICES,
  WEAPON_ATTACK_FILTER_CHOICES,
  WEAPON_ATTACK_HELD_CHOICES,
  WEAPON_ATTACK_PRESET_CHOICES,
} from "./weapon-attack-sheet.mjs";
import { resolveDroppedItem } from "../../utils/drag-drop.mjs";

const SPECIAL_DESCRIPTOR_FLAGS = {
  Combination: "system.isCombination",
  Hijutsu: "system.isHijutsu",
  Kinjutsu: "system.isKinjutsu",
};

function localizeChoices(choices) {
  return Object.fromEntries(
    Object.entries(choices).map(([key, label]) => [key, game.i18n.localize(label)]),
  );
}


export function createTechniqueItemSheet() {
  class TechniqueItemSheet extends ItemSheet {
    static get defaultOptions() {
      return foundry.utils.mergeObject(super.defaultOptions, {
        classes: ["pf1", "sheet", "item"],
        width: 620,
        height: 600,
        tabs: [
          {
            navSelector: "nav.sheet-navigation[data-group='primary']",
            contentSelector: "section.primary-body",
            initial: "description",
            group: "primary",
          },
          {
            navSelector: "nav.sheet-navigation[data-group='links']",
            contentSelector: "section.links-body",
            initial: "prerequisites",
            group: "links",
          },
        ],
        scrollY: [".tab"],
        dragDrop: [{ dragSelector: null, dropSelector: "[data-drop-category]" }],
        resizable: true,
      });
    }

    get template() {
      return `modules/${MODULE_ID}/templates/item/technique-sheet.hbs`;
    }

    async getData(options) {
      const context = await super.getData(options);
      const item = this.item;
      const system = item.system;
      const derived = system.derived;
      const loc = (k) => game.i18n.localize(k);

      context.item = item;
      context.system = system;
      context.editable = this.isEditable;
      context.owner = item.isOwner;
      context.cssClass = this.isEditable ? "editable" : "locked";
      context.itemType = loc(CONFIG.Item.typeLabels?.[item.type] ?? "ITEM.TypeItem");
      context.derived = derived;
      context.isGM = game.user.isGM;

      const rollData = item.getRollData?.() ?? {};
      context.descriptionHTML = await TextEditor.enrichHTML(system.description?.value ?? "", {
        async: true,
        rollData,
      });

      context.topDescription = await renderTechniqueHeader(item);
      context.instructionsHTML = await TextEditor.enrichHTML(
        system.description?.instructions ?? "",
        { async: true, rollData },
      );

      // Actions — use PF1e's ItemAction collection when available
      context.actions = Array.from(item.actions ?? []);
      const descriptors = new Set(system.descriptors ?? []);
      context.descriptorList = TECHNIQUE_DESCRIPTORS.filter((label) => descriptors.has(label));
      context.hasDescriptors = descriptors.size > 0;
      context.descriptorChoices = TECHNIQUE_DESCRIPTORS.map((label) => ({
        label,
        checked: descriptors.has(label),
      }));

      // Perform flow
      const actor = item.actor;
      const learning = buildLearningView(item, actor);
      const skillKey = DISCIPLINE_SKILL_MAP[system.discipline];
      const skillRanks = skillKey && actor ? (actor.system.skills?.[skillKey]?.rank ?? 0) : 0;
      const threshold = derived.skillThreshold;
      const masteryPerform = derived.masteryPerform ?? 0;
      const effRanks = skillRanks + masteryPerform;
      const bypasses = !skillKey || effRanks >= threshold;
      const ranksLabel = masteryPerform > 0 ? `${skillRanks}+${masteryPerform}` : `${skillRanks}`;

      context.learning = learning;
      context.mastery = buildMasteryView(item, actor);
      context.enforceLearning = game.settings.get(MODULE_ID, "enforceLearning");
      context.canUse =
        !!actor &&
        canAffordTechnique(actor, item) &&
        (!context.enforceLearning || learning.effectivelyLearned);
      context.skillKey = skillKey;
      context.skillRanks = skillRanks;
      context.bypassesPerform = bypasses;
      context.performHint = !actor
        ? "Equip on an actor to use."
        : !skillKey
          ? "No perform check required for this discipline."
          : bypasses
            ? `Ranks ${ranksLabel}/${threshold} — auto-perform.`
            : `Ranks ${ranksLabel}/${threshold} — must roll vs DC ${derived.performDC}.`;

      context.hasComponents =
        system.compHandSeals ||
        system.compHalfSeals ||
        system.compConcentration ||
        system.compMobility ||
        system.compFocus ||
        system.compEmpower ||
        system.compMastery ||
        system.compExpendable ||
        system.compPhysical ||
        system.compXpCost;

      context.disciplineChoices = {
        "": loc("NarutoD20.Technique.Discipline.none"),
        "Chakra Control": loc("NarutoD20.Technique.Discipline.ChakraControl"),
        Fuinjutsu: loc("NarutoD20.Technique.Discipline.Fuinjutsu"),
        Genjutsu: loc("NarutoD20.Technique.Discipline.Genjutsu"),
        "Hachimon Tonkou": loc("NarutoD20.Technique.Discipline.HachimonTonkou"),
        Ninjutsu: loc("NarutoD20.Technique.Discipline.Ninjutsu"),
        Taijutsu: loc("NarutoD20.Technique.Discipline.Taijutsu"),
        Training: loc("NarutoD20.Technique.Discipline.Training"),
      };

      context.complexityChoices = Object.fromEntries(
        Object.keys(COMPLEXITY_TABLE).map((k) => [k, k]),
      );

      context.buffTargetModeChoices = {
        auto: loc("NarutoD20.Automation.TargetMode.Auto"),
        self: loc("NarutoD20.Automation.TargetMode.Self"),
        selected: loc("NarutoD20.Automation.TargetMode.Selected"),
      };

      context.maintenanceResourceChoices = {
        "": loc("NarutoD20.Automation.Maintenance.Resource.None"),
        chakra: loc("NarutoD20.Automation.Maintenance.Resource.Chakra"),
        hp: loc("NarutoD20.Automation.Maintenance.Resource.Hp"),
      };
      context.maintenancePolicyChoices = {
        prompt: loc("NarutoD20.Automation.Maintenance.Policy.Prompt"),
        forced: loc("NarutoD20.Automation.Maintenance.Policy.Forced"),
      };
      context.maintenanceWaiverChoices = {
        "": loc("NarutoD20.Automation.Maintenance.Waiver.None"),
        step: loc("NarutoD20.Automation.Maintenance.Waiver.Step"),
        freeUse: loc("NarutoD20.Automation.Maintenance.Waiver.FreeUse"),
      };
      context.maintenanceChoiceChoices = {
        "": loc("NarutoD20.Automation.Maintenance.Choice.None"),
        mode: loc("NarutoD20.Automation.Maintenance.Choice.Mode"),
      };
      const maintenance = system.automation?.maintenance ?? {};
      context.maintenanceFields = {
        show: maintenance.enabled === true,
        hasCost: Boolean(maintenance.resource),
        showWaiverStep: maintenance.waiver === "step",
        showFreeRounds: maintenance.waiver === "freeUse",
        showAllowStanceStacking: String(system.subtype ?? "")
          .toLowerCase()
          .split(/\s*,\s*/)
          .includes("stance"),
        showElementDoubleStep: maintenance.element === true,
      };
      context.empowerModeChoices = {
        damageBonus: loc("NarutoD20.Empower.Mode.DamageBonus"),
      };
      const empower = system.automation?.empower ?? {};
      context.empowerFields = {
        show: empower.enabled === true,
        hasPerformIncrease: Number(empower.performIncreaseEvery ?? 0) > 0,
      };
      const localizeOrFormat = (key, data = {}) =>
        Object.keys(data).length ? game.i18n.format(key, data) : game.i18n.localize(key);
      context.weaponAttack = buildWeaponAttackFormData(item, {
        damageTypeRegistry: pf1.registry?.damageTypes,
      });
      context.weaponAttackSummary = buildWeaponAttackSummary(
        context.weaponAttack,
        localizeOrFormat,
      );
      context.weaponAttackFilterChoices = localizeChoices(WEAPON_ATTACK_FILTER_CHOICES);
      context.weaponAttackDamageModeChoices = localizeChoices(WEAPON_ATTACK_DAMAGE_MODE_CHOICES);
      context.weaponAttackHeldChoices = localizeChoices(WEAPON_ATTACK_HELD_CHOICES);
      context.weaponAttackPresetChoices = localizeChoices(WEAPON_ATTACK_PRESET_CHOICES);

      // ── Links tab — structured for PF1e's table/sub-nav layout ──
      const linkCat = (id, labelKey, helpKey) => ({
        id,
        label: loc(labelKey),
        help: loc(helpKey),
        items: (system.links?.[id] ?? []).map((l, index) => ({
          uuid: l.uuid,
          name: l.name || l.uuid,
          img: l.img || "icons/svg/item-bag.svg",
          broken: false,
          index,
        })),
        fields: [],
      });
      context.links = {
        list: [
          linkCat(
            "prerequisites",
            "NarutoD20.Links.Prerequisites.Label",
            "NarutoD20.Links.Prerequisites.Hint",
          ),
          linkCat(
            "supplements",
            "NarutoD20.Links.Supplements.Label",
            "NarutoD20.Links.Supplements.Hint",
          ),
          linkCat("children", "NarutoD20.Links.Children.Label", "NarutoD20.Links.Children.Hint"),
        ],
      };

      // ── Advanced tab ───────────────────────────────────────────
      // ── Content sources (mirrors ItemSheetPF._prepareContentSource) ──
      this._prepareContentSource(context);

      context.tagList = Array.from(system.tags ?? []);

      // flags.boolean is ObjectField {key: true}, flags.dictionary is ObjectField {key: value}
      context.flags = {
        boolean: system.flags?.boolean ?? {},
        dictionary: system.flags?.dictionary ?? {},
      };

      // ── Script Calls (mirrors ItemSheetPF._prepareScriptCalls) ──
      const scCategories =
        pf1.registry?.scriptCalls?.filter(
          (c) => c.itemTypes.includes(item.type) && !(c.hidden === true && !game.user.isGM),
        ) ?? [];
      if (scCategories.length) {
        context.scriptCalls = {};
        const scDocs = Array.from(item.scriptCalls ?? []);
        for (const { id, name, info } of scCategories) {
          context.scriptCalls[id] = {
            name,
            tooltip: info,
            items: scDocs.filter((s) => s.category === id && !s.hide),
            dataset: { category: id },
          };
        }
      } else {
        context.scriptCalls = null;
      }

      return context;
    }

    // ─────────────────────────────────────────────────────────────
    // Listeners
    // ─────────────────────────────────────────────────────────────

    activateListeners(html) {
      super.activateListeners(html);
      if (!this.isEditable) return;

      // Details — actions (wired to PF1e's action system)
      html.on("click", ".use-action", this._onUseAction.bind(this));
      html.on("click", ".learn-technique", this._onLearnTechnique.bind(this));
      html.on("click", ".reset-learning", this._onResetLearning.bind(this));
      html.on("click", ".master-technique", this._onMasterTechnique.bind(this));
      html.on("click", ".reset-mastery", this._onResetMastery.bind(this));
      html.on("click", ".add-action", this._onAddAction.bind(this));
      html.on("click", ".edit-action", this._onEditAction.bind(this));
      html.on("click", ".delete-action", this._onDeleteAction.bind(this));
      html.on("click", ".duplicate-action", this._onDuplicateAction.bind(this));
      html.on("change", ".descriptor-checkbox", this._onDescriptorToggle.bind(this));
      html.on(
        "change",
        "select[name='weaponAttack-preset']",
        this._onWeaponAttackPreset.bind(this),
      );
      html.on("click", ".weapon-attack-damage-add", this._onWeaponAttackDamageAdd.bind(this));
      html.on("click", ".weapon-attack-damage-delete", this._onWeaponAttackDamageDelete.bind(this));
      html.on(
        "click",
        ".weapon-attack-damage-row .damage-type-visual",
        this._onWeaponAttackDamageType.bind(this),
      );

      // Content source editor
      html.on("click", ".content-source .control a.edit", () =>
        pf1.applications.ContentSourceEditor.open(this.item, { editable: this.isEditable }),
      );

      // Links
      html.on("click", ".delete-link", this._onDeleteLink.bind(this));
      html.on("click", ".source-item", this._onOpenLink.bind(this));

      // Advanced — tags
      html.on("keydown", ".add-tag-input", this._onAddTag.bind(this));
      html.on("click", ".delete-tag", this._onDeleteTag.bind(this));

      // Advanced — flags (entry-selector opens PF1e's EntrySelector modal)
      html.on("click", ".entry-selector", this._onEntrySelector.bind(this));

      // Advanced — script calls
      html.on("click", ".script-calls .item-control", this._onScriptCallControl.bind(this));
      html.on("contextmenu", ".script-calls .item-list .item", this._onScriptCallEdit.bind(this));
    }

    async _updateObject(event, formData) {
      if (typeof formData["system.automation.empower.damageTypes"] === "string") {
        formData["system.automation.empower.damageTypes"] = formData[
          "system.automation.empower.damageTypes"
        ]
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean);
      }

      if (typeof formData["weaponAttack-extraAttacksText"] === "string") {
        formData["system.weaponAttack.extraAttacks"] = extraAttacksArrayFromText(
          formData["weaponAttack-extraAttacksText"],
        );
        delete formData["weaponAttack-extraAttacksText"];
      }
      formData["system.weaponAttack.damageParts"] = damagePartRowsFromForm(
        extractIndexedRows(formData, "system.weaponAttack.damageParts"),
      );
      formData["system.weaponAttack.nonCritDamageParts"] = damagePartRowsFromForm(
        extractIndexedRows(formData, "system.weaponAttack.nonCritDamageParts"),
      );
      delete formData["weaponAttack-preset"];

      return super._updateObject(event, formData);
    }

    // ─────────────────────────────────────────────────────────────
    // Content source — mirrors ItemSheetPF._prepareContentSource
    // ─────────────────────────────────────────────────────────────

    _prepareContentSource(context) {
      const rawSources = this.item.system.sources ?? [];
      if (rawSources.length === 0) return;

      const sources = rawSources.map((source) => {
        const registry = pf1.registry?.sources?.get(source?.id) ?? {};
        const { publisher, date, abbr, name, edition } = registry;
        return {
          publisher,
          date,
          abbr,
          name,
          edition,
          ...source,
          title: source.title || registry.name,
          registry,
          datestamp: Date.parse(source.date || registry.date),
        };
      });

      sources.sort((a, b) => b.datestamp - a.datestamp);
      const main = sources[0];

      context.bookSources = { all: sources, main };
      if (sources.length > 1) context.bookSources.extras = sources.filter((s) => s !== main);
    }

    // ─────────────────────────────────────────────────────────────
    // Actions — PF1e ItemAction API
    // ─────────────────────────────────────────────────────────────

    async _onUseAction(event) {
      event.preventDefault();
      event.stopPropagation();
      if (event.currentTarget.classList.contains("disabled")) return;
      const row = event.currentTarget.closest(".item[data-action-id]");
      const id = row?.dataset.actionId;
      if (id) await performTechnique(this.item, id, event);
    }

    async _onLearnTechnique(event) {
      event.preventDefault();
      event.stopPropagation();
      await attemptLearnTechnique(this.item);
    }

    async _onResetLearning(event) {
      event.preventDefault();
      event.stopPropagation();
      await this.item.update({
        "system.learning.learned": false,
        "system.learning.progress": 0,
        "system.learning.attemptsUsed": 0,
        "system.learning.failureInsight": 0,
        "system.learning.trainingBlocks": 0,
        "system.learning.chakraSpent": 0,
        "system.learning.lastTrainingAt": 0,
        "system.learning.actionPointBonus": 0,
      });
    }

    async _onMasterTechnique(event) {
      event.preventDefault();
      event.stopPropagation();
      await attemptMasterTechnique(this.item);
    }

    async _onResetMastery(event) {
      event.preventDefault();
      event.stopPropagation();
      await this.item.update({
        "system.masteryLearning.progress": 0,
        "system.masteryLearning.attemptsUsed": 0,
        "system.masteryLearning.failureInsight": 0,
        "system.masteryLearning.trainingBlocks": 0,
        "system.masteryLearning.chakraSpent": 0,
        "system.masteryLearning.lastTrainingAt": 0,
        "system.masteryLearning.actionPointBonus": 0,
      });
    }

    async _onAddAction(event) {
      event.preventDefault();
      event.stopPropagation();
      const newId = foundry.utils.randomID(8);
      const actions = foundry.utils.deepClone(this.item.system.actions ?? []);
      actions.push({ _id: newId, name: game.i18n.localize("PF1.Use") });
      await this.item.update({ "system.actions": actions });
      this.item.actions?.get(newId)?.sheet?.render(true);
    }

    async _onEditAction(event) {
      event.preventDefault();
      event.stopPropagation();
      const row = event.currentTarget.closest(".item[data-action-id]");
      this.item.actions.get(row?.dataset.actionId)?.sheet?.render(true);
    }

    async _onDeleteAction(event) {
      event.preventDefault();
      event.stopPropagation();
      const row = event.currentTarget.closest(".item[data-action-id]");
      await this.item.actions.get(row?.dataset.actionId)?.delete();
    }

    async _onDuplicateAction(event) {
      event.preventDefault();
      event.stopPropagation();
      const row = event.currentTarget.closest(".item[data-action-id]");
      const action = this.item.actions.get(row?.dataset.actionId);
      if (!action) return;
      const data = foundry.utils.deepClone(action.toObject());
      delete data._id;
      const newId = foundry.utils.randomID(8);
      data._id = newId;
      const actions = foundry.utils.deepClone(this.item.system.actions ?? []);
      actions.push(data);
      await this.item.update({ "system.actions": actions });
    }

    async _onDescriptorToggle(event) {
      const input = event.currentTarget;
      const descriptor = input.dataset.descriptor;
      if (!descriptor) return;

      await this._onSubmit(event, { preventRender: true });

      const descriptors = new Set(this.item.system.descriptors ?? []);
      if (input.checked) descriptors.add(descriptor);
      else descriptors.delete(descriptor);

      const updates = { "system.descriptors": Array.from(descriptors) };
      for (const [special, path] of Object.entries(SPECIAL_DESCRIPTOR_FLAGS)) {
        updates[path] = descriptors.has(special);
      }
      await this.item.update(updates);
    }

    _onWeaponAttackPreset(event) {
      const preset = event.currentTarget.value;
      if (!preset || preset === "custom") return;

      const form = event.currentTarget.form;
      const get = (name) => form.elements.namedItem(name);
      const fields = [
        "system.weaponAttack.enabled",
        "system.weaponAttack.filter",
        "system.weaponAttack.damageMode",
        "system.weaponAttack.held",
        "system.weaponAttack.charge",
        "system.weaponAttack.iteratives",
        "system.weaponAttack.attackBonus",
        "system.weaponAttack.suppressNaturalAttack",
        "system.weaponAttack.suppressAbilityDamage",
        "weaponAttack-extraAttacksText",
      ];
      if (fields.some((name) => !get(name))) return;

      const current = {
        enabled: get("system.weaponAttack.enabled").checked === true,
        preset,
        filter: get("system.weaponAttack.filter").value,
        damageMode: get("system.weaponAttack.damageMode").value,
        attackBonus: get("system.weaponAttack.attackBonus").value,
        extraAttacksText: get("weaponAttack-extraAttacksText").value,
        held: get("system.weaponAttack.held").value,
        charge: get("system.weaponAttack.charge").checked === true,
        iteratives: get("system.weaponAttack.iteratives").checked === true,
        suppressNaturalAttack: get("system.weaponAttack.suppressNaturalAttack").checked === true,
        suppressAbilityDamage: get("system.weaponAttack.suppressAbilityDamage").checked === true,
      };

      const next = applyWeaponAttackPreset(preset, current);
      get("system.weaponAttack.enabled").checked = next.enabled === true;
      get("system.weaponAttack.filter").value = next.filter;
      get("system.weaponAttack.damageMode").value = next.damageMode;
      get("system.weaponAttack.held").value = next.held ?? "";
      get("system.weaponAttack.charge").checked = next.charge === true;
      get("system.weaponAttack.iteratives").checked = next.iteratives !== false;
      get("system.weaponAttack.attackBonus").value = next.attackBonus ?? "";
      get("weaponAttack-extraAttacksText").value = next.extraAttacksText ?? "";
      get("system.weaponAttack.suppressNaturalAttack").checked =
        next.suppressNaturalAttack === true;
      get("system.weaponAttack.suppressAbilityDamage").checked =
        next.suppressAbilityDamage === true;
    }

    _onWeaponAttackDamageAdd(event) {
      event.preventDefault();
      const list = event.currentTarget.closest("[data-weapon-attack-damage-list]");
      const prefix = list?.dataset.weaponAttackDamageList;
      const rowsContainer = list?.querySelector(".weapon-attack-damage-rows");
      if (!prefix || !rowsContainer) return;

      const escapedPrefix = prefix.replaceAll(".", "\\.");
      const existingInputs = rowsContainer.querySelectorAll(`input[name^="${escapedPrefix}."]`);
      let maxIndex = -1;
      for (const input of existingInputs) {
        const match = input.name.match(new RegExp(`^${escapedPrefix}\\.(\\d+)\\.`));
        if (match) maxIndex = Math.max(maxIndex, Number(match[1]));
      }
      const index = maxIndex + 1;

      const row = document.createElement("div");
      row.className = "weapon-attack-damage-row";
      row.dataset.damagePart = String(index);
      row.innerHTML = `
        <input type="text" name="${prefix}.${index}.formula" value="" placeholder="${game.i18n.localize("NarutoD20.WeaponAttack.DamageParts.FormulaPlaceholder")}">
        <input type="hidden" name="${prefix}.${index}.types" value="">
        <div class="damage-type-visual empty" data-name="${prefix}.${index}.types">
          <span>${game.i18n.localize("PF1.Undefined")}</span>
        </div>
        <button type="button" class="weapon-attack-damage-delete" data-tooltip="${game.i18n.localize("PF1.DeleteItem")}">
          <i class="fa-solid fa-trash" inert></i>
        </button>
      `;
      rowsContainer.append(row);
    }

    _onWeaponAttackDamageDelete(event) {
      event.preventDefault();
      event.currentTarget.closest(".weapon-attack-damage-row")?.remove();
    }

    async _onWeaponAttackDamageType(event) {
      event.preventDefault();
      const elem = event.currentTarget;
      const row = elem.closest(".weapon-attack-damage-row");
      const list = elem.closest("[data-weapon-attack-damage-list]");
      const prefix = list?.dataset.weaponAttackDamageList;
      const index = Number(row?.dataset.damagePart);
      if (!prefix || index < 0) return;

      await this._onSubmit(event, { preventRender: true });

      const currentRows = foundry.utils.getProperty(this.item, prefix) ?? [];
      const currentTypes = currentRows[index]?.types ?? [];
      const app = new pf1.applications.DamageTypeSelector(
        this.item,
        `${prefix}.${index}.types`,
        new Set(currentTypes),
        {
          updateCallback: async (update) => {
            await this.item.update({ [prefix]: replaceDamagePartTypes(currentRows, index, update) });
            this.render(false);
          },
        },
      );
      return app.render(true);
    }

    // ─────────────────────────────────────────────────────────────
    // Links — drag-drop, delete, open
    // ─────────────────────────────────────────────────────────────

    async _onDrop(event) {
      const category = event.target.closest?.("[data-drop-category]")?.dataset.dropCategory;
      if (!category) return;

      const doc = await resolveDroppedItem(event);
      if (!doc) {
        ui.notifications.warn(game.i18n.localize("NarutoD20.Links.OnlyItems"));
        return;
      }
      if (doc.uuid === this.item.uuid) return;

      const existing = this.item.system.links?.[category] ?? [];
      if (existing.some((e) => e.uuid === doc.uuid)) return;

      await this.item.update({
        [`system.links.${category}`]: [
          ...existing,
          {
            _id: foundry.utils.randomID(8),
            uuid: doc.uuid,
            name: doc.name,
            img: doc.img,
          },
        ],
      });
    }

    async _onDeleteLink(event) {
      event.preventDefault();
      const category = event.currentTarget.dataset.type;
      const uuid = event.currentTarget.dataset.uuid;
      if (!category || !uuid) return;
      const existing = this.item.system.links?.[category] ?? [];
      await this.item.update({
        [`system.links.${category}`]: existing.filter((e) => e.uuid !== uuid),
      });
    }

    async _onOpenLink(event) {
      event.preventDefault();
      const uuid = event.currentTarget.dataset.uuid;
      if (!uuid) return;
      const doc = await fromUuid(uuid);
      doc?.sheet?.render(true);
    }

    // ─────────────────────────────────────────────────────────────
    // Advanced — tags (SetField)
    // ─────────────────────────────────────────────────────────────

    async _onAddTag(event) {
      if (event.key !== "Enter") return;
      event.preventDefault();
      const input = event.currentTarget;
      const value = input.value.trim();
      if (!value) return;
      const tags = new Set(this.item.system.tags ?? []);
      if (tags.has(value)) {
        input.value = "";
        return;
      }
      tags.add(value);
      await this.item.update({ "system.tags": Array.from(tags) });
    }

    async _onDeleteTag(event) {
      event.preventDefault();
      const value = event.currentTarget.dataset.tag;
      if (!value) return;
      const tags = new Set(this.item.system.tags ?? []);
      tags.delete(value);
      await this.item.update({ "system.tags": Array.from(tags) });
    }

    // ─────────────────────────────────────────────────────────────
    // Advanced — entry-selector (opens PF1e's EntrySelector modal)
    // Mirrors ItemSheetPF._onEntrySelector exactly.
    // ─────────────────────────────────────────────────────────────

    _onEntrySelector(event) {
      event.preventDefault();
      const t = event.currentTarget;
      const opts = {
        name: t.dataset.for,
        title: t.dataset.title,
        flag: "true" === t.dataset.flag,
        boolean: "true" === t.dataset.boolean,
        flat: "true" === t.dataset.flat,
        fields: t.dataset.fields,
        dtypes: t.dataset.dtypes,
      };
      const existing = Object.values(foundry.applications.instances).find(
        (a) =>
          a instanceof pf1.applications.EntrySelector &&
          a.name === opts.name &&
          a.document.id === this.item.id,
      );
      if (existing) {
        existing.render(true);
        existing.bringToFront();
      } else
        new pf1.applications.EntrySelector({ ...opts, document: this.item }).render({
          force: true,
        });
    }

    // ─────────────────────────────────────────────────────────────
    // Advanced — script calls
    // ─────────────────────────────────────────────────────────────

    async _onScriptCallControl(event) {
      event.preventDefault();
      const btn = event.currentTarget;
      const category = btn.closest(".item-list")?.dataset.category;
      const itemId = btn.closest(".item")?.dataset.itemId;
      const sc = itemId ? this.item.scriptCalls?.get(itemId) : null;

      if (btn.classList.contains("item-create")) {
        await this._onSubmit(event, { preventRender: true });
        const created = await pf1.components.ItemScriptCall.create([{ category, type: "script" }], {
          parent: this.item,
        });
        created?.forEach((s) => s.edit());
      } else if (sc && btn.classList.contains("item-delete")) {
        const updates = {
          "system.scriptCalls": (this.item.system.scriptCalls ?? []).filter((s) => s._id !== sc.id),
        };
        await this.item.update(updates);
      } else if (sc && btn.classList.contains("item-edit")) {
        sc.edit();
      } else if (sc && btn.classList.contains("item-hide")) {
        await this._onSubmit(event, { preventRender: true });
        await sc.update({ hidden: !sc.hidden });
      }
    }

    _onScriptCallEdit(event) {
      event.preventDefault();
      const t = event.currentTarget;
      const sc = this.item.scriptCalls?.get(t.dataset.itemId);
      sc?.edit({ editable: this.isEditable });
    }
  }

  return TechniqueItemSheet;
}
