const ACTION_ID_RE = /^[A-Za-z0-9]+$/;

export function isValidActionId(id) {
  return typeof id === "string" && ACTION_ID_RE.test(id);
}

export function createActionId() {
  if (globalThis.foundry?.utils?.randomID) return foundry.utils.randomID(16);
  return Math.random().toString(36).slice(2, 18).padEnd(16, "0");
}

export function normalizeActionIds(actions) {
  if (!Array.isArray(actions)) return { actions, changed: false };

  let changed = false;
  const seen = new Set();
  const normalized = actions.map((action) => {
    if (!action || typeof action !== "object") return action;

    const next = { ...action };
    if (next.id && !next._id) {
      next._id = next.id;
      delete next.id;
      changed = true;
    }

    if (!isValidActionId(next._id) || seen.has(next._id)) {
      let id;
      do {
        id = createActionId();
      } while (seen.has(id));
      next._id = id;
      changed = true;
    }

    seen.add(next._id);
    return next;
  });

  return { actions: normalized, changed };
}
