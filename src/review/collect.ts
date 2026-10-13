// Running a literature review's searches within a budget: count first (cheap), estimate, then fetch page by page, stop at the
// limit, cache what was fetched, score with each search's rules and merge what several searches found. The client is passed in
// (a fake in tests), so nothing here touches the network or Obsidian.
import { dedupe } from "../match/dedupe";
import { scorePaper } from "../match/score";
import { topicsFor } from "../inbox/scan";
import { shortOpenAlexId, type ListedTier } from "../inbox/write";
import type { Candidate } from "../openalex/client";
import type { FeedConfig } from "../settings/data";
import { COST_PER_REQUEST, PAGE_SIZE, estimateSearch, overBudget, type Budget, type Estimate, type TopicCount, type TopicPlan } from "./budget";
import { getTopic, putTopic, topicKey, type ReviewCache } from "./cache";

/** The two calls a review makes on the OpenAlex client. */
export interface ReviewClient {
  countTopic(topic: string, opts: { fromDate?: string }): Promise<{ count: number; costUsd: number }>;
  searchPage(topic: string, page: number, opts: { fromDate?: string; extra?: boolean; sort?: string }): Promise<{ papers: Candidate[]; fetched: number; count: number; costUsd: number }>;
}

export interface ReviewOptions {
  /** `YYYY-MM-DD`: works published on or after this day. */
  fromDate: string;
  capPerTopic: number;
  /** Papers that go into the prompt. */
  maxPapers: number;
  /** The lowest tier that is kept. */
  minTier: Exclude<ListedTier, "unchecked">;
  /** Ignore the cache and fetch again. */
  refresh: boolean;
}

export interface ReviewDeps {
  client: ReviewClient;
  cache: ReviewCache;
  /** Milliseconds since 1970. */
  now: number;
  budget: Budget;
}

export interface PlannedTopic extends TopicPlan {
  /** The searches that use this topic string. */
  feedIds: string[];
}

export interface ReviewPlan {
  topics: PlannedTopic[];
  estimate: Estimate;
  overBudget: boolean;
}

/** How a paper was found by one search. */
export interface Find {
  feedId: string;
  tier: ListedTier;
  matched: string[];
  /** Topics (1-based, in that search's order) that returned it. */
  topics: number[];
}

export interface ReviewPaper {
  /** The short OpenAlex id, `W123`. */
  id: string;
  title: string;
  authors: string[];
  venue: string | null;
  year: number | null;
  publicationDate: string | null;
  doi: string | null;
  abstract: string | null;
  isPreprint: boolean;
  citedByCount: number;
  /** Short ids of the works it cites. */
  referencedWorks: string[];
  finds: Find[];
  /** The best tier among the finds. */
  tier: ListedTier;
}

export interface TopicRun {
  feedId: string;
  topic: string;
  /** Works OpenAlex says match, and how many were fetched. */
  count: number;
  fetched: number;
  fromCache: boolean;
}

export interface ReviewResult {
  papers: ReviewPaper[];
  /** Papers kept by the rules before the cap on the prompt. */
  total: number;
  topics: TopicRun[];
  /** Cost of this review so far, counting included. */
  spentUsd: number;
  /** Why the run stopped before it finished, or null. */
  stopped: string | null;
}

const RANK: ListedTier[] = ["priority", "strong", "possible", "unchecked"];

const fetchOptions = (fromDate: string) => ({ fromDate, extra: true, sort: "relevance_score:desc" });

/** The distinct topic strings of the searches, each with the searches that use it. */
function distinctTopics(feeds: readonly FeedConfig[]): { topic: string; feedIds: string[] }[] {
  const out = new Map<string, string[]>();
  for (const feed of feeds) {
    for (const topic of feed.topics) {
      const list = out.get(topic) ?? [];
      if (!list.includes(feed.id)) list.push(feed.id);
      out.set(topic, list);
    }
  }
  return [...out].map(([topic, feedIds]) => ({ topic, feedIds }));
}

/**
 * Counts what each topic matches (one tiny request per topic that is not cached) and estimates the cost of fetching it. Nothing
 * is fetched. The counting is itself charged to the budget, and stops with an error if even that would pass the limit.
 */
