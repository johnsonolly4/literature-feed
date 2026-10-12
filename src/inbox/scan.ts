// One scan: every enabled feed, scored, turned into what goes into this week's note. No Obsidian here: the client is
// passed in, and the result says what to write and what to remember. The caller does the writing.
import type { OpenAlexClient } from "../openalex/client";
import { SEEN_CAP, type Settings } from "../settings/data";
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
  const sections: FeedSection[] = [];
  const seenAdd: string[] = [];
  let costUsd = 0;
  let dropped = 0;

  const feeds = settings.feeds.filter((f) => f.enabled && f.topics.length > 0);
  for (const feed of feeds) {
    try {
      const scan = await deps.client.scan(feed.topics, { fromDate: windowStart(feed.yearsFrom, settings.lastScan, today) });
      costUsd += scan.costUsd;
      const unseen = scan.papers.filter((c) => {
        const id = shortOpenAlexId(c.openalexId);
        return id === null || !seen.has(seenKey(feed.id, id));
      });
      const built = buildPapers(feed, unseen);
      dropped += built.dropped;
      if (built.papers.length === 0) continue;
      for (const p of built.papers) {
        perTier[p.tier]++;
        seenAdd.push(seenKey(feed.id, p.openalexId));
      }
      sections.push({ feedId: feed.id, feedName: feed.name, papers: built.papers });
    } catch (e) {
      failures.push({ feed: feed.name, message: e instanceof Error ? e.message : "unknown error" });
    }
  }

  const lastScan = failures.length === 0 && feeds.length > 0 ? today : settings.lastScan;
  if (sections.length === 0) {
    return { note: null, perTier, dropped, costUsd, failures, feedsScanned: feeds.length, lastScan, seenAdd };
  }
  const note = { path: inboxPath(settings.inboxFolder, deps.now), input: { week: weekLabel(deps.now), scanned: today, sections } };
  return { note, perTier, dropped, costUsd, failures, feedsScanned: feeds.length, lastScan, seenAdd };
}

/** The `seen` list after a scan: new keys added at the end, the oldest dropped beyond the cap. */
export function updatedSeen(seen: readonly string[], add: readonly string[]): string[] {
  return [...new Set([...seen, ...add])].slice(-SEEN_CAP);
}
