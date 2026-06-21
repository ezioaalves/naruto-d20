# GODAI TAIGEKI: NIDAN JUTSU — Configuração dos 6 variantes

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adicionar dano base (3d6 do elemento correto), automação de empower, e cone area com measureTemplate dinâmico nos 6 variantes de GODAI TAIGEKI: NIDAN JUTSU.

**Architecture:** Edições diretas nos 6 arquivos JSON do compêndio em `packs/_source/techniques/`. Sem build step de código — só JSON + `npm run pack` ao final.

**Tech Stack:** JSON (Foundry VTT compendium source), Node.js (`validate-compendia`, `npm run pack`)

## Global Constraints

- `automation.enabled` deve ser `false` (sem buff correspondente no compêndio technique-buffs — o validador emite `automation.enabled is true but no matching buff source was found` se ligado)
- `automation.empower.enabled` deve ser `true` para ativar o empower UI
- `maxStepsFormula` usa `@cl` (Character Level, injetado em `technique-rolldata.mjs`)
- Tipos de dano: `"electric"`, `"earth"`, `"fire"`, `"wind"`, `"cold"`, `"water"` (PF1 standard + naruto-d20 custom)
- `damage.parts[0].formula` = `"3d6"` em todos (base igual para toda a família NIDAN)
- Todos os variantes têm area = Cone: adicionar `system.area: "Cone"` (campo de exibição) e dentro da action `"area": "Cone"` + `"measureTemplate": { "type": "cone", "size": "floor(@cl / 2) * 5 + 20" }`
- O tamanho do cone é dinâmico baseado em `@cl`: fórmula `floor(@cl / 2) * 5 + 20` (= 20ft base + 5ft a cada 2 níveis, refletindo o alcance Medium da família)
- `npm run pack` recompila só o compêndio `techniques` (não usar `pack:all`)
- Sempre criar feature branch antes de commitar — nunca commitar diretamente na `master`

---

## Mapeamento de arquivos

| Arquivo | Elemento | Tipo de dano | maxStepsFormula |
|---|---|---|---|
| `DENPO_NO_JUTSU__STATIC_BULLET_TECHNIQUE__uNfjnndJK7eK4SAt.json` | Raiton | `electric` | `"min(@cl, 11) - 3"` |
| `DOROGA_NO_JUTSU__MUD_FANG_TECHNIQUE__GFBu6gLXWTFbXV9f.json` | Doton | `earth` | `"min(@cl, 9) - 3"` |
| `ENGA_NO_JUTSU__FIRE_FANGS_TECHNIQUE__IX2wUE4g0Gkg6FtD.json` | Katon | `fire` | `"min(@cl, 11) - 3"` |
| `GUFUUKEN_NO_JUTSU__TORNADO_SLASH_TECHNIQUE__g7P6NOhupcgTwX0i.json` | Fuuton | `wind` | `"min(@cl, 11) - 3"` |
| `HYOURENTO__FIERCE_ICE_DAGGERS__n3GrRJkVcm9qzgEA.json` | Hyouton | `cold` | `"min(@cl, 9) - 3"` |
| `MIZUTEPPO__WATER_BULLETS__WnwyyNy04gK1TMnY.json` | Suiton | `water` | `"min(@cl, 9) - 3"` |

Todos estão em `packs/_source/techniques/`.

---

### Task 1: Criar feature branch

- [ ] **Criar branch**

```bash
git checkout -b feat/godai-taigeki-nidan-empower
```

---

### Task 2: Editar DENPO NO JUTSU (Electric, max 11d6)

**Arquivo:** `packs/_source/techniques/DENPO_NO_JUTSU__STATIC_BULLET_TECHNIQUE__uNfjnndJK7eK4SAt.json`

- [ ] **Adicionar `damage.parts` na action**

Em `system.actions[0]`, adicionar o campo `"damage"` entre `"range"` e `"save"`:

```json
"damage": {
  "parts": [
    {
      "formula": "3d6",
      "types": ["electric"]
    }
  ]
},
```

- [ ] **Setar `system.area` para exibição**

No objeto `system` (nível raiz, campo de exibição), alterar:
```json
"area": "Cone",
```

O objeto `system.actions[0]` completo após edição:
```json
{
  "_id": "17n5HEjn1td0fRrh",
  "name": "Use",
  "actionType": "save",
  "activation": {
    "type": "attack",
    "unchained": { "type": "action", "cost": 1 }
  },
  "duration": { "units": "inst" },
  "range": { "units": "medium" },
  "area": "Cone",
  "measureTemplate": {
    "type": "cone",
    "size": "floor(@cl / 2) * 5 + 20"
  },
  "damage": {
    "parts": [
      { "formula": "3d6", "types": ["electric"] }
    ]
  },
  "save": { "type": "ref", "description": "Reflex half" }
}
```

- [ ] **Adicionar bloco `automation` em `system`**

Inserir o campo `"automation"` em `system` entre `"changes": []` e `"actions"`:

```json
"automation": {
  "enabled": false,
  "targetMode": "auto",
  "empower": {
    "enabled": true,
    "mode": "damageBonus",
    "costPerStep": 1,
    "formulaPerStep": "1d6",
    "damageTypes": ["electric"],
    "maxStepsFormula": "min(@cl, 11) - 3",
    "performIncreaseEvery": 0,
    "performIncreaseAmount": 0
  }
},
```

- [ ] **Verificar JSON válido**

```bash
python3 -c "import json; json.load(open('packs/_source/techniques/DENPO_NO_JUTSU__STATIC_BULLET_TECHNIQUE__uNfjnndJK7eK4SAt.json'))" && echo "OK"
```

Esperado: `OK`

---

### Task 3: Editar DOROGA NO JUTSU (Earth, max 9d6)

**Arquivo:** `packs/_source/techniques/DOROGA_NO_JUTSU__MUD_FANG_TECHNIQUE__GFBu6gLXWTFbXV9f.json`

- [ ] **Adicionar `damage.parts` na action**

Em `system.actions[0]`, adicionar o campo `"damage"` entre `"range"` e `"save"`:

```json
"damage": {
  "parts": [
    {
      "formula": "3d6",
      "types": ["earth"]
    }
  ]
},
```

- [ ] **Setar `system.area` para exibição**

No objeto `system` (nível raiz), alterar:
```json
"area": "Cone",
```

O objeto `system.actions[0]` completo após edição:
```json
{
  "_id": "c4d76582f7db4869",
  "name": "Use",
  "actionType": "save",
  "activation": {
    "type": "attack",
    "unchained": { "type": "action", "cost": 1 }
  },
  "duration": { "units": "inst" },
  "range": { "units": "medium" },
  "area": "Cone",
  "measureTemplate": {
    "type": "cone",
    "size": "floor(@cl / 2) * 5 + 20"
  },
  "damage": {
    "parts": [
      { "formula": "3d6", "types": ["earth"] }
    ]
  },
  "save": { "type": "ref", "description": "Reflex half" }
}
```

- [ ] **Adicionar bloco `automation` em `system`**

Inserir o campo `"automation"` em `system` entre `"changes": []` e `"actions"`:

```json
"automation": {
  "enabled": false,
  "targetMode": "auto",
  "empower": {
    "enabled": true,
    "mode": "damageBonus",
    "costPerStep": 1,
    "formulaPerStep": "1d6",
    "damageTypes": ["earth"],
    "maxStepsFormula": "min(@cl, 9) - 3",
    "performIncreaseEvery": 0,
    "performIncreaseAmount": 0
  }
},
```

- [ ] **Verificar JSON válido**

```bash
python3 -c "import json; json.load(open('packs/_source/techniques/DOROGA_NO_JUTSU__MUD_FANG_TECHNIQUE__GFBu6gLXWTFbXV9f.json'))" && echo "OK"
```

Esperado: `OK`

---

### Task 4: Editar ENGA NO JUTSU (Fire, max 11d6)

**Arquivo:** `packs/_source/techniques/ENGA_NO_JUTSU__FIRE_FANGS_TECHNIQUE__IX2wUE4g0Gkg6FtD.json`

- [ ] **Adicionar `damage.parts` na action**

Em `system.actions[0]`, adicionar o campo `"damage"` entre `"range"` e `"save"`:

```json
"damage": {
  "parts": [
    {
      "formula": "3d6",
      "types": ["fire"]
    }
  ]
},
```

- [ ] **Setar `system.area` para exibição**

No objeto `system` (nível raiz), alterar:
```json
"area": "Cone",
```

O objeto `system.actions[0]` completo após edição:
```json
{
  "_id": "W91ik1YhI5KJl4BJ",
  "name": "Use",
  "actionType": "save",
  "activation": {
    "type": "attack",
    "unchained": { "type": "action", "cost": 1 }
  },
  "duration": { "units": "inst" },
  "range": { "units": "medium" },
  "area": "Cone",
  "measureTemplate": {
    "type": "cone",
    "size": "floor(@cl / 2) * 5 + 20"
  },
  "damage": {
    "parts": [
      { "formula": "3d6", "types": ["fire"] }
    ]
  },
  "save": { "type": "ref", "description": "Reflex half" }
}
```

- [ ] **Adicionar bloco `automation` em `system`**

