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
- [ ] Phase 2 not verified: (a) `search.title_and_abstract` vs `title_and_abstract.search` form, (b) AND / OR / quoted phrases, (c) cost per topic, (d) `from_publication_date` enough (late-indexed papers), (e) `abstract_inverted_index` present with this `select=`. All settled by `scripts/openalex-run.mjs --form scoped|filter` with a key. Record results here.
- [ ] Phase 2 wrapper still to write (Phase 3 or 7): the `Requester` over Obsidian's `requestUrl({ throw: false })` must catch the `json` getter throwing on a non-JSON body and return `json: null`; `sleep` must use `window.setTimeout` (lint rule). `src/openalex/client.ts:25`.

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
