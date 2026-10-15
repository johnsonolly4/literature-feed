# Plan: bring refcheck's features and metrics into Literature Feed (owner decisions 2026-10-15 recorded; Q5 default assumed)

Source: the owner's Python tool `refcheck.py` (spec in untracked `replication_docs/`, indexed in `docs/reference/refcheck-index.md`). Drafted 2026-10-15 by an Opus review of the spec against the real code; the spec's numbers were not re-run. No real names in fixtures: invent them.

## Why this is the skipped Phase 3
Phase 3 (Expand as the one gaps tool) was skipped on 2026-10-14 because the owner had a Python alternative to bring in later. refcheck is that alternative: the citer-scan routes below fill Phase 3 and the unbuilt gaps half of Phase 5. Author-group features stay out (same decision).

## Rules carried over
Plain counts and shares, **no combined score** (so no "paper strength"); review shown as a badge, never reorders; every paid step shows its price first; one new host (Semantic Scholar) only if the owner says so; thresholds shown against the list length.

## Verdicts
- **Already covered:** signal 1 (`src/review/network.ts:199`, `gaps-fetch.ts`; ours defaults to 3, refcheck 4: check the year filter), kit tables, citation map layout, pasted-list parse/resolve (`src/refs/`).
- **Include:** niche (k1 / cited_by) and its percentile (hidden column), both-routes chip, heavy-reference rule (≥ 2000 citations skipped by default, price listed), 2b diagonal chart (later).
- **Adapt:** citer scan for 2a/2b (cursor paging and a slim select; `buildCitingUrl` stops at 10,000 results), neighbours and "of which reviews", gap column, review-flag rules (keep `type` and `biblio`; editable venue list), self-citation filter (DOI route), consensus clustering with stability and bridges (seeded), pasted-list hardening (a DOI in the text wins, coverage warning under 80%, Crossref deposited list), cluster-formation figure (only if consensus is adopted).
- **Skip:** possible gap (author matching), Semantic Scholar for now, Sankey/flow chart/Authors tab/ACS copy, batch, paper strength and the rejected metrics.

## Caveats shown in the tool
"Pointers, not verdicts. In one test of the source tool, 13 of 30 held-out references came back." Each threshold next to the list length ("needs 4 of your 57 references"). Warn when fewer than 10 similar papers are found. Neighbours are a modelling choice. Clusters are rough groups by citation only, with stability shown; not claimed to match the Python ones.

## Phases (one session each; more than 2 files → plan mode first)
- **R1 Review flag and niche (built 2026-10-15, branch `feat/searches-merge`; the venue list is a constant, not a setting; no note column)** — `src/openalex/client.ts` (keep `type`, add `biblio`), new `src/review/review-flag.ts`, `gaps-rows.ts`. Free. Fixture: invented works (type review → sure; "Annual Review of X" → sure; 160 references → hint; 40 references, plain title → none).
- **R2a Citer scan: pure part and client (built 2026-10-15: `neighbours.ts`, `fetchCiters`, `citersPage`; nothing calls it yet)** — `client.ts` (cursor, slim select), new `src/review/neighbours.ts`, `network-fetch.ts`. Fixture: 6 invented references; citing works share 5, 5, 6, 2, 0 → 3 similar; one candidate on both routes; one heavy reference skipped. Price first (spec: about $0.005 to $0.05 a paper; not measured).
- **R2b 2a/2b in the gaps tool (split 2026-10-15: R2b-1 built = session switch `similar`, `scanSimilar` in `gaps-fetch.ts`, rows/chips/columns in `gaps-rows.ts`, `tests/gaps-scan.test.ts`; R2b-2 open = panel toggle, price confirm box, caveat lines, note cell and record. Owner chose: scan off by default, 2b works only, 2a similar-paper rows not listed)** — `gaps-fetch.ts`, `gaps-panel.ts`, `gaps-rows.ts`, `gaps-note.ts`: both-routes chip, caveat lines.
- **R3 Consensus clustering** — new `src/review/consensus.ts`, `src/improve/library-map.ts`. Fixture: two invented 4-cliques plus a node tied 2:1 → bridge; seeds 1 to 5 give the same split. Free.
- **R4 Self-citation and review-neighbour filters.**
- **R5 Pasted-list hardening** — `src/refs/resolve.ts`, `gaps-input.ts`, Crossref deposit.
- **R6 (optional)** diagonal chart, cluster figure. **R7 (optional)** Semantic Scholar review hint (new host: README Network use, store notes).

**Order with the searches-merge phases:** R1 → R2a → R2b → owner judges the 6b.1 groups → R3 if needed → 6b.2 → 6b.3 → R4 → R5. Neither 6b phase is replaced; Drift can later report each paper's change in stability.

## Owner decisions (2026-10-15, chat)
1. Grouping: **show both** union-find and consensus and pick, **and the owner wants a way to use both metrics (ours: shared references + 3 x shared authors; refcheck's: direct citation + 5 x Jaccard) to build out the maps.** So R3 makes the link weight and the grouping method both selectable, and the map view can show the two side by side. Design detail to settle when R3 is planned.
2. Link weight for the gaps map: refcheck's.
3. Gap column: **shown** by default.
4. Semantic Scholar: after R4, optional, key in secret storage.
5. Thresholds: not asked; refcheck's defaults plus the length caveat assumed (recommended). Confirm.

## Risks, not verifiable here
Spec numbers come from the owner's Python data. JavaScript random runs will differ from Python's. Nothing run against live OpenAlex; cursor paging changes the API client. Venue list is chemistry-only. Speed of 200 runs on ~300 papers unmeasured. Three groupings (`coherence.ts`, `network.ts`, `consensus.ts`) may disagree: pick one per view.
