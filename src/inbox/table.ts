// What the reading-inbox table shows: a status for each paper, an order, a filter, and when a paper is about to age out.
// Pure: no Obsidian. The colours of the statuses are Lab Kit's palette by meaning (styles.css): New slate (not started),
// Ticked blue (doing now), In Zotero amber (waiting), Read and Processed green (finished), red only for "ages out soon".
import { addDays } from "./scan";
import { noteWeekStart } from "./state";
import type { ListedTier, ParsedPaper } from "./write";

export type PaperStatus = "new" | "ticked" | "in-zotero" | "read" | "processed" | "dismissed";

export const STATUS_LABEL: Record<PaperStatus, string> = {
  new: "New", ticked: "Ticked", "in-zotero": "In Zotero", read: "Read", processed: "Processed", dismissed: "Dismissed",
};

/** To read first, then what is being sent, then new papers, then finished ones, then dismissed ones. */
const STATUS_RANK: Record<PaperStatus, number> = { "in-zotero": 0, ticked: 1, new: 2, read: 3, processed: 4, dismissed: 5 };
const TIER_RANK: Record<ListedTier, number> = { priority: 0, strong: 1, possible: 2, unchecked: 3 };

export const TIER_LABEL: Record<ListedTier, string> = { priority: "Priority", strong: "Strong", possible: "Possible", unchecked: "No abstract" };

/**
 * Dismissed (the user rejected it, at any stage) wins over everything. Then Read (a literature note exists), Processed when
 * that note's takeaway line is filled. Otherwise: in Zotero (sent and ticked), Ticked (ticked and waiting to be sent, or
 * unticked in the "In Zotero" list to be sent again), else New.
 */
export function paperStatus(p: ParsedPaper, processed: boolean): PaperStatus {
  if (p.dismissed) return "dismissed";
  if (p.read) return processed ? "processed" : "read";
  if (p.synced && p.ticked) return "in-zotero";
  if (p.synced || p.ticked) return "ticked";
  return "new";
}

export interface TableRow {
  paper: ParsedPaper;
  status: PaperStatus;
  /** Position in the note, for a stable order. */
  index: number;
}

export type SortKey = "status" | "paper" | "tier" | "year";
export interface SortSetting {
  by: SortKey;
  desc: boolean;
}
export type FilterKey = "all" | PaperStatus;

export const DEFAULT_SORT: SortSetting = { by: "status", desc: false };

export function makeRows(papers: readonly ParsedPaper[], processed: ReadonlySet<string>): TableRow[] {
  return papers.map((paper, index) => ({
    paper, index, status: paperStatus(paper, processed.has(`${paper.feedId}|${paper.openalexId}`)),
  }));
}

function byDefault(a: TableRow, b: TableRow): number {
  return STATUS_RANK[a.status] - STATUS_RANK[b.status]
    || TIER_RANK[a.paper.tier] - TIER_RANK[b.paper.tier]
    || a.index - b.index;
}

/** The rows in order. The chosen column first (reversed when `desc`), then the default order for ties. */
export function orderRows(rows: readonly TableRow[], sort: SortSetting = DEFAULT_SORT): TableRow[] {
  const sign = sort.desc ? -1 : 1;
  const primary = (a: TableRow, b: TableRow): number => {
    switch (sort.by) {
      case "status": return STATUS_RANK[a.status] - STATUS_RANK[b.status];
      case "tier": return TIER_RANK[a.paper.tier] - TIER_RANK[b.paper.tier];
      case "paper": return a.paper.title.localeCompare(b.paper.title);
      case "year": return (a.paper.year ?? 0) - (b.paper.year ?? 0);
    }
  };
  return [...rows].sort((a, b) => sign * primary(a, b) || byDefault(a, b));
}

/** Rows with the chosen status (or all), and only those of one feed when `feedId` is given. */
export function filterRows(rows: readonly TableRow[], filter: FilterKey, feedId: string | null = null): TableRow[] {
  return rows.filter((r) => (filter === "all" || r.status === filter) && (feedId === null || r.paper.feedId === feedId));
}

/** For each OpenAlex id, the searches that list it (only ids listed under more than one search are kept). */
export function sharedPapers(rows: readonly TableRow[]): Map<string, string[]> {
  const all = new Map<string, string[]>();
  for (const { paper } of rows) {
    const feeds = all.get(paper.openalexId) ?? [];
    if (!feeds.includes(paper.feedId)) feeds.push(paper.feedId);
    all.set(paper.openalexId, feeds);
  }
  for (const [id, feeds] of all) if (feeds.length < 2) all.delete(id);
  return all;
}

export function countsByStatus(rows: readonly TableRow[]): Record<FilterKey, number> {
  const counts: Record<FilterKey, number> = { all: rows.length, new: 0, ticked: 0, "in-zotero": 0, read: 0, processed: 0, dismissed: 0 };
  for (const r of rows) counts[r.status]++;
  return counts;
}

/**
 * True for a paper that is still New or In Zotero (not read) during the last week before it counts as done by age (its note's
 * week ended N weeks ago; see `unfinishedPapers`). Lab Kit's red means overdue only, and this is the one overdue case.
 */
export function agesOutSoon(status: PaperStatus, noteName: string, today: string, dismissAfterWeeks: number): boolean {
  if (status !== "new" && status !== "in-zotero") return false;
  const start = noteWeekStart(noteName);
  if (start === null) return false;
  const agedFrom = addDays(start, 7 + dismissAfterWeeks * 7);
  return today >= addDays(agedFrom, -7) && today < agedFrom;
}

/**
 * Whether a literature note has its takeaway filled in: Lab Kit's `[takeaway:: one line]` (also in round brackets, or on a
 * line of its own). An empty field, as the template leaves it, means the paper is still to process.
 */
export function takeawayFilled(noteText: string): boolean {
  for (const m of noteText.matchAll(/\btakeaway::[ \t]*([^\])\n]*)/g)) {
    if (m[1].trim() !== "") return true;
  }
  return false;
}