export async function planReview(feeds: readonly FeedConfig[], opts: ReviewOptions, deps: ReviewDeps): Promise<ReviewPlan> {
  const counts: (TopicCount & { feedIds: string[] })[] = [];
  for (const { topic, feedIds } of distinctTopics(feeds)) {
    const key = topicKey(topic, opts.fromDate, opts.capPerTopic);
    const cached = opts.refresh ? null : getTopic(deps.cache, key, deps.now);
    if (cached) {
      counts.push({ key, topic, count: cached.count, fromCache: true, feedIds });
      continue;
    }
    if (!deps.budget.canAfford()) throw new Error("The budget is used up before counting the topics. Raise it or narrow the review.");
    const { count, costUsd } = await deps.client.countTopic(topic, { fromDate: opts.fromDate });
    deps.budget.add(costUsd > 0 ? costUsd : COST_PER_REQUEST);
    counts.push({ key, topic, count, fromCache: false, feedIds });
  }
  const estimate = estimateSearch(counts, opts.capPerTopic);
  const topics = estimate.topics.map((t, i): PlannedTopic => ({ ...t, feedIds: counts[i].feedIds }));
  // The budget already holds the counting; what remains must pay for the pages.
  return { topics, estimate: { ...estimate, topics }, overBudget: overBudget({ usd: estimate.usd + deps.budget.spent }, deps.budget.limitUsd) };
}

/** Fetches the planned pages (stopping at the budget), then scores, merges, sorts and caps. */
export async function runReview(feeds: readonly FeedConfig[], plan: ReviewPlan, opts: ReviewOptions, deps: ReviewDeps): Promise<ReviewResult> {
  let stopped: string | null = null;
  const fetchedByTopic = new Map<string, Candidate[]>();
  const runs = new Map<string, { count: number; fetched: number; fromCache: boolean }>();

  for (const t of plan.topics) {
    const cached = opts.refresh ? null : getTopic(deps.cache, t.key, deps.now);
    if (cached) {
      fetchedByTopic.set(t.topic, cached.papers);
      runs.set(t.topic, { count: cached.count, fetched: cached.papers.length, fromCache: true });
      continue;
    }
    const papers: Candidate[] = [];
    let fetched = 0;
    let complete = true;
    for (let page = 1; page <= t.pages; page++) {
      if (stopped !== null) {
        complete = false;
        break;
      }
      if (!deps.budget.canAfford()) {
        stopped = `stopped at $${deps.budget.spent.toFixed(3)} (the limit is $${deps.budget.limitUsd.toFixed(3)}) after ${papers.length} works of "${short(t.topic)}"; the rest was not fetched`;
        complete = false;
        break;
      }
      try {
        const res = await deps.client.searchPage(t.topic, page, fetchOptions(opts.fromDate));
        deps.budget.add(res.costUsd > 0 ? res.costUsd : COST_PER_REQUEST);
        papers.push(...res.papers);
        fetched += res.fetched;
        if (res.fetched < PAGE_SIZE) break;
      } catch (e) {
        stopped = `stopped after ${papers.length} works of "${short(t.topic)}": ${e instanceof Error ? e.message : "unknown error"}`;
        complete = false;
        break;
      }
    }
    fetchedByTopic.set(t.topic, papers);
    runs.set(t.topic, { count: t.count, fetched, fromCache: false });
    if (complete) putTopic(deps.cache, t.key, { at: deps.now, count: t.count, papers });
  }

  const byId = new Map<string, ReviewPaper>();
  const topicRuns: TopicRun[] = [];
  for (const feed of feeds) {
    const results = feed.topics.map((topic) => ({ papers: fetchedByTopic.get(topic) ?? [] }));
    feed.topics.forEach((topic) => {
      const run = runs.get(topic);
      topicRuns.push({ feedId: feed.id, topic, count: run?.count ?? 0, fetched: run?.fetched ?? 0, fromCache: run?.fromCache ?? false });
    });
    for (const c of dedupe(results.flatMap((r) => r.papers))) {
      const score = scorePaper(c, feed);
      if (score.tier === "dropped") continue;
      const tier = score.tier;
      if (RANK.indexOf(tier) > RANK.indexOf(opts.minTier)) continue;
      const id = shortOpenAlexId(c.openalexId);
      if (id === null) continue;
      const find: Find = {
        feedId: feed.id, tier, matched: [...new Set(score.groups.flatMap((g) => g.terms))], topics: topicsFor(c, results),
      };
      const existing = byId.get(id);
      if (existing) {
        existing.finds.push(find);
        if (RANK.indexOf(tier) < RANK.indexOf(existing.tier)) existing.tier = tier;
        continue;
      }
      byId.set(id, {
        id, title: c.title, authors: c.authors, venue: c.venue, year: c.year ?? null, publicationDate: c.publicationDate,
        doi: c.doi ?? null, abstract: c.abstract ?? null, isPreprint: c.isPreprint === true,
        citedByCount: c.citedByCount ?? 0, referencedWorks: c.referencedWorks ?? [], finds: [find], tier,
      });
    }
  }

  const all = [...byId.values()].sort(
    (a, b) => RANK.indexOf(a.tier) - RANK.indexOf(b.tier) || b.citedByCount - a.citedByCount || (b.year ?? 0) - (a.year ?? 0) || a.title.localeCompare(b.title),
  );
  return { papers: all.slice(0, opts.maxPapers), total: all.length, topics: topicRuns, spentUsd: deps.budget.spent, stopped };
}

function short(text: string, max = 40): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}
