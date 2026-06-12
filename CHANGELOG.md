# Changelog

## v1.0.26 - 2026-06-12

- Added **per-round Dex/Str mode-choice** for Champuru stances. Performing a mode-choice stance (e.g. `CHAMPURU DAICHI SUTANSU -AYAUI APPUKU`) applies a self-buff that expires at the start of the user's turn and prompts to keep the mode, switch between **Dexterity** (+2 attack / Acrobatics) and **Strength** (+2 damage / CMB), or break the stance. Maintenance is free — only the initial perform pays chakra. Both mode buffs carry a context note for the +2 dodge vs attacks of opportunity. Stances opt in via a new `system.automation.stanceMode` toggle on the technique's Automation tab.
- Added `stance-buffs.mjs` + `stance-buff-maintenance.mjs` mirroring the rank-buff maintenance lifecycle, and two variant buffs (`(Dexterity)` / `(Strength)`) to the `technique-buffs` compendium.

## v1.0.25 - 2026-06-11

- Added **238 Community Compendium techniques** to the `naruto-d20.techniques` compendium, covering every technique from the Community Compendium source in narutod20_db. Includes a new `tools/import-community-compendium.mjs` converter and auto-generated actions for all new entries. 7 techniques already present under the same name were skipped.
- Fixed icon paths on the 238 Community Compendium techniques: icons now point to `systems/pf1/icons/` (matching all pre-existing Redux techniques) instead of the non-existent `modules/naruto-d20/icons/` path.

## v1.0.24 - 2026-06-11

- Added **content source** support to technique items: the technique sheet now shows PF1e's standard source editor (title + page fields) and the `sources` ArrayField was added to `TechniqueDataModel` so Foundry's schema validation preserves the data at runtime.
- Populated `system.sources` on all 1053 techniques in the `naruto-d20.techniques` compendium, referencing **NarutoD20 Redux v1.3** with the canonical page number from the narutod20_db database.
- Synced page numbers across 436 techniques whose page references had drifted from the canonical narutod20_db source.

## v1.0.23 - 2026-06-10

- Added support for **temporary** and **bonus** rank grants alongside the existing paid (technique-created) grants for Speed Rank (KOUSOKU) and Strength Rank (JOURYOKU). Temp grants do not stack with paid ranks (max wins); bonus grants add on top. The effective rank is computed once per key and only the designated carrier buff item applies it — all other active rank buffs of the same key zero out to prevent double-application.
- Replaced the separate `speed-rank-penalties.mjs` and `str-rank-bonuses.mjs` hooks with a unified `rank-rolldata.mjs` on `pf1GetRollData`, and extracted rank combination logic into `rank-effective-level.mjs`.
- Added a **Naruto Rank** section to PF1e buff sheets so GMs can configure grant type (paid / temp / bonus) directly on any rank buff item.
- Added `SPEED_RANK_GRANT` and `STRENGTH_RANK_GRANT` entries to the `technique-buffs` compendium.

## v1.0.22 - 2026-06-09

- Fixed JOURYOKU (Strength Rank) progression formulas: replaced ad-hoc roll expressions with a lookup table injected via `pf1GetRollData`, correcting `carryMult` at ranks 4–5 and `strMod`/`actions` at ranks 6–10. Fixed KOUSOKU speed bonus at rank 10 (+60 ft, not +55 ft). Includes migration v7 to update existing world buff items.

## v1.0.21 - 2026-06-09

- Automated KOUSOKU (Speed Rank) penalties: the effective rank applied to armor/encumbrance and immobilizing-condition penalties is now derived from PF1e roll data, preserving the stored base rank. Includes a migration pass for existing buffs and compendium updates.
- Fixed Chakra tab state loss on re-render: discipline filter, search query, and expanded technique descriptions are now stored on the sheet instance and restored after every `actor.update()` re-render (e.g. after spending chakra), matching PF1e's own spell-list pattern.
- Repaired corrupted LevelDB manifests in the classes, feats, and technique-buffs compendia caused by Foundry's runtime compaction leaving CURRENT pointing to a deleted MANIFEST. Includes a repacked technique-buffs compendium with the JOURYOKU buff source edit.

## v1.0.20 - 2026-06-08

- Fixed technique weapon-attack saves so selected PF1e attack items inherit the technique's save type and Technique DC instead of showing `DC 0` in chat.
- Added missing Fortitude saves to `SANGEKI HISSATSU WAZA: NIGEKI` and `SANGEKI HISSATSU WAZA: SANGEKI`, and repacked the techniques compendium.
- Updated contributor docs and QA notes for save propagation, `weaponAttack.extraAttacks`, and the selected-attack technique flow.

## v1.0.19 - 2026-06-08

- Learn and mastery technique checks now post a single chat card. The progress result (Learn/Mastery check vs DC, successes, training blocks, and training chakra) is appended onto the roll card as PF1e-style **Info** / **Training** property groups, instead of a separate second card. Reroll and "Add Action Point" now act on that same card.
- Added the `NarutoD20.Cards.TrainingHeader` label (English and pt-BR) and documented the design in `docs/learning-mastery-chat-cards.md`.

