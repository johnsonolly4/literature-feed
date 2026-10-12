# Architecture: where things are

Update this when a folder or entry file is added, moved or removed. The planned layout is in `docs/plans/literature-feed.md` (Files of each phase); this page lists only what exists.

- `src/main.ts`: plugin entry. Loads and unloads; registers nothing yet (Phase 0).
- `src/match/`: the matching engine, pure (no Obsidian imports; a test checks). `feed.ts` types, `score.ts` text normalisation, both spellings, phrase match and the tier rules, `dedupe.ts` DOI then title, journal over preprint (Phase 1).
- `tests/`: vitest. `tests/score.test.ts` and `tests/dedupe.test.ts` test the engine; `tests/fixtures/` holds the lipoic acid feed and hand-written paper cases with a known tier each. `tests/helpers/obsidian-stub.ts` is the runtime stand-in for the `obsidian` package.
- `test-vault/`: dev vault. Only `Welcome.md` is tracked.
