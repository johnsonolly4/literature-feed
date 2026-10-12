# Backlog

Open items only: done items are in `docs/changelog.md` and git history. New open questions from the plan go here.
When an item is chosen, move it to `STATUS.md` → Next.

## TOP

## Decisions needed

## Bugs

## Quick changes
- [ ] Trim the Lab Kit copies: `.claude/rules/obsidian-plugin.md` (mentions `src/node.ts`, `src/platform.ts`, `hasNode()`) and `docs/reference/plugin-guidelines.md:68` (kit updater). Left as copied in Phase 0 on purpose; adjust when this plugin has its own helpers.
- [ ] Look at the 9 `npm audit` findings from `npm install` (6 moderate, 1 high, 2 critical; dev dependencies only, versions as in Lab Kit). Do not run `npm audit fix --force` blind.
- [ ] npm warns that the install scripts of `esbuild` (0.24.2 and 0.21.5) are not on an allow list (`npm install-scripts`); build and `npm run dev` work without. Decide whether to approve them.

## Not yet tested by the user
- [ ] Phase 0: the plugin loads and unloads in `test-vault` (`npm run dev`, enable Literature Feed). Only the build, the unit test and lint were run.

## Future features
