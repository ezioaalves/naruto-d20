# PF1 Buff Changes Reference

Esta referencia lista os `Changes` que um item `buff` do PF1e v11.11 pode aplicar.
Ela foi verificada contra a instalacao local em
`Data/systems/pf1` (`system.json` versao `11.11`) e contra os targets extras
registrados por este modulo em `scripts/flag-paths.mjs`.

No JSON do item, cada change fica em `item.system.changes[]`:

```json
{
  "_id": "randomid",
  "formula": "2",
  "operator": "add",
  "target": "ac",
  "type": "deflection",
  "priority": 0
}
```

## Campos

| Campo | Valores | Uso |
| --- | --- | --- |
| `operator` | `add`, `set` | `add` soma ao alvo; `set` substitui o valor do alvo. |
| `target` | uma chave das tabelas abaixo | Define qual estatistica do actor sera afetada. |
| `type` | uma chave de bonus type | Controla stacking. |
| `formula` | formula PF1/Foundry | Pode usar roll data, como `@abilities.wis.mod`. |
| `priority` | numero, padrao `0` | PF1 processa prioridades maiores mais cedo; negativas rodam mais tarde. |
| `continuous` | boolean opcional | Reaplica o change continuamente durante a preparacao de dados. |

Tipos que empilham entre si: `untyped`, `untypedPerm`, `dodge`, `racial`,
`circumstance`. Os demais usam o maior bonus positivo do mesmo tipo. Penalidades
negativas normalmente acumulam por diferenca aplicada pelo engine.

## Bonus Types

| Chave | Label PF1 |
| --- | --- |
| `untyped` | Untyped |
| `untypedPerm` | Untyped (Permanent) |
| `base` | Base |
| `enh` | Enhancement |
| `dodge` | Dodge |
| `haste` | Haste |
| `inherent` | Inherent |
| `deflection` | Deflection |
| `morale` | Morale |
| `luck` | Luck |
| `sacred` | Sacred |
| `insight` | Insight |
| `resist` | Resistance |
| `profane` | Profane |
| `trait` | Trait |
| `racial` | Racial |
| `size` | Size |
| `competence` | Competence |
| `circumstance` | Circumstance |
| `alchemical` | Alchemical |

## Core PF1 Targets

`Aplicacao` indica quando o valor entra no actor. `prepared` altera dados
preparados do actor; `roll/deferred` e calculado quando a rolagem usa aquele
tipo de bonus; `simple` roda antes do roll data completo existir.

### Defense

| Target | Label PF1 | Aplicacao |
| --- | --- | --- |
| `ac` | Generic AC | prepared |
| `aac` | Armor AC | prepared |
| `sac` | Shield AC | prepared |
| `nac` | Natural Armor AC | prepared |
| `tac` | Touch AC | prepared |
| `ffac` | Flat-footed AC | prepared |
| `cmd` | Combat Maneuver Defense | prepared |
| `ffcmd` | Flat-footed CMD | prepared |
| `spellResist` | Spell Resistance | prepared |

### Saving Throws

| Target | Label PF1 | Aplicacao |
| --- | --- | --- |
| `allSavingThrows` | All Saving Throws | roll/deferred |
| `fort` | Fortitude | roll/deferred |
| `ref` | Reflex | roll/deferred |
| `will` | Will | roll/deferred |

### Attack

| Target | Label PF1 | Aplicacao |
| --- | --- | --- |
| `attack` | All Attack Rolls | roll/deferred |
| `bab` | Base Attack Bonus | prepared |
| `wattack` | Weapon Attack Rolls | roll/deferred |
| `sattack` | Spell Attack Rolls | roll/deferred |
| `mattack` | Melee Attack Rolls | roll/deferred |
| `nattack` | Natural Attack Rolls | roll/deferred |
| `rattack` | Ranged Attack Rolls | roll/deferred |
| `tattack` | Thrown Attack Rolls | roll/deferred |
| `critConfirm` | Critical Confirmation | roll/deferred |
| `cmb` | Combat Maneuver Bonus | prepared |

PF1 also defines hidden target `~attackCore`, which writes to
`system.attributes.attack.shared`. Hidden targets are filtered out of the picker
and are normally reserved for PF1 internals such as wound-threshold handling.

### Damage

| Target | Label PF1 | Aplicacao |
| --- | --- | --- |
| `damage` | All Damage Rolls | roll/deferred |
| `wdamage` | Weapon Damage | roll/deferred |
| `mwdamage` | Melee Weapon Damage | roll/deferred |
| `rwdamage` | Ranged Weapon Damage | roll/deferred |
| `twdamage` | Thrown Weapon Damage | roll/deferred |
| `rdamage` | All Ranged Damage | roll/deferred |
| `mdamage` | All Melee Damage | roll/deferred |
| `ndamage` | Natural Attack Damage | roll/deferred |
| `sdamage` | Spell Damage | roll/deferred |

