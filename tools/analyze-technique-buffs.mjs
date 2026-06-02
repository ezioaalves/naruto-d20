/**
 * Analyze technique buffs for valid PF1e changes.
 *
 * Reads JSON sources from packs/_source/technique-buffs/ and
 * packs/_source/techniques/, validates change targets against
 * pf1-buff-changes-reference.md and BUFF_TARGETS, and writes a
 * structured markdown report to dev-notes/buff-analysis-report.md.
 *
 * Usage: node tools/analyze-technique-buffs.mjs
 */

import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const DEV_NOTES_DIR = join(ROOT, "dev-notes");
const BUFFS_DIR = join(ROOT, "packs/_source/technique-buffs");
const TECHNIQUES_DIR = join(ROOT, "packs/_source/techniques");
const OUTPUT = join(DEV_NOTES_DIR, "buff-analysis-report.md");
const REVIEWED_FILE = join(DEV_NOTES_DIR, "buff-analysis-reviewed.json");

// ---------------------------------------------------------------------------
// Valid PF1e change targets — from docs/pf1-buff-changes-reference.md
// ---------------------------------------------------------------------------

const EXACT_TARGETS = new Set([
  // Defense
  "ac",
  "aac",
  "sac",
  "nac",
  "tac",
  "ffac",
  "cmd",
  "ffcmd",
  "spellResist",
  // Saves
  "allSavingThrows",
  "fort",
  "ref",
  "will",
  // Attack
  "attack",
  "bab",
  "wattack",
  "sattack",
  "mattack",
  "nattack",
  "rattack",
  "tattack",
  "critConfirm",
  "cmb",
  // Damage
  "damage",
  "wdamage",
  "mwdamage",
  "rwdamage",
  "twdamage",
  "rdamage",
  "mdamage",
  "ndamage",
  "sdamage",
  // Abilities
  "str",
  "dex",
  "con",
  "int",
  "wis",
  "cha",
  "strMod",
  "dexMod",
  "conMod",
  "intMod",
  "wisMod",
  "chaMod",
  "strPen",
  "dexPen",
  "conPen",
  "intPen",
  "wisPen",
  "chaPen",
  // Ability checks
  "allChecks",
  "strChecks",
  "dexChecks",
  "conChecks",
  "intChecks",
  "wisChecks",
  "chaChecks",
  // Health
  "mhp",
  "wounds",
  "vigor",
  // Skills (grouped)
  "skills",
  "unskills",
  "bonusSkillRanks",
  "strSkills",
  "dexSkills",
  "conSkills",
  "intSkills",
  "wisSkills",
  "chaSkills",
  // Speed
  "landSpeed",
  "climbSpeed",
  "swimSpeed",
  "burrowSpeed",
  "flySpeed",
  "allSpeeds",
  // Spells
  "concentration",
  "cl",
  "dc",
  // Misc
  "acpA",
  "acpS",
  "mDexA",
  "mDexS",
  "carryStr",
  "carryMult",
  "ageCategory",
  "ageCategoryPhysical",
  "ageCategoryMental",
  "size",
  "reach",
  "init",
  "bonusFeats",
  // Senses
  "sensedv",
  "sensets",
  "sensebse",
  "sensebs",
  "sensels",
  "sensesc",
  "sensetr",
  // Naruto D20 module targets (BUFF_TARGETS keys)
  "chakraPool",
  "chakraReserve",
  "learnCkc",
  "learnGnj",
  "learnNin",
  "learnTai",
  "learnFui",
  "techDcAll",
  "techDcCkc",
  "techDcFui",
  "techDcGnj",
  "techDcNin",
  "techDcTai",
]);

// Targets that match prefix patterns
const PATTERN_PREFIXES = [
  "skill.", // skill.acr, skill.ste, skill.ckc (custom), etc.
  "concn.", // concentration per spellbook
  "cl.book.", // caster level per spellbook
  "dc.school.", // DC per school
  "cl.school.", // CL per school
];

