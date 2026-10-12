# Status
_Updated: 2026-10-12 (Phase 4 session). Cap 40 lines. History lives in git and `docs/changelog.md`, not here._

**Version:** 0.0.1 (moves only at `/release`; TypeScript in `src/`)

## Now
Phases 0 and 1 done (matching engine, `feat/matching-engine`, pushed, PR johnsonolly4/literature-feed#1 open). Phase 2 (OpenAlex client, `feat/openalex-client`) done except the late-indexing run, which needs a run on or after 2026-10-19 (BACKLOG). Phase 3 (settings tab, keys in Obsidian's secret storage, `feat/settings-tab`): the owner confirmed Test works; the rest of its checklist is still open (BACKLOG → Not yet tested). None of these three branches is pushed.
Phase 4 (weekly reading-inbox note) **code done; seen in Obsidian 2026-10-12 (dark theme): first scan, note, ticking, rescan after a delete, and the Home card all work; the card styling changes, last-scan line, per-feed rows, light theme, Unchecked list and Notice text are not yet checked** on `feat/inbox-note` (cut from `feat/settings-tab`, committed, not pushed): `src/inbox/` (`write.ts`, `scan.ts`, `block.ts`), the **Scan now** command in `src/main.ts`, `styles.css`, `lastScan` and `seen` in the settings. Since then, at the owner's request: Lab Kit-style buttons and card (flat inside a callout), a last-scan line with the dropped count, per-feed rows when more than one feed is on, papers counted once across feeds. 175 tests pass, lint 0 errors 0 warnings, build passes. The pure parts are unit-tested; the code block, the command and the note writing are not. What to look at: BACKLOG → Not yet tested (Phase 4) and → Phase 4 findings. Nothing was run against Zotero.

## Next (ordered: top item is the next session; plan: `docs/plans/literature-feed.md`)
1. Phase 4 check in Obsidian: owner runs **Scan now** in `test-vault` and goes through the BACKLOG list, then `/feedback` with what looks wrong. Fix findings before Phase 5. (Open Phase 3 checklist items can be done at the same time.)
2. Phase 2 late-indexing run, on or after 2026-10-19: `node scripts/openalex-run.mjs --from 2025-10-12 --out run3.json`, compare with `run.json` (needs the owner's key)
3. Phase 5: Zotero sync (one real sync of one paper); needs the Zotero key and user ID
4. Phase 6: read state and archive
5. Phase 7: schedule, ribbon, start-up scan (the **Scan now** command already exists)
6. Phase 8: Lab Kit side (in the Lab Kit repo, its own session and plan)
7. Phase 9: release (owner's call)

## Running: none

## Waiting on owner (needs a human)
- [ ] Phase 4 in Obsidian: `npm run dev`, reload Obsidian with `test-vault`, switch the lipoic feed on, run **Scan now** (about $0.004 to $0.01), go through BACKLOG → Not yet tested (Phase 4, then the open Phase 3 and Phase 0 items)
- [ ] Check the lipoic feed terms in `docs/feeds/lipoic-acid-copolymers.json` (my reading of the plan) and the choices in BACKLOG → Decisions needed
- [ ] Review PR #1 (johnsonolly4/literature-feed); merge when happy
- [ ] Push `feat/openalex-client`, `feat/settings-tab` and `feat/inbox-note` and open PRs when you want them (not pushed; each sits on the one before)
- [ ] Before Phase 5: Zotero API key with write access to My Library, and the user ID (API keys part of the zotero.org account settings)
- [ ] Keys go into Obsidian's secret storage via the plugin's settings in `test-vault` only, never into chat. Secrets are per device: choose them again on another machine

## Known issues
- `npm install` reports 9 audit findings (6 moderate, 1 high, 2 critical), all in dev dependencies (same tooling versions as Lab Kit); nothing is bundled into `main.js`. Not looked into: BACKLOG.
- `.claude/rules/obsidian-plugin.md` and `docs/reference/plugin-guidelines.md` are Lab Kit copies and still mention Lab Kit files that do not exist here (`src/node.ts`, `src/platform.ts`, the kit updater): BACKLOG.
