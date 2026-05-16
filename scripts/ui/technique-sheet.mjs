import { TechniqueDataModel } from "../data/technique-model.mjs";

/**
 * Naruto D20 — Technique Item Sheet
 *
 * Extends the base Foundry ItemSheet directly. We deliberately bypass
 * pf1.applications.item.ItemSheetPF because its _prepareContext calls
 * item.getLabels({ rollData, isolated }) (pf1-source
 * applications/item/abstract/item-sheet.mjs:292), which requires the
 * full ItemPF action/label machinery. The technique item type is
 * registered via CONFIG.Item.dataModels without that machinery, so
 * traversing the PF1e sheet pipeline throws "getLabels is not a function".
 */
export class TechniqueItemSheet extends ItemSheet {

    /** @override */
    static get defaultOptions() {
        return foundry.utils.mergeObject(super.defaultOptions, {
            classes: ["pf1", "sheet", "item", "naruto-technique"],
            template: "modules/naruto-d20/templates/item/technique-sheet.hbs",
            width: 560,
            height: 560,
            tabs: [{ navSelector: ".sheet-tabs", contentSelector: ".sheet-body", initial: "details" }],
            resizable: true
        });
    }

    /** @override */
    get title() {
        return `${this.item.name} — Technique`;
    }

    /** @override */
    async getData(options = {}) {
        // Call V1 ItemSheet.getData directly via super — this sets up editor state,
        // editable, cssClass, and the item reference correctly for FormApplication.
        const context = await super.getData(options);

        // Ensure these are present regardless of what super provided
        context.item     = this.item;
        context.system   = this.item.system;
        context.flags    = this.item.flags;
        context.owner    = this.item.isOwner;
        context.editable = this.isEditable;

        const loc = (key) => game.i18n.localize(key);

        context.derived = this.item.system.derived;

        context.enrichedDescription = await TextEditor.enrichHTML(
            this.item.system.description ?? "",
            { secrets: this.item.isOwner }
        );

        context.disciplineChoices = {
            "":                loc("NarutoD20.Technique.Discipline.none"),
            "Chakra Control":  loc("NarutoD20.Technique.Discipline.ChakraControl"),
            "Fuinjutsu":       loc("NarutoD20.Technique.Discipline.Fuinjutsu"),
            "Genjutsu":        loc("NarutoD20.Technique.Discipline.Genjutsu"),
            "Hachimon Tonkou": loc("NarutoD20.Technique.Discipline.HachimonTonkou"),
            "Ninjutsu":        loc("NarutoD20.Technique.Discipline.Ninjutsu"),
            "Taijutsu":        loc("NarutoD20.Technique.Discipline.Taijutsu"),
            "Training":        loc("NarutoD20.Technique.Discipline.Training")
        };

        context.complexityChoices = Object.fromEntries(
            Object.keys(TechniqueDataModel.COMPLEXITY_TABLE).map(k => [k, k])
        );

        context.activationChoices = {
            "standard":  loc("NarutoD20.Technique.Activation.standard"),
            "full":      loc("NarutoD20.Technique.Activation.full"),
            "swift":     loc("NarutoD20.Technique.Activation.swift"),
            "immediate": loc("NarutoD20.Technique.Activation.immediate"),
            "free":      loc("NarutoD20.Technique.Activation.free"),
            "ritual":    loc("NarutoD20.Technique.Activation.ritual")
        };

        return context;
    }

    /** @override */
    activateListeners(html) {
        super.activateListeners(html);
    }
}
