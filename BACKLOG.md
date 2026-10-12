# Backlog

Open items only: done items are in `docs/changelog.md` and git history. New open questions from the plan go here.
When an item is chosen, move it to `STATUS.md` → Next.

## TOP

## Decisions needed
Phase 1 took these where the plan was silent (approved in plan mode 2026-10-12 as part of the Phase 1 plan; confirm or change):
- [ ] A **lower** term counts once per paper, however many match (`src/match/score.ts`, `scorePaper`).
- [ ] A feed with **no required group** scores every non-dropped paper Possible (same function). Phase 3 may want to refuse such a feed.
- [ ] Group term lists of the lipoic acid feed are my reading of the plan, test data only (`tests/fixtures/lipoic-feed.ts`). The real importable feed JSON in `docs/feeds/` is still to be written; check its terms then.
- [ ] Dedupe merges any two papers with the same normalised title, even if both are journal articles with different DOIs (`src/match/dedupe.ts`). Fine for this feed; revisit if generic titles appear.
- [ ] Matching is whole-word with a plural `s`/`es` on the last word and -ise/-ize, -yse/-yze spellings only; no other stemming (`polymerised` does not match `polymerisation`). List such forms as terms.

## Bugs

## Quick changes
- [ ] Trim the Lab Kit copies: `.claude/rules/obsidian-plugin.md` (mentions `src/node.ts`, `src/platform.ts`, `hasNode()`) and `docs/reference/plugin-guidelines.md:68` (kit updater). Left as copied in Phase 0 on purpose; adjust when this plugin has its own helpers.
- [ ] Look at the 9 `npm audit` findings from `npm install` (6 moderate, 1 high, 2 critical; dev dependencies only, versions as in Lab Kit). Do not run `npm audit fix --force` blind.
- [ ] npm warns that the install scripts of `esbuild` (0.24.2 and 0.21.5) are not on an allow list (`npm install-scripts`); build and `npm run dev` work without. Decide whether to approve them.

## Not yet tested by the user
- [ ] Phase 0: the plugin loads and unloads in `test-vault` (`npm run dev`, enable Literature Feed). Only the build, the unit test and lint were run.

## Future features
