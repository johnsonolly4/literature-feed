# Doc-sync table: after a change, update these

Claude: check this table at the end of every session (routine step 2).

| If you changed… | Also update |
|---|---|
| Matching, API clients or sync (`src/match/`, `src/openalex/`, `src/zotero/`) | A test against `tests/fixtures/` (no keys or personal data in recorded responses) |
| Anything user-visible (feature, setting, wording) | `docs/changelog.md` under the next version |
| Settings (`src/settings/`) | `README.md` |
| A host the plugin calls, or what is sent to it | `README.md` → Network use (and the store disclosure at release) |
| A feature that needs a look inside Obsidian | `BACKLOG.md` → Not yet tested |
| A folder or entry file added, moved or removed | `docs/architecture.md` |
| A command in `package.json` | `CLAUDE.md` → Commands, `README.md` → Development |
| The version | Nothing by hand: only `/release` moves it |
| A user test result (chat, screenshot, feedback note) | `BACKLOG.md`: tick what it confirms (date + source), add what is broken; STATUS → Now alone is not enough |
| A decision (method, scope, rule) | One line in `docs/decisions.md` |
| A plan phase finished or changed | The plan's phase text and `STATUS.md` → Next |

Never copy code into docs. Link to the file instead: copies drift.
