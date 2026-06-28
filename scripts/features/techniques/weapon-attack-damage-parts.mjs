function trimString(value) {
  return String(value ?? "").trim();
}

export function typeCsvToArray(value) {
  if (Array.isArray(value)) return value.map(trimString).filter(Boolean);
  return String(value ?? "")
    .split(/[,;]/)
    .map(trimString)
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
      types: row?.typesText,
    })),
  );
}
