# Status
_Updated: 2026-10-12 (Phase 5 session). Cap 40 lines. History lives in git and `docs/changelog.md`, not here._

**Version:** 0.0.1 (moves only at `/release`; TypeScript in `src/`)

## Now
Phases 0 and 1 done (matching engine, `feat/matching-engine`, pushed, PR johnsonolly4/literature-feed#1 open). Phase 2 (OpenAlex client, `feat/openalex-client`) done except the late-indexing run, which needs a run on or after 2026-10-19 (BACKLOG). Phase 3 (settings tab, keys in Obsidian's secret storage, `feat/settings-tab`): the owner confirmed Test works; the rest of its checklist is still open (BACKLOG → Not yet tested). None of these three branches is pushed.
Phase 4 (weekly reading-inbox note, `feat/inbox-note`) seen working in Obsidian 2026-10-12 (dark theme): scan, note, ticking, rescan, Home card; later changes (card styling, last-scan line, per-feed rows, light theme, Unchecked list) not yet checked (BACKLOG).
Phase 5 (Zotero sync) **code done; first real run partly worked (collections created, paper failed with HTTP 400, being diagnosed)** on `feat/zotero-sync` (cut from `feat/inbox-note`, committed, not pushed): `src/zotero/` (`client.ts`, `map.ts`, `request.ts`), `src/inbox/sync.ts`, `markSynced` in `write.ts`, `getWork` in the OpenAlex client, the command **Sync ticked papers** and the enabled **Sync** button. 221 tests pass, lint 0 errors 0 warnings, build passes; Zotero responses in the tests are hand-written to the documented shapes. First real run (owner, 2026-10-12): the confirm window and collection creation worked (both collections now exist in the real library); the paper itself failed with HTTP 400, cause unknown. Errors now say which step failed and why; next step is to press Sync again and read the Notice (BACKLOG → Phase 5). ZotLit reads Zotero desktop's local database, so a synced paper reaches ZotLit only after desktop's own sync.

## Next (ordered: top item is the next session; plan: `docs/plans/literature-feed.md`)
1. Owner checks in Obsidian: Phase 5 first (one real sync of one paper, BACKLOG → Phase 5), then the open Phase 4 and Phase 3 items; `/feedback` with what looks wrong. Fix findings, then record the real Zotero responses as fixtures.
2. Phase 2 late-indexing run, on or after 2026-10-19: `node scripts/openalex-run.mjs --from 2025-10-12 --out run3.json`, compare with `run.json` (needs the owner's key)
3. Phase 6: read state and archive
4. Phase 7: schedule, ribbon, start-up scan and start-up sync (the **Scan now** and **Sync ticked papers** commands already exist)
5. Phase 8: Lab Kit side (in the Lab Kit repo, its own session and plan)
6. Phase 9: release (owner's call)

## Running: none

## Waiting on owner (needs a human)
- [ ] Phase 5 in Obsidian: `npm run dev`, reload Obsidian with `test-vault`, make sure the Zotero key (secret) and user ID are set, tick one paper, press **Sync**, check Zotero and the note (BACKLOG → Phase 5). Then the open Phase 4, Phase 3 and Phase 0 items
- [ ] Check the lipoic feed terms in `docs/feeds/lipoic-acid-copolymers.json` (my reading of the plan) and the choices in BACKLOG → Decisions needed
- [ ] Review PR #1 (johnsonolly4/literature-feed); merge when happy
- [ ] Push `feat/openalex-client`, `feat/settings-tab`, `feat/inbox-note` and `feat/zotero-sync` and open PRs when you want them (not pushed; each sits on the one before)
- [ ] Keys go into Obsidian's secret storage via the plugin's settings in `test-vault` only, never into chat. Secrets are per device: choose them again on another machine

## Known issues
- `npm install` reports 9 audit findings (6 moderate, 1 high, 2 critical), all in dev dependencies (same tooling versions as Lab Kit); nothing is bundled into `main.js`. Not looked into: BACKLOG.
- `.claude/rules/obsidian-plugin.md` and `docs/reference/plugin-guidelines.md` are Lab Kit copies and still mention Lab Kit files that do not exist here (`src/node.ts`, `src/platform.ts`, the kit updater): BACKLOG.
