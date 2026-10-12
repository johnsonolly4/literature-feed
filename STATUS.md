# Status
_Updated: 2026-10-12 (Phase 2 session). Cap 40 lines. History lives in git and `docs/changelog.md`, not here._

**Version:** 0.0.1 (moves only at `/release`; TypeScript in `src/`)

## Now
Phase 0 (repo scaffold) done 2026-10-12: `npm run build`, `npm test` (2 tests) and `npm run lint` pass with 0 errors, 0 warnings; `npm run dev` writes the plugin into `test-vault/.obsidian/plugins/literature-feed/`. Not seen in Obsidian: loading the plugin in `test-vault` is still to be done by the owner (see Waiting on owner). Nothing run against OpenAlex or Zotero.
Phase 1 (matching engine, pure) done 2026-10-12 on `feat/matching-engine`, pushed, PR johnsonolly4/literature-feed#1 open: `src/match/` (feed, score, dedupe), 55 new tests (57 in all), lint and build pass. Pure code: nothing to see in Obsidian. Rules I chose where the plan was silent: BACKLOG → Decisions needed.
Phase 2 (OpenAlex client) **code done, real run done, a few checks open** 2026-10-12 on `feat/openalex-client` (cut from `feat/matching-engine`, committed, not pushed): `src/openalex/client.ts`, 21 new tests (78 in all), lint and build pass. Real run done by the owner (4 topics; 30 days: 14 works, one year: 153 listings, 114 unique, $0.004 per run): the scoped query form works; details and what is still open: BACKLOG. No-abstract rule done 2026-10-12 (same branch, committed, not pushed): `scorePaper` caps an empty abstract at Possible; 83 tests, lint and build pass; cap order is a question in BACKLOG. Second Phase 2 session (same day): known paper found (JACS 10.1021/jacs.6c02848); recorded fixture `tests/fixtures/openalex-recorded.json` plus 3 tests (86 in all, lint passes); `scripts/openalex-run.mjs --sample`. Hand check: 26 papers with no returned abstract and no lipoic term in the title are probably real hits (42 with an abstract all held a term); owner chose a separate list, so `scorePaper` now gives them tier `unchecked` instead of dropped (89 tests, lint and build pass; the inbox list itself is Phase 4, BACKLOG). Other test responses are hand-written to the documented shape. Docs differ from the plan in 3 points (query form, date filter, key header): `docs/decisions.md`.

## Next (ordered: top item is the next session; plan: `docs/plans/literature-feed.md`)
1. Phase 2 finish: only the late-indexing run is left (on or after 2026-10-19: `node scripts/openalex-run.mjs --from 2025-10-12 --out run3.json`, then compare with `run.json`; needs the owner's key),. Known paper, recorded fixture and the no-abstract list decision are done. Otherwise go to Phase 3 and leave these in BACKLOG.
2. Phase 3: settings tab
3. Phase 4: weekly dashboard note
4. Phase 5: Zotero sync (one real sync of one paper)
5. Phase 6: read state and archive
6. Phase 7: schedule, commands, ribbon
7. Phase 8: Lab Kit side (in the Lab Kit repo, its own session and plan)
8. Phase 9: release (owner's call)

## Running: none

## Waiting on owner (needs a human)
- [ ] Review PR #1 (johnsonolly4/literature-feed) and the five rules in BACKLOG → Decisions needed; merge when happy
- [ ] Turn on the plugin in `test-vault`: `npm run dev`, open `test-vault` in Obsidian, enable Literature Feed (then BACKLOG "Not yet tested": plugin loads)
- [ ] For further Phase 2 runs: the key in `OPENALEX_API_KEY` in your own terminal (not in chat)
- [ ] Push `feat/openalex-client` and open its PR when you want it (not pushed; it sits on top of PR #1)
- [ ] Before Phase 5: Zotero API key with write access to My Library, and the user ID (API keys part of the zotero.org account settings)
- [ ] Keys go into the plugin's settings in `test-vault` only

## Known issues
- `npm install` reports 9 audit findings (6 moderate, 1 high, 2 critical), all in dev dependencies (same tooling versions as Lab Kit); nothing is bundled into `main.js`. Not looked into: BACKLOG.
- `.claude/rules/obsidian-plugin.md` and `docs/reference/plugin-guidelines.md` are Lab Kit copies and still mention Lab Kit files that do not exist here (`src/node.ts`, `src/platform.ts`, the kit updater): BACKLOG.
