# Status
_Updated: 2026-10-12 (Phase 0 session). Cap 40 lines. History lives in git and `docs/changelog.md`, not here._

**Version:** 0.0.1 (moves only at `/release`; TypeScript in `src/`)

## Now
Phase 0 (repo scaffold) done 2026-10-12: `npm run build`, `npm test` (2 tests) and `npm run lint` pass with 0 errors, 0 warnings; `npm run dev` writes the plugin into `test-vault/.obsidian/plugins/literature-feed/`. Not seen in Obsidian: loading the plugin in `test-vault` is still to be done by the owner (see Waiting on owner). Nothing run against OpenAlex or Zotero.
Phase 1 (matching engine, pure) done 2026-10-12 on `feat/matching-engine`, not pushed: `src/match/` (feed, score, dedupe), 55 new tests (57 in all), lint and build pass. Pure code: nothing to see in Obsidian. Rules I chose where the plan was silent: BACKLOG → Decisions needed.

## Next (ordered: top item is the next session; plan: `docs/plans/literature-feed.md`)
1. Push `feat/matching-engine` and open a PR (owner says "push")
2. Phase 2: OpenAlex client (one real run with the owner's key)
3. Phase 3: settings tab
4. Phase 4: weekly dashboard note
5. Phase 5: Zotero sync (one real sync of one paper)
6. Phase 6: read state and archive
7. Phase 7: schedule, commands, ribbon
8. Phase 8: Lab Kit side (in the Lab Kit repo, its own session and plan)
9. Phase 9: release (owner's call)

## Running: none

## Waiting on owner (needs a human)
- [ ] Say "push" to push `feat/matching-engine` and open a PR; confirm or change the five rules in BACKLOG → Decisions needed
- [ ] Turn on the plugin in `test-vault`: `npm run dev`, open `test-vault` in Obsidian, enable Literature Feed (then BACKLOG "Not yet tested": plugin loads)
- [ ] Before Phase 2: free OpenAlex account, copy the API key from `openalex.org/settings/api`
- [ ] Before Phase 5: Zotero API key with write access to My Library, and the user ID (API keys part of the zotero.org account settings)
- [ ] Keys go into the plugin's settings in `test-vault` only

## Known issues
- `npm install` reports 9 audit findings (6 moderate, 1 high, 2 critical), all in dev dependencies (same tooling versions as Lab Kit); nothing is bundled into `main.js`. Not looked into: BACKLOG.
- `.claude/rules/obsidian-plugin.md` and `docs/reference/plugin-guidelines.md` are Lab Kit copies and still mention Lab Kit files that do not exist here (`src/node.ts`, `src/platform.ts`, the kit updater): BACKLOG.
