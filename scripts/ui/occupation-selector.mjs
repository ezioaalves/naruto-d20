/**
 * Occupation grant selection dialog (class skills + bonus feat + technique).
 * `renderOccupationSelectionContent` is pure and unit-tested; the prompt uses
 * DialogV2. Localized via NarutoD20.Occupation.* with English fallbacks so the
 * render function stays testable outside Foundry.
 */

function t(key, fallback, data) {
  const i18n = globalThis.game?.i18n;
  if (i18n?.localize) {
    return data ? i18n.format(key, data) : i18n.localize(key);
  }
  return data ? fallback.replace(/\{(\w+)\}/g, (_, k) => String(data[k] ?? "")) : fallback;
}

function resolveSkillLabel(key, fallback) {
  const pf1Label = globalThis.pf1?.config?.skills?.[key];
  return typeof pf1Label === "string" ? pf1Label : fallback;
}

export function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function normalizeOccupationSelectionResult(result) {
  if (!result) return null;
  if (result === "cancel") return null;
  if (typeof result === "object" && result.action === "cancel") return null;
  return result;
}

export function renderOccupationSelectionContent({
  classSkillOptions,
  skillSelectCount,
  featOptions,
  manualFeatOptions,
  techniqueOptions,
}) {
  const skills = classSkillOptions ?? [];
  const feats = featOptions ?? [];
  const manualFeats = manualFeatOptions ?? [];
  const techniques = techniqueOptions ?? [];

  const skillRows = skills
    .map(
      (o) =>
        `<label class="nd20-occ-choice"><input type="checkbox" name="classSkill" value="${escapeHtml(o.key)}"> <span>${escapeHtml(resolveSkillLabel(o.key, o.label))}</span></label>`,
    )
    .join("");
  const featRows = feats
    .map((name, i) => {
      const checked = feats.length === 1 || i === 0 ? " checked" : "";
      return `<label class="nd20-occ-choice"><input type="radio" name="featOption" value="${escapeHtml(name)}"${checked}> <span>${escapeHtml(name)}</span></label>`;
    })
    .join("");
  const techRows = techniques
    .map((name, i) => {
      const checked = techniques.length === 1 || i === 0 ? " checked" : "";
      return `<label class="nd20-occ-choice"><input type="radio" name="techniqueOption" value="${escapeHtml(name)}"${checked}> <span>${escapeHtml(name)}</span></label>`;
    })
    .join("");

  const skillSection = skillSelectCount
    ? `<section class="nd20-occ-section"><h3>${t("NarutoD20.Occupation.ClassSkills", "Class Skills")}</h3><p class="nd20-occ-hint">${t("NarutoD20.Occupation.SelectExactly", "Select exactly {n}.", { n: skillSelectCount })}</p><div class="nd20-occ-grid">${skillRows}</div></section>`
    : "";
  const featSection = feats.length
    ? `<section class="nd20-occ-section"><h3>${t("NarutoD20.Occupation.BonusFeat", "Bonus Feat")}</h3><div class="nd20-occ-grid">${featRows}</div></section>`
    : "";
  const manualFeatRows = manualFeats.map((name) => `<li>${escapeHtml(name)}</li>`).join("");
  const manualFeatSection = manualFeats.length
    ? `<section class="nd20-occ-section"><h3>${t("NarutoD20.Occupation.ManualFeatChoices", "Manual Feat Choices")}</h3><p class="nd20-occ-hint">${t("NarutoD20.Occupation.ManualFeatHint", "Choose one of these manually on the actor sheet; it is not auto-granted.")}</p><ul class="nd20-occ-manual-list">${manualFeatRows}</ul></section>`
    : "";
  const techSection = techniques.length
    ? `<section class="nd20-occ-section"><h3>${t("NarutoD20.Occupation.Technique", "Technique")}</h3><div class="nd20-occ-grid">${techRows}</div></section>`
    : "";

  return `<div class="nd20-occupation-selector">${skillSection}${featSection}${manualFeatSection}${techSection}</div>`;
}

export async function promptOccupationSelections(
  occupationItem,
  { classSkillOptions, skillSelectCount, featOptions, manualFeatOptions, techniqueOptions },
) {
  const content = renderOccupationSelectionContent({
    classSkillOptions,
    skillSelectCount,
    featOptions,
    manualFeatOptions,
    techniqueOptions,
  });

  const result = await foundry.applications.api.DialogV2.wait({
    window: {
      title: t("NarutoD20.Occupation.SelectTitle", "{name}: Select Occupation Grants", {
        name: occupationItem.name,
      }),
      icon: "fa-solid fa-list-check",
    },
    classes: ["pf1-v2", "occupation-selector", "standard-form"],
    position: { width: 520 },
    content,
    buttons: [
      {
        action: "apply",
        label: t("NarutoD20.Occupation.Apply", "Apply"),
        default: true,
        callback: (_event, _button, dialog) => {
          const root = dialog.element.querySelector(".nd20-occupation-selector") ?? dialog.element;
          const classSkillKeys = [...root.querySelectorAll("input[name='classSkill']:checked")].map(
            (input) => input.value,
          );
          const featName = root.querySelector("input[name='featOption']:checked")?.value ?? null;
          const techniqueName =
            root.querySelector("input[name='techniqueOption']:checked")?.value ?? null;
          return {
            classSkillKeys,
            featName: featName ?? featOptions?.[0] ?? null,
            techniqueName: techniqueName ?? techniqueOptions?.[0] ?? null,
          };
        },
      },
      {
        action: "cancel",
        label: t("NarutoD20.Common.Cancel", "Cancel"),
        callback: () => null,
      },
    ],
    render: (_event, dialog) => {
      wireOccupationDialogConstraints(dialog.element, {
        skillSelectCount,
        requireFeat: (featOptions?.length ?? 0) > 1,
        requireTechnique: (techniqueOptions?.length ?? 0) > 1,
      });
    },
    rejectClose: false,
  });

  return normalizeOccupationSelectionResult(result);
}

function wireOccupationDialogConstraints(
  root,
  { skillSelectCount, requireFeat, requireTechnique },
) {
  const skillBoxes = [...root.querySelectorAll("input[name='classSkill']")];
  const featRadios = [...root.querySelectorAll("input[name='featOption']")];
  const techniqueRadios = [...root.querySelectorAll("input[name='techniqueOption']")];
  const applyButton =
    root.closest(".application")?.querySelector("button[data-action='apply']") ??
    root.parentElement?.querySelector("button[data-action='apply']");

  const refresh = () => {
    const checked = skillBoxes.filter((cb) => cb.checked).length;
    const atLimit = skillSelectCount > 0 && checked >= skillSelectCount;
    for (const cb of skillBoxes) {
      cb.disabled = atLimit && !cb.checked;
      cb.parentElement?.classList.toggle("nd20-occ-choice-disabled", cb.disabled);
    }
    const skillsOk = skillSelectCount === 0 || checked === skillSelectCount;
    const featOk = !requireFeat || featRadios.some((r) => r.checked);
    const techniqueOk = !requireTechnique || techniqueRadios.some((r) => r.checked);
    if (applyButton) applyButton.disabled = !(skillsOk && featOk && techniqueOk);
  };

  for (const cb of skillBoxes) cb.addEventListener("change", refresh);
  for (const r of featRadios) r.addEventListener("change", refresh);
  for (const r of techniqueRadios) r.addEventListener("change", refresh);
  refresh();
}
