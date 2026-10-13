// The models behind the cards in the reading-inbox note (one per search) and the summary on the home card. Pure: no Obsidian.
// Status colours are Lab Kit's palette by meaning (styles.css): amber = waiting to be read, blue = ticked, slate = new, green = read.
import type { FeedConfig, ScanCounts } from "../settings/data";
import { orderRows, type TableRow } from "./table";

export const DEFAULT_LIMIT = 3;
export const MAX_LIMIT = 20;

/** Papers per status for a set of rows; `read` includes processed ones. */
export interface StatusCounts {
  toRead: number;
  ticked: number;
  new: number;
  read: number;
}

export interface FeedCard {
  feedId: string;
  name: string;
  /** "4 topics · last scan 2026-10-12: 3 new, 7 dropped": the parts that are known, joined. */
  description: string;
  /** The first papers waiting to be read (In Zotero, not read), in the table's default order. */
  toRead: TableRow[];
  /** How many more are waiting beyond `toRead`. */
  moreToRead: number;
  counts: StatusCounts;
  /** Listed = the feed's lines in the note; ticked = ticked, sent, read or processed (interest shown); read = read or processed. */
  funnel: { listed: number; ticked: number; read: number };
  /** Percent of the feed's papers per status. They sum to 100, or are all 0 when there are no papers. */
  bar: StatusCounts;
  badge: { text: string; waiting: boolean };
}

export function summariseRows(rows: readonly TableRow[]): StatusCounts {
  const counts: StatusCounts = { toRead: 0, ticked: 0, new: 0, read: 0 };
  for (const r of rows) {
    if (r.status === "in-zotero") counts.toRead++;
    else if (r.status === "ticked") counts.ticked++;
    else if (r.status === "new") counts.new++;
    else counts.read++;
  }
  return counts;
}

/** "3 to read · 5 new · 1 ticked · 4 read" */
export function countsLine(c: StatusCounts): string {
  return `${c.toRead} to read · ${c.new} new · ${c.ticked} ticked · ${c.read} read`;
}

/** Whole percents that sum to 100 (largest remainder), or all zeros when `counts` is empty. */
export function barWidths(counts: StatusCounts): StatusCounts {
  const keys = ["toRead", "ticked", "new", "read"] as const;
  const total = keys.reduce((n, k) => n + counts[k], 0);
  const out: StatusCounts = { toRead: 0, ticked: 0, new: 0, read: 0 };
  if (total === 0) return out;
  const parts = keys.map((k) => ({ k, raw: (counts[k] / total) * 100 }));
  for (const p of parts) out[p.k] = Math.floor(p.raw);
  let left = 100 - keys.reduce((n, k) => n + out[k], 0);
  for (const p of [...parts].sort((a, b) => (b.raw - Math.floor(b.raw)) - (a.raw - Math.floor(a.raw)))) {
    if (left <= 0) break;
    out[p.k]++;
    left--;
  }
  return out;
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

function describe(feed: FeedConfig | undefined, last: ScanCounts | null, feedId: string): string {
  const parts: string[] = [];
  if (feed) parts.push(plural(feed.topics.length, "topic"));
  const row = last?.feeds.find((f) => f.id === feedId);
  if (last && row) {
    if (row.failed) parts.push(`last scan ${last.at}: failed`);
    else parts.push(`last scan ${last.at}: ${row.priority + row.strong + row.possible + row.unchecked} new, ${row.dropped} dropped`);
  }
  return parts.join(" · ");
}

/**
 * One card per feed that is switched on and per feed that still has papers in the note, in the settings' order and then any
 * feed the settings no longer know. `rows` are all the note's rows; `limit` is how many papers to read each card lists.
 */
export function buildCards(rows: readonly TableRow[], feeds: readonly FeedConfig[], last: ScanCounts | null, limit = DEFAULT_LIMIT): FeedCard[] {
  const inNote = [...new Set(rows.map((r) => r.paper.feedId))];
  const known = new Map(feeds.map((f) => [f.id, f]));
  const ids = [
    ...feeds.filter((f) => f.enabled || inNote.includes(f.id)).map((f) => f.id),
    ...inNote.filter((id) => !known.has(id)),
  ];
  return ids.map((feedId) => {
    const own = rows.filter((r) => r.paper.feedId === feedId);
    const counts = summariseRows(own);
    const waiting = orderRows(own.filter((r) => r.status === "in-zotero"));
    const toRead = waiting.slice(0, Math.max(0, limit));
    const feed = known.get(feedId);
    return {
      feedId,
      name: feed?.name ?? last?.feeds.find((f) => f.id === feedId)?.name ?? feedId,
      description: describe(feed, last, feedId),
      toRead,
      moreToRead: waiting.length - toRead.length,
      counts,
      funnel: { listed: own.length, ticked: counts.ticked + counts.toRead + counts.read, read: counts.read },
      bar: barWidths(counts),
      badge: counts.toRead > 0 ? { text: `${counts.toRead} to read`, waiting: true } : { text: "nothing to read", waiting: false },
    };
  });
}

/** What the home card adds: the counts and the first papers to read (in the table's default order). */
export function homeSummary(rows: readonly TableRow[], limit = DEFAULT_LIMIT): { counts: StatusCounts; toRead: TableRow[]; more: number } {
  const waiting = orderRows(rows.filter((r) => r.status === "in-zotero"));
  const toRead = waiting.slice(0, Math.max(0, limit));
  return { counts: summariseRows(rows), toRead, more: waiting.length - toRead.length };
}

/** The `limit: N` line of a `literature-feed` block: a whole number from 1 to 20, else the default of 3. */
export function parseLimit(source: string): number {
  const m = /^\s*limit:\s*(\d+)\s*$/m.exec(source);
  if (!m) return DEFAULT_LIMIT;
  const n = Number(m[1]);
  return n >= 1 ? Math.min(n, MAX_LIMIT) : DEFAULT_LIMIT;
}
