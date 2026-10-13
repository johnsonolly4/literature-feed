# Status
_Updated: 2026-10-13 (literature review: tab, graph in the note, record and repeat). Cap 40 lines. History lives in git and `docs/changelog.md`, not here._

**Version:** 0.2.0 released (moves only at `/release`; TypeScript in `src/`). Releases so far: 0.1.0, 0.1.1, 0.2.0, all desktop-only, squash-merged via PRs #2 to #4.

## Now
Branch `feat/lit-review` (from main 0.2.0, **unpushed**, last commit `43c484f`, 556 tests, lint and build clean). The literature review (`src/review/`, `src/zotero/library-index.ts`) is built and was run once by the owner in `test-vault` (Lipoic acid copolymers, 60 of 172 papers, $0.010, LLM answer pasted). Since then, from their feedback:
- OpenAlex lookups priced as filtered lists ($0.0001) and a reference-list coverage line (`a36712e`).
- The graph is drawn inside the review note (`literature-feed-graph` block, **Open full graph**), at the top of the window, in the commands (`c6a6c60`). The owner had never seen it because **Open graph** sat below the table and charts.
- The review opens in a **tab**, is saved as you go (`review-session.json`, Resume / Start new), and a telescope ribbon icon opens a menu (`9e36087`).
- The note records how the review was made (topics, rules, window, sort, LLM, prompt hash, prompt kept as a note, answer as pasted, P-labels) and **Repeat the review in this note** re-runs it (as recorded or current searches) and lists what changed (`2adfbe2`).
- The graph tab drew lines but no papers (SVG classes; fixed in `0f2a35e`) and threw papers against the walls (layout fixed); then a better graph (top labels, hover, group names, theme colours, zoom buttons, legend; `43c484f`). Checked in a browser page with the owner's data, not in Obsidian.
- **Citation gaps** is its own tab (DOI/id, Zotero item or pasted references; about $0.0003 a paper; gaps note with record) (`aa385e2`).
None of these has run in Obsidian (code and unit tests only). `test-vault`'s plugin folder already holds the latest build (the dev watcher was running); reload the plugin.

## Next (top item is the next session; plan: `C:\Users\CEP25OJJ\.claude\plans\vectorized-wandering-sunrise.md`)
1. Owner tests the review in `test-vault` (BACKLOG → Not yet tested: graph in the note, tab and resume, record and repeat, phases A to C) and reports; fix what they find.
2. **Part C, optional Semantic Scholar** (approved plan, not started; the owner is applying for a key, unauthenticated calls work, TLDRs are patchy): switch off by default, optional key; similar papers (Recommendations API), reference-list cross-check, TLDRs to shorten the prompt; new host `api.semanticscholar.org` in the README and store disclosure. First step: one live call from a script (needs a key if the owner has one), else mark "not tested live".
3. Rebase `feat/lit-review` onto main, push, PR, merge, `/release` 0.3.0 (only when the owner says).
4. Phase 2 late-indexing run on or after 2026-10-19 (`node scripts/openalex-run.mjs --from 2025-10-12 --out run3.json`, compare with `run.json`; needs the owner's key). Phase 8: Lab Kit side (its own repo and session). Store submission after 0.3.0.

## Running: `npm run dev` watcher may still be running against this repo (rebuilds `test-vault`'s plugin folder). Stop it with Ctrl+C in its terminal.

## Waiting on owner (needs a human)
- [ ] Reload the plugin in `test-vault`, re-run **Generate literature review** (free from the 24 h cache), press Create review note and check: the graph in the note, the tab (click away, Resume), the record section, **Repeat the review in this note**. Say if the graph and layout are acceptable at 20, 60, 150 papers.
- [ ] Run **Check against Zotero** in the review, **Find missing papers** and **Find gaps** once (a few cents at most) and report.
- [ ] Say whether to go ahead with Semantic Scholar (Part C) now or after testing, and whether they have a Semantic Scholar key.
- [ ] The still-open checks: overlap numbers after real scans, Compare searches (two searches), the archive move (point the three folders at `Demo/...`), Mac and phone via BRAT (plugin is `isDesktopOnly`), the Lab Kit To process list needing ZotLit.
- [ ] Keys go into Obsidian's secret storage via the plugin's settings in `test-vault` only, never into chat.

## Known issues
- `npm install` reports 9 audit findings, all in dev dependencies; nothing is bundled into `main.js` (BACKLOG).
- `.claude/rules/obsidian-plugin.md` and `docs/reference/plugin-guidelines.md` are Lab Kit copies and still mention files that do not exist here (BACKLOG).
- Semantic Scholar rate limits are reported inconsistently by third-party sources; the plan stops on the first 429.
