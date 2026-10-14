# Plan: Searches merged into Watch, Discover, Expand (and Improve)

_Agreed: 2026-10-13. Written by `/phase-plan` (Opus review of a Sonnet proposal from the same session). Each phase = one session._

## Goal
The owner finds papers through three clearly separate searches (**Watch** what is new, **Discover** what was missed on a subject, **Expand** what some papers rest on or miss) plus one **Improve** tab per search, all learning from the papers already filed in that search's Zotero collection, with one path to Zotero (the weekly inbox).

## Decision taken
- **No single engine.** The weekly scan and the review stay separate code; only pure pieces are shared (scoring already is; ranking and known-paper overlap become shared). Checked in the code: the scan (`src/inbox/scan.ts:90`) fetches a small window in full and lists everything, so it never had the cap or ordering problem that hid the owner's papers in the review (`src/review/collect.ts`). Rewriting it would risk the weekly scan for no visible gain.
- **Known papers per search = its own seed collection + DOIs added by hand (revised 2026-10-14).** Each search gets a *seed collection*, `<its Zotero collection>/seeds` (the owner's layout: `Inbox/<search>/seeds`). It sits inside the inbox collection but is a separate collection: only items directly in it are seeds, so synced-but-unvetted papers (which Sync files in the inbox collection) never become seeds. The owner curates it; a **Promote to seeds** action (Phase 5b) moves good papers in. The rest of the library keeps its current job (the "in Zotero" flag) and is not used as seeds, which would mix subjects.
- **Papers from Discover and Expand reach Zotero through this week's inbox note**: ticked in the review or gaps table, added under their search, sent by the usual Sync. Keeps "triage first" (decision 2026-10-12) and one sync path, and the ledger sees these decisions.
- **One Improve tab per search** groups topic statistics, overlap, strings suggested from its known papers and the LLM prompts; the existing commands open it.
- Correction to the earlier proposal: the review's per-paper **Find gaps** and the Citation gaps tool already share `fetchCitationGaps` (`src/review/network-fetch.ts:133`); only the interface is duplicated. Set-level **Find missing papers** (`fetchNetworkExtras`, M and C labels in the prompt and graph) stays in Discover.
- Rejected: one engine behind scan and review (risk, little gain); pasted DOIs only (hand upkeep); one global seed list (mixes subjects); a direct Send button in review and gaps (second sync path, invisible to the ledger); removing the LLM tweak and compare prompts (kept, moved into Improve).

## Out of scope
- Semantic Scholar, retraction flags, first-and-last authors (separate BACKLOG items).
- Moving the settings tab and modals onto the UI kit.
- Changing what the weekly scan fetches or how it scores.
- Seed overlap shown in the weekly inbox (would need references in every scan request): Phase 7, optional.
- Author-gap features (authors cited/uncited table, drill-down, "other work on this ground"): the owner will rework these separately in Python (2026-10-14). The existing code stays untouched and no phase here changes it.
- Calling an LLM from the plugin (it never does). An LLM grouping prompt is only a possible follow-up to Phase 6b.

## Before Phase 1
The work of 2026-10-13 is uncommitted on `feat/lit-review` (UI kit, Citation gaps rebuild, author audit prompt, review ranking, known papers, seed strings). The owner tries it in `test-vault`, then it is committed (one commit per piece) so each phase below starts clean.

## Phases

### Phase 1 — One "Find papers" menu (built 2026-10-14; code and unit tests only, see BACKLOG → Not yet tested)
- The telescope ribbon menu becomes **Find papers**: Watch (open this week's inbox, Scan now), Discover (new review, resume), Expand (citation gaps, last gaps report), Improve (choose a search; until Phase 6 it opens Search effectiveness), then the utilities (Find DOIs, Check setup). Commands are renamed by group ("Watch: Scan now", "Discover: Generate literature review", …); ids may change too (the owner has no hotkeys set). Superseded commands are removed: "Open the graph in this note" (covered by "Open this note's report view") and "Open review graph" (in the menu).
- Files: `src/main.ts`, new pure `src/menu.ts` (the entries as data), `tests/menu.test.ts`, README.
- Done when: test lists every command under exactly one group; lint, build; owner sees the menu in Obsidian.
- New dependencies: none.

### Phase 2 — Known papers per search (revised after the plan review of 2026-10-14; two sessions: 2.1 then 2.2)
Settled in the review: no remembered collection key (found by path only; Sync is path-based too); seeds are direct members only; items in Zotero's Trash never count; title matching is not used in Phase 2.

### Phase 2.1 — Known papers from the seed collection (built 2026-10-14; code and unit tests only, see BACKLOG → Not yet tested)
- **Seed collection.** Each search's seeds are the Zotero collection `<its Zotero collection>/seeds`; with the owner's layout that is `Inbox/<search name>/seeds`. Worked out from the search's Zotero collection setting (not its name, so renaming a search changes nothing); an explicit path in the search overrides it. No Zotero collection and no explicit path = no seed collection ("not set"), never a top-level `seeds`. Only items directly in `seeds` count; its subcollections do not. The path is matched exactly (case included), collections in the Trash left out; not found says "collection not found" with near-misses (other case, a `seeds` elsewhere), never an empty set; an empty collection says "empty".
- **Library index, format 2** (`zotero-index.json`). Each item also stores its collection keys (direct membership as the API reports it), and the file stores the collection list (key, name, parent, in Trash). Items are read with `includeTrashed=1`; an item in the Trash is removed; collection keys missing from the current collection list are dropped at every refresh. The collection list is read again at every refresh (one request per 100 collections). Requests run one after another. A format-1 file keeps its items (flags still work) and the next refresh reads the whole library once, replacing the items instead of merging (`listDeleted(0)` returns nothing, so a merge would keep deleted items).
- **Settings.** Two optional search fields: `seedCollection` ("" = worked out as above; the worked-out path is never stored) and `knownDois` (list). `cloneFeed` copies the list; export and import carry both, never a Zotero key; old searches and old exports load unchanged. The search editor shows the worked-out path as the placeholder and how many DOIs it recognised.
- **`knownPapers(feed, index)`** (new pure `src/review/known.ts`): the DOIs (seed collection plus `knownDois`, no repeats), the items without a DOI, and counts (items, with DOI, without, repeats, not counted: notes and attachments).
- **Review.** "Papers I already know" gets **Fill from seed collection**: refreshes the Zotero index first (free), then replaces the box's text with one chosen search's known papers (the box stays editable). The result line gives the counts above and the price of reading them (⌈N/50⌉ × $0.0001) before anything is read. Items without a DOI are listed in a warning asking to add one in Zotero (DOI field, or a `DOI: …` line in Extra for types without one). The leave-one-out test of suggested searches checks at most 40 papers (it runs locally, no requests, but rebuilds the strings once per paper).
- Files: `src/zotero/library-index.ts`, `src/zotero/client.ts`, `src/main.ts`, `src/settings/data.ts`, `src/settings/feed-modal.ts`, new `src/review/known.ts`, `src/review/window.ts`; tests in `tests/review-a.test.ts` (index), `tests/settings.test.ts`, new `tests/known.test.ts`, and a recorded Zotero fixture (one `/items` page with nested collections, a trashed item, a DOI in Extra and a child note; one `/collections` page with a trashed collection; one `/deleted` answer; invented keys, titles and DOIs, no authors, user ID 123456).
- Tests also cover: a format-1 file; a full read replacing stale items; a trashed item removed and a restored one back; unknown or trashed collection keys dropped; default path, override, nested path, no inbox collection, case mismatch, trashed seed collection, parent and subcollection items not counted, extras, repeats, empty collection; old feeds load, `cloneFeed` shares no list, export keys, import of bad types.
- Done when: tests, lint, build; in `test-vault` Fill's counts for the SDL search add up to the item count Zotero shows in its `seeds` collection, and the ten reference DOIs are among the known papers. (The plugin sees what Zotero desktop has synced to zotero.org; sync first.)
- Depends on: nothing.

### Phase 2.2 — Seed collection in Check setup, and Find DOIs for seeds (built 2026-10-14; code and unit tests only, see BACKLOG → Not yet tested)
- Check setup reads the Zotero collections when the key and user ID are set (a failed read gives one row "could not read Zotero"). For every search with topics (switched on or not): ok; not set; the same as the inbox or project collection (warning); not found, with **Create it** (new fix `create-zotero-collection`: last name only, the parent must exist, otherwise "Sync once first, or create the inbox collection in Zotero"). Pressing the button is the consent for that one collection. `applyFix` handles each kind by name (today any kind other than create-folder sets the literature folder).
- The warning about seeds without a DOI gets **Find DOIs for these**: opens the Find DOIs tab with their titles filled in. It only suggests; the owner types the DOI into Zotero.
- Files: `src/setup/checks.ts`, `src/setup/setup-modal.ts`, `src/main.ts`, `src/refs/view.ts` (or `panel.ts`), `src/review/window.ts`; tests in `tests/setup.test.ts` (each row state, searches switched off covered, an unknown fix kind leaves the literature folder alone) and `tests/refs.test.ts`.
- Done when: tests; in `test-vault` a search without `seeds` shows the row, Create makes it in Zotero and the row turns ok; a seed without a DOI opens in Find DOIs.
- Depends on: 2.1.

**Deferred to Phase 2b:** the cached seed profile `known-papers.json` (with its date and a refresh button). Phase 2 does not need it; the coherence analysis does.

### Phase 2b — Coherence of a search's papers (built 2026-10-14: `coherence.ts`, `SeedProfile.perPaper`, box in the review window; unit tests only, real-data check open, see BACKLOG)
- Makes sure the papers chosen for a search form one coherent path, and says where they do not. Pure `src/review/coherence.ts` on the seed profiles (no new requests):
  - **Links** between every two known papers: shared references plus shared authors (3 each), as `seeds.ts` scores them.
  - **Outliers**: a known paper linked to none or almost none of the others (below a quarter of the median), shown with "does not belong here, or this search needs a second strand".
  - **Strands**: groups of papers linked more to each other than to the rest (connected groups above the median link), named by their shared phrases (`seed-queries.ts`). Two strands is normal (the owner's SDL search has an optimisation strand and a RAFT-dispersion-in-flow strand); a strand of one paper is an outlier.
  - **Fit of a new paper**: its overlap with the search's known papers, against the lowest overlap of a known paper with the others (leave-one-out). Below that, the paper is marked "does not fit this search", and if it fits another search's known papers better, that search is named.
- Shown after **Fill from seed collection** (Phase 2.1), when papers are added to a search's inbox (Phase 5: a mark per ticked paper, nothing blocked) and as a section of Improve (Phase 6: the strands as a small table or graph, outliers first).
- **Distortion check for promotion** (used by Phase 5b): before a paper joins the seeds, show its fit to the current seeds, how the seeds' mined search strings would change (phrases added or dropped, via `seed-queries.ts`) and whether it would become an outlier or a one-paper strand. Nothing is blocked. A paper that the existing seeds found (its inbox line carries the topics that matched) is expected to fit; the check matters for papers found elsewhere.
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

### Phase 5b — Promote to seeds
- A **Promote to seeds** action on a paper in the inbox table, the review table and the Improve tab: shows the distortion check (Phase 2b), asks to confirm, then adds the paper's Zotero item to the search's seed collection (collection membership only; the existing PATCH in `client.ts` that adds collections; the item must already be in Zotero, so an unsent paper is sent first by the usual Sync). Undo removes it from the seed collection again. Known papers refresh after.
- Files: `src/zotero/client.ts`, `src/inbox/block.ts`, `src/review/window.ts`, `src/review/known.ts`; tests for the collection write, the confirm text and undo.
- Done when: tests; in `test-vault` a synced paper is promoted and shows up in the search's known papers count and in Zotero's seed collection.
- Depends on: Phase 2, 2b.

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

### Phase 6b — Library map (one-off grouping, then drift and assignment)
- Code only, no LLM. Reads the library index (about 300 papers; references fetched for the DOIs, about $0.0001 per 50, price shown first) and groups papers by bibliographic coupling (shared references, shared authors) and shared mined phrases, reusing `coherence.ts` strands and `seed-queries.ts`.
- **Setup run (once):** shows the proposed groups with a name from their shared phrases, outliers listed apart; the owner renames, merges or splits groups, then **Create seed collections** makes `<search's Zotero collection>/seeds` for each group assigned to a search and files the papers (the plugin creates collections only on this explicit action, separate from the existing "create missing" switches).
- **After setup:** (a) *Assign*: for papers in the library outside every seed collection (or newly synced), suggest the best-fitting search with its fit, or "fits none"; (b) *Drift*: per search, how its seeds' strands and shared phrases changed since the last snapshot (kept in `known-papers.json` with dates), so a search that is wandering shows up. Both sit in Improve and are suggestions only.
- Files: new `src/improve/library-map.ts`, `src/zotero/client.ts` (create collection, already exists), `src/improve/view.ts`; tests with invented libraries (two clear groups, one outlier, drift after adding papers).
- Done when: tests; on the owner's real ~300 papers the proposed groups are read and judged sensible by the owner before anything is created.
- Depends on: Phase 2, 2b, 6. Possible follow-up: an optional copy/paste LLM grouping prompt if the code-only groups are not good enough.

### Phase 7 (optional) — Known-paper hint in the weekly inbox
- Ask the weekly scan for references too (same request, larger answer) and show a "close to your known papers" mark in the inbox table. Only if the owner wants it after Phase 6.
- Depends on: Phase 2.

## Order
1 and 2 have no dependency on each other; 2b, 3 and 4 need 2; 5 needs 4 and 2b (and 3 for its gaps half); 5b needs 2 and 2b; 6 needs 2 and 2b and uses 1; 6b needs 6; 7 is last and optional. No users and no deadline, so the order is by ease: 1, 2.1, 2.2, 2b, 4, 3, 5, 5b, 6, 6b, 7. "Depends on: Phase 2" means 2.1 (2.2 adds only Check setup and Find DOIs). Phases 5b and 6b write to Zotero outside Sync (adding papers to a seed collection); that needs its own decision line when they are planned.

## Verification
- **Reference set:** the owner's ten expected SDL papers (listed in this session; DOIs in the owner's message). They should be in the SDL search's Zotero collection; Phase 2 must find them as known papers, Phase 4 must reproduce the seed ranks measured here, Phase 3's set-level gaps must not list them as gaps. Phase 2b must keep all of them in the search (no outlier among them) and flag an off-subject paper added as a test.
- Every phase: `npm test`, `npm run lint`, `npm run build`; then a manual check in `test-vault` by the owner (nothing here has run in Obsidian before it).
- Costs: every paid step shows its price before it runs (Phase 2 refresh, Phase 3 run, size checks) as now.
