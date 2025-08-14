# Changelog
All notable changes to the SmartCards script will be documented in this file.

## [v0.9.3] - 2025-08-15

### Added
- **Multi-Trigger SmartCards (MTS)** 
  - Supports AND-condition triggers: a card can require multiple words/phrases to appear together before activation.

- **Config options** for MTS:
  - `triggerEnable` – master on/off switch.
  - `triggerTTL` – number of turns a triggered card stays active (default: `3`).
  - `triggerMaxPerTurn` – cap on how many cards MTS can inject per turn (default: `3`).
  - `triggerCaseInsensitive` – match tokens without case sensitivity (default: `true`).
  - `triggerAnchor` – preferred context insertion point (default: `World Lore:\n`).

### Changed
- Trigger matching now uses clean, normalized parsing instead of symbol-padded duplicates (`{Smith}`, `]Smith[`, etc.).
- MTS injects card `entry` text after the configured anchor (default: after “World Lore”) to preserve story flow.

### Fixed
- Prevented duplicate trigger scheduling for the same card in the same turn.
- Fixed case-sensitivity mismatches in AND-condition detection.


## [v0.9.1] - 2025-08-15

### MORE ANNOTATIONS MOHAHAHA


### Added
- **Automatic Character Typing**
  - Introduced `classifyTitle()` using `hasConjunction`, `hasPronoun`, `hasRelationshipWord`, and `sentenceContaining` to determine when a generated card should default to `type: "character"`.
  - Classification is based on surrounding context and configurable vocab (`characterPronouns`, `relationshipWords`).
- **Conjunction Guard in Scanning**
  - `conjunctionGuard` now skips multi-name titles (e.g., `"Sarah and Jane"`) when scanning candidates to avoid merged cards.
- **Source-Aware Scheduling**

### Fixed
- **`extractAfterMarker` Function**

### Changed
- Classification and conjunction guard behavior are fully controlled via the SmartCards Config card without requiring code edits.

---

## [0.9] - 2025-08-15
### Added
- Reconstructed Memory injection system:
  - Injects SmartCard memories into AI Dungeon’s active context.
  

### Changed
- `/sc redo` command:
  - Skips SC Script / AC Script cards.
  - Preserves the existing Notes (context summary) when regenerating cards.
  - **No longer deletes or overwrites existing memories in the card's notes section.**

  ---
  
## [v0.8.2] - 2025-08-14
### Added
- `/sc redo` now preserves Notes (context summary) when regenerating a card.
- Added support for both `SC Script:` and `AC Script:` card prefixes.

### Fixed
- Improved regex to avoid false-positive matches when scanning for script cards.

---

## [v0.8.1] - 2025-08-10
### Added
- Added `relationshipWords` config key to better identify character cards.

### Fixed
- Fixed bug where certain titles were incorrectly skipped due to all-caps detection.

---

## [v0.8.0] - 2025-08-04
### Added
- Detailed inline comments explaining each function and logic section.
- Added ability for autogeneration to detect and categorize characters as "Character" type.
- Configurable characterPronouns and relationshipWords for title classification.