Inserir o campo `"automation"` em `system` entre `"changes": []` e `"actions"`:

```json
"automation": {
  "enabled": false,
  "targetMode": "auto",
  "empower": {
    "enabled": true,
    "mode": "damageBonus",
    "costPerStep": 1,
    "formulaPerStep": "1d6",
    "damageTypes": ["fire"],
    "maxStepsFormula": "min(@cl, 11) - 3",
    "performIncreaseEvery": 0,
    "performIncreaseAmount": 0
  }
},
```

- [ ] **Verificar JSON válido**

```bash
python3 -c "import json; json.load(open('packs/_source/techniques/ENGA_NO_JUTSU__FIRE_FANGS_TECHNIQUE__IX2wUE4g0Gkg6FtD.json'))" && echo "OK"
```

Esperado: `OK`

---

### Task 5: Editar GUFUUKEN NO JUTSU (Wind, max 11d6)

**Arquivo:** `packs/_source/techniques/GUFUUKEN_NO_JUTSU__TORNADO_SLASH_TECHNIQUE__g7P6NOhupcgTwX0i.json`

- [ ] **Adicionar `damage.parts` na action**

Em `system.actions[0]`, adicionar o campo `"damage"` entre `"range"` e `"save"`:

```json
"damage": {
  "parts": [
    {
      "formula": "3d6",
      "types": ["wind"]
    }
  ]
},
```

- [ ] **Setar `system.area` para exibição**

No objeto `system` (nível raiz), alterar:
```json
"area": "Cone",
```

O objeto `system.actions[0]` completo após edição:
```json
{
  "_id": "kEPcrHX78H3RK097",
  "name": "Use",
  "actionType": "save",
  "activation": {
    "type": "attack",
    "unchained": { "type": "action", "cost": 1 }
  },
  "duration": { "units": "inst" },
  "range": { "units": "medium" },
  "area": "Cone",
  "measureTemplate": {
    "type": "cone",
    "size": "floor(@cl / 2) * 5 + 20"
  },
  "damage": {
    "parts": [
      { "formula": "3d6", "types": ["wind"] }
    ]
  },
  "save": { "type": "ref", "description": "Reflex half" }
}
```

- [ ] **Adicionar bloco `automation` em `system`**

Inserir o campo `"automation"` em `system` entre `"changes": []` e `"actions"`:

```json
"automation": {
  "enabled": false,
  "targetMode": "auto",
  "empower": {
    "enabled": true,
    "mode": "damageBonus",
    "costPerStep": 1,
    "formulaPerStep": "1d6",
    "damageTypes": ["wind"],
    "maxStepsFormula": "min(@cl, 11) - 3",
    "performIncreaseEvery": 0,
    "performIncreaseAmount": 0
  }
},
```

- [ ] **Verificar JSON válido**

```bash
python3 -c "import json; json.load(open('packs/_source/techniques/GUFUUKEN_NO_JUTSU__TORNADO_SLASH_TECHNIQUE__g7P6NOhupcgTwX0i.json'))" && echo "OK"
```

Esperado: `OK`

---

### Task 6: Editar HYOURENTO (Cold, max 9d6)

**Arquivo:** `packs/_source/techniques/HYOURENTO__FIERCE_ICE_DAGGERS__n3GrRJkVcm9qzgEA.json`

- [ ] **Adicionar `damage.parts` na action**

Em `system.actions[0]`, adicionar o campo `"damage"` entre `"range"` e `"save"`:

```json
"damage": {
  "parts": [
    {
      "formula": "3d6",
      "types": ["cold"]
    }
  ]
},
```

- [ ] **Setar `system.area` para exibição**

No objeto `system` (nível raiz), alterar:
```json
"area": "Cone",
```

O objeto `system.actions[0]` completo após edição:
```json
{
  "_id": "AuS5LbrgL71IcE7b",
  "name": "Use",
  "actionType": "save",
  "activation": {
    "type": "attack",
    "unchained": { "type": "action", "cost": 1 }
  },
  "duration": { "units": "inst" },
  "range": { "units": "medium" },
  "area": "Cone",
  "measureTemplate": {
    "type": "cone",
    "size": "floor(@cl / 2) * 5 + 20"
  },
  "damage": {
    "parts": [
      { "formula": "3d6", "types": ["cold"] }
    ]
  },
  "save": { "type": "ref", "description": "Reflex half" }
}
```

- [ ] **Adicionar bloco `automation` em `system`**

Inserir o campo `"automation"` em `system` entre `"changes": []` e `"actions"`:

