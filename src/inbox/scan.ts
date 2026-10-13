// One scan: every enabled feed, scored, turned into what goes into this week's note. No Obsidian here: the client is
// passed in, and the result says what to write and what to remember. The caller does the writing.
import type { Candidate, OpenAlexClient, TopicResult } from "../openalex/client";
import { SEEN_CAP, type FeedCounts, type ScanCounts, type Settings } from "../settings/data";
import { titleKey } from "../zotero/client";
import { bareDoi } from "../zotero/map";
import { buildPapers, noteName, shortOpenAlexId, weekLabel, type FeedSection, type ListedTier, type NoteInput } from "./write";

/** The window starts this many days before the last scan, so papers OpenAlex indexed late are still caught. */
export const OVERLAP_DAYS = 14;
/** On the first scan, look back this many days. */
export const FIRST_SCAN_DAYS = 30;

export interface ScanDeps {
  client: Pick<OpenAlexClient, "scan">;
  now: Date;
}

export interface ScanOutcome {
  /**
   * What to put in this week's note; null when nothing new was found. The caller creates the note (`renderNote`) or, if
   * it exists, adds to it inside `vault.process` (`mergeIntoNote`), so a tick made during the scan is not overwritten.
   */
  note: { path: string; input: NoteInput } | null;
  /** Newly listed papers per tier, counted once per feed they were listed under. */
  perTier: Record<ListedTier, number>;
  /** Candidates the feeds' rules removed. */
  dropped: number;
  costUsd: number;
  failures: { feed: string; message: string }[];
  /** One entry per feed that was scanned, in feed order. */
  perFeed: FeedCounts[];
  /** Number of feeds that were scanned (enabled and with topics). */
  feedsScanned: number;
  /** Store these after the note is written. `lastScan` only moves when every feed succeeded. */
  lastScan: string;
  seenAdd: string[];
}

export function localDay(date: Date): string {
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function addDays(day: string, days: number): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** First day to ask OpenAlex for: before the last scan (or 30 days back at first), but not before the feed's "years from". */
export function windowStart(yearsFrom: number | null, lastScan: string, today: string): string {
  const base = lastScan === "" ? addDays(today, -FIRST_SCAN_DAYS) : addDays(lastScan, -OVERLAP_DAYS);
  const floor = yearsFrom === null ? "" : `${yearsFrom}-01-01`;
  return floor > base ? floor : base;
}

/**
 * Which of the feed's topics (1-based, in order) returned a paper. The client merges papers found by several topics, and a
 * preprint and its journal version into one, so a paper counts for a topic when that topic returned a paper with the same
 * OpenAlex id, the same DOI or the same title.
 */
export function topicsFor(c: Candidate, perTopic: readonly Pick<TopicResult, "papers">[]): number[] {
  const doi = bareDoi(c.doi);
  const title = titleKey(c.title);
  const same = (p: Candidate): boolean =>
    p.openalexId === c.openalexId || (doi !== "" && bareDoi(p.doi) === doi) || (title !== "" && titleKey(p.title) === title);
  return perTopic.flatMap((t, i) => (t.papers.some(same) ? [i + 1] : []));
}

export function inboxPath(inboxFolder: string, now: Date): string {
  return `${inboxFolder === "" ? "" : `${inboxFolder}/`}${noteName(now)}.md`;
}

/** The key under which a paper listed for a feed is remembered in `seen`. */
export function seenKey(feedId: string, openalexId: string): string {
  return `${feedId}/${openalexId}`;
}

export async function runScan(settings: Settings, deps: ScanDeps): Promise<ScanOutcome> {
  const today = localDay(deps.now);
  const seen = new Set(settings.seen);
  const perTier: Record<ListedTier, number> = { priority: 0, strong: 0, possible: 0, unchecked: 0 };
  const failures: ScanOutcome["failures"] = [];
  const perFeed: FeedCounts[] = [];
  const sections: FeedSection[] = [];
  const seenAdd: string[] = [];
  let costUsd = 0;
  let dropped = 0;

  const feeds = settings.feeds.filter((f) => f.enabled && f.topics.length > 0);
  for (const feed of feeds) {
    const row: FeedCounts = { id: feed.id, name: feed.name, priority: 0, strong: 0, possible: 0, unchecked: 0, dropped: 0, failed: false };
    perFeed.push(row);
    try {
      const scan = await deps.client.scan(feed.topics, { fromDate: windowStart(feed.yearsFrom, settings.lastScan, today) });
      costUsd += scan.costUsd;
      const unseen = scan.papers.filter((c) => {
        const id = shortOpenAlexId(c.openalexId);
        return id === null || !seen.has(seenKey(feed.id, id));
      });
      const built = buildPapers(feed, unseen, (c) => topicsFor(c, scan.perTopic));
      dropped += built.dropped;
      row.dropped = built.dropped;
      if (built.papers.length === 0) continue;
      for (const p of built.papers) {
        perTier[p.tier]++;
        row[p.tier]++;
        seenAdd.push(seenKey(feed.id, p.openalexId));
      }
      sections.push({ feedId: feed.id, feedName: feed.name, papers: built.papers });
    } catch (e) {
      row.failed = true;
      failures.push({ feed: feed.name, message: e instanceof Error ? e.message : "unknown error" });
    }
  }

  const lastScan = failures.length === 0 && feeds.length > 0 ? today : settings.lastScan;
  if (sections.length === 0) {
    return { note: null, perTier, dropped, costUsd, failures, perFeed, feedsScanned: feeds.length, lastScan, seenAdd };
  }
  const note = { path: inboxPath(settings.inboxFolder, deps.now), input: { week: weekLabel(deps.now), scanned: today, sections } };
  return { note, perTier, dropped, costUsd, failures, perFeed, feedsScanned: feeds.length, lastScan, seenAdd };
}

/** The `seen` list after a scan: new keys added at the end, the oldest dropped beyond the cap. */
export function updatedSeen(seen: readonly string[], add: readonly string[]): string[] {
  return [...new Set([...seen, ...add])].slice(-SEEN_CAP);
}

export function scanCounts(outcome: ScanOutcome, at: string): ScanCounts {
  const { perTier } = outcome;
  return { at, ...perTier, dropped: outcome.dropped, failed: outcome.failures.length, feeds: outcome.perFeed.map((f) => ({ ...f })) };
}

/** One sentence for the status block: what the latest scan found. */
export function describeCounts(c: ScanCounts): string {
  const total = c.priority + c.strong + c.possible + c.unchecked;
  const found = total === 0
    ? "no new papers"
    : `${total} new (${c.priority} priority, ${c.strong} strong, ${c.possible} possible, ${c.unchecked} without abstract)`;
  const failed = c.failed > 0 ? `, ${c.failed} ${c.failed === 1 ? "feed" : "feeds"} failed` : "";
  return `Last scan ${c.at}: ${found}, ${c.dropped} dropped by the feed rules${failed}.`;
}

/** One row of the per-feed list: what is waiting for this feed and what the last scan found for it. */
export function describeFeedRow(name: string, waiting: Record<ListedTier, number>, last: FeedCounts | undefined): string {
  const total = waiting.priority + waiting.strong + waiting.possible + waiting.unchecked;
  const now = `${total} waiting (${waiting.priority} priority, ${waiting.strong} strong, ${waiting.possible} possible, ${waiting.unchecked} without abstract)`;
  if (!last) return `${name}: ${now}`;
  if (last.failed) return `${name}: ${now}. Last scan: failed.`;
  const found = last.priority + last.strong + last.possible + last.unchecked;
  return `${name}: ${now}. Last scan: ${found} new, ${last.dropped} dropped.`;
}
