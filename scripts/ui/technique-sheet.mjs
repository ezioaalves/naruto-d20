/**
 * Naruto D20 — Technique Item Sheet
 *
 * V1 ItemSheet — kept on the legacy API surface deliberately. AppV2 +
 * ActionItemSheetPF inheritance broke the render to "header only"; this
 * is the simplest working baseline. Layout mirrors PF1e's spell sheet
 * (grid: sidebar + sheet-navigation + primary-body).
 */

import { MODULE_ID }                            from "../constants.mjs";
import { DISCIPLINE_SKILL_MAP }                 from "../data/skills.mjs";
import { COMPLEXITY_TABLE }                     from "../data/technique-model.mjs";
import { canAffordTechnique, performTechnique } from "../use-technique.mjs";
import { resolveDroppedItem }                   from "../utils/drag-drop.mjs";

export function createTechniqueItemSheet() {

    class TechniqueItemSheet extends ItemSheet {

        static get defaultOptions() {
            return foundry.utils.mergeObject(super.defaultOptions, {
                classes: ["pf1", "sheet", "item"],
                width: 620,
                height: 600,
                tabs: [
                    {
                        navSelector:     "nav.sheet-navigation[data-group='primary']",
                        contentSelector: "section.primary-body",
                        initial:         "description",
                        group:           "primary",
                    },
                    {
                        navSelector:     "nav.sheet-navigation[data-group='links']",
                        contentSelector: "section.links-body",
                        initial:         "prerequisites",
                        group:           "links",
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
            const item    = this.item;
            const system  = item.system;
            const loc     = (k) => game.i18n.localize(k);

            context.item     = item;
            context.system   = system;
            context.editable = this.isEditable;
            context.owner    = item.isOwner;
            context.cssClass = this.isEditable ? "editable" : "locked";
            context.itemType = loc(CONFIG.Item.typeLabels?.[item.type] ?? "ITEM.TypeItem");
            context.derived  = system.derived;
            context.isGM     = game.user.isGM;

            // Actions — use PF1e's ItemAction collection when available
            context.actions  = Array.from(item.actions ?? []);

            // Perform flow
            const actor      = item.actor;
            const skillKey   = DISCIPLINE_SKILL_MAP[system.discipline];
            const skillRanks = (skillKey && actor) ? (actor.system.skills?.[skillKey]?.rank ?? 0) : 0;
            const threshold  = system.derived.skillThreshold;
            const bypasses   = !skillKey || skillRanks >= threshold;

            context.canUse         = !!actor && canAffordTechnique(actor, item);
            context.skillKey       = skillKey;
            context.skillRanks     = skillRanks;
            context.bypassesPerform = bypasses;
            context.performHint    = !actor
                ? "Equip on an actor to use."
                : (!skillKey
                    ? "No perform check required for this discipline."
                    : (bypasses
                        ? `Ranks ${skillRanks}/${threshold} — auto-perform.`
                        : `Ranks ${skillRanks}/${threshold} — must roll vs DC ${system.derived.performDC}.`));

            context.hasComponents = (
                system.compHandSeals || system.compHalfSeals || system.compConcentration ||
                system.compMobility  || system.compFocus     || system.compEmpower       ||
                system.compMastery   || system.compExpendable || system.compPhysical     ||
                system.compXpCost
            );

            context.disciplineChoices = {
                "":                loc("NarutoD20.Technique.Discipline.none"),
                "Chakra Control":  loc("NarutoD20.Technique.Discipline.ChakraControl"),
                "Fuinjutsu":       loc("NarutoD20.Technique.Discipline.Fuinjutsu"),
                "Genjutsu":        loc("NarutoD20.Technique.Discipline.Genjutsu"),
                "Hachimon Tonkou": loc("NarutoD20.Technique.Discipline.HachimonTonkou"),
                "Ninjutsu":        loc("NarutoD20.Technique.Discipline.Ninjutsu"),
                "Taijutsu":        loc("NarutoD20.Technique.Discipline.Taijutsu"),
                "Training":        loc("NarutoD20.Technique.Discipline.Training"),
            };

            context.complexityChoices = Object.fromEntries(
                Object.keys(COMPLEXITY_TABLE).map((k) => [k, k])
            );

            context.activationChoices = {
                "standard":  loc("NarutoD20.Technique.Activation.standard"),
                "full":      loc("NarutoD20.Technique.Activation.full"),
                "swift":     loc("NarutoD20.Technique.Activation.swift"),
                "immediate": loc("NarutoD20.Technique.Activation.immediate"),
                "free":      loc("NarutoD20.Technique.Activation.free"),
                "ritual":    loc("NarutoD20.Technique.Activation.ritual"),
            };

            // ── Links tab — structured for PF1e's table/sub-nav layout ──
            const linkCat = (id, labelKey, helpKey) => ({
                id,
                label: loc(labelKey),
                help:  loc(helpKey),
                items: (system.links?.[id] ?? []).map((l, index) => ({
                    uuid:   l.uuid,
                    name:   l.name || l.uuid,
                    img:    l.img  || "icons/svg/item-bag.svg",
                    broken: false,
                    index,
                })),
                fields: [],
            });
            context.links = {
                list: [
                    linkCat("prerequisites", "NarutoD20.Links.Prerequisites.Label", "NarutoD20.Links.Prerequisites.Hint"),
                    linkCat("supplements",   "NarutoD20.Links.Supplements.Label",   "NarutoD20.Links.Supplements.Hint"),
                    linkCat("children",      "NarutoD20.Links.Children.Label",      "NarutoD20.Links.Children.Hint"),
                ],
            };

            // ── Advanced tab ───────────────────────────────────────────
            context.tagList = Array.from(system.tags ?? []);

            // flags.boolean is ObjectField {key: true}, flags.dictionary is ObjectField {key: value}
            context.flags = {
                boolean:    system.flags?.boolean    ?? {},
                dictionary: system.flags?.dictionary ?? {},
            };

            // ── Script Calls (mirrors ItemSheetPF._prepareScriptCalls) ──
            const scCategories = pf1.registry?.scriptCalls?.filter(
                (c) => c.itemTypes.includes(item.type) && !(c.hidden === true && !game.user.isGM)
            ) ?? [];
            if (scCategories.length) {
                context.scriptCalls = {};
                const scDocs = Array.from(item.scriptCalls ?? []);
                for (const { id, name, info } of scCategories) {
                    context.scriptCalls[id] = {
                        name,
                        tooltip: info,
                        items:   scDocs.filter((s) => s.category === id && !s.hide),
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
            html.on("click", ".use-action",       this._onUseAction.bind(this));
            html.on("click", ".add-action",       this._onAddAction.bind(this));
            html.on("click", ".edit-action",      this._onEditAction.bind(this));
            html.on("click", ".delete-action",    this._onDeleteAction.bind(this));
            html.on("click", ".duplicate-action", this._onDuplicateAction.bind(this));

            // Links
            html.on("click", ".delete-link",  this._onDeleteLink.bind(this));
            html.on("click", ".source-item",  this._onOpenLink.bind(this));

            // Advanced — tags
            html.on("keydown", ".add-tag-input", this._onAddTag.bind(this));
            html.on("click",   ".delete-tag",    this._onDeleteTag.bind(this));

            // Advanced — flags (entry-selector opens PF1e's EntrySelector modal)
            html.on("click", ".entry-selector", this._onEntrySelector.bind(this));

            // Advanced — script calls
            html.on("click",        ".script-calls .item-control",    this._onScriptCallControl.bind(this));
            html.on("contextmenu",  ".script-calls .item-list .item", this._onScriptCallEdit.bind(this));
        }

        // ─────────────────────────────────────────────────────────────
        // Actions — PF1e ItemAction API
        // ─────────────────────────────────────────────────────────────

        async _onUseAction(event) {
            event.preventDefault();
            event.stopPropagation();
            const row = event.currentTarget.closest(".item[data-action-id]");
            const id  = row?.dataset.actionId;
            if (id) await performTechnique(this.item, id);
        }

        async _onAddAction(event) {
            event.preventDefault();
            event.stopPropagation();
            const newId  = foundry.utils.randomID(8);
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
            const newId  = foundry.utils.randomID(8);
            data._id = newId;
            const actions = foundry.utils.deepClone(this.item.system.actions ?? []);
            actions.push(data);
            await this.item.update({ "system.actions": actions });
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
                [`system.links.${category}`]: [...existing, {
                    _id:  foundry.utils.randomID(8),
                    uuid: doc.uuid,
                    name: doc.name,
                    img:  doc.img,
                }],
            });
        }

        async _onDeleteLink(event) {
            event.preventDefault();
            const category = event.currentTarget.dataset.type;
            const uuid     = event.currentTarget.dataset.uuid;
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
            if (tags.has(value)) { input.value = ""; return; }
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
                name:    t.dataset.for,
                title:   t.dataset.title,
                flag:    "true" === t.dataset.flag,
                boolean: "true" === t.dataset.boolean,
                flat:    "true" === t.dataset.flat,
                fields:  t.dataset.fields,
                dtypes:  t.dataset.dtypes,
            };
            const existing = Object.values(foundry.applications.instances).find((a) =>
                a instanceof pf1.applications.EntrySelector &&
                a.name === opts.name &&
                a.document.id === this.item.id
            );
            if (existing) { existing.render(true); existing.bringToFront(); }
            else new pf1.applications.EntrySelector({ ...opts, document: this.item }).render({ force: true });
        }

        // ─────────────────────────────────────────────────────────────
        // Advanced — script calls
        // ─────────────────────────────────────────────────────────────

        async _onScriptCallControl(event) {
            event.preventDefault();
            const btn      = event.currentTarget;
            const category = btn.closest(".item-list")?.dataset.category;
            const itemId   = btn.closest(".item")?.dataset.itemId;
            const sc       = itemId ? this.item.scriptCalls?.get(itemId) : null;

            if (btn.classList.contains("item-create")) {
                await this._onSubmit(event, { preventRender: true });
                const created = await pf1.components.ItemScriptCall.create(
                    [{ category, type: "script" }],
                    { parent: this.item }
                );
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
            const t  = event.currentTarget;
            const sc = this.item.scriptCalls?.get(t.dataset.itemId);
            sc?.edit({ editable: this.isEditable });
        }
    }

    return TechniqueItemSheet;
}
