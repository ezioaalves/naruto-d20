# Compendium Markdown Recovery Plan

Based on the provided snippets and the PDF, the Markdown conversion has suffered from severe structural corruption. Specifically:

1. **Rogue Headers:** The converter misinterpreted capitalized class names within sentences as Markdown headers (e.g., `## Akatsuki Spy'S Class Skills Are...`). This breaks the parser's ability to locate the actual start of a class.
2. **Smushed Tables & Text:** Paragraph text has been merged into table rows. For example, in the `Battle Maiden` mount table, the 10th level row includes the start of the next paragraph: `| 10th | 12d8+40 | 10 | 22 | 9 +14 +9 | Speed 70 ft., SR 20 Nat : A`.
3. **Malformed Table Syntax:** Tables in the Bloodline file have leading/trailing empty columns (`| | Level | ... | |`) and broken delimiter rows (`|---| \n |---|---|`).

## Proposed Implementation Plan

### Phase 1: Structural Repair Script
Instead of relying on the current broken parser, I will write a Python script specifically designed to "un-smush" and repair these Markdown files.
* **Header Demotion:** The script will find any `#` or `##` header that contains a verb (e.g., "Is", "Are", "Gains") or is longer than a few words, and demote it back to regular bold or plain text.
* **Table Reconstruction:** The script will look for table header rows (e.g., `| Level | BaB |`) and forcefully separate them from surrounding text. It will repair the delimiter rows (ensuring exactly one `|---|---|` row) and strip empty leading/trailing pipes `| |`.
* **Paragraph Separation:** We will use regex to detect when a line starts with a number (like `10th`) inside a table, and if it trails off into a sentence (like `... SR 20 Nat : A`), we will split the string and push the text to a new line outside the table.

### Phase 2: Targeted JSON Extraction
Once the Markdown is structurally sound, we will write a targeted parser that iterates through the repaired files. 
* It will anchor on the true `# Class Name` headers (verified against the PDF Table of Contents).
* It will extract the `Hit Die`, `Action Points`, `Skill Points`, and the cleanly formatted `Level | BaB | ...` tables.
* It will map skills and saving throws according to the PF1e mapping rules defined in our previous `DECISIONS.md`.

## Questions for You
Before I proceed with writing the repair scripts, I have a few questions to ensure we take the right path:

1. **Markdown Artifacts:** Is the ultimate goal *only* to get a clean `classes-db.json` file, or do you also want the source `.md` files permanently repaired and saved for human readability? 
2. **Missing Levels:** I noticed `Akatsuki Spy` only goes up to level 3. I verified this in the PDF (page 75), so it seems correct, but are there any classes you know of where the PDF-to-Markdown conversion completely dropped levels or tables?
3. **Sub-tables:** Some classes have secondary tables (like the `Battle Maiden's Special Mount` or `Savage Feast Damage`). Should we extract these into the class JSON (perhaps as a text block in a specific feature), or ignore them for the base class extraction?