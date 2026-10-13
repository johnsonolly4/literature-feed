# Plan: Searches merged into Watch, Discover, Expand (and Improve)

_Agreed: 2026-10-13. Written by `/phase-plan` (Opus review of a Sonnet proposal from the same session). Each phase = one session._

## Goal
The owner finds papers through three clearly separate searches (**Watch** what is new, **Discover** what was missed on a subject, **Expand** what some papers rest on or miss) plus one **Improve** tab per search, all learning from the papers already filed in that search's Zotero collection, with one path to Zotero (the weekly inbox).

## Decision taken
- **No single engine.** The weekly scan and the review stay separate code; only pure pieces are shared (scoring already is; ranking and known-paper overlap become shared). Checked in the code: the scan (`src/inbox/scan.ts:90`) fetches a small window in full and lists everything, so it never had the cap or ordering problem that hid the owner's papers in the review (`src/review/collect.ts`). Rewriting it would risk the weekly scan for no visible gain.
- **Known papers per search = its Zotero collection + DOIs added by hand.** The set grows as the owner files papers. The rest of the library keeps its current job (the "in Zotero" flag) and is not used as seeds, which would mix subjects; Improve may offer library papers that overlap a search's seeds as candidates to add.
- **Papers from Discover and Expand reach Zotero through this week's inbox note**: ticked in the review or gaps table, added under their search, sent by the usual Sync. Keeps "triage first" (decision 2026-10-12) and one sync path, and the ledger sees these decisions.
- **One Improve tab per search** groups topic statistics, overlap, strings suggested from its known papers and the LLM prompts; the existing commands open it.
- Correction to the earlier proposal: the review's per-paper **Find gaps** and the Citation gaps tool already share `fetchCitationGaps` (`src/review/network-fetch.ts:133`); only the interface is duplicated. Set-level **Find missing papers** (`fetchNetworkExtras`, M and C labels in the prompt and graph) stays in Discover.
- Rejected: one engine behind scan and review (risk, little gain); pasted DOIs only (hand upkeep); one global seed list (mixes subjects); a direct Send button in review and gaps (second sync path, invisible to the ledger); removing the LLM tweak and compare prompts (kept, moved into Improve).

## Out of scope
- Semantic Scholar, retraction flags, first-and-last authors (separate BACKLOG items).
- Moving the settings tab and modals onto the UI kit.
- Changing what the weekly scan fetches or how it scores.
- Seed overlap shown in the weekly inbox (would need references in every scan request): Phase 7, optional.

## Before Phase 1
The work of 2026-10-13 is uncommitted on `feat/lit-review` (UI kit, Citation gaps rebuild, author audit prompt, review ranking, known papers, seed strings). The owner tries it in `test-vault`, then it is committed (one commit per piece) so each phase below starts clean.

## Phases

