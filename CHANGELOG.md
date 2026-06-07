# Changelog

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
