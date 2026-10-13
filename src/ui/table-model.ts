// The logic behind every report table in the plugin (chips, search, sort, paging, CSV). Pure: no Obsidian, so it is tested directly.
// The reading inbox's table (`inbox/table.ts`) does the same for its own rows; reports built on the UI kit share this.

/** A chip filters the rows to those it accepts; `tone` colours it by meaning (the plugin's status palette). */
export interface Chip<T> {
  key: string;
  label: string;
  test: (row: T) => boolean;
  tone?: "neutral" | "doing" | "waiting" | "done" | "overdue";
  /** Shown only when this returns true (for chips that make no sense for every run). */
  when?: () => boolean;
}

export interface SortState {
  by: string;
  desc: boolean;
}

/** What the model needs to know about a column; the table adds how to draw it. */
export interface ColumnSpec<T> {
  key: string;
  label: string;
  sortable?: boolean;
  /** Ascending order of two rows; required when `sortable`. */
  compare?: (a: T, b: T) => number;
  /** The cell as a CSV value; columns without one are left out of the CSV. */
  csv?: (row: T) => string | number;
}

export interface ViewState {
  chip: string;
  query: string;
  sort: SortState;
}

export interface TableModel<T> {
  columns: readonly ColumnSpec<T>[];
  chips: readonly Chip<T>[];
  /** The text a search looks in. */
  searchText: (row: T) => string;
  /** Order of rows that compare equal (keeps the order stable). */
  fallback?: (a: T, b: T) => number;
}

/** Rows that pass the chip and the search, in the chosen order (reversed when `desc`; ties keep the fallback order). */
export function viewRows<T>(rows: readonly T[], model: TableModel<T>, view: ViewState): T[] {
  const chip = model.chips.find((c) => c.key === view.chip);
  const words = view.query.toLowerCase().split(/\s+/).filter((w) => w !== "");
  const kept = rows.filter((r) => {
    if (chip && !chip.test(r)) return false;
    if (words.length === 0) return true;
    const text = model.searchText(r).toLowerCase();
    return words.every((w) => text.includes(w));
  });
  const col = model.columns.find((c) => c.key === view.sort.by);
  const compare = col?.compare;
  if (!compare) return kept;
  const sign = view.sort.desc ? -1 : 1;
  const fallback = model.fallback ?? ((): number => 0);
  const index = new Map(rows.map((r, i) => [r, i]));
  return kept.sort((a, b) => sign * compare(a, b) || fallback(a, b) || (index.get(a) ?? 0) - (index.get(b) ?? 0));
}

/** How many rows each chip accepts (the search applies, so the numbers match what a click would show). */
export function chipCounts<T>(rows: readonly T[], model: TableModel<T>, query: string): Map<string, number> {
  const out = new Map<string, number>();
  for (const c of model.chips) out.set(c.key, viewRows(rows, model, { chip: c.key, query, sort: { by: "", desc: false } }).length);
  return out;
}

/** The sort after a click on a column header: a new column sorts ascending, the same one flips. */
export function nextSort(current: SortState, key: string): SortState {
  return { by: key, desc: current.by === key ? !current.desc : false };
}

/** The rows as CSV (columns that have a `csv`), quoted where needed. */
export function rowsToCsv<T>(rows: readonly T[], columns: readonly ColumnSpec<T>[]): string {
  const cols = columns.filter((c) => c.csv);
  const cell = (v: string | number): string => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  return [cols.map((c) => cell(c.label)).join(","), ...rows.map((r) => cols.map((c) => cell(c.csv?.(r) ?? "")).join(","))].join("\n");
}

/** The stored view, made safe: unknown chips or columns fall back to the defaults. */
export function normaliseView<T>(raw: unknown, model: TableModel<T>, fallback: ViewState): ViewState {
  if (typeof raw !== "object" || raw === null) return fallback;
  const r = raw as { chip?: unknown; query?: unknown; sort?: { by?: unknown; desc?: unknown } };
  const chip = typeof r.chip === "string" && model.chips.some((c) => c.key === r.chip) ? r.chip : fallback.chip;
  const valid = typeof r.sort?.by === "string" && model.columns.some((c) => c.key === r.sort?.by && c.sortable);
  const sort = valid ? { by: r.sort?.by as string, desc: r.sort?.desc === true } : fallback.sort;
  return { chip, query: typeof r.query === "string" ? r.query : "", sort };
}
