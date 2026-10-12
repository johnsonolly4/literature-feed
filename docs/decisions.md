# Decisions

One line each, newest first. Answers "when did we decide that, and why?"
Format: `date — decision — why — (who / source)`

All lines below come from the agreed plan (`docs/plans/literature-feed.md`); never invent a past decision or its reason.

- 2026-10-12 — Off-topic terms come in two kinds, **drop** (paper removed) and **lower** (moves down one tier) — drop is for clearly off-topic meanings, lower for on-topic but less wanted work — (user, chat 2026-10-12; plan "Decided" 3)
- 2026-10-12 — Finished weekly inbox notes move to the archive folder automatically (setting, on by default); unticked papers count as dismissed after 4 weeks (setting); literature notes still come from ZotLit in `ZotLit Imports` — (user, chat 2026-10-12; plan "Decided" 2)
- 2026-10-12 — First feed's project is `Projects/Lipoic acid copolymerisation` — (user, chat 2026-10-12; plan "Decided" 1)
- 2026-10-12 — Terms marked **lower** (self-healing, adhesive, ionic elastomer, end group, end-functional, anchoring group) move a paper down one tier in the lipoic acid feed — (user, chat 2026-10-12; plan "First feed")
- 2026-10-12 — Notes get `kind: reading-inbox` — Lab Kit's literature lists and Tidy rules then leave them alone — (user, chat 2026-10-12; plan)
- 2026-10-12 — Inbox folder starts as `04 Literature/Suggested` in the user's vault, but the repo default is empty (a setting, as in Lab Kit) — keeps personal values out of a public repo — (user, chat 2026-10-12; plan)
- 2026-10-12 — Two separate jobs: a weekly OpenAlex scan; Zotero sync when the button is pressed and once a day on start-up (no OpenAlex cost) — (user, chat 2026-10-12; plan)
- 2026-10-12 — Triage first: only ticked papers go to Zotero — keeps the Zotero library clean — (user, chat 2026-10-12; plan)
- 2026-10-12 — One weekly dashboard note with a collapsible section per feed, styled with Lab Kit's classes when present, plain Obsidian look otherwise — (user, chat 2026-10-12; plan)
- 2026-10-12 — Feeds are defined in the settings tab (name, topics, concept groups with roles, exclusions, years from, Zotero collection, optional project) — (user, chat 2026-10-12; plan)
- 2026-10-12 — Native button (own code block, ribbon icon, command, no default hotkey); Meta Bind button rejected — it adds a dependency and a static label — (user, chat 2026-10-12; plan)
- 2026-10-12 — Native TypeScript with no other plugins needed; network through Obsidian's `requestUrl` — works on Windows, macOS and probably mobile — (user, chat 2026-10-12; plan)
- 2026-10-12 — Separate plugin with id `literature-feed`, linked to Lab Kit by note conventions only — Lab Kit is store-listed with no network use, this plugin needs OpenAlex and Zotero calls and its own store review; rejected: a module inside Lab Kit, and a Python script run through Templater / Shell commands (Python on every machine, desktop only) — (user, chat 2026-10-12; plan)
- 2026-10-12 — OpenAlex scan window uses `from_publication_date` (free), not `from_created_date` / `from_updated_date` (paid plan per the OpenAlex docs); the window will overlap the last scan so late-indexed papers are caught, repeats are removed against already-seen DOIs — (user, plan-mode approval 2026-10-12; Phase 2 plan)
- 2026-10-12 — Topic search uses the scoped parameter `search.title_and_abstract` (docs call the `title_and_abstract.search` filter form deprecated); `buildSearchUrl` supports both until the real run settles it — (user, plan-mode approval 2026-10-12; Phase 2 plan)
- 2026-10-12 — The OpenAlex key is sent as a `Bearer` header, never in the URL, so it cannot end up in a log line or error text — (user, plan-mode approval 2026-10-12; Phase 2 plan)
- 2026-10-12 — The OpenAlex client takes the HTTP function and the sleep function as parameters (no Obsidian or timer use inside `src/openalex/`), so tests and `scripts/openalex-run.mjs` use the same code as the plugin — (user, plan-mode approval 2026-10-12; Phase 2 plan)
- 2026-10-12 — A paper with no abstract is matched on its title alone and can rank at most Possible (less evidence); 38 of 114 papers in the one-year OpenAlex run had none — (user, chat 2026-10-12, Phase 2 session)
- 2026-10-12 — A paper with no abstract whose title does not show the required terms is "Unchecked" (listed apart in the inbox), not Dropped; a drop term in the title still drops it. Hand check: OpenAlex matches on abstract text it does not return, and all 42 returned abstracts of title-less papers held a required term — (user chose option 1, chat 2026-10-12, Phase 2 session)
- 2026-10-12 — The feed editor's Test button runs one real OpenAlex scan (last year, not before the feed's "years from") after a confirmation that states the request count and the price; it shows counts per tier and the cost and writes nothing. Matches and cost cannot be known without calling the API — (user, plan-mode approval 2026-10-12; Phase 3 plan)
- 2026-10-12 — Feed export writes `<id>.feed.json` into the inbox folder (vault root if none is set), never over an existing file; import adds the feed switched off and renames it if the name is taken. Exports hold no keys — (user, plan-mode approval 2026-10-12; Phase 3 plan)
- 2026-10-12 — The settings tab uses Obsidian's declarative settings API (`getSettingDefinitions`, 1.13+) instead of `display()`, which is deprecated; `minAppVersion` is already 1.14.0 — (Claude, lint-driven, Phase 3 session; flag if you want the old style)
- 2026-10-12 — API keys are kept in Obsidian's secret storage (`app.secretStorage`, picked with `SecretComponent`); `data.json` holds only the secret's id, so a vault sync or backup never copies a key. Keys saved as plain text by the first Phase 3 build are moved over on first load, never overwriting an existing secret. Replaces the plan's "keys in plugin settings"; the cost is choosing the secrets again on each device — (user, chat 2026-10-12, Phase 3 follow-up)
- 2026-10-12 — A folder setting of "/" (what the folder picker gives for the vault root) is stored as "" — (Claude, found in the owner's `test-vault` data file)
