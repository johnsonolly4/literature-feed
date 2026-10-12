// What the feed editor's Test button does, minus the buttons: one OpenAlex scan, scored, counted. Nothing is written.
import { scorePaper } from "../match/score";
import type { Tier } from "../match/feed";
import type { OpenAlexClient, ScanResult } from "../openalex/client";
import type { FeedConfig } from "./data";

export const TEST_DAYS = 365;

export interface TestSummary {
  windowStart: string;
  /** Unique papers after merging the topics. */
  papers: number;
  perTier: Record<Tier, number>;
  perTopic: { topic: string; count: number }[];
  costUsd: number;
  /** Titles of the best-ranked papers (Priority, then Strong, then Possible), at most `limit`. */
  top: { title: string; tier: Tier }[];
}

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** The Test looks back one year, but not before the feed's own "years from". */
export function testWindowStart(feed: FeedConfig, now: Date): string {
  const yearAgo = isoDay(new Date(now.getTime() - TEST_DAYS * 86_400_000));
  const floor = feed.yearsFrom === null ? "" : `${feed.yearsFrom}-01-01`;
  return floor > yearAgo ? floor : yearAgo;
}

const RANKED: Tier[] = ["priority", "strong", "possible"];

export function summariseScan(scan: ScanResult, feed: FeedConfig, windowStart: string, limit = 5): TestSummary {
  const perTier: Record<Tier, number> = { priority: 0, strong: 0, possible: 0, dropped: 0, unchecked: 0 };
  const scored = scan.papers.map((paper) => ({ title: paper.title, tier: scorePaper(paper, feed).tier }));
  for (const s of scored) perTier[s.tier]++;
  const top = RANKED.flatMap((tier) => scored.filter((s) => s.tier === tier)).slice(0, limit);
  return {
    windowStart,
    papers: scan.papers.length,
    perTier,
    perTopic: scan.perTopic.map((t) => ({ topic: t.topic, count: t.count })),
    costUsd: scan.costUsd,
    top,
  };
}

/** One real scan of the feed's topics. Costs about $0.001 per request; the caller asks the user first. */
export async function runFeedTest(client: OpenAlexClient, feed: FeedConfig, now = new Date()): Promise<TestSummary> {
  const windowStart = testWindowStart(feed, now);
  const scan = await client.scan(feed.topics, { fromDate: windowStart });
  return summariseScan(scan, feed, windowStart);
}
