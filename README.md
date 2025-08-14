# 🃏SmartCards🃏
SmartCards is a refined, evolving, card automation script for AI Dungeon, inspired by LewdLeah’s Auto-Cards. It auto-creates and updates plot-relevant cards, supports per-adventure scripts, and keeps story memory organized without breaking immersion.
### [Changelog](https://github.com/Kaisersaphan/SmartCards/blob/main/CHANGELOG)

### Key Features
- **Automatic card creation** — detects new entities in the narrative and builds cards without manual prompts.
- **Context injection** — keeps important card entries in the AI’s context so they influence story generation.
- **Multi-Trigger SmartCards (MTS)** — supports complex AND-condition triggers for cards that should appear only when multiple words/phrases occur together.
- **Annotated code** — inline comments make it easier to understand

  ## Installation

SmartCards runs as a **User Script** inside AI Dungeon’s Scripting system.  
Follow these steps to install:

### 1. Open the Script Editor
1. Open any AI Dungeon adventure (new or existing).
2. Click the **⋯ details tab** and then the Edit Scripts button at the button.

### 3. Paste SmartCards Code 
(Delete anything in the tabs mentioned below)
1. Copy the INPUT script, and paste it into your input tab,
2. Copy the CONEXT script and paste it into your context tab.
3. Copy the {**Library Script**(https://github.com/Kaisersaphan/SmartCards/blob/main/SourceCode/Library.js) and paste it into your library tab.
4. Click **Save**.


### 4. Configure SmartCards
Once installed, you can configure SmartCards in-game:
1. Create or edit the **SmartCards Config** card in your deck.
2. Adjust settings such if you know what you want to change.
3. Changes take effect immediately — no script reload needed.

### 6. Play
- SmartCards will now automatically create and feed cards into your story.
- The new **Multi-Trigger SmartCards (MTS)** system will also listen for your custom AND-condition triggers and keep those cards active for the number of turns you set.

---

### Card Management
- `/sc {title}` Force SmartCards to create a card with the given title.
- `/sc {title}/ {Focus}/{first line}` focus is what you’d like the entry to emphasise, the first line forces what you input there.
- `/sc redo {title}` Regenerates a card’s entry from recent context.
- `/sc delete {title}` Permanently delete the specified card.
- `/sc clear`  Delete **all** SmartCards (careful!).
### How to Use Multi-Trigger SmartCards (MTS)
-In Trigger Keys: use A & B for “both at once”, commas for “either/or”.
- Example: alice & bob, rain & umbrella = fires if (“alice” AND “bob”) or (“rain” AND “umbrella”) appear together.
.
