# refcheck: index of the replication docs

> [!info] What this is
> Index of `replication_docs/REPLICATION_SPEC.md` (432 lines, written 2026-10-15), the spec of the owner's separate Python tool `refcheck.py`. Read the spec only for the section you need. **The spec's text names real researchers (examples, test papers); `replication_docs/` is untracked and must not be committed** (public repo, CLAUDE.md rule). This index has no names. The overlap notes in the last table come from reading the spec and the Improve/review code of 2026-10-15, not from running anything.

## What refcheck does
Takes a paper's reference list and finds papers it probably *should* cite and does not. Uses OpenAlex (main), Crossref, Semantic Scholar. Output: report, JSON, standalone HTML dashboard. Everything is a pointer, not a verdict; no ground truth, nothing validated against expert labels.

## Spec sections
| § | Topic | Lines | Use for |
|---|---|---|---|
| 1 | Purpose, user, working rules | 29-45 | Rule: **plain counts and shares, no invented combined scores**; colour never the only cue |
| 2 | Files and state kept | 48-74 | Cache, library, choices files (shape of state to keep) |
| 3 | Commands, options, defaults | 78-95 | Parameter defaults (min-count 4, min-shared 5, neighbours 30, top 40) |
| 4 | OpenAlex, Crossref, Semantic Scholar | 99-107 | Prices, endpoints, batch sizes; **Semantic Scholar is a new host for the plugin** |
| 5 | Pipeline: parse, resolve, signals 1, 2a, 2b, 3 | 111-168 | The metrics' exact definitions |
| 6 | Metrics table: definition, filter, weakness | 172-201 | Which metrics to include; rejected metrics list |
| 7 | Review detection (`sure` / `suspect`) | 205-215 | Flagging reviews; evidence vs Semantic Scholar |
| 8 | Author groups (research groups from last authors) | 219-235 | **Out of scope for the plugin** (owner reworks author-gap features in Python, plan 2026-10-14) |
| 9 | Clustering: link weight, label propagation, consensus, bridges | 239-254 | Candidate replacement/upgrade for `coherence.ts` strands |
| 10 | Output files, `signals.json` schema | 257-263 | Data shape |
| 11 | Dashboard: tables, charts, tabs, Lab Kit design | 267-331 | UI patterns; design rules match `SPEC.md` |
| 12 | Figures (cluster-formation figure) | 335-345 | `make_cluster_figure.py` + SVG: explanatory figure |
| 13 | Decisions log (do not reopen) | 349-368 | Constraints to respect |
| 14 | Evidence: tests and numbers | 372-385 | Measured behaviour (recall 13/30 held out; strength AUC 0.589) |
| 15 | Known problems | 389-401 | Caveats to carry into any port |
| 16 | Rebuild order, acceptance checks | 405-431 | Test fixtures with known answers |

## The tool's metrics (§6)
- **k1** = number of the paper's references citing a candidate (≥ 4); **share of refs** = k1 / refs with a bibliography.
- **k2** = number of the 30 most similar papers citing a candidate (≥ 3); **share of neighbours**; split into research and review neighbours.
- **gap** = share of neighbours − share of refs (points). **niche** = k1 / total citations; **niche percentile** within a table.
- **Similar paper** = a citing work sharing ≥ 5 references with the list; **weighted shared** = Σ 1/ln(2 + cited_by); **Jaccard**.
- **Both routes** = signal 1 and signal 2b. **Possible gap** = both-route paper none of whose authors is already in the list.
- **Cluster** = consensus label propagation (link = direct citation 1 + 5 × Jaccard of reference lists; 200 shuffled runs; average-linkage at 0.5); **stability**; **bridge** (stability < 0.7 and ≥ 0.2 to another cluster).
- Not adopted by the owner: "paper strength" `k1/4 + k2/3` (kept in the tool, AUC 0.589, weak) and all combined scores in §6 "Rejected metrics".

## First reading of overlap with the plugin (unverified against code)
| refcheck idea | Plugin today | Notes for the plan |
|---|---|---|
| Signal 1: papers cited by many of your references (k1) | Citation gaps (`src/review/gaps-*.ts`) counts what a paper's references cite and the paper's citers do not; "known papers" profile counts shared references | Check how close the two are before porting; thresholds differ |
| Signal 2: similar papers by shared references, then what they cite (k2) | Seed overlap/rank (`seeds.ts`, review "Order papers by"); no neighbour step | New "neighbours" step needs a citing-works scan (cost: §4, $0.005-0.05 a paper) |
| Review detection (§7) | None (backlog: retraction flags is separate) | Pure rule + Semantic Scholar (new host, README Network use, store notes) |
| Consensus clustering + bridges (§9) | `coherence.ts`: median-link union-find strands, outliers | Same input (shared refs); consensus is more stable; weight 5 and thresholds are conventions |
| Self-citation filter (own authors) | None | Needs own-author names; surname + initial key exists (`authorKey`) |
| Heavy-reference rule (≥ 2000 citations) | None | Cost control for citer scans |
| Dashboard tables/charts/legend tiles | UI kit `src/ui/` (DataTable, Section, SplitPane, ReportBar) | Charts (scatter, map, Sankey) would be new |
| Metrics shown as plain counts and shares | Same principle in Improve | Keep |
