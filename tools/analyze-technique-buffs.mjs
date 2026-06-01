/**
 * Analyze technique buffs for valid PF1e changes.
 *
 * Reads JSON sources from packs/_source/technique-buffs/ and
 * packs/_source/techniques/, validates change targets against
 * pf1-buff-changes-reference.md and BUFF_TARGETS, and writes a
 * structured markdown report to tools/buff-analysis-report.md.
 *
 * Usage: node tools/analyze-technique-buffs.mjs
 */

import { readdir, readFile, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const BUFFS_DIR = join(ROOT, "packs/_source/technique-buffs");
const TECHNIQUES_DIR = join(ROOT, "packs/_source/techniques");
const OUTPUT = join(__dirname, "buff-analysis-report.md");

// ---------------------------------------------------------------------------
// Valid PF1e change targets — from docs/pf1-buff-changes-reference.md
// ---------------------------------------------------------------------------

const EXACT_TARGETS = new Set([
    // Defense
    "ac","aac","sac","nac","tac","ffac","cmd","ffcmd","spellResist",
    // Saves
    "allSavingThrows","fort","ref","will",
    // Attack
    "attack","bab","wattack","sattack","mattack","nattack","rattack","tattack","critConfirm","cmb",
    // Damage
    "damage","wdamage","mwdamage","rwdamage","twdamage","rdamage","mdamage","ndamage","sdamage",
    // Abilities
    "str","dex","con","int","wis","cha",
    "strMod","dexMod","conMod","intMod","wisMod","chaMod",
    "strPen","dexPen","conPen","intPen","wisPen","chaPen",
    // Ability checks
    "allChecks","strChecks","dexChecks","conChecks","intChecks","wisChecks","chaChecks",
    // Health
    "mhp","wounds","vigor",
    // Skills (grouped)
    "skills","unskills","bonusSkillRanks",
    "strSkills","dexSkills","conSkills","intSkills","wisSkills","chaSkills",
    // Speed
    "landSpeed","climbSpeed","swimSpeed","burrowSpeed","flySpeed","allSpeeds",
    // Spells
    "concentration","cl","dc",
    // Misc
    "acpA","acpS","mDexA","mDexS","carryStr","carryMult",
    "ageCategory","ageCategoryPhysical","ageCategoryMental",
    "size","reach","init","bonusFeats",
    // Senses
    "sensedv","sensets","sensebse","sensebs","sensels","sensesc","sensetr",
    // Naruto D20 module targets (BUFF_TARGETS keys)
    "chakraPool","chakraReserve",
    "learnCkc","learnGnj","learnNin","learnTai","learnFui",
    "techDcAll","techDcCkc","techDcFui","techDcGnj","techDcNin","techDcTai",
]);

// Targets that match prefix patterns
const PATTERN_PREFIXES = [
    "skill.",       // skill.acr, skill.ste, skill.ckc (custom), etc.
    "concn.",       // concentration per spellbook
    "cl.book.",     // caster level per spellbook
    "dc.school.",   // DC per school
    "cl.school.",   // CL per school
];

function isValidTarget(target) {
    if (!target || typeof target !== "string") return false;
    if (EXACT_TARGETS.has(target)) return true;
    return PATTERN_PREFIXES.some(p => target.startsWith(p));
}

// ---------------------------------------------------------------------------
// JSON loading helpers
// ---------------------------------------------------------------------------

async function loadJsonDir(dir) {
    const files = (await readdir(dir)).filter(f => f.endsWith(".json"));
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
    const exact = new Map();   // name → buff doc
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
    console.log("Loading buffs…");
    const buffEntries = await loadJsonDir(BUFFS_DIR);

    console.log("Loading techniques…");
    const allEntries = await loadJsonDir(TECHNIQUES_DIR);
    const techEntries = allEntries.filter(({ doc }) => doc.type === "naruto-d20.technique");

    const buffMap = buildBuffMap(buffEntries);

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
            const targets = (doc.system?.changes ?? []).map(c => c.target);
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
    for (const { name, count, targets } of buffsValidChanges.sort((a,b) => a.name.localeCompare(b.name))) {
        h(`| ${name} | ${count} | ${[...new Set(targets)].join(", ")} |`);
    }
    h(``);

    // Section B — empty buffs
    h(`## Seção B — Buffs sem changes (${buffsEmptyChanges.length}) — candidatos a receber changes`);
    h(``);
    if (buffsEmptyChanges.length === 0) {
        h(`_Nenhum._`);
    } else {
        h(`| Buff | Técnica correspondente | Disciplina | Rank |`);
        h(`|---|---|---|---|`);
        for (const { name } of buffsEmptyChanges.sort((a,b) => a.name.localeCompare(b.name))) {
            const match = techWithEmptyBuff.find(t => t.buffName === name)
                ?? techWithValidBuff.find(t => t.buffName === name);
            const techName = match?.name ?? "—";
            const disc = match?.discipline ?? "—";
            const rank = match?.rank ?? "—";
            h(`| ${name} | ${techName} | ${disc} | ${rank} |`);
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

    // Overview table
    h(`### Visão geral por disciplina`);
    h(``);
    h(`| Disciplina | Técnicas sem buff |`);
    h(`|---|---|`);
    for (const disc of sortedDisciplines) {
        h(`| ${disc} | ${byDiscipline.get(disc).length} |`);
    }
    h(``);

    // Per-discipline detail
    for (const disc of sortedDisciplines) {
        const list = byDiscipline.get(disc);
        h(`### ${disc} (${list.length})`);
        h(``);
        h(`| Rank | Nome | Subtipo |`);
        h(`|---|---|---|`);
        for (const { rank, name, subtype } of list) {
            h(`| ${rank} | ${name} | ${subtype} |`);
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
    console.log(`  Sem buff: ${techNoBuff.length}`);
    console.log(`  Buffs com targets inválidos: ${buffsInvalidTargets.length}`);
    if (buffsInvalidTargets.length > 0) {
        console.log("\n  [ATENÇÃO] Targets inválidos encontrados:");
        for (const { name, invalid } of buffsInvalidTargets) {
            console.log(`    ${name}: ${invalid.map(x => x.target).join(", ")}`);
        }
    }
}

main().catch(e => { console.error(e); process.exit(1); });