```json
"automation": {
  "enabled": false,
  "targetMode": "auto",
  "empower": {
    "enabled": true,
    "mode": "damageBonus",
    "costPerStep": 1,
    "formulaPerStep": "1d6",
    "damageTypes": ["cold"],
    "maxStepsFormula": "min(@cl, 9) - 3",
    "performIncreaseEvery": 0,
    "performIncreaseAmount": 0
  }
},
```

- [ ] **Verificar JSON válido**

```bash
python3 -c "import json; json.load(open('packs/_source/techniques/HYOURENTO__FIERCE_ICE_DAGGERS__n3GrRJkVcm9qzgEA.json'))" && echo "OK"
```

Esperado: `OK`

---

### Task 7: Editar MIZUTEPPO (Water, max 9d6)

**Arquivo:** `packs/_source/techniques/MIZUTEPPO__WATER_BULLETS__WnwyyNy04gK1TMnY.json`

- [ ] **Adicionar `damage.parts` na action**

Em `system.actions[0]`, adicionar o campo `"damage"` entre `"range"` e `"save"`:

```json
"damage": {
  "parts": [
    {
      "formula": "3d6",
      "types": ["water"]
    }
  ]
},
```

- [ ] **Setar `system.area` para exibição**

No objeto `system` (nível raiz), alterar:
```json
"area": "Cone",
```

O objeto `system.actions[0]` completo após edição:
```json
{
  "_id": "s0xWyXxUyyrkDUfx",
  "name": "Use",
  "actionType": "save",
  "activation": {
    "type": "attack",
    "unchained": { "type": "action", "cost": 1 }
  },
  "duration": { "units": "inst" },
  "range": { "units": "medium" },
  "area": "Cone",
  "measureTemplate": {
    "type": "cone",
    "size": "floor(@cl / 2) * 5 + 20"
  },
  "damage": {
    "parts": [
      { "formula": "3d6", "types": ["water"] }
    ]
  },
  "save": { "type": "ref", "description": "Reflex half" }
}
```

- [ ] **Adicionar bloco `automation` em `system`**

Inserir o campo `"automation"` em `system` entre `"changes": []` e `"actions"`:

```json
"automation": {
  "enabled": false,
  "targetMode": "auto",
  "empower": {
    "enabled": true,
    "mode": "damageBonus",
    "costPerStep": 1,
    "formulaPerStep": "1d6",
    "damageTypes": ["water"],
    "maxStepsFormula": "min(@cl, 9) - 3",
    "performIncreaseEvery": 0,
    "performIncreaseAmount": 0
  }
},
```

- [ ] **Verificar JSON válido**

```bash
python3 -c "import json; json.load(open('packs/_source/techniques/MIZUTEPPO__WATER_BULLETS__WnwyyNy04gK1TMnY.json'))" && echo "OK"
```

Esperado: `OK`

---

### Task 8: Validar, pack e commitar

- [ ] **Rodar o validador nos 6 arquivos**

```bash
node tools/validate-compendia.mjs 2>&1 | grep -E "(DENPO|DOROGA|ENGA|GUFUUKEN|HYOURENTO|MIZUTEPPO)"
```

Esperado: nenhuma linha de output (os warnings de `compEmpower is set but automation.empower is absent` devem ter sumido).

- [ ] **Confirmar que a contagem de erros não aumentou**

```bash
node tools/validate-compendia.mjs 2>&1 | tail -4
```

Esperado: `Errors: 0` (warnings podem ser mais ou iguais ao baseline, mas não podem ter aumentado para os 6 arquivos alvo).

- [ ] **Recompilar o compêndio**

```bash
npm run pack
```

Esperado: termina sem erro.

- [ ] **Commitar**

```bash
git add packs/_source/techniques/DENPO_NO_JUTSU__STATIC_BULLET_TECHNIQUE__uNfjnndJK7eK4SAt.json \
        packs/_source/techniques/DOROGA_NO_JUTSU__MUD_FANG_TECHNIQUE__GFBu6gLXWTFbXV9f.json \
        packs/_source/techniques/ENGA_NO_JUTSU__FIRE_FANGS_TECHNIQUE__IX2wUE4g0Gkg6FtD.json \
        packs/_source/techniques/GUFUUKEN_NO_JUTSU__TORNADO_SLASH_TECHNIQUE__g7P6NOhupcgTwX0i.json \
        packs/_source/techniques/HYOURENTO__FIERCE_ICE_DAGGERS__n3GrRJkVcm9qzgEA.json \
        packs/_source/techniques/MIZUTEPPO__WATER_BULLETS__WnwyyNy04gK1TMnY.json \
        packs/techniques.db
git commit -m "feat(compendium): configure damage and empower on GODAI TAIGEKI NIDAN variants"
```
