# Plano: weaponAttack.extraAttacks — Ataques Extras via Técnica

## Contexto

Técnicas como SANGEKI: NIGEKI (2 ataques, segundo com -5) e SANGEKI: SANGEKI (3 ataques, terceiro com -10)
precisam injetar ataques adicionais quando rolam através do `weaponAttack` system. Hoje, o sistema
suporta `attackBonus`, `damageBonus`, `nonCritDamageBonus`, `held` e `charge`, mas não tem como adicionar
ataques extras além do que a arma já tem configurado. O novo campo `weaponAttack.extraAttacks` resolve isso.

## Como o PF1e processa múltiplos ataques

**Arquivo de referência:** `foundryvtt-pathfinder1-v11.11/module/components/action.mjs`

- `action.extraAttacks.type` — determina o modo (ver `pf1.config.extraAttacks`):
  - `"standard"` → iterativas de BAB apenas, sem ataques manuais
  - `"advanced"` → iterativas de BAB + ataques manuais (`manual: true`)
  - `"custom"` → sem iterativas, só ataques manuais (`manual: true`)
- `action.extraAttacks.manual` — array de `{ name?: string, formula: string }` onde `formula` é o modificador do ataque (ex: `"-5"`)
- `getAttacks()` (linha 1961) lê `this.extraAttacks.manual` e empurra cada entrada para o array de ataques retornado

**Timeline do ActionUse** (`action-use.mjs`):
| Linha | Evento |
|-------|--------|
| 1599  | **`Hooks.callAll("pf1CreateActionUse", this)`** ← nossa janela |
| 1602  | `shared.fullAttack = true` |
| 1603  | `generateAttacks(true)` — lê `action.extraAttacks` aqui |
| ~1607 | Dialog de ataque mostrado ao jogador |
| 1633  | `if (!shared.fullAttack) attacks = attacks.slice(0, 1)` |

**Conclusão:** mutar `action.extraAttacks` dentro do hook `pf1CreateActionUse` **antes** de `generateAttacks()` é o mecanismo correto. É o mesmo padrão já usado para `nonCritParts`.

## Implementação

### 1. `scripts/ui/technique-weapon-attack.mjs`

**a) Adicionar `"extraAttacks"` a `KNOWN_KEYS`** (linha 9–18)

**b) Parsing em `parseWeaponAttackConfig`** — ler a string, dividir por `";"` para múltiplos ataques, e por `"|"` para separar `formula` de `name` opcional:

```js
// Formato: "-5|Second Attack;-10|Third Attack"
const rawExtra = str("extraAttacks");
const extraAttacks = rawExtra
  ? rawExtra.split(";").map((entry) => {
      const [formula, name] = entry.split("|").map((s) => s.trim());
      return { formula, name: name ?? "" };
    }).filter((e) => e.formula)
  : [];
```

Adicionar `extraAttacks` ao objeto `config` retornado.

**c) Injeção no hook `pf1CreateActionUse`** — dentro de `rollSelectedWeaponAttackWithTechnique`, após a lógica de `nonCritDamageBonus`:

```js
if (config.extraAttacks?.length) {
  const exAtk = actionUse.shared.action.extraAttacks;
  const supportsManual = pf1.config.extraAttacks[exAtk?.type]?.manual === true;

  // Se o tipo atual não suporta ataques manuais, upgrade para "advanced"
  // (mantém iterativas de BAB + habilita manual)
  const originalType = exAtk?.type;
  if (!supportsManual) {
    exAtk.type = "advanced";
  }

  const manual = (exAtk.manual ??= []);
  const originalLength = manual.length;
  for (const atk of config.extraAttacks) {
    manual.push(atk); // { formula, name }
  }

  cleanup.push(() => {
    exAtk.type = originalType;
    manual.splice(originalLength);
  });
}
```

**Nota:** `actionUse.shared.action` é uma referência viva e mutável — confirmado pela análise do código. `Object.defineProperties` só torna `shared.action` não-reassinável, não seus campos internos.

### 2. Técnicas no compendium (branch `feat/sangeki-weapon-attack`)

**NIGEKI** (`SANGEKI_HISSATSU_WAZA__NIGEKI__...json`):
```json
"weaponAttack.extraAttacks": "-5|Second Attack"
```

**SANGEKI** (`SANGEKI_HISSATSU_WAZA__SANGEKI__...json`):
```json
"weaponAttack.extraAttacks": "-5|Second Attack;-10|Third Attack"
```

Após editar os JSONs: `npm run pack`.

## Arquivos modificados

| Arquivo | Mudança |
|---------|---------|
| `scripts/ui/technique-weapon-attack.mjs` | `KNOWN_KEYS`, parsing, injeção no hook |
| `packs/_source/techniques/SANGEKI_HISSATSU_WAZA__NIGEKI__...json` | `weaponAttack.extraAttacks` |
| `packs/_source/techniques/SANGEKI_HISSATSU_WAZA__SANGEKI__...json` | `weaponAttack.extraAttacks` |

## Verificação

1. Usar NIGEKI com uma arma de melee equipada → dialog de seleção aparece → após confirmar, dialog de ataque da arma mostra "Attack #1" e "Attack #2 (−5)"
2. Usar SANGEKI → dialog mostra "Attack #1", "Attack #2 (−5)", "Attack #3 (−10)"
3. Usar uma técnica SEM `weaponAttack.extraAttacks` (ex: IGEKI) → comportamento inalterado, sem ataques extras
4. Abrir o console do Foundry e confirmar que nenhum warning de "unknown field" é emitido para `extraAttacks`
5. Usar a técnica duas vezes seguidas → confirmar que o cleanup funcionou e a arma não ficou com ataques extras persistidos