### Phase 1 — One "Find papers" menu
- The telescope ribbon menu becomes **Find papers**: Watch (open this week's inbox, Scan now), Discover (new review, resume), Expand (citation gaps, last gaps report), Improve (choose a search; until Phase 6 it opens Search effectiveness), then the utilities (Find DOIs, Check setup). Commands are renamed by group ("Watch: Scan now", "Discover: Generate literature review", …); ids may change too (the owner has no hotkeys set). Superseded commands are removed: "Open the graph in this note" (covered by "Open this note's report view") and "Open review graph" (in the menu).
- Files: `src/main.ts`, new pure `src/menu.ts` (the entries as data), `tests/menu.test.ts`, README.
- Done when: test lists every command under exactly one group; lint, build; owner sees the menu in Obsidian.
- New dependencies: none.

### Phase 2 — Known papers per search
- The Zotero library index also stores each item's collection keys (a full re-read once, then incremental as now) and the collection tree (name path to key).
- Each search gets "Extra known DOIs" (settings). `knownPapers(feed, index)` = DOIs in the search's Zotero collection (and its subcollections) plus the extra DOIs.
- The seed profile of each search (`seeds.ts`) is kept in `known-papers.json` in the plugin folder with its date, refreshed only on a button press (about $0.0001 per 50 DOIs).
- The review's "Papers I already know" box starts from the ticked searches' known papers (it can still be edited).
- Files: `src/zotero/library-index.ts`, `src/zotero/client.ts`, `src/settings/data.ts`, `src/settings/feed-modal.ts`, new `src/review/known.ts`, `src/review/window.ts`, `src/main.ts`; tests for the index migration, collection paths (nested, renamed, missing), `knownPapers`.
- Done when: tests; in `test-vault` the SDL search's known papers list matches what Zotero shows in its collection (a count the owner reads off Zotero).
- Depends on: nothing (can run in parallel with Phase 1).

### Phase 2b — Coherence of a search's papers
- Makes sure the papers chosen for a search form one coherent path, and says where they do not. Pure `src/review/coherence.ts` on the seed profiles (no new requests):
  - **Links** between every two known papers: shared references plus shared authors (3 each), as `seeds.ts` scores them.
  - **Outliers**: a known paper linked to none or almost none of the others (below a quarter of the median), shown with "does not belong here, or this search needs a second strand".
  - **Strands**: groups of papers linked more to each other than to the rest (connected groups above the median link), named by their shared phrases (`seed-queries.ts`). Two strands is normal (the owner's SDL search has an optimisation strand and a RAFT-dispersion-in-flow strand); a strand of one paper is an outlier.
  - **Fit of a new paper**: its overlap with the search's known papers, against the lowest overlap of a known paper with the others (leave-one-out). Below that, the paper is marked "does not fit this search", and if it fits another search's known papers better, that search is named.
- Shown when known papers are refreshed (Phase 2), when papers are added to a search's inbox (Phase 5: a mark per ticked paper, nothing blocked) and as a section of Improve (Phase 6: the strands as a small table or graph, outliers first).
- Checked on the cached data: among the owner's 8 fetched SDL papers every one links to the others (73 to 125), a lipoic-acid paper added as a test links to none (0), and the strands come out as papers 1, 2, 3, 7 (self-driving and optimisation) and 6, 8, 9 (RAFT dispersion in flow, linked by 11 to 17 shared references), with 4 between them.
- Files: new `src/review/coherence.ts`, `tests/coherence.test.ts`, small display in `src/review/window.ts` (the known papers box).
- Done when: tests with invented papers (one outlier, two strands, a paper that fits another search better); on the cached data the test paper above is flagged and the two strands appear.
- Depends on: Phase 2.

### Phase 3 — Expand as the one gaps tool
- Citation gaps gains a fourth start: **a search's known papers** (set-level gaps: the existing reference-list path with the known DOIs).
- The review's per-paper **Find gaps** opens Citation gaps on that paper instead of drawing its own list; its code in `window.ts` goes.
- Files: `src/review/gaps-panel.ts`, `src/review/gaps-input.ts`, `src/review/window.ts`, `src/main.ts`; tests on the input and the hand-off.
- Done when: tests; the old in-review gaps list is gone and its button opens the tool with the paper filled in; a known-papers run on the owner's SDL search lists gaps.
- Depends on: Phase 2.

### Phase 4 — Review results on the UI kit
- The review's paper list becomes a `DataTable`: chips by rank, by search, In Zotero / not, known paper; columns rank, overlap with known papers, fit, year, citations; search box; the order chosen in the window is the default sort. Behaviour otherwise unchanged (prompt, note and graph take the same papers).
- Files: `src/review/window.ts`, new `src/review/review-rows.ts`, `styles.css`; tests for the rows and chips.
- Done when: tests; the owner's ten papers show the same ranks as the table in this session's chat (seed order: 1, 2, 4, 6, 7, 9, 15, 25 among the fetched).
- Depends on: Phase 2 (known-paper chip). Independent of Phase 3.

### Phase 5 — Add to this week's inbox from Discover and Expand
- A tick column in the review table and the gaps Works table; **Add N to this week's inbox** asks which search (Discover: the search that found it; Expand: chosen from a menu) and writes the lines with the inbox's own code (`mergeIntoNote`), with a provenance marker (review or gaps of which paper) that Sync turns into the Zotero Extra line and `found-by/openalex` tag as today. Papers already listed for that search are skipped and named. Each ticked paper shows its fit to the chosen search (Phase 2b) and, when it fits another search better, says so; the owner can still add it.
- Files: `src/inbox/write.ts`, `src/inbox/sync.ts`, `src/review/window.ts`, `src/review/gaps-panel.ts`, `src/main.ts`; tests on the line format, the merge (no duplicate, ticks kept) and the Extra line.
- Done when: tests; in `test-vault` one paper added from the review and one from gaps appear in the week's note, Sync sends them to the right collections, and the ledger counts them under their search.
- Depends on: Phase 4 (review table), Phase 2b (fit marks); Phase 3 for the gaps side only.

### Phase 6 — Improve tab per search
- A tab per search with four sections on the kit:
  - **How it is doing**: topic statistics and wanted/dismissed rates from the ledger, with the "weak until about 20 decided papers" note.
  - **Overlap**: shared papers and dropped ids against the other searches.
  - **Coherence**: the search's strands and outliers (Phase 2b).
  - **From your known papers**: suggested strings with what each finds, leave-one-out, size check, Add topic (`seed-queries.ts`). Also library papers outside the collection that overlap the seeds strongly, as candidates to file.
  - **Ask an LLM**: the tweak and compare prompts through `PromptPanel`, the answers applied as today (`prompts/apply.ts`).
- Opened from each search's card in the inbox, from the settings row, and from the old commands, which now open it.
- Files: new `src/improve/view.ts` and `src/improve/model.ts`, `src/ledger/report.ts`, `src/prompts/modals.ts`, `src/inbox/block.ts`, `src/main.ts`; tests on the model (sections, empty states).
- Done when: tests; the owner opens Improve for the SDL search and sees its stats, overlap, suggestions and the prompt, and adds one suggested string.
- Depends on: Phase 2 and 2b (known papers, coherence); Phase 1 (menu entry).

### Phase 7 (optional) — Known-paper hint in the weekly inbox
- Ask the weekly scan for references too (same request, larger answer) and show a "close to your known papers" mark in the inbox table. Only if the owner wants it after Phase 6.
- Depends on: Phase 2.

## Order
1 and 2 have no dependency on each other; 2b, 3 and 4 need 2; 5 needs 4 and 2b (and 3 for its gaps half); 6 needs 2 and 2b and uses 1; 7 is last and optional. Recommended run: 1, 2, 2b, 4, 3, 5, 6.

## Verification
- **Reference set:** the owner's ten expected SDL papers (listed in this session; DOIs in the owner's message). They should be in the SDL search's Zotero collection; Phase 2 must find them as known papers, Phase 4 must reproduce the seed ranks measured here, Phase 3's set-level gaps must not list them as gaps. Phase 2b must keep all of them in the search (no outlier among them) and flag an off-subject paper added as a test.
- Every phase: `npm test`, `npm run lint`, `npm run build`; then a manual check in `test-vault` by the owner (nothing here has run in Obsidian before it).
- Costs: every paid step shows its price before it runs (Phase 2 refresh, Phase 3 run, size checks) as now.
