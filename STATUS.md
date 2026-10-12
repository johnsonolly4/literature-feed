# Status
_Updated: 2026-10-12 (Phase 3 session). Cap 40 lines. History lives in git and `docs/changelog.md`, not here._

**Version:** 0.0.1 (moves only at `/release`; TypeScript in `src/`)

## Now
Phase 0 (scaffold) and Phase 1 (matching engine, `feat/matching-engine`, pushed, PR johnsonolly4/literature-feed#1 open) done 2026-10-12.
Phase 2 (OpenAlex client, `feat/openalex-client`, committed, not pushed) done except one check: the real run, the known paper (found), the recorded fixture, the no-abstract rule and the Unchecked tier (papers with no abstract and no required term in the title are listed apart, not dropped) are in; the late-indexing comparison needs a run on or after 2026-10-19 (BACKLOG).
Phase 3 (settings tab) **code done, never seen in Obsidian** on `feat/settings-tab` (cut from `feat/openalex-client`, committed, not pushed): `src/settings/` (`data.ts`, `tab.ts`, `feed-modal.ts`, `test-feed.ts`), `src/openalex/request.ts`, `docs/feeds/lipoic-acid-copolymers.json`, `styles.css`. 114 tests pass (25 new in `tests/settings.test.ts`), lint 0 errors 0 warnings, build passes. Only the data layer and the Test summary are unit-tested; the tab and windows are not. The tab uses Obsidian's declarative settings API, chosen from the type definitions without running it (BACKLOG → Not yet tested has the full list of things to look at). Nothing was run against Zotero.

## Next (ordered: top item is the next session; plan: `docs/plans/literature-feed.md`)
1. Phase 3 check in Obsidian: owner tries the tab in `test-vault` (list in BACKLOG → Not yet tested), then `/feedback` with what broke. Fix findings before Phase 4.
2. Phase 2 late-indexing run, on or after 2026-10-19: `node scripts/openalex-run.mjs --from 2025-10-12 --out run3.json`, compare with `run.json` (needs the owner's key).
3. Phase 4: weekly dashboard note (must render the Unchecked list, BACKLOG)
4. Phase 5: Zotero sync (one real sync of one paper)
5. Phase 6: read state and archive
6. Phase 7: schedule, commands, ribbon
7. Phase 8: Lab Kit side (in the Lab Kit repo, its own session and plan)
8. Phase 9: release (owner's call)

## Running: none

## Waiting on owner (needs a human)
- [ ] Phase 3 in Obsidian: `npm run dev`, open `test-vault`, enable Literature Feed, go through BACKLOG → Not yet tested (Phase 3 and Phase 0 items); Test needs your OpenAlex key typed into the tab (about $0.004)
- [ ] Check the lipoic feed terms in `docs/feeds/lipoic-acid-copolymers.json` (my reading of the plan) and the choices in BACKLOG → Decisions needed
- [ ] Review PR #1 (johnsonolly4/literature-feed); merge when happy
- [ ] Push `feat/openalex-client` and `feat/settings-tab` and open PRs when you want them (not pushed; each sits on the one before)
- [ ] Before Phase 5: Zotero API key with write access to My Library, and the user ID (API keys part of the zotero.org account settings)
- [ ] Keys go into the plugin's settings in `test-vault` only, never into chat

## Known issues
- `npm install` reports 9 audit findings (6 moderate, 1 high, 2 critical), all in dev dependencies (same tooling versions as Lab Kit); nothing is bundled into `main.js`. Not looked into: BACKLOG.
- `.claude/rules/obsidian-plugin.md` and `docs/reference/plugin-guidelines.md` are Lab Kit copies and still mention Lab Kit files that do not exist here (`src/node.ts`, `src/platform.ts`, the kit updater): BACKLOG.
