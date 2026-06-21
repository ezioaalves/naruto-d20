# GODAI TAIGEKI: SHODAN JUTSU — Configuração dos 6 variantes

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adicionar dano base (2d6 do elemento correto) e automação de empower nos 6 variantes de GODAI TAIGEKI: SHODAN JUTSU.

**Architecture:** Edições diretas nos 6 arquivos JSON do compêndio em `packs/_source/techniques/`. Sem build step de código — só JSON + `npm run pack` ao final.

**Tech Stack:** JSON (Foundry VTT compendium source), Node.js (`validate-compendia`, `npm run pack`)

## Global Constraints

- `automation.enabled` deve ser `false` (sem buff correspondente no compêndio technique-buffs — o validador emite `automation.enabled is true but no matching buff source was found` se ligado)
- `automation.empower.enabled` deve ser `true` para ativar o empower UI
- `maxStepsFormula` usa `@cl` (Character Level, injetado em `technique-rolldata.mjs`)
- Tipos de dano: `"electric"`, `"earth"`, `"fire"`, `"wind"`, `"cold"`, `"water"` (PF1 standard + naruto-d20 custom)
- `damage.parts[0].formula` = `"2d6"` em todos (base igual para toda a família)
- `npm run pack` recompila só o compêndio `techniques` (não usar `pack:all`)
- Sempre criar feature branch antes de commitar — nunca commitar diretamente na `master`

---

## Mapeamento de arquivos

| Arquivo | Elemento | Tipo de dano | maxStepsFormula |
|---|---|---|---|
| `DENHA_NO_JUTSU__STATIC_BURST_TECHNIQUE__GJlezXoOiAQqerO5.json` | Raiton | `electric` | `"min(@cl, 10) - 2"` |
| `DORONAMI_NO_JUTSU__MUD_WAVE_TECHNIQUE__cxFtQpwbnnT2gVT3.json` | Doton | `earth` | `"min(@cl, 8) - 2"` |
| `GOUKAKYUU_NO_JUTSU__GRAND_FIREBALL_TECHNIQUE__QQvrR7CAV8Zdt7TB.json` | Katon | `fire` | `"min(@cl, 10) - 2"` |
| `GUFUURAN_NO_JUTSU__TORNADO_SLICER_TECHNIQUE__p3Z52FbgwYvmGUBj.json` | Fuuton | `wind` | `"min(@cl, 10) - 2"` |
| `HYOUKAIMEN_NO_JUTSU__ICE_CRUSHER_TECHNIQUE__vBzIaExrAPgMhbjE.json` | Hyouton | `cold` | `"min(@cl, 8) - 2"` |
| `MIZURAPPA__CRUSHING_WATER_WAVE__lXOHVZA6LMLtP7J6.json` | Suiton | `water` | `"min(@cl, 8) - 2"` |

Todos estão em `packs/_source/techniques/`.

---

### Task 1: Criar feature branch

- [ ] **Criar branch**

```bash
git checkout -b feat/godai-taigeki-shodan-empower
```

---

### Task 2: Editar DENHA NO JUTSU (Electric, max 10d6)

**Arquivo:** `packs/_source/techniques/DENHA_NO_JUTSU__STATIC_BURST_TECHNIQUE__GJlezXoOiAQqerO5.json`

Dois campos do objeto `system` precisam ser alterados.

- [ ] **Adicionar `damage.parts` na action**

Em `system.actions[0]`, o objeto `"save"` atualmente tem a chave `"save"` como última key e não tem `"damage"`. Adicionar `"damage"` com parts:

```json
"damage": {
  "parts": [
    {
      "formula": "2d6",
      "types": ["electric"]
    }
  ]
}
```

O objeto `system.actions[0]` completo após edição:
```json
{
  "_id": "yKwe4r0defmmQxFK",
  "name": "Use",
  "actionType": "save",
  "activation": {
    "type": "attack",
    "unchained": { "type": "action", "cost": 1 }
  },
  "duration": { "units": "inst" },
  "range": { "units": "close" },
  "area": "Cone",
  "measureTemplate": { "type": "cone", "size": "30" },
  "damage": {
    "parts": [
      { "formula": "2d6", "types": ["electric"] }
    ]
  },
  "save": { "type": "ref", "description": "Reflex half" }
}
```

