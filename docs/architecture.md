# Architecture: where things are

Update this when a folder or entry file is added, moved or removed. The planned layout is in `docs/plans/literature-feed.md` (Files of each phase); this page lists only what exists.

- `src/main.ts`: plugin entry. Loads and unloads; registers nothing yet (Phase 0).
- `src/match/`: the matching engine, pure (no Obsidian imports; a test checks). `feed.ts` types, `score.ts` text normalisation, both spellings, phrase match and the tier rules, `dedupe.ts` DOI then title, journal over preprint (Phase 1).
- `src/openalex/client.ts`: OpenAlex client (Phase 2). No Obsidian imports: the caller passes in a `Requester` and a `sleep`. Builds the search URL, pages, backs off on 429, sums `meta.cost_usd`, maps works to `Candidate` (a `Paper` plus authors, venue, OpenAlex id). Not wired into `main.ts` yet.
- `scripts/openalex-run.mjs`: the real run against the live API (needs `OPENALEX_API_KEY`); bundles the client with esbuild, prints count and cost per topic, writes nothing. Not part of the plugin.
- `tests/`: vitest. `tests/openalex.test.ts` tests the client with `tests/fixtures/openalex-responses.ts` (hand-written) and `tests/fixtures/openalex-recorded.json` (one real work, authors replaced). `tests/score.test.ts` and `tests/dedupe.test.ts` test the engine; `tests/fixtures/` holds the lipoic acid feed and hand-written paper cases with a known tier each. `tests/helpers/obsidian-stub.ts` is the runtime stand-in for the `obsidian` package.
- `test-vault/`: dev vault. Only `Welcome.md` is tracked.
