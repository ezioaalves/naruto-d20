# Design: GODAI TAIGEKI: SHODAN JUTSU — Configuração dos 6 variantes

## Contexto

GODAI TAIGEKI: SHODAN JUTSU é uma técnica-coleção. Os 6 variantes existem como itens separados no compêndio, mas estão sem dano nem automação de empower configurados.

## Escopo

Apenas os 6 variantes do SHODAN JUTSU. Outros ranks (NIDAN, SANDAN, YONDAN) e a família RANSATSU ficam fora.

## Arquivos afetados

| Arquivo | Elemento | Tipo de dano | Max empower |
|---|---|---|---|
| `DENHA_NO_JUTSU__STATIC_BURST_TECHNIQUE__GJlezXoOiAQqerO5.json` | Raiton | `electric` | 10d6 |
| `DORONAMI_NO_JUTSU__MUD_WAVE_TECHNIQUE__cxFtQpwbnnT2gVT3.json` | Doton | `earth` | 8d6 |
| `GOUKAKYUU_NO_JUTSU__GRAND_FIREBALL_TECHNIQUE__QQvrR7CAV8Zdt7TB.json` | Katon | `fire` | 10d6 |
| `GUFUURAN_NO_JUTSU__TORNADO_SLICER_TECHNIQUE__p3Z52FbgwYvmGUBj.json` | Fuuton | `wind` | 10d6 |
| `HYOUKAIMEN_NO_JUTSU__ICE_CRUSHER_TECHNIQUE__vBzIaExrAPgMhbjE.json` | Hyouton | `cold` | 8d6 |
| `MIZURAPPA__CRUSHING_WATER_WAVE__lXOHVZA6LMLtP7J6.json` | Suiton | `water` | 8d6 |

## Mudanças por arquivo

### 1. `actions[0].damage.parts`

Adicionar a cada variante:
```json
[{ "formula": "2d6", "types": ["<elemento>"] }]
```

### 2. `system.automation`

Adicionar bloco novo em cada variante. Segue o padrão já usado por GODAI RANSATSU: SHODAN JUTSU.

```json
"automation": {
  "enabled": true,
  "targetMode": "auto",
  "empower": {
    "enabled": true,
    "mode": "damageBonus",
    "costPerStep": 1,
    "formulaPerStep": "1d6",
    "damageTypes": ["<elemento>"],
    "maxStepsFormula": "min(@cl, <MAX>) - 2",
    "performIncreaseEvery": 0,
    "performIncreaseAmount": 0
  }
}
```

- Max 10d6: `"min(@cl, 10) - 2"` (Denha, Goukakyuu, Gufuuran)
- Max 8d6: `"min(@cl, 8) - 2"` (Doronami, Hyoukaimen, Mizurappa)

O `-2` desconta a base `2d6`; steps = dados extras máximos.

### 3. Range

`actions[0].range.units = "close"` já está correto em todos. `measureTemplate.size = "30"` permanece (nenhuma outra técnica usa fórmulas em templates).

## O que não muda

- Técnica-pai GODAI TAIGEKI: SHODAN JUTSU
- `actionType`, `rank`, `chakraCost`, `compEmpower`, área, save