- [ ] **Adicionar bloco `automation` em `system`**

Inserir o campo `"automation"` em `system` (após `"changes": []` e antes de `"scriptCalls"`):

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
    "maxStepsFormula": "min(@cl, 10) - 2",
    "performIncreaseEvery": 0,
    "performIncreaseAmount": 0
  }
}
```

- [ ] **Verificar JSON válido**

```bash
python3 -c "import json; json.load(open('packs/_source/techniques/DENHA_NO_JUTSU__STATIC_BURST_TECHNIQUE__GJlezXoOiAQqerO5.json'))" && echo "OK"
```

Esperado: `OK`

---

### Task 3: Editar DORONAMI NO JUTSU (Earth, max 8d6)

**Arquivo:** `packs/_source/techniques/DORONAMI_NO_JUTSU__MUD_WAVE_TECHNIQUE__cxFtQpwbnnT2gVT3.json`

- [ ] **Adicionar `damage.parts` na action**

Em `system.actions[0]`:
```json
"damage": {
  "parts": [
    { "formula": "2d6", "types": ["earth"] }
  ]
}
```

- [ ] **Adicionar bloco `automation` em `system`**

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
    "maxStepsFormula": "min(@cl, 8) - 2",
    "performIncreaseEvery": 0,
    "performIncreaseAmount": 0
  }
}
```

- [ ] **Verificar JSON válido**

```bash
python3 -c "import json; json.load(open('packs/_source/techniques/DORONAMI_NO_JUTSU__MUD_WAVE_TECHNIQUE__cxFtQpwbnnT2gVT3.json'))" && echo "OK"
```

Esperado: `OK`

---

### Task 4: Editar GOUKAKYUU NO JUTSU (Fire, max 10d6)

**Arquivo:** `packs/_source/techniques/GOUKAKYUU_NO_JUTSU__GRAND_FIREBALL_TECHNIQUE__QQvrR7CAV8Zdt7TB.json`

- [ ] **Adicionar `damage.parts` na action**

Em `system.actions[0]`:
```json
"damage": {
  "parts": [
    { "formula": "2d6", "types": ["fire"] }
  ]
}
```

- [ ] **Adicionar bloco `automation` em `system`**

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
    "maxStepsFormula": "min(@cl, 10) - 2",
    "performIncreaseEvery": 0,
    "performIncreaseAmount": 0
  }
}
```

- [ ] **Verificar JSON válido**

```bash
python3 -c "import json; json.load(open('packs/_source/techniques/GOUKAKYUU_NO_JUTSU__GRAND_FIREBALL_TECHNIQUE__QQvrR7CAV8Zdt7TB.json'))" && echo "OK"
```

Esperado: `OK`

---

### Task 5: Editar GUFUURAN NO JUTSU (Wind, max 10d6)

**Arquivo:** `packs/_source/techniques/GUFUURAN_NO_JUTSU__TORNADO_SLICER_TECHNIQUE__p3Z52FbgwYvmGUBj.json`

- [ ] **Adicionar `damage.parts` na action**

Em `system.actions[0]`:
```json
"damage": {
  "parts": [
    { "formula": "2d6", "types": ["wind"] }
  ]
}
```

- [ ] **Adicionar bloco `automation` em `system`**

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
    "maxStepsFormula": "min(@cl, 10) - 2",
    "performIncreaseEvery": 0,
    "performIncreaseAmount": 0
  }
}
```

- [ ] **Verificar JSON válido**

```bash
python3 -c "import json; json.load(open('packs/_source/techniques/GUFUURAN_NO_JUTSU__TORNADO_SLICER_TECHNIQUE__p3Z52FbgwYvmGUBj.json'))" && echo "OK"
```

Esperado: `OK`