### Ability Scores

| Target | Label PF1 | Aplicacao |
| --- | --- | --- |
| `str` | Strength | prepared |
| `dex` | Dexterity | prepared |
| `con` | Constitution | prepared |
| `int` | Intelligence | prepared |
| `wis` | Wisdom | prepared |
| `cha` | Charisma | prepared |
| `strMod` | Strength Modifier | prepared |
| `dexMod` | Dexterity Modifier | prepared |
| `conMod` | Constitution Modifier | prepared |
| `intMod` | Intelligence Modifier | prepared |
| `wisMod` | Wisdom Modifier | prepared |
| `chaMod` | Charisma Modifier | prepared |
| `strPen` | Strength Penalty | prepared |
| `dexPen` | Dexterity Penalty | prepared |
| `conPen` | Constitution Penalty | prepared |
| `intPen` | Intelligence Penalty | prepared |
| `wisPen` | Wisdom Penalty | prepared |
| `chaPen` | Charisma Penalty | prepared |

### Ability Checks

| Target | Label PF1 | Aplicacao |
| --- | --- | --- |
| `allChecks` | All Ability Checks | roll/deferred |
| `strChecks` | Strength Checks | roll/deferred |
| `dexChecks` | Dexterity Checks | roll/deferred |
| `conChecks` | Constitution Checks | roll/deferred |
| `intChecks` | Intelligence Checks | roll/deferred |
| `wisChecks` | Wisdom Checks | roll/deferred |
| `chaChecks` | Charisma Checks | roll/deferred |

### Health

| Target | Label PF1 | Aplicacao |
| --- | --- | --- |
| `mhp` | Hit Points | prepared |
| `wounds` | Wounds | prepared |
| `vigor` | Vigor | prepared |

PF1's `getChangeFlat` also recognizes `woundThreshold`, which writes to
`system.attributes.wounds.threshold`. It is not part of the normal buff target
selector in v11.11.

### Skills

| Target | Label PF1 | Aplicacao |
| --- | --- | --- |
| `skills` | All Skills | roll/deferred |
| `unskills` | Untrained Skills | roll/deferred |
| `strSkills` | Strength Skills | roll/deferred |
| `dexSkills` | Dexterity Skills | roll/deferred |
| `conSkills` | Constitution Skills | roll/deferred |
| `intSkills` | Intelligence Skills | roll/deferred |
| `wisSkills` | Wisdom Skills | roll/deferred |
| `chaSkills` | Charisma Skills | roll/deferred |
| `bonusSkillRanks` | Bonus Skill Ranks | prepared |

Specific skills use `skill.<skillKey>`. On actors with subskills, PF1 also
accepts `skill.<skillKey>.<subSkillKey>`. A target starting with
`skill.~<skillKey>` affects only the parent skill and does not spread to
subskills.

| Target | Label PF1 |
| --- | --- |
| `skill.acr` | Acrobatics |
| `skill.apr` | Appraise |
| `skill.art` | Artistry |
| `skill.blf` | Bluff |
| `skill.clm` | Climb |
| `skill.crf` | Craft |
| `skill.dip` | Diplomacy |
| `skill.dev` | Disable Device |
| `skill.dis` | Disguise |
| `skill.esc` | Escape Artist |
| `skill.fly` | Fly |
| `skill.han` | Handle Animal |
| `skill.hea` | Heal |
| `skill.int` | Intimidate |
| `skill.kar` | Knowledge (Arcana) |
| `skill.kdu` | Knowledge (Dungeoneering) |
| `skill.ken` | Knowledge (Engineering) |
| `skill.kge` | Knowledge (Geography) |
| `skill.khi` | Knowledge (History) |
| `skill.klo` | Knowledge (Local) |
| `skill.kna` | Knowledge (Nature) |
| `skill.kno` | Knowledge (Nobility) |
| `skill.kpl` | Knowledge (Planes) |
| `skill.kre` | Knowledge (Religion) |
| `skill.lin` | Linguistics |
| `skill.lor` | Lore |
| `skill.per` | Perception |
| `skill.prf` | Perform |
| `skill.pro` | Profession |
| `skill.rid` | Ride |
| `skill.sen` | Sense Motive |
| `skill.slt` | Sleight of Hand |
| `skill.spl` | Spellcraft |
| `skill.ste` | Stealth |
| `skill.sur` | Survival |
| `skill.swm` | Swim |
| `skill.umd` | Use Magic Device |

