# Backlog

Open items only: done items are in `docs/changelog.md` and git history. New open questions from the plan go here.
When an item is chosen, move it to `STATUS.md` → Next.

## TOP

## Decisions needed
Phase 1 took these where the plan was silent (approved in plan mode 2026-10-12 as part of the Phase 1 plan; confirm or change):
- [ ] A **lower** term counts once per paper, however many match (`src/match/score.ts`, `scorePaper`).
- [x] A feed with **no required group** scores every non-dropped paper Possible (same function). Phase 3 handles it with an editor warning, not a refusal (`checkFeed`, `src/settings/data.ts`); say if you would rather block saving such a feed.
- [ ] Group term lists of the lipoic acid feed are my reading of the plan (`tests/fixtures/lipoic-feed.ts`). They are now also the real importable feed `docs/feeds/lipoic-acid-copolymers.json` (a test keeps the two equal): check the terms there before you rely on the feed.
- [ ] Dedupe merges any two papers with the same normalised title, even if both are journal articles with different DOIs (`src/match/dedupe.ts`). Fine for this feed; revisit if generic titles appear.
- [ ] Matching is whole-word with a plural `s`/`es` on the last word and -ise/-ize, -yse/-yze spellings only; no other stemming (`polymerised` does not match `polymerisation`). List such forms as terms.

