# Literature Feed: changelog

## 0.0.1 (not released)
- API keys are kept in Obsidian's secret storage, not in the vault; the settings file holds only the secret's name. Keys saved as plain text by an earlier build are moved on first load.
- Settings tab: OpenAlex and Zotero keys, Zotero user ID, inbox and archive folders, scan day; a feed list (switch on or off, edit, duplicate, delete, export and import as `.json`); a feed editor (topics, concept groups with roles, drop and lower terms, years from, Zotero collection, project) with warnings and a **Test** button that runs a real OpenAlex search and shows how the papers would score. Settings are read tolerantly and reload when `data.json` changes outside Obsidian. Not seen in Obsidian yet.
- First feed as an importable file: `docs/feeds/lipoic-acid-copolymers.json`.
- Matching: a paper with no abstract whose title does not show the required terms is "Unchecked" (to be listed apart in the inbox), not Dropped.
- Matching: a paper with no abstract is scored on its title alone and ranks at most Possible. Not visible in Obsidian yet (the "no abstract" badge comes with the inbox note, Phase 4).
- Repo scaffold: a plugin that loads and unloads, build, test and lint set up, CI workflows. No feature yet.