### Speed

| Target | Label PF1 | Aplicacao |
| --- | --- | --- |
| `landSpeed` | Land | prepared |
| `climbSpeed` | Climb | prepared |
| `swimSpeed` | Swim | prepared |
| `burrowSpeed` | Burrow | prepared |
| `flySpeed` | Fly | prepared |
| `allSpeeds` | All Speeds | prepared |

### Spells

| Target | Label PF1 | Aplicacao |
| --- | --- | --- |
| `concentration` | Concentration | roll/deferred |
| `cl` | Caster Level | prepared |
| `dc` | Spell DC | prepared |

Dynamic spell targets:

| Target pattern | Effect |
| --- | --- |
| `concn.<bookId>` | Concentration for one spellbook. Common book ids: `primary`, `secondary`, `tertiary`, `spelllike`. |
| `cl.book.<bookId>` | Caster level bonus for one spellbook. |
| `dc.school.<schoolId>` | Spell DC for one school. |
| `cl.school.<schoolId>` | Caster level for one school. |

School ids:

| School id | Label PF1 |
| --- | --- |
| `abj` | Abjuration |
| `con` | Conjuration |
| `div` | Divination |
| `enc` | Enchantment |
| `evo` | Evocation |
| `ill` | Illusion |
| `nec` | Necromancy |
| `trs` | Transmutation |
| `uni` | Universal |
| `misc` | Miscellaneous |

### Miscellaneous

| Target | Label PF1 | Aplicacao |
| --- | --- | --- |
| `acpA` | ACP (Armor) | prepared |
| `acpS` | ACP (Shield) | prepared |
| `mDexA` | Max Dexterity Bonus (Armor) | prepared |
| `mDexS` | Max Dexterity Bonus (Shield) | prepared |
| `carryStr` | Carry Strength | prepared |
| `carryMult` | Carry Multiplier | prepared |
| `ageCategory` | Age Category | prepared |
| `ageCategoryPhysical` | Physical Age Category | prepared |
| `ageCategoryMental` | Mental Age Category | prepared |
| `size` | Size | prepared, simple |
| `reach` | Natural Reach | prepared |
| `init` | Initiative | prepared |
| `bonusFeats` | Bonus Feats | prepared |

### Senses

| Target | Label PF1 | Aplicacao |
| --- | --- | --- |
| `sensedv` | Darkvision | prepared |
| `sensets` | Tremorsense | prepared |
| `sensebse` | Blindsense | prepared |
| `sensebs` | Blindsight | prepared |
| `sensels` | Lifesense | prepared |
| `sensesc` | Scent | prepared |
| `sensetr` | True seeing | prepared |

## Naruto D20 Module Targets

Este modulo registra os targets abaixo no hook `pf1PostInit` e mapeia cada um
para uma flag no hook `pf1GetChangeFlat`. Eles aparecem no mesmo seletor de
Changes de buffs PF1.

| Target | Categoria | Label | Caminho escrito pelo PF1 |
| --- | --- | --- | --- |
| `chakraPool` | Chakra | Chakra Pool Max | `flags.naruto-d20.chakra.pool.maxBonus` |
| `chakraReserve` | Chakra | Chakra Reserve Max | `flags.naruto-d20.chakra.reserve.maxBonus` |
| `tapReserves` | Chakra | Tap Reserves | `flags.naruto-d20.chakra.tapReserves.buffBonus` |
| `learnCkc` | Technique | Learn: Chakra Control | `flags.naruto-d20.learn.ckc.buffBonus` |
| `learnGnj` | Technique | Learn: Genjutsu | `flags.naruto-d20.learn.gnj.buffBonus` |
| `learnNin` | Technique | Learn: Ninjutsu | `flags.naruto-d20.learn.nin.buffBonus` |
| `learnTai` | Technique | Learn: Taijutsu | `flags.naruto-d20.learn.tai.buffBonus` |
| `learnFui` | Technique | Learn: Fuinjutsu | `flags.naruto-d20.learn.fui.buffBonus` |
| `techDcAll` | Technique | Technique DC (All) | `flags.naruto-d20.techniqueDC.all.buffBonus` |
| `techDcCkc` | Technique | Technique DC: Chakra Control | `flags.naruto-d20.techniqueDC.ckc.buffBonus` |
| `techDcFui` | Technique | Technique DC: Fuinjutsu | `flags.naruto-d20.techniqueDC.fui.buffBonus` |
| `techDcGnj` | Technique | Technique DC: Genjutsu | `flags.naruto-d20.techniqueDC.gnj.buffBonus` |
| `techDcNin` | Technique | Technique DC: Ninjutsu | `flags.naruto-d20.techniqueDC.nin.buffBonus` |
| `techDcTai` | Technique | Technique DC: Taijutsu | `flags.naruto-d20.techniqueDC.tai.buffBonus` |

