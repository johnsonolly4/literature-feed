// The rows of the citation-gaps report: one row per gap work (first and second level together), and the columns, chips and sort of
// the Works and Authors tables. Pure: the panel only draws them (with the UI kit's DataTable).
import { shortOpenAlexId } from "../inbox/write";
import type { Flags } from "./flags";
import { authorKey, couldHaveBeenCited, type AuthorRow } from "./gaps-authors";
import type { GapsRun } from "./gaps-fetch";
import type { Chip, ColumnSpec } from "../ui/table-model";

export interface WorkRow {
  /** A stable key: the OpenAlex id. */
  key: string;
  title: string;
  doi: string | null;
  authors: string[];
  year: number | null;
  citedBy: number | null;
  level: 1 | 2;
  /** How many of the references (level 1) or shared works (level 2) cite it, and out of how many. */
  count: number;
  of: number;
  share: number;
  flags: Flags;
  timing: "before" | "after" | "unknown";
}

/** The gap works as rows, the first level then the second. `flagsOf` gives what the reader already has of each. */
export function buildWorkRows(run: GapsRun, flagsOf: (list: GapsRun["gaps"]) => Flags[]): WorkRow[] {
  const paperYear = run.subject?.year ?? null;
  const rows: WorkRow[] = [];
  const add = (list: GapsRun["gaps"], level: 1 | 2, of: number): void => {
    const flags = flagsOf(list);
    list.forEach((g, i) => {
      const p = g.paper;
      const year = p?.year ?? null;
      rows.push({
        key: `${level}:${p ? (shortOpenAlexId(p.openalexId) ?? g.gap.id) : g.gap.id}`, title: p ? p.title : g.gap.id, doi: p?.doi ?? null, authors: p?.authors ?? [], year,
        citedBy: p?.citedByCount ?? null, level, count: g.gap.count, of, share: g.gap.share,
        flags: flags[i] ?? { zotero: null, vault: null, listedBefore: [] }, timing: couldHaveBeenCited(year, paperYear),
      });
    });
  };
  add(run.gaps, 1, run.referencesWithLists);
  if (run.deeper) add(run.deeper.gaps, 2, run.deeper.hubsWithLists);
  return rows;
}

export const WORK_CHIPS = (hasSecond: boolean, hasYear: boolean): Chip<WorkRow>[] => [
  { key: "all", label: "All", test: () => true },
  { key: "first", label: "First level", test: (r) => r.level === 1 },
  { key: "second", label: "Second level", test: (r) => r.level === 2, when: () => hasSecond },
  { key: "have", label: "In Zotero or vault", tone: "done", test: (r) => r.flags.zotero !== null || r.flags.vault !== null },
  { key: "missing", label: "Not in Zotero", tone: "waiting", test: (r) => r.flags.zotero === null },
  { key: "early", label: "Could have been cited", tone: "doing", test: (r) => r.timing === "before", when: () => hasYear },
];

const num = (n: number | null): number => n ?? -1;

export const WORK_COLUMNS: ColumnSpec<WorkRow>[] = [
  { key: "title", label: "Paper", sortable: true, compare: (a, b) => a.title.localeCompare(b.title), csv: (r) => r.title },
  { key: "year", label: "Year", sortable: true, compare: (a, b) => num(a.year) - num(b.year), csv: (r) => r.year ?? "" },
  { key: "count", label: "Cited by", sortable: true, compare: (a, b) => a.share - b.share, csv: (r) => `${r.count} of ${r.of}` },
  { key: "citations", label: "Citations", sortable: true, compare: (a, b) => num(a.citedBy) - num(b.citedBy), csv: (r) => r.citedBy ?? "" },
  { key: "level", label: "Level", sortable: true, compare: (a, b) => a.level - b.level, csv: (r) => r.level },
  { key: "have", label: "Have", csv: (r) => [r.flags.zotero ? "Zotero" : "", r.flags.vault ? "vault" : ""].filter((x) => x !== "").join(" + ") },
  { key: "doi", label: "DOI", csv: (r) => r.doi ?? "" },
];

export const workSearchText = (r: WorkRow): string => `${r.title} ${r.authors.join(" ")} ${r.year ?? ""}`;

export const AUTHOR_CHIPS: Chip<AuthorRow>[] = [
  { key: "all", label: "All", test: () => true },
  { key: "under", label: "Under-cited", tone: "waiting", test: (r) => r.label === "Under-cited" },
  { key: "over", label: "Over-cited", tone: "doing", test: (r) => r.label === "Over-cited" },
  { key: "own", label: "The paper's authors", tone: "done", test: (r) => r.own },
];

const pct = (n: number): string => `${n.toFixed(n > 0 && n < 10 ? 1 : 0)}%`;
export const pctText = pct;

export const AUTHOR_COLUMNS: ColumnSpec<AuthorRow>[] = [
  { key: "name", label: "Author", sortable: true, compare: (a, b) => a.name.localeCompare(b.name), csv: (r) => r.name },
  { key: "cited", label: "Cited", sortable: true, compare: (a, b) => a.cited - b.cited, csv: (r) => r.cited },
  { key: "citedPct", label: "% of cited", sortable: true, compare: (a, b) => a.citedPct - b.citedPct, csv: (r) => r.citedPct.toFixed(1) },
  { key: "uncited", label: "Uncited", sortable: true, compare: (a, b) => a.uncited - b.uncited, csv: (r) => r.uncited },
  { key: "uncitedPct", label: "% of uncited", sortable: true, compare: (a, b) => a.uncitedPct - b.uncitedPct, csv: (r) => r.uncitedPct.toFixed(1) },
  { key: "diff", label: "Difference", sortable: true, compare: (a, b) => Math.abs(a.diff) - Math.abs(b.diff), csv: (r) => r.diff.toFixed(1) },
  { key: "label", label: "", sortable: true, compare: (a, b) => a.label.localeCompare(b.label), csv: (r) => r.label },
];

export const authorSearchText = (r: AuthorRow): string => r.name;

/** The author row for a name, looked up by the family-name-and-initial key (null when none matches). */
export function findAuthorRow(rows: readonly AuthorRow[], name: string): AuthorRow | null {
  const key = authorKey(name);
  return key === "" ? null : (rows.find((r) => r.key === key) ?? null);
}
