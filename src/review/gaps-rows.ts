// The rows of the citation-gaps report: one row per gap work (first and second level together), and the columns, chips and sort of
// the Works and Authors tables. Pure: the panel only draws them (with the UI kit's DataTable).
import { shortOpenAlexId } from "../inbox/write";
import type { Flags } from "./flags";
import { authorKey, couldHaveBeenCited, type AuthorRow } from "./gaps-authors";
import type { GapsRun } from "./gaps-fetch";
import { gapPoints } from "./neighbours";
import { reviewFlag, type ReviewFlag } from "./review-flag";
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
  /** Probably a review article, with the reason. A pointer only. */
  review: ReviewFlag;
  /** How many of the citing references this work has per citation it has received (count / citations); null without citations. High = few others cite it. */
  niche: number | null;
  /** Where the niche value stands among the rows that have one, 0 to 100; null without one. */
  nichePct: number | null;
  /** Which route found it: the references (signal 1), the neighbours (signal 2b), or both. Without a scan every row is "refs". */
  route: "refs" | "both" | "similar";
  /** How many of the neighbours cite it, and out of how many; null when the scan did not list it (or did not run). */
  similarCount: number | null;
  similarOf: number | null;
  /** Share of the neighbours minus share of the references that cite it, in percentage points; null when only one route covers it. */
  gap: number | null;
}

/** Percentile (0 to 100, share of other values that are lower) of each value; null stays null. */
export function percentiles(values: readonly (number | null)[]): (number | null)[] {
  const have = values.filter((v): v is number => v !== null);
  return values.map((v) => (v === null || have.length < 2 ? null : (have.filter((o) => o < v).length / (have.length - 1)) * 100));
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
        review: reviewFlag({ type: p?.workType, venue: p?.venue, title: p?.title, referenceCount: p?.referencedWorks?.length ?? null, pages: p?.pages }),
        niche: p?.citedByCount && g.gap.count > 0 ? g.gap.count / p.citedByCount : null, nichePct: null,
        route: "refs", similarCount: null, similarOf: null, gap: null,
      });
    });
  };
  add(run.gaps, 1, run.referencesWithLists);
  if (run.deeper) add(run.deeper.gaps, 2, run.deeper.hubsWithLists);
  const sim = run.similar && !run.similar.skipped ? run.similar : null;
  if (sim) {
    const found = new Map(sim.rows.map((r) => [r.gap.id, r.gap] as const));
    for (const row of rows) {
      const id = row.key.slice(row.key.indexOf(":") + 1);
      const hit = row.level === 1 ? found.get(id) : undefined;
      if (hit) Object.assign(row, { route: "both", similarCount: hit.count, similarOf: sim.neighbours, gap: gapPoints(hit.share, row.share) });
    }
    const have = new Set(rows.filter((r) => r.level === 1).map((r) => r.key.slice(2)));
    const extra = sim.rows.filter((r) => !have.has(r.gap.id)).map((r) => ({ gap: { id: r.gap.id, count: 0, share: 0 }, paper: r.paper, via: r.gap }));
    const flags = flagsOf(extra);
    extra.forEach((x, i) => {
      const p = x.paper;
      const year = p?.year ?? null;
      rows.push({
        key: `s:${p ? (shortOpenAlexId(p.openalexId) ?? x.gap.id) : x.gap.id}`, title: p ? p.title : x.gap.id, doi: p?.doi ?? null, authors: p?.authors ?? [], year,
        citedBy: p?.citedByCount ?? null, level: 1, count: 0, of: run.referencesWithLists, share: 0,
        flags: flags[i] ?? { zotero: null, vault: null, listedBefore: [] }, timing: couldHaveBeenCited(year, paperYear),
        review: reviewFlag({ type: p?.workType, venue: p?.venue, title: p?.title, referenceCount: p?.referencedWorks?.length ?? null, pages: p?.pages }),
        niche: null, nichePct: null, route: "similar", similarCount: x.via.count, similarOf: sim.neighbours, gap: gapPoints(x.via.share, 0),
      });
    });
  }
  const pct = percentiles(rows.map((r) => r.niche));
  rows.forEach((r, i) => { r.nichePct = pct[i]; });
  return rows;
}

export const WORK_CHIPS = (hasSecond: boolean, hasYear: boolean, hasScan = false): Chip<WorkRow>[] => [
  { key: "all", label: "All", test: () => true },
  { key: "first", label: "First level", test: (r) => r.level === 1 && r.route !== "similar" },
  { key: "both", label: "Both routes", tone: "done", test: (r) => r.route === "both", when: () => hasScan },
  { key: "similar", label: "From similar papers", test: (r) => r.route !== "refs", when: () => hasScan },
  { key: "second", label: "Second level", test: (r) => r.level === 2, when: () => hasSecond },
  { key: "have", label: "In Zotero or vault", tone: "done", test: (r) => r.flags.zotero !== null || r.flags.vault !== null },
  { key: "missing", label: "Not in Zotero", tone: "waiting", test: (r) => r.flags.zotero === null },
  { key: "early", label: "Could have been cited", tone: "doing", test: (r) => r.timing === "before", when: () => hasYear },
  { key: "reviews", label: "Reviews", test: (r) => r.review.level !== "" },
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
  { key: "review", label: "Review?", csv: (r) => (r.review.level === "" ? "" : `${r.review.level === "sure" ? "review" : "possible review"} (${r.review.reason})`) },
  { key: "niche", label: "Niche", sortable: true, compare: (a, b) => num(a.niche) - num(b.niche), csv: (r) => (r.niche === null ? "" : `${r.niche.toFixed(3)} (percentile ${Math.round(r.nichePct ?? 0)})`) },
  { key: "similar", label: "Similar papers", sortable: true, compare: (a, b) => num(a.similarCount) - num(b.similarCount), csv: (r) => (r.similarCount === null ? "" : `${r.similarCount} of ${r.similarOf ?? ""}`) },
  { key: "gap", label: "Gap", sortable: true, compare: (a, b) => (a.gap ?? -Infinity) - (b.gap ?? -Infinity), csv: (r) => (r.gap === null ? "" : r.gap.toFixed(0)) },
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