## Manual/Internal Targets

The following targets are recognized by PF1's `getChangeFlat`, but are not
normal entries in `CONFIG.PF1.buffTargets` and may not appear in the change
selector:

| Target | Effect |
| --- | --- |
| `woundThreshold` | Writes `system.attributes.wounds.threshold`. |
| `vehicleSave` | Writes `system.attributes.savingThrows.save.total`. |
| `~attackCore` | Writes `system.attributes.attack.shared`; hidden from the selector because the key starts with `~`. |

## Change Flags

Buffs tambem podem marcar flags booleanas em `item.system.changeFlags`.
Elas nao usam `system.changes[]`, mas fazem parte da mesma aba de Changes do
item PF1.

| Flag | Label PF1 |
| --- | --- |
| `lowLightVision` | Low-light vision |
| `seeInDarkness` | See in darkness |
| `seeInvisibility` | See invisibility |
| `immuneToMorale` | Immune to Morale Effects |
| `loseDexToAC` | Lose Dex to AC |
| `noMediumEncumbrance` | Unaffected by Medium Encumbrance |
| `noHeavyEncumbrance` | Unaffected by Heavy Encumbrance |
| `mediumArmorFullSpeed` | Full Speed in Medium Armor |
| `heavyArmorFullSpeed` | Full Speed in Heavy Armor |

## Context Note Targets

Context notes ficam em `item.system.contextNotes[]`. Elas nao alteram numeros;
apenas adicionam texto contextual em rolagens ou estatisticas apropriadas.

| Target | Label PF1 | Categoria |
| --- | --- | --- |
| `attack` | Attack Rolls | attacks |
| `critical` | Critical Hits | attacks |
| `effect` | Effects | attacks |
| `melee` | Melee | attacks |
| `meleeWeapon` | Melee Weapon | attacks |
| `meleeSpell` | Melee Spell | attacks |
| `ranged` | Ranged | attacks |
| `rangedWeapon` | Ranged Weapon | attacks |
| `rangedSpell` | Ranged Spell | attacks |
| `cmb` | Combat Maneuver Bonus | attacks |
| `allSavingThrows` | All Saving Throws | savingThrows |
| `fort` | Fortitude | savingThrows |
| `ref` | Reflex | savingThrows |
| `will` | Will | savingThrows |
| `skills` | All Skills | skills |
| `strSkills` | Strength Skills | skills |
| `dexSkills` | Dexterity Skills | skills |
| `conSkills` | Constitution Skills | skills |
| `intSkills` | Intelligence Skills | skills |
| `wisSkills` | Wisdom Skills | skills |
| `chaSkills` | Charisma Skills | skills |
| `allChecks` | All Ability Checks | abilityChecks |
| `strChecks` | Strength Checks | abilityChecks |
| `dexChecks` | Dexterity Checks | abilityChecks |
| `conChecks` | Constitution Checks | abilityChecks |
| `intChecks` | Intelligence Checks | abilityChecks |
| `wisChecks` | Wisdom Checks | abilityChecks |
| `chaChecks` | Charisma Checks | abilityChecks |
| `spellEffect` | Spell Effect | spell |
| `concentration` | Concentration | spell |
| `cl` | Caster Level | spell |
| `ac` | AC | defense |
| `cmd` | Combat Maneuver Defense | defense |
| `sr` | Spell Resistance | defense |
| `init` | Initiative | misc |
| `landSpeed` | Land | speed |
| `climbSpeed` | Climb | speed |
| `swimSpeed` | Swim | speed |
| `burrowSpeed` | Burrow | speed |
| `flySpeed` | Fly | speed |
| `allSpeeds` | All Speeds | speed |

## Observacoes de implementacao

- `size` e um target `simple`; ele roda antes do roll data completo.
- Targets `roll/deferred` podem manter formulas nao deterministicas para serem
  resolvidas no momento da rolagem.
- `morale` e ignorado quando o actor tem imunidade a efeitos de morale.
- Bonus `dodge` positivo em AC e ignorado quando `loseDexToAC` esta ativo.
- `ac` tambem pode afetar CMD dependendo do tipo de bonus; `dodge`/`haste`
  afetam CMD normal, e varios tipos defensivos afetam CMD normal e flat-footed.
- Os targets do Naruto D20 escrevem em flags, sao zerados em
  `pf1PrepareBaseActorData` e usados em `pf1PrepareDerivedActorData`.