function isValidTarget(target) {
  if (!target || typeof target !== "string") return false;
  if (EXACT_TARGETS.has(target)) return true;
  return PATTERN_PREFIXES.some((p) => target.startsWith(p));
}

// ---------------------------------------------------------------------------
// JSON loading helpers
// ---------------------------------------------------------------------------

async function loadJsonDir(dir) {
  const files = (await readdir(dir)).filter((f) => f.endsWith(".json"));
  const docs = [];
  for (const file of files) {
    try {
      const raw = await readFile(join(dir, file), "utf8");
      docs.push({ file, doc: JSON.parse(raw) });
    } catch (e) {
      console.error(`  [WARN] Failed to parse ${file}: ${e.message}`);
    }
  }
  return docs;
}

// ---------------------------------------------------------------------------
// Buff name matching (mirrors buff-application.mjs findBuffByName logic)
// ---------------------------------------------------------------------------

function buildBuffMap(buffEntries) {
  const exact = new Map(); // name → buff doc
  const variants = new Map(); // prefix name → buff doc (first variant wins)

  for (const { doc } of buffEntries) {
    const name = doc.name;
    if (!name) continue;
    if (!exact.has(name)) exact.set(name, doc);
    // Register as variant source for any technique whose name is a prefix
    const m = name.match(/^(.+?)\s+\(/);
    if (m) {
      const base = m[1];
      if (!variants.has(base)) variants.set(base, doc);
    }
  }
  return { exact, variants };
}

function findBuff(techniqueName, buffMap) {
  if (buffMap.exact.has(techniqueName)) return buffMap.exact.get(techniqueName);
  for (const [base, doc] of buffMap.variants) {
    if (techniqueName.startsWith(base + " (")) return doc;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Change validation
// ---------------------------------------------------------------------------

function validateBuff(buffDoc) {
  const changes = buffDoc.system?.changes ?? [];
  const invalid = [];
  for (let i = 0; i < changes.length; i++) {
    const t = changes[i]?.target;
    if (!isValidTarget(t)) invalid.push({ index: i, target: t ?? "(missing)" });
  }
  return { count: changes.length, invalid };
}

// ---------------------------------------------------------------------------
// Main analysis
// ---------------------------------------------------------------------------

async function main() {
  await mkdir(DEV_NOTES_DIR, { recursive: true });

  console.log("Loading buffs…");
  const buffEntries = await loadJsonDir(BUFFS_DIR);

  console.log("Loading techniques…");
  const allEntries = await loadJsonDir(TECHNIQUES_DIR);
  const techEntries = allEntries.filter(({ doc }) => doc.type === "naruto-d20.technique");

  const buffMap = buildBuffMap(buffEntries);

  // --- Load review tracking (analyzed-but-intentionally-no-buff) ---
  let reviewed = { reviewedDisciplines: [], reviewedTechniques: [], notes: {} };
  try {
    reviewed = { ...reviewed, ...JSON.parse(await readFile(REVIEWED_FILE, "utf8")) };
  } catch {
    /* no tracking file yet */
  }
  const reviewedDisc = new Set(reviewed.reviewedDisciplines ?? []);
  const reviewedNames = new Set(reviewed.reviewedTechniques ?? []);
  const isReviewed = (t) => reviewedDisc.has(t.discipline) || reviewedNames.has(t.name);

  // --- Analyse buffs ---
  const buffsValidChanges = [];
  const buffsEmptyChanges = [];
  const buffsInvalidTargets = [];

  for (const { file, doc } of buffEntries) {
    const { count, invalid } = validateBuff(doc);
    if (invalid.length > 0) {
      buffsInvalidTargets.push({ file, name: doc.name, invalid });
    } else if (count === 0) {
      buffsEmptyChanges.push({ file, name: doc.name });
    } else {
      const targets = (doc.system?.changes ?? []).map((c) => c.target);
      buffsValidChanges.push({ file, name: doc.name, count, targets });
    }
  }

  // --- Analyse techniques ---
  const techWithValidBuff = [];
  const techWithEmptyBuff = [];
  const techNoBuff = [];

  for (const { file, doc } of techEntries) {
    const buff = findBuff(doc.name, buffMap);
    const discipline = doc.system?.discipline ?? "Unknown";
    const rank = doc.system?.rank ?? 0;
    const subtype = doc.system?.subtype ?? "";
    const entry = { file, name: doc.name, discipline, rank, subtype };

    if (!buff) {
      techNoBuff.push(entry);
    } else {
      const { count } = validateBuff(buff);
      if (count === 0) {
        techWithEmptyBuff.push({ ...entry, buffName: buff.name });
      } else {
        techWithValidBuff.push({ ...entry, buffName: buff.name });
      }
    }
  }

  // --- Group techniques without buff by discipline ---
  const byDiscipline = new Map();
  for (const t of techNoBuff) {
    if (!byDiscipline.has(t.discipline)) byDiscipline.set(t.discipline, []);
    byDiscipline.get(t.discipline).push(t);
  }
  for (const list of byDiscipline.values()) {
    list.sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name));
  }
  const sortedDisciplines = [...byDiscipline.keys()].sort();

  // --- Build report ---
  const lines = [];
  const h = (s) => lines.push(s);

  h(`# Relatório: Técnicas e Buffs com Changes`);
  h(``);
  h(`Gerado em: ${new Date().toISOString()}`);
  h(
    `> Arquivo gerado automaticamente por \`tools/analyze-technique-buffs.mjs\`. Não editar à mão — alterações são sobrescritas na próxima execução.`,
  );
  h(``);
  h(`## Metodologia`);
  h(``);
  h(`### Scripts`);
  h(``);
  h(`| Arquivo | Papel |`);
  h(`|---|---|`);
  h(
    `| \`tools/analyze-technique-buffs.mjs\` | Gera este relatório. Lê os JSON-fonte de \`packs/_source/techniques/\` e \`packs/_source/technique-buffs/\`, casa técnica↔buff por nome, valida os \`system.changes[].target\` contra os targets do PF1e + módulo, e agrupa as pendências por disciplina. |`,
  );
  h(
    `| \`dev-notes/buff-analysis-reviewed.json\` | Rastreio de progresso. Lista disciplinas/técnicas já analisadas e deixadas sem buff (ou com buff vazio) de propósito, para não voltarem como pendência. |`,
  );
  h(
    `| _gerador ad-hoc_ | Os itens de buff novos são criados por um script gerador pontual por batch (ex.: o usado no batch Taijutsu), modelado no buff de stance \`KOUSEN RYU\` (\`subType: temp\`, \`duration: perm\`, \`_id\` de 16 hex). |`,
  );
  h(``);
  h(`### Fontes de validação`);
  h(``);
  h(
    `- Targets válidos PF1e: \`docs/pf1-buff-changes-reference.md\` (codificados em \`EXACT_TARGETS\` + \`PATTERN_PREFIXES\` no script).`,
  );
  h(
    `- Targets do módulo: \`scripts/flag-paths.mjs\` → \`BUFF_TARGETS\` (chakra, learn checks, technique DC).`,
  );
  h(``);
  h(`### Passos do fluxo de análise (por batch)`);
  h(``);
  h(
    `1. Rodar \`node tools/analyze-technique-buffs.mjs\` e abrir a Seção D para ver as disciplinas pendentes.`,
  );
  h(
    `2. Extrair as descrições da disciplina-alvo (ex.: \`node\` lendo os fontes e despejando \`name\` + \`system.description.value\` sem HTML) e revisar uma a uma.`,
  );
  h(
    `3. Decidir candidatos. Regra: só vira buff-com-change o efeito **persistente** com **bônus numérico explícito** no texto. Técnicas Strike (ataque único) ficam de fora — o bônus pertence à _action_ da técnica, não a um buff.`,
  );
  h(
    `4. Criar os buffs (nome idêntico ao da técnica, para a automação casar) com os \`changes\` mapeados; deixar \`changes: []\` nos casos sem alvo limpo.`,
  );
  h(
    `5. Registrar a varredura em \`dev-notes/buff-analysis-reviewed.json\` (disciplina inteira ou nomes avulsos) com uma nota da decisão.`,
  );
  h(
    `6. Re-rodar o script: a Seção C deve seguir vazia (0 targets inválidos) e o batch aparece como revisado.`,
  );
  h(`7. \`npm run pack\` + recarregar o Foundry para aplicar.`);
  h(``);
  h(`### Convenções de mapeamento`);
  h(``);
  h(`- "Defense" → \`ac\` (com o tipo de bônus citado: dodge/insight/untyped).`);
  h(
    `- "weapon damage/attack" → \`wdamage\`/\`wattack\`; "unarmed" → \`mwdamage\`/\`mattack\` (em PF1e o desarmado é ataque corpo-a-corpo de arma).`,
  );
  h(`- "Balance"/"Tumble" (d20 Modern) → \`skill.acr\` (Acrobatics).`);
  h(`- "confirm critical hits" → \`critConfirm\`. Penalidades entram com formula negativa.`);
  h(``);
  h(`## Resumo`);
  h(``);
  h(`| Métrica | Valor |`);
  h(`|---|---|`);
  h(`| Técnicas totais | ${techEntries.length} |`);
  h(`| Buffs totais | ${buffEntries.length} |`);
  h(`| Técnicas com buff + changes válidas | ${techWithValidBuff.length} |`);
  h(`| Técnicas com buff sem changes | ${techWithEmptyBuff.length} |`);
  h(`| Técnicas sem buff | ${techNoBuff.length} |`);
  h(`| Buffs com changes válidas | ${buffsValidChanges.length} |`);
  h(`| Buffs sem changes | ${buffsEmptyChanges.length} |`);
  h(`| Buffs com targets inválidos | ${buffsInvalidTargets.length} |`);
  h(``);

  // Section A — valid buffs
  h(`## Seção A — Buffs com changes válidas (${buffsValidChanges.length})`);
  h(``);
  h(`| Buff | Changes | Targets usados |`);
  h(`|---|---|---|`);
  for (const { name, count, targets } of buffsValidChanges.sort((a, b) =>
    a.name.localeCompare(b.name),
  )) {
    h(`| ${name} | ${count} | ${[...new Set(targets)].join(", ")} |`);
  }
  h(``);

  // Section B — empty buffs (split reviewed-intentionally-empty vs pending candidates)
  const emptyRows = buffsEmptyChanges
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(({ name }) => {
      const match =
        techWithEmptyBuff.find((t) => t.buffName === name) ??
        techWithValidBuff.find((t) => t.buffName === name);
      return {
        name,
        techName: match?.name ?? "—",
        disc: match?.discipline ?? "—",
        rank: match?.rank ?? "—",
        reviewed: reviewedNames.has(name) || (match && reviewedDisc.has(match.discipline)),
      };
    });
  const emptyPending = emptyRows.filter((r) => !r.reviewed);
  const emptyReviewed = emptyRows.filter((r) => r.reviewed);

  h(
    `## Seção B — Buffs sem changes (${buffsEmptyChanges.length}) — ${emptyPending.length} candidatos pendentes / ${emptyReviewed.length} revisados (vazio intencional)`,
  );
  h(``);
  if (emptyRows.length === 0) {
    h(`_Nenhum._`);
  } else {
    h(`| Buff | Disciplina | Rank | Status |`);
    h(`|---|---|---|---|`);
    for (const r of [...emptyPending, ...emptyReviewed]) {
      const status = r.reviewed ? "✓ vazio intencional" : "candidato";
      h(`| ${r.name} | ${r.disc} | ${r.rank} | ${status} |`);
    }
  }
  h(``);

  // Section C — invalid targets
  h(`## Seção C — Buffs com targets inválidos (${buffsInvalidTargets.length})`);
  h(``);
  if (buffsInvalidTargets.length === 0) {
    h(`_Nenhum — todos os targets existentes são válidos._`);
  } else {
    h(`| Buff | Change # | Target problemático |`);
    h(`|---|---|---|`);
    for (const { name, invalid } of buffsInvalidTargets) {
      for (const { index, target } of invalid) {
        h(`| ${name} | ${index} | \`${target}\` |`);
      }
    }
  }
  h(``);

  // Section D — techniques without buff, per discipline
  h(`## Seção D — Técnicas sem buff, por disciplina (${techNoBuff.length} total)`);
  h(``);
  h(`Revisão em batches: cada disciplina é uma subseção colapsável.`);
  h(``);

  // Overview table — split reviewed (analyzed, no buff) vs pending
  const reviewedTotal = techNoBuff.filter(isReviewed).length;
  h(
    `Status: **${reviewedTotal} revisadas** (analisadas e deixadas sem buff) / **${techNoBuff.length - reviewedTotal} pendentes**.`,
  );
  h(``);
  h(`### Visão geral por disciplina`);
  h(``);
  h(`| Disciplina | Sem buff | Revisadas | Pendentes |`);
  h(`|---|---|---|---|`);
  for (const disc of sortedDisciplines) {
    const list = byDiscipline.get(disc);
    const rev = list.filter(isReviewed).length;
    const tag = reviewedDisc.has(disc) ? " ✓" : "";
    h(`| ${disc}${tag} | ${list.length} | ${rev} | ${list.length - rev} |`);
  }
  h(``);
  if (Object.keys(reviewed.notes ?? {}).length) {
    h(`Notas de revisão:`);
    for (const [disc, note] of Object.entries(reviewed.notes)) {
      h(`- **${disc}:** ${note}`);
    }
    h(``);
  }

  // Per-discipline detail — fully-reviewed disciplines are collapsed to a note
  for (const disc of sortedDisciplines) {
    const list = byDiscipline.get(disc);
    const pending = list.filter((t) => !isReviewed(t));
    if (pending.length === 0) {
      h(`### ${disc} (${list.length}) — ✓ revisada, sem pendências`);
      h(``);
      continue;
    }
    h(`### ${disc} (${pending.length} pendentes de ${list.length})`);
    h(``);
    h(`| Rank | Nome | Subtipo | Status |`);
    h(`|---|---|---|---|`);
    for (const t of list) {
      const status = isReviewed(t) ? "✓ revisada" : "pendente";
      h(`| ${t.rank} | ${t.name} | ${t.subtype} | ${status} |`);
    }
    h(``);
  }

  const report = lines.join("\n");
  await writeFile(OUTPUT, report, "utf8");
  console.log(`\nRelatório gerado: ${OUTPUT}`);
  console.log(`  Técnicas totais: ${techEntries.length}`);
  console.log(`  Buffs totais: ${buffEntries.length}`);
  console.log(`  Com buff + changes: ${techWithValidBuff.length}`);
  console.log(`  Com buff sem changes: ${techWithEmptyBuff.length}`);
  console.log(
    `  Sem buff: ${techNoBuff.length} (${reviewedTotal} revisadas / ${techNoBuff.length - reviewedTotal} pendentes)`,
  );
  console.log(`  Buffs com targets inválidos: ${buffsInvalidTargets.length}`);
  if (buffsInvalidTargets.length > 0) {
    console.log("\n  [ATENÇÃO] Targets inválidos encontrados:");
    for (const { name, invalid } of buffsInvalidTargets) {
      console.log(`    ${name}: ${invalid.map((x) => x.target).join(", ")}`);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