## v1.0.18 - 2026-06-08

- Reroll cards now show which keep option was chosen: "Kept new result", "Kept lower result", or "Kept higher result" instead of the generic "Kept result" label. Localized in both English and pt-BR.

## v1.0.17 - 2026-06-08

- Added Chakra Resistance field to technique items, mirroring PF1e's Spell Resistance mechanic. Techniques that apply Chakra Resistance now show a "Chakra Resistance" pill in the expanded item summary row and a checkbox on the Details tab of the technique sheet.
- Synced Chakra Resistance data from the source DB: 429 of 1053 techniques are now marked as chakra-resistant.
- Added `tools/sync-technique-cr-from-db.mjs` for future re-sync from the external DB.

## v1.0.16 - 2026-06-08

- Changed activation cost for all Speed Rank (Kousoku) and Strength Rank (Jouryoku) techniques (Ranks 1–5) from Standard Action to Free Action.
- Fixed Zettai Bougyo's activation from Standard Action to Move Action.
- Fixed technique card data (Hekiden) being lost when rolling through selected unarmed attacks.
- Fixed the download URL in module.json to use `releases/latest/download/module.zip` instead of a hardcoded version tag.

## v1.0.15 - 2026-06-07

- Fixed the technique weapon/attack selector so it honors each technique's descriptors. Techniques with an unarmed descriptor (Kick, Punch, Kick or Punch, Punch or Kick) now offer only unarmed natural attacks; Armed techniques offer only weapons; techniques carrying both offer both. Previously an unarmed technique such as Gouken: Konoha Reppuu also listed equipped weapons (Kunai, Daikunai) alongside the unarmed strikes.
- Kept `weaponAttack.filter` as the melee/ranged refinement for armed weapons, and as the fallback for techniques that have no attack descriptor.
- Fixed Ryuutsuki (Dragon Thrust) so it offers unarmed attacks in addition to melee weapons.

## v1.0.14 - 2026-06-07

- Fixed the Community Compendium class descriptions where OCR conversion had mashed talent-tree options into single run-on paragraphs. Each talent, mastery, and feral power now reads as its own entry across Deft Skirmisher, Beast Tamer, Elemental Master, Master Thrower, Ninja Crafter, Shadow Adept, Shunjutsu Master, Space-Time Specialist, and Shinobi Squad Leader.
- Rebuilt structure the OCR had broken: the Deft Skirmisher headings split mid-word, the Akatsuki Spy "DC Knowledge" table, and the Battle Maiden special-mount stat legend and abilities.
- Regenerated the affected class compendium entries from the corrected sources; only the displayed descriptions changed, with all class mechanics, IDs, and feat grants left intact.

## v1.0.13 - 2026-06-07

- Added 25 Community Compendium advanced classes to the classes compendium: Akatsuki Spy, Battle Maiden, Beast Tamer, Chakra Fighter, Chemist, Clansman, Dao Shi Monk, Dervish Dancer, Elemental Master, Hitokiri, Holy/Unholy Warrior, Iaijutsu Master, Master Thrower, Ninja Crafter, Ryukyu Swordsman, Sannin, Sensory Shinobi, Shadow Adept, Shinobi Scribe, Shinobi Squad Leader, Shunjutsu Master, Space-Time Specialist, Specialist Summoner, Sword Saint, Tora Oshiego.
- Each new class carries a themed PF1e icon, and its Base Attack Bonus, saving throw, and Defense progressions were verified faithful to the source books at every level.
- Taught the class generator to reproduce the irregular save and BAB tables some Community Compendium classes print, so their formulas match the books exactly.

## v1.0.12 - 2026-06-07

- Added 14 Bloodline prestige classes to the classes compendium: Akimichi Master, Bulwark, Clairvoyant Assassin, Inuzuka Beastmaster, Kaguya Marauder, Nara Shadowmaster, Piercing Seer, Ravager, Symbiote Bugmaster, Uchiha Elite, Uzumaki Warrior, Waterbender, Wind Walker, Yamanaka Spymaster.
- Refreshed the generated class descriptions for the Bloodline classes from standardized local Markdown sources.

## v1.0.11 - 2026-06-07

- Added 29 prestige classes to the classes compendium: Beastlord, Berserker, Blinkstrike, Devastator, Elementalist, Exalted One, Exarch, Exemplar, Genjutsu Master, Interrogator, Living Puppeteer, Master Artisan, Master Strategist, Ninja Hunter, Outlaw, Pain Engine, Poisoner, Reaver, Rising Star, Sage, Shade, Skirmisher, Sohei, Summoner, Swarmwrecker, Sword Savant, Takedown Specialist, Technique Analyst, Technowarrior.
- Added 21 advanced classes to the classes compendium: Beastmaster, Commando, Gadgeteer, Grand Scholar, Master Infiltrator, Medical Specialist, Ninja Police, Ninja Scout, Puppeteer, Sacred Fist, Shadow Hand, Sharpshooter, Shinobi Adept, Shinobi Bodyguard, Shinobi Swordsman, Shuriken Expert, Soul Edge, Specialist, Squad Captain, Taijutsu Master, Wild Technician.
- Updated Livewire class data.

