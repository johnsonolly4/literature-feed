# Architecture: where things are

Update this when a folder or entry file is added, moved or removed. The planned layout is in `docs/plans/literature-feed.md` (Files of each phase); this page lists only what exists.

- `src/main.ts`: plugin entry. Loads and unloads; registers nothing yet (Phase 0).
- `tests/`: vitest. `tests/helpers/obsidian-stub.ts` is the runtime stand-in for the `obsidian` package.
- `test-vault/`: dev vault. Only `Welcome.md` is tracked.
