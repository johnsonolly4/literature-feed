# UI kit (`src/ui/`)

One look and one set of mechanisms for every search report. Built with `createEl` only; logic that can be tested is kept apart from DOM.

| Piece | File | What it gives |
| --- | --- | --- |
| Table model | `table-model.ts` | chips with counts, search (all words), sort, CSV, stored-view repair. Pure; tests in `tests/ui-table-model.test.ts`. |
| `DataTable` | `data-table.ts` | the table: chips, search box, sortable headers, show more, Copy as CSV, row selection, remembered view (`app.saveLocalStorage`). Columns marked `secondary` hide when narrow. |
| `Section` / `formGrid` | `section.ts` | titled, foldable card (remembers open/closed); a grid for short options. |
| `SplitPane` | `split-pane.ts` | table left, detail right (sticky, own scroll); stacks in a narrow tab (container query in `styles.css`). |
| `ReportBar` | `report-bar.ts` | status lines and buttons above a report. |
| `PromptPanel` | `prompt-panel.ts` | show / copy / save the prompt, paste the answer, check it. |
| Report block | `report-block.ts`, `report-view.ts` | a note holds a `literature-feed-report` snapshot `{kind, version, data, summary}`; a button, the command **Open this note's report view** and the ribbon menu reopen the view. Kinds are registered in `main.ts` (`reportKinds`). |

## Adding a search to the kit
1. Rows and columns as pure data (see `review/gaps-rows.ts`): `ColumnSpec` (key, label, compare, csv), `Chip` (key, label, test, tone).
2. Draw with `DataTable` inside a `SplitPane`; put the options in a `Section`; the report's actions in a `ReportBar`.
3. For the LLM step: a pure prompt builder and answer checker (see `review/authors-prompt.ts`), shown with `PromptPanel`.
4. To reopen from the note: write `reportBlock(kind, snapshot, summary)` into the note, register `{label, open}` in `reportKinds`. Keep the snapshot small (drop abstracts).
5. Colours only from `styles.css` tokens (`--vt-*` with Obsidian fallbacks; chip `tone-*`).

## Not migrated yet
Inbox block table and cards (`inbox/block.ts`), review window result lists (`review/window.ts`), refs panel, graph side panels, settings tab and modals. They look right already; moving them is mechanical but should be checked against screenshots in Obsidian.
