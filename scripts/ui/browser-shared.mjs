export function buildFilterGroup(id, label, choiceMap, activeSet, collapsed) {
    const choices = Object.entries(choiceMap).map(([key, choiceLabel]) => ({
        key,
        label:  choiceLabel,
        active: activeSet.has(key),
    }));
    return {
        id,
        label,
        choices,
        active:      activeSet.size > 0,
        activeCount: activeSet.size,
        collapsed:   collapsed.has(id) ? "collapsed" : "",
    };
}

export function clearFilterSets(filters) {
    for (const set of Object.values(filters)) set.clear();
}

export function restoreSearchFocus(root, selection = null) {
    const input = root.querySelector('input[name="filter"]');
    if (!input) return false;

    input.focus();
    const len = input.value.length;
    const start = Number.isInteger(selection?.start) ? Math.min(selection.start, len) : len;
    const end = Number.isInteger(selection?.end) ? Math.min(selection.end, len) : start;
    input.setSelectionRange(start, end);
    return true;
}

export function registerBrowserSearch(root, onSearch, delay = 200) {
    const search = root.querySelector('input[name="filter"]');
    if (!search) return;

    let timer;
    search.addEventListener("input", (ev) => {
        clearTimeout(timer);
        const { selectionStart, selectionEnd, value } = ev.target;
        timer = setTimeout(() => onSearch({
            value,
            selection: { start: selectionStart, end: selectionEnd },
        }), delay);
    });
}

export function registerCheckboxFilterListeners(root, filters, onChange) {
    root.querySelectorAll('input[type="checkbox"][name^="filter."]').forEach((checkbox) => {
        checkbox.addEventListener("change", (ev) => {
            const [, groupId, , key] = ev.target.name.split(".");
            const set = filters[groupId];
            if (!set) return;
            if (ev.target.checked) set.add(key);
            else set.delete(key);
            onChange();
        });
    });
}

export function registerFilterCollapseListeners(root, collapsed) {
    root.querySelectorAll(".filter h3").forEach((h3) => {
        h3.style.cursor = "pointer";
        h3.addEventListener("click", (ev) => {
            if (ev.target.closest(".filter-count")) return;
            const filterEl = h3.closest("[data-filter-id]");
            const id = filterEl?.dataset.filterId;
            if (!id) return;
            if (collapsed.has(id)) collapsed.delete(id);
            else collapsed.add(id);
            filterEl.querySelector(".filter-content")
                ?.classList.toggle("collapsed", collapsed.has(id));
        });
    });
}

export function registerEntryOpenListeners(root) {
    root.querySelectorAll(".entry-name a").forEach((anchor) => {
        anchor.addEventListener("click", async (ev) => {
            ev.preventDefault();
            const uuid = ev.currentTarget.closest("[data-uuid]")?.dataset.uuid;
            const doc = uuid ? await fromUuid(uuid) : null;
            doc?.sheet?.render(true);
        });
    });
}

export function registerUuidDragStartListeners(root) {
    root.querySelectorAll("[data-uuid]").forEach((li) => {
        li.addEventListener("dragstart", (ev) => {
            const uuid = li.dataset.uuid;
            if (!uuid) return;
            ev.dataTransfer.setData("text/plain", JSON.stringify({ type: "Item", uuid }));
        });
    });
}

export function registerReloadListener(root, onReload) {
    root.querySelector(".reload")?.addEventListener("click", onReload);
}

export function registerClearFiltersListener(root, onClear) {
    root.querySelector(".clear-filters")?.addEventListener("click", onClear);
}
