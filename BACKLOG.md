# Backlog

Open items only: done items are in `docs/changelog.md` and git history. New open questions from the plan go here.
When an item is chosen, move it to `STATUS.md` → Next.

## TOP

## Decisions needed
Phase 1 took these where the plan was silent (approved in plan mode 2026-10-12 as part of the Phase 1 plan; confirm or change):
- [ ] A **lower** term counts once per paper, however many match (`src/match/score.ts`, `scorePaper`).
- [ ] A feed with **no required group** scores every non-dropped paper Possible (same function). Phase 3 may want to refuse such a feed.
- [ ] Group term lists of the lipoic acid feed are my reading of the plan, test data only (`tests/fixtures/lipoic-feed.ts`). The real importable feed JSON in `docs/feeds/` is still to be written; check its terms then.
- [ ] Dedupe merges any two papers with the same normalised title, even if both are journal articles with different DOIs (`src/match/dedupe.ts`). Fine for this feed; revisit if generic titles appear.
- [ ] Matching is whole-word with a plural `s`/`es` on the last word and -ise/-ize, -yse/-yze spellings only; no other stemming (`polymerised` does not match `polymerisation`). List such forms as terms.

- [ ] OpenAlex client details I chose (`src/openalex/client.ts`): retries only on 429 (not 5xx), 4 tries with 1 s doubling wait, no `Retry-After` (not documented); works without a title are skipped (`toCandidate`); the plan said `runScan`, it is the method `OpenAlexClient.scan`. Confirm or change.
- [ ] Phase 2 real run, 2026-10-12 (owner's key, `scripts/openalex-run.mjs`, scoped form). Pasted in chat; the owner's `run.json` stays local (untracked, not committed).
  - 30-day window: 7, 2, 5, 0 works for the four topics; $0.001 per request.
  - 365-day window (from 2025-10-12): **66, 29, 52, 6** works; one page each, $0.001 per request, $0.004 in all. 153 listed, **114 unique** (dedupe by OpenAlex id), publication dates 2025-10-14 to 2026-10-07, 17 preprints, 3 without a DOI.
  - Settled: (a) the scoped form `search.title_and_abstract` works with parentheses, quoted phrases and AND / OR; the `filter` form was not tried. Topic 4 returned 6 over a year, so its 0 over 30 days was the narrow topic, not syntax. (c) cost is flat $0.001 per request at this size. (e) abstracts do come back with this `select=`.
  - **New finding (decided 2026-10-12: title only, capped at Possible; see the item below):** only 76 of the 114 unique papers (108 of 153 listings) have an abstract; the other 38 can only be matched on the title. A feed whose required group needs a term that only appears in an abstract will drop them silently. Options for Phase 3/4: match title only and show a "no abstract" badge; or score them Possible at best; or list them apart. Not decided; the matching engine currently treats a missing abstract as empty text (`src/match/score.ts`, `scorePaper`).
  - Seen in the results: "Antioxidative Thermosensitive Polymer Based Micelles To Prevent Rat Skip Flap Necrosis" matches topic 4 (lipoic acid as an antioxidant, not as a monomer): the kind of paper the drop terms are for. Run the 114 through `scorePaper` with the lipoic feed to see the tier spread (a cheap next step, no API calls: `run.json` has titles but no abstract text).
  - Still open: (b) AND / OR semantics are plausible from titles but not proven (check a known paper is found, and that something lacking the required terms does not appear). (d) `from_publication_date` vs late-indexed papers: needs a second run a week later and a comparison with this record. Fixtures are still hand-written; recorded ones need a trimmed copy of one real response (ids, title, abstract index of a public paper), since `run.json` has no abstract text.
- [ ] Implement the no-abstract rule decided 2026-10-12 (docs/decisions.md): a paper with an empty abstract is scored on the title and capped at Possible. Engine change in `src/match/score.ts` (`scorePaper`) plus tests; the inbox badge "no abstract" belongs to Phase 4. Not done in the Phase 2 session (out of scope).

## Bugs

## Quick changes
- [ ] Trim the Lab Kit copies: `.claude/rules/obsidian-plugin.md` (mentions `src/node.ts`, `src/platform.ts`, `hasNode()`) and `docs/reference/plugin-guidelines.md:68` (kit updater). Left as copied in Phase 0 on purpose; adjust when this plugin has its own helpers.
- [ ] Look at the 9 `npm audit` findings from `npm install` (6 moderate, 1 high, 2 critical; dev dependencies only, versions as in Lab Kit). Do not run `npm audit fix --force` blind.
- [ ] npm warns that the install scripts of `esbuild` (0.24.2 and 0.21.5) are not on an allow list (`npm install-scripts`); build and `npm run dev` work without. Decide whether to approve them.

## Not yet tested by the user
- [ ] Phase 0: the plugin loads and unloads in `test-vault` (`npm run dev`, enable Literature Feed). Only the build, the unit test and lint were run.

## Future features
- [ ] Feed assistant (after Phase 3; idea from chat 2026-10-12). The plugin calls no LLM and sends nothing; the user does the pasting.
  - Command **Copy feed-builder prompt**: fixed text with the role and tier definitions, the feed JSON schema and one example feed (the lipoic acid feed). No papers inside. It tells the user to append a Zotero **Export Items** as CSL JSON (Create Bibliography has no abstracts) and, optionally, a second export of papers they do not want (best source of drop and lower terms). It says: only propose terms likely to appear in a title or abstract (matching reads nothing else, so PDFs add vocabulary but no matchable text).
  - Command **New feed from clipboard**, with a paste-box window as fallback (clipboard access can fail on mobile): strip a code fence, validate the JSON and say what is wrong, show a preview, save as a new feed that is switched off.
  - Back-test, proposed for the first version: if the CSL JSON export is pasted too, run `scorePaper` (`src/match/score.ts`) over it and report papers per tier, e.g. "8 seed papers: 5 Priority, 2 Strong, 1 Dropped". CSL JSON needs no parser (`JSON.parse`); BibTeX would, so leave it out.
  - Later, from real use: terms frequent in dismissed papers but absent from ticked ones, offered as drop / lower candidates.
