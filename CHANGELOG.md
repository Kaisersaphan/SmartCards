# Changelog
All notable changes to the SmartCards script will be documented in this file.

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