## v1.0.10 - 2026-06-06

- Fixed class skills for Fast Paragon, Strong Ninja, Strong Paragon, Tough Ninja, and Tough Paragon classes.

## v1.0.9 - 2026-06-06

- Added a Classes compendium pack with base ninja classes (Strong, Fast, Dedicated, Charismatic, Smart, Tough) and their matching Paragon variants.
- Added Deft Skirmisher and Livewire prestige classes to the compendium.
- Added pack/unpack scripts for the classes compendium (`npm run pack:classes`, `unpack:classes`, `pack:all`, `unpack:all`).

## v1.0.8 - 2026-06-05

- Added Denjiba Reiki no Jutsu (Electromagnetic Aura Technique) to the techniques compendium and rebuilt the techniques pack.
- Added Naruto chat roll context options for Action Points and rerolls on Tap Reserves, shinobi learn checks, technique perform checks, and learn/mastery attempt rolls.
- Reworked learn/mastery rerolls and Action Points from the d20 roll card so they reprocess progression state, chakra deductions, and result cards safely.

## v1.0.7 - 2026-06-04

- Fixed Synckit so actor-owned technique state no longer marks compendium-sourced techniques out of sync: current daily-use charges and mastery training progress are ignored during diffing.
- Preserved local learning, mastery progress, mastery step, and daily-use charge state when syncing an actor-owned technique from the compendium.

## v1.0.6 - 2026-06-04

- Added mastery step 5 free rounds for Strength Rank and Speed Rank techniques: mastered rank techniques now prompt for the once-per-day 5-round free activation instead of paying chakra.
- Added PF1e daily use tracking to the rank techniques so resting with Restore Daily Uses restores the mastery free use.
- Added the same mastery free-use option when a rank buff reaches its maintenance point.
- Added daily use data to all Strength Rank and Speed Rank technique source JSON and rebuilt the techniques pack.

## v1.0.5 - 2026-06-04

- Added automated Jouryoku and Kousoku rank buffs: using a Strength Rank or Speed Rank technique now applies the shared buff at the matching level.
- Added chakra costs to Strength Rank and Speed Rank technique source JSON and rebuilt the techniques pack.
- Added upkeep prompts for active rank buffs: when maintenance is due, the owner can spend the rank's chakra cost to keep the buff active or deactivate it.
- Shared chakra spending logic between technique use and rank buff upkeep so temporary chakra, pool chakra, and Emergency Transfer resolve consistently.

## v1.0.4 - 2026-06-03

- Added a mastery learning process: roll learn checks toward the next mastery step from the technique's Master button, tracking attempts, failure insight, training blocks/chakra, four-hour-block mode, and the post-roll Action Point re-evaluation. On enough successes the technique advances one mastery step.
- Changed the Details tab Mastery field to display-only — the achieved step is now earned through the mastery learning process, with the GM panel providing the manual override.

## v1.0.3 - 2026-06-03

- Added learning techniques by spending Empathy Points: click Empathy Points on the Chakra tab to open the technique browser, pick a technique, and learn it for a cost equal to its skill threshold. Techniques learned this way are flagged "via Empathy" on the sheet and the Chakra tab.
- Fixed roll-less technique chat cards (Empathy learning, training interruption, unmapped-discipline learn) so they honour the active roll mode instead of always posting publicly.
- Fixed Raite so it uses the unarmed attack configuration.

## v1.0.2 - 2026-06-03

- Added GM-editable successes/failures to technique learning, with assorted sheet polish.
- Fixed Melee touch techniques so they no longer add the Strength modifier to damage, including the Disarming Throw and Flying Throw throw techniques.
- Fixed technique use so the auto-perform chat card is suppressed correctly and roll visibility is preserved.
- Fixed Kensoku: Iaiken so its bonus damage dice no longer multiply on a critical hit.
- Fixed the Electric Shock buff (Kanigakure Hiden: Denki Shokku) to use the native Electricity damage type and apply its bonus to natural attacks.

## v1.0.1 - 2026-06-03

- Renamed the technique sync UI from Medkit to Synckit and refined its sheet integration.
- Fixed Synckit so local mastery changes on actor-owned techniques no longer mark entries out of sync.
- Fixed Training technique learning to resolve its learn discipline from subtype, including prompted selection for empty or multi-discipline cases.
- Changed technique costs and training-chakra costs to use only temp chakra and pool automatically; reserve now stays manual through Tap Reserves, while Emergency Transfer remains as a separate depletion rule.
- Fixed Tap Reserves bookkeeping so temporary chakra and reserve updates stay aligned with the revised chakra flow.
