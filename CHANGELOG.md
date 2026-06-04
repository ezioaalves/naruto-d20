# Changelog

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
