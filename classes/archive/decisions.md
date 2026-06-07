# Class Extraction & Conversion Decisions

This document outlines the logic and rules applied during the automated extraction of classes from Markdown files into the `classes-db.json` database.

## 1. Class Classification (Sub-Types)
- **Base Classes**: Only classes located directly within the `@Mechanics/Character_Options/Classes/` directory are tagged as `base`.
- **Prestige Classes**: All other classes (located in subdirectories or compendiums) are tagged as `prestige`.

## 2. Skill Conversion Logic
Skills have been mapped from D20 Modern nomenclature to the target system keys as follows:

| D20 Modern Skill | internal Key | Target Skill |
| :--- | :--- | :--- |
| Balance, Tumble, Jump | `acr` | Acrobatics |
| Bluff | `blf` | Bluff |
| Climb | `clm` | Climb |
| Concentration | `ckc` | Chakra Control |
| Decipher Script, Forgery, Research, Speak/Read/Write Language | `lin` | Linguistics |
| Demolitions, Disable Device | `dev` | Disable Device |
| Diplomacy, Gather Information | `dip` | Diplomacy |
| Disguise | `dis` | Disguise |
| Drive, Ride, Pilot | `rid` | Ride |
| Escape Artist, Use Rope | `esc` | Escape Artist |
| Gamble, Business, Profession | `pro` | Profession |
| Handle Animal | `han` | Handle Animal |
| Hide, Move Silently | `ste` | Stealth |
| Intimidate | `int` | Intimidate |
| Investigate, Listen, Search, Spot | `per` | Perception |
| Sense Motive, Behavioral Sciences | `sen` | Sense Motive |
| Sleight of Hand | `slt` | Sleight of Hand |
| Survival, Navigate, Use Rope | `sur` | Survival |
| Swim | `swm` | Swim |
| Treat Injury | `hea` | Heal |
| Use Computer, Physical Sciences | `kne` / `crf` | Knowledge (Eng) / Craft |
| Ninja Lore, Arcane Lore, Tactics | `kna` | Knowledge (Arcana) |
| Art, History | `knh` | Knowledge (History) |
| Civics, Current Events, Pop Culture, Streetwise | `kni` | Knowledge (Local) |
| Earth and Life Sciences, Shadowlands | `knm` | Knowledge (Nature) |

## 3. Progression Logic (BAB & Saves)
- **Base Attack Bonus (BAB)**: Determined by the value at **Level 3**.
    - `+3` -> `high`
    - `+2` -> `med`
    - `+1` -> `low`
- **Saving Throws**: Determined by the value at **Level 1**.
    - `+2` -> `high`
    - `+1` -> `custom` (Formula: `floor(1+( @level/2.5))`)
    - `+0` -> `low`

## 4. Feature Descriptions
- The parser searches for bolded markers (`**Feature Name**`) or headers (`### Feature Name`) below the class table to extract HTML-formatted descriptions.
- If no description is found, a simple `<p>Feature Name</p>` placeholder is generated.

## 5. Metadata & Defaults
- **Favored Class (`fc`)**: Removed from all class entries as per specific instructions.
- **Hit Dice & Skill Points**: Extracted directly from the "Class Information" section of each file.
