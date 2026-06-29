function trimString(value) {
  return String(value ?? "").trim();
}

const DAMAGE_TYPE_ALIASES = Object.freeze({
  electricity: "electric",
});

const EMPTY_DAMAGE_TYPE_LABELS = new Set(["undefined"]);

function canonicalDamageType(value) {
  const type = trimString(value);
  if (EMPTY_DAMAGE_TYPE_LABELS.has(type.toLowerCase())) return "";
  return DAMAGE_TYPE_ALIASES[type] ?? type;
}

export function typeCsvToArray(value) {
  if (Array.isArray(value)) return value.map(canonicalDamageType).filter(Boolean);
  if (value instanceof Set) return [...value].map(canonicalDamageType).filter(Boolean);
  return String(value ?? "")
    .split(/[,;]/)
    .map(canonicalDamageType)
    .filter(Boolean);
}

export function typeArrayToCsv(types) {
  return typeCsvToArray(types).join(", ");
}

export function normalizeDamagePartRows(rows) {
  if (!Array.isArray(rows)) return [];
  return rows
    .map((row) => ({
      formula: trimString(row?.formula),
      types: typeCsvToArray(row?.types),
    }))
    .filter((row) => row.formula);
}

export function normalizeDamagePartDraftRows(rows) {
  if (!Array.isArray(rows)) return [];
  return rows
    .map((row) => ({
      formula: trimString(row?.formula),
      types: typeCsvToArray(row?.types ?? row?.typesText),
    }))
    .filter((row) => row.formula || row.types.length);
}

export function legacyFormulaToDamageParts(formula) {
  const text = trimString(formula);
  return text ? [{ formula: text, types: [] }] : [];
}

export function damagePartRowsToForm(rows) {
  return normalizeDamagePartRows(rows).map((row) => ({
    formula: row.formula,
    typesText: typeArrayToCsv(row.types),
  }));
}

export function damagePartRowsFromForm(rows) {
  if (!Array.isArray(rows)) return [];
  return normalizeDamagePartRows(
    rows.map((row) => ({
      formula: row?.formula,
      types: row?.types ?? row?.typesText,
    })),
  );
}
