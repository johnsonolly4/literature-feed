// A short-lived cache of what a literature review fetched, so changing the prompt options or reopening the window does not spend
// OpenAlex credits again. Pure: the plugin reads and writes `review-cache.json`. Entries are kept 24 hours and the file is capped.
import type { Candidate } from "../openalex/client";

export const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
/** Topic results kept (the oldest go first); each holds up to a few hundred works with abstracts. */
export const MAX_TOPIC_ENTRIES = 20;
/** Works kept by id (missing papers and the like). */
export const MAX_WORK_ENTRIES = 2000;

export interface TopicEntry {
  /** Milliseconds since 1970 when it was fetched. */
  at: number;
  /** Works OpenAlex said matched (not only the ones fetched). */
  count: number;
  papers: Candidate[];
}

export interface ReviewCache {
  version: 1;
  topics: Record<string, TopicEntry>;
  /** Short work id to the paper, with when it was fetched. */
  works: Record<string, { at: number; paper: Candidate }>;
}

export function emptyCache(): ReviewCache {
  return { version: 1, topics: {}, works: {} };
}

/** The key of a topic's result: the same topic over the same window with the same cap gives the same result. */
export function topicKey(topic: string, fromDate: string, cap: number): string {
  return `${fromDate}|${cap}|${topic}`;
}

export function getTopic(cache: ReviewCache, key: string, now: number): TopicEntry | null {
  const entry = cache.topics[key];
  return entry && now - entry.at < CACHE_TTL_MS && now >= entry.at ? entry : null;
}

export function putTopic(cache: ReviewCache, key: string, entry: TopicEntry): void {
  cache.topics[key] = entry;
  const keys = Object.keys(cache.topics).sort((a, b) => cache.topics[a].at - cache.topics[b].at);
  for (const old of keys.slice(0, Math.max(0, keys.length - MAX_TOPIC_ENTRIES))) delete cache.topics[old];
}

export function getWork(cache: ReviewCache, id: string, now: number): Candidate | null {
  const entry = cache.works[id];
  return entry && now - entry.at < CACHE_TTL_MS && now >= entry.at ? entry.paper : null;
}

export function putWorks(cache: ReviewCache, papers: readonly Candidate[], now: number): void {
  for (const paper of papers) {
    const id = /(W\d+)$/.exec(paper.openalexId)?.[1];
    if (id) cache.works[id] = { at: now, paper };
  }
  const ids = Object.keys(cache.works).sort((a, b) => cache.works[a].at - cache.works[b].at);
  for (const old of ids.slice(0, Math.max(0, ids.length - MAX_WORK_ENTRIES))) delete cache.works[old];
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isCandidate(v: unknown): v is Candidate {
  return isRecord(v) && typeof v.openalexId === "string" && typeof v.title === "string" && Array.isArray(v.authors);
}

/** The cache from whatever the file held; damaged entries are dropped, nothing throws. */
export function normaliseCache(raw: unknown): ReviewCache {
  const out = emptyCache();
  if (!isRecord(raw)) return out;
  if (isRecord(raw.topics)) {
    for (const [key, entry] of Object.entries(raw.topics)) {
      if (!isRecord(entry) || typeof entry.at !== "number" || typeof entry.count !== "number" || !Array.isArray(entry.papers)) continue;
      out.topics[key] = { at: entry.at, count: entry.count, papers: entry.papers.filter(isCandidate) };
    }
  }
  if (isRecord(raw.works)) {
    for (const [id, entry] of Object.entries(raw.works)) {
      if (/^W\d+$/.test(id) && isRecord(entry) && typeof entry.at === "number" && isCandidate(entry.paper)) out.works[id] = { at: entry.at, paper: entry.paper };
    }
  }
  return out;
}
