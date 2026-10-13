// Keeping a literature review inside a spending limit. Pure: no Obsidian, no network. OpenAlex bills a request through the
// `meta.cost_usd` it reports (about $0.001 for a search page); a review adds up many requests, so it is estimated before it runs,
// capped while it runs, and every request is tallied by month. The plugin only sees its own requests: the account's real
// allowance is on openalex.org.

/** What one search request costs when the answer does not say (as seen: $0.001). */
export const COST_PER_REQUEST = 0.001;
/** The default spending limit of one review. */
export const DEFAULT_BUDGET_USD = 0.05;
/** At most this many works are fetched per search topic (3 pages). */
export const CAP_PER_TOPIC = 300;
export const PAGE_SIZE = 100;
/** Papers in the prompt: the default, and the most the window allows. */
export const DEFAULT_PROMPT_PAPERS = 60;
export const MAX_PROMPT_PAPERS = 150;

export interface TopicCount {
  /** The cache key of the topic's result (see cache.ts). */
  key: string;
  topic: string;
  /** Works OpenAlex says match. */
  count: number;
  /** The result is already cached, so fetching it costs nothing. */
  fromCache: boolean;
}

export interface TopicPlan extends TopicCount {
  /** Works that will be fetched: the count, up to the cap. */
  fetch: number;
  pages: number;
  /** Requests still to make for this topic (0 when it is cached). */
  requests: number;
}

export interface Estimate {
  topics: TopicPlan[];
  works: number;
  requests: number;
  usd: number;
}

export function pagesFor(count: number, cap = CAP_PER_TOPIC): { fetch: number; pages: number } {
  const fetch = Math.max(0, Math.min(count, cap));
  return { fetch, pages: Math.ceil(fetch / PAGE_SIZE) };
}

/** What fetching the topics would cost, from their counts. `extraRequests` is for other steps (for example the citation network). */
export function estimateSearch(counts: readonly TopicCount[], cap = CAP_PER_TOPIC, extraRequests = 0, costPerRequest = COST_PER_REQUEST): Estimate {
  const topics = counts.map((c): TopicPlan => {
    const { fetch, pages } = pagesFor(c.count, cap);
    return { ...c, fetch, pages, requests: c.fromCache ? 0 : pages };
  });
  const requests = topics.reduce((n, t) => n + t.requests, 0) + extraRequests;
  return { topics, works: topics.reduce((n, t) => n + t.fetch, 0), requests, usd: round(requests * costPerRequest) };
}

function round(usd: number): number {
  return Math.round(usd * 1e6) / 1e6;
}

/** True when the estimate is more than the budget (a hair of tolerance for rounding). */
export function overBudget(estimate: Pick<Estimate, "usd">, budgetUsd: number): boolean {
  return estimate.usd > budgetUsd + 1e-9;
}

/** The running cost of one review against its limit. */
export class Budget {
  spent = 0;

  constructor(readonly limitUsd: number) {}

  add(usd: number): void {
    this.spent = round(this.spent + Math.max(0, usd));
  }

  get remaining(): number {
    return Math.max(0, round(this.limitUsd - this.spent));
  }

  /** True when another request of this cost would not pass the limit. */
  canAfford(usd = COST_PER_REQUEST): boolean {
    return this.spent + usd <= this.limitUsd + 1e-9;
  }
}

// ---- the monthly tally ------------------------------------------------------------------------------------------------

export interface SpendTally {
  version: 1;
  /** Keyed `YYYY-MM`. */
  months: Record<string, { requests: number; usd: number }>;
}

export function emptyTally(): SpendTally {
  return { version: 1, months: {} };
}

export function monthOf(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

export function addSpend(tally: SpendTally, month: string, usd: number, requests = 1): void {
  const row = tally.months[month] ?? { requests: 0, usd: 0 };
  row.requests += requests;
  row.usd = round(row.usd + Math.max(0, usd));
  tally.months[month] = row;
}

export function monthTotal(tally: SpendTally, month: string): { requests: number; usd: number } {
  return tally.months[month] ?? { requests: 0, usd: 0 };
}

/** The tally from whatever the file held; damaged rows are left out, nothing throws. */
export function normaliseTally(raw: unknown): SpendTally {
  const out = emptyTally();
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return out;
  const months = (raw as { months?: unknown }).months;
  if (typeof months !== "object" || months === null || Array.isArray(months)) return out;
  for (const [month, row] of Object.entries(months)) {
    if (!/^\d{4}-\d{2}$/.test(month) || typeof row !== "object" || row === null) continue;
    const { requests, usd } = row as { requests?: unknown; usd?: unknown };
    if (typeof requests === "number" && Number.isFinite(requests) && requests >= 0 && typeof usd === "number" && Number.isFinite(usd) && usd >= 0) {
      out.months[month] = { requests: Math.floor(requests), usd: round(usd) };
    }
  }
  return out;
}

/** True when a review that costs `usd` would pass a monthly soft limit (0 or less = no limit). */
export function passesMonthlyLimit(tally: SpendTally, month: string, usd: number, limitUsd: number): boolean {
  return limitUsd > 0 && monthTotal(tally, month).usd + usd > limitUsd + 1e-9;
}