---

### Task 6: Editar HYOUKAIMEN NO JUTSU (Cold, max 8d6)

**Arquivo:** `packs/_source/techniques/HYOUKAIMEN_NO_JUTSU__ICE_CRUSHER_TECHNIQUE__vBzIaExrAPgMhbjE.json`

- [ ] **Adicionar `damage.parts` na action**

Em `system.actions[0]`:
```json
"damage": {
  "parts": [
    { "formula": "2d6", "types": ["cold"] }
  ]
}
```

- [ ] **Adicionar bloco `automation` em `system`**

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
    "maxStepsFormula": "min(@cl, 8) - 2",
    "performIncreaseEvery": 0,
    "performIncreaseAmount": 0
  }
}
```

- [ ] **Verificar JSON válido**

```bash
python3 -c "import json; json.load(open('packs/_source/techniques/HYOUKAIMEN_NO_JUTSU__ICE_CRUSHER_TECHNIQUE__vBzIaExrAPgMhbjE.json'))" && echo "OK"
```

Esperado: `OK`

---

### Task 7: Editar MIZURAPPA (Water, max 8d6)

**Arquivo:** `packs/_source/techniques/MIZURAPPA__CRUSHING_WATER_WAVE__lXOHVZA6LMLtP7J6.json`

- [ ] **Adicionar `damage.parts` na action**

Em `system.actions[0]`:
```json
"damage": {
  "parts": [
    { "formula": "2d6", "types": ["water"] }
  ]
}
```

- [ ] **Adicionar bloco `automation` em `system`**

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
    "maxStepsFormula": "min(@cl, 8) - 2",
    "performIncreaseEvery": 0,
    "performIncreaseAmount": 0
  }
}
```

- [ ] **Verificar JSON válido**

```bash
python3 -c "import json; json.load(open('packs/_source/techniques/MIZURAPPA__CRUSHING_WATER_WAVE__lXOHVZA6LMLtP7J6.json'))" && echo "OK"
```

Esperado: `OK`

---

### Task 8: Validar, pack e commitar

- [ ] **Rodar o validador**

```bash
node tools/validate-compendia.mjs 2>&1 | grep -E "(DENHA|DORONAMI|GOUKAKYUU|GUFUURAN|HYOUKAIMEN|MIZURAPPA)"
```

Esperado: nenhuma linha de output (os warnings de `compEmpower is set but automation.empower is absent` devem ter sumido).

- [ ] **Confirmar que a contagem de erros não aumentou**

```bash
node tools/validate-compendia.mjs 2>&1 | tail -4
```

Esperado: `Errors: 0` (warnings podem ser mais ou iguais ao baseline de 245, mas não podem ter aumentado para os 6 arquivos alvo).

- [ ] **Recompilar o compêndio**

```bash
npm run pack
```

Esperado: termina sem erro.

- [ ] **Commitar**

```bash
git add packs/_source/techniques/DENHA_NO_JUTSU__STATIC_BURST_TECHNIQUE__GJlezXoOiAQqerO5.json \
        packs/_source/techniques/DORONAMI_NO_JUTSU__MUD_WAVE_TECHNIQUE__cxFtQpwbnnT2gVT3.json \
        packs/_source/techniques/GOUKAKYUU_NO_JUTSU__GRAND_FIREBALL_TECHNIQUE__QQvrR7CAV8Zdt7TB.json \
        packs/_source/techniques/GUFUURAN_NO_JUTSU__TORNADO_SLICER_TECHNIQUE__p3Z52FbgwYvmGUBj.json \
        packs/_source/techniques/HYOUKAIMEN_NO_JUTSU__ICE_CRUSHER_TECHNIQUE__vBzIaExrAPgMhbjE.json \
        packs/_source/techniques/MIZURAPPA__CRUSHING_WATER_WAVE__lXOHVZA6LMLtP7J6.json \
        packs/techniques.db
git commit -m "feat(compendium): configure damage and empower on GODAI TAIGEKI SHODAN variants"
```