- [ ] OpenAlex client details I chose (`src/openalex/client.ts`): retries only on 429 (not 5xx), 4 tries with 1 s doubling wait, no `Retry-After` (not documented); works without a title are skipped (`toCandidate`); the plan said `runScan`, it is the method `OpenAlexClient.scan`. Confirm or change.
- [ ] Phase 2 real run, 2026-10-12 (owner's key, `scripts/openalex-run.mjs`, scoped form). Pasted in chat; the owner's `run.json` stays local (untracked, not committed).
  - 30-day window: 7, 2, 5, 0 works for the four topics; $0.001 per request.
  - 365-day window (from 2025-10-12): **66, 29, 52, 6** works; one page each, $0.001 per request, $0.004 in all. 153 listed, **114 unique** (dedupe by OpenAlex id), publication dates 2025-10-14 to 2026-10-07, 17 preprints, 3 without a DOI.
  - Settled: (a) the scoped form `search.title_and_abstract` works with parentheses, quoted phrases and AND / OR; the `filter` form was not tried. Topic 4 returned 6 over a year, so its 0 over 30 days was the narrow topic, not syntax. (c) cost is flat $0.001 per request at this size. (e) abstracts do come back with this `select=`.
  - **New finding (decided 2026-10-12: title only, capped at Possible; see the item below):** only 76 of the 114 unique papers (108 of 153 listings) have an abstract; the other 38 can only be matched on the title. A feed whose required group needs a term that only appears in an abstract will drop them silently. Options for Phase 3/4: match title only and show a "no abstract" badge; or score them Possible at best; or list them apart. Not decided; the matching engine currently treats a missing abstract as empty text (`src/match/score.ts`, `scorePaper`).
  - Seen in the results: "Antioxidative Thermosensitive Polymer Based Micelles To Prevent Rat Skip Flap Necrosis" matches topic 4 (lipoic acid as an antioxidant, not as a monomer): the kind of paper the drop terms are for. Run the 114 through `scorePaper` with the lipoic feed to see the tier spread (a cheap next step, no API calls: `run.json` has titles but no abstract text).
  - Checked 2026-10-12 (owner's second run, `run2.json`, same window and criteria): (b) known paper found: "Biodegradability of Acrylate-Lipoic Acid Copolymers" (J. Am. Chem. Soc., DOI 10.1021/jacs.6c02848; owner's PubMed link) is returned by topics 1, 2 and 4 and not by topic 3, which fits its abstract (acrylates, lipoic acid, RAFT, high-throughput). (d) the repeat run a minute later gave the identical 114 unique ids and counts 66, 29, 52, 6; that shows the query is stable, not that late-indexed papers are caught.
  - **Checked by hand 2026-10-12 (b, second half; keyless public API calls, scratch script, not in the repo):** 68 of the 114 unique papers have no lipoic / lipoate / thioctic / dithiolan in the title. Re-fetched from OpenAlex: 42 have an abstract and **all 42 contain a required term**, so the AND works as the query reads. The other 26 come back with no abstract. Crossref has an abstract for 5 of those 26 (4 preprints, 1 more) and all 5 contain a required term; for the other 21 I found no abstract anywhere I looked, so not verified. Reading: OpenAlex searches abstract text it does not hand back (publisher-restricted), so these papers are probably real hits. Titles such as "A coenzyme-based interface-welding hydrogel coating" and "A dynamically cross-linked LA/Arg/NMA hydrogel" point the same way (guess from titles only).
  - [x] Decided 2026-10-12 (owner, option 1: separate list): the 26 papers without a returned abstract and without a required term in the title are tier `unchecked`, not `dropped` (`src/match/feed.ts` `Tier`, `src/match/score.ts` `scorePaper`; tests in `tests/score.test.ts`). Not run over the real 114 (`run.json` has no abstract text).
- [ ] Phase 4: the inbox note must render the `unchecked` tier as its own list ("no abstract returned, matched by OpenAlex") and the "no abstract" badge on capped papers. Check how the Zotero sync should treat unchecked papers (Phase 5).
  - Still open: (d) a run on or after 2026-10-19 with `--from 2025-10-12`, compared with `run.json` (new ids with a publication date before 2026-10-12 = late-indexed papers). Recorded fixture: done, `tests/fixtures/openalex-recorded.json` (one real work, authors replaced by "Author n"); the other response shapes (429, error bodies) are still hand-written.
- [x] No-abstract rule (decided 2026-10-12, docs/decisions.md) implemented 2026-10-12: `src/match/score.ts` `scorePaper` caps an empty or blank abstract at Possible, before lower terms; tests in `tests/score.test.ts` ("papers with no abstract"). Two role tests got an abstract so they still reach Priority. Still open: the inbox badge "no abstract" (Phase 4), and the run over the 114 papers has titles only, so it shows the tier spread with every paper capped; not run.
- [ ] Confirm the cap order: it is applied before lower terms, so a title-only paper with a lower term goes Possible → Dropped. Change if you would rather it stay Possible.

## Bugs

## Quick changes
- [ ] Trim the Lab Kit copies: `.claude/rules/obsidian-plugin.md` (mentions `src/node.ts`, `src/platform.ts`, `hasNode()`) and `docs/reference/plugin-guidelines.md:68` (kit updater). Left as copied in Phase 0 on purpose; adjust when this plugin has its own helpers.
- [ ] Look at the 9 `npm audit` findings from `npm install` (6 moderate, 1 high, 2 critical; dev dependencies only, versions as in Lab Kit). Do not run `npm audit fix --force` blind.
- [ ] npm warns that the install scripts of `esbuild` (0.24.2 and 0.21.5) are not on an allow list (`npm install-scripts`); build and `npm run dev` work without. Decide whether to approve them.

## Not yet tested by the user
- [ ] Phase 0: the plugin loads and unloads in `test-vault` (`npm run dev`, enable Literature Feed). Only the build, the unit test and lint were run.
- [ ] Phase 3 (settings tab, 2026-10-12): none of it has been seen in Obsidian. Only the data layer is unit-tested (`tests/settings.test.ts`); the UI (`src/settings/tab.ts`, `feed-modal.ts`) built and linted clean but never ran. In `test-vault`, check: the tab opens and the sections show; text, folder and scan-day fields keep their values after closing and reopening Obsidian; the API key fields are masked; **Add feed** / edit / duplicate / delete / on-off switch; import the file `docs/feeds/lipoic-acid-copolymers.json` (paste and file picker), then export it (a `.feed.json` appears in the inbox folder or vault root); the editor's group rows, warnings and **Test** (with your key, about $0.004; the confirm window shows first); edit `data.json` outside Obsidian while the tab is open and see the tab update; look in light and dark; the settings search finds the fields.
- [ ] The declarative settings API (`getSettingDefinitions`, 1.13+) was chosen from the type definitions only, without running it. If a row does not render as intended (the feed rows use `render`; the list's delete button comes from `onDelete`), that is the first suspect.

## Quick changes (Phase 3 findings)
- [ ] API keys sit in `data.json` as plain text (plan and CLAUDE.md rule). Obsidian 1.11.4+ has a secret storage (`app.secretStorage`: `setSecret`, `getSecret`) that keeps them out of the vault and out of vault sync. Worth a decision before release: it would change the README "Network use" note and the settings rows (`secretRow` in `src/settings/tab.ts`). Not done: outside Phase 3's plan.
- [ ] The feed editor does not check that a Zotero collection name exists (that is Phase 5), nor that a search topic is valid OpenAlex syntax (only brackets and quotes are balanced; **Test** is the real check).

## Future features
- [ ] Feed assistant (after Phase 3; idea from chat 2026-10-12). The plugin calls no LLM and sends nothing; the user does the pasting.
  - Command **Copy feed-builder prompt**: fixed text with the role and tier definitions, the feed JSON schema and one example feed (the lipoic acid feed). No papers inside. It tells the user to append a Zotero **Export Items** as CSL JSON (Create Bibliography has no abstracts) and, optionally, a second export of papers they do not want (best source of drop and lower terms). It says: only propose terms likely to appear in a title or abstract (matching reads nothing else, so PDFs add vocabulary but no matchable text).
  - Command **New feed from clipboard**, with a paste-box window as fallback (clipboard access can fail on mobile): strip a code fence, validate the JSON and say what is wrong, show a preview, save as a new feed that is switched off.
  - Back-test, proposed for the first version: if the CSL JSON export is pasted too, run `scorePaper` (`src/match/score.ts`) over it and report papers per tier, e.g. "8 seed papers: 5 Priority, 2 Strong, 1 Dropped". CSL JSON needs no parser (`JSON.parse`); BibTeX would, so leave it out.
  - Later, from real use: terms frequent in dismissed papers but absent from ticked ones, offered as drop / lower candidates.
