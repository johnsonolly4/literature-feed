// The OpenAlex requests the citation network and the citation gaps need, each inside the review's budget and using the work cache
// so a repeat costs nothing. The client is passed in (a fake in tests); nothing here touches Obsidian.
import { shortOpenAlexId } from "../inbox/write";
import type { Candidate } from "../openalex/client";
import { COST_FILTER, type Budget } from "./budget";
import { getWork, putWorks, type ReviewCache } from "./cache";
import type { ReviewPaper } from "./collect";
import { alsoCites, citationGaps, type Gap, type Network } from "./network";

export interface NetworkClient {
  citingPage(ids: readonly string[], page: number): Promise<{ papers: Candidate[]; fetched: number; count: number; costUsd: number }>;
  getWorks(ids: readonly string[]): Promise<{ papers: Candidate[]; costUsd: number }>;
}

export interface NetworkDeps {
  client: NetworkClient;
  cache: ReviewCache;
  now: number;
  budget: Budget;
}

/** Papers whose citing works are looked up (OpenAlex takes at most 50 ids in one filter). */
export const SEED_BATCH = 50;
/** Pages of 100 citing works read per batch of seeds. */
export const CITING_PAGES = 2;
/** At most this many references of one paper are read for its citation gaps (two requests). */
export const MAX_GAP_REFERENCES = 100;
/** The citation-gaps tool keeps this many gaps (the review's per-paper block keeps 15). */
export const MAX_GAPS = 100;
/** The second level reads the records of at most this many shared works, and keeps this many deeper gaps. */
export const MAX_HUBS = 300;
export const MAX_DEEPER = 50;

export function estimateNetworkRequests(setSize: number, detailIds: number): number {
  const batches = Math.ceil(Math.min(setSize, SEED_BATCH) / SEED_BATCH);
  return batches * CITING_PAGES + Math.ceil(detailIds / 50);
}

export function estimateGapRequests(referenceCount: number): number {
  return Math.ceil(Math.min(referenceCount, MAX_GAP_REFERENCES) / 50) + 1;
}

/** Works by id, from the cache where possible; the rest in batches of 50, each only if the budget allows. */
export async function worksById(ids: readonly string[], deps: NetworkDeps): Promise<{ papers: Candidate[]; stopped: string | null }> {
  const have: Candidate[] = [];
  const need: string[] = [];
  for (const id of new Set(ids)) {
    const cached = getWork(deps.cache, id, deps.now);
    if (cached) have.push(cached);
    else need.push(id);
  }
  let stopped: string | null = null;
  for (let i = 0; i < need.length; i += 50) {
    if (!deps.budget.canAfford(COST_FILTER)) {
      stopped = `stopped at $${deps.budget.spent.toFixed(4)}; some works were not fetched`;
      break;
    }
    try {
      const got = await deps.client.getWorks(need.slice(i, i + 50));
      deps.budget.add(got.costUsd > 0 ? got.costUsd : COST_FILTER);
      putWorks(deps.cache, got.papers, deps.now);
      have.push(...got.papers);
    } catch (e) {
      stopped = `stopped while fetching works: ${e instanceof Error ? e.message : "unknown error"}`;
      break;
    }
  }
  return { papers: have, stopped };
}

export interface NetworkExtras {
  /** Works the set cites often that are not in it, in the network's order, with their details. */
  missing: { paper: Candidate; count: number; citers: string[] }[];
  /** Works outside the set that cite several of its papers, most first. */
  alsoCite: { paper: Candidate; count: number; cites: string[] }[];
  stopped: string | null;
}

/** Looks up what cites the set (for "also cite") and the details of the missing and the also-citing works. */
export async function fetchNetworkExtras(papers: readonly ReviewPaper[], network: Network, deps: NetworkDeps): Promise<NetworkExtras> {
  const setIds = new Set(papers.map((p) => p.id));
  let stopped: string | null = null;
  const seeds = [...papers]
    .sort((a, b) => (network.degree.get(b.id)?.in ?? 0) - (network.degree.get(a.id)?.in ?? 0) || b.citedByCount - a.citedByCount || a.id.localeCompare(b.id))
    .slice(0, SEED_BATCH)
    .map((p) => p.id);
  const citing: { id: string; referencedWorks: string[] }[] = [];
  for (let page = 1; page <= CITING_PAGES && seeds.length > 0; page++) {
    if (!deps.budget.canAfford(COST_FILTER)) {
      stopped = `stopped at $${deps.budget.spent.toFixed(4)} before reading the citing works`;
      break;
    }
    try {
      const res = await deps.client.citingPage(seeds, page);
      deps.budget.add(res.costUsd > 0 ? res.costUsd : COST_FILTER);
      for (const c of res.papers) {
        const id = shortOpenAlexId(c.openalexId);
        if (id !== null) citing.push({ id, referencedWorks: c.referencedWorks ?? [] });
      }
      if (res.fetched < 100) break;
    } catch (e) {
      stopped = `stopped while reading the citing works: ${e instanceof Error ? e.message : "unknown error"}`;
      break;
    }
  }
  const also = alsoCites(citing, setIds);
  const wanted = [...network.missing.map((m) => m.id), ...also.map((a) => a.id)];
  const details = await worksById(wanted, deps);
  stopped ??= details.stopped;
  const byId = new Map(details.papers.flatMap((p) => { const id = shortOpenAlexId(p.openalexId); return id ? [[id, p] as const] : []; }));
  return {
    missing: network.missing.flatMap((m) => { const paper = byId.get(m.id); return paper ? [{ paper, count: m.count, citers: m.citers }] : []; }),
    alsoCite: also.flatMap((a) => { const paper = byId.get(a.id); return paper ? [{ paper, count: a.count, cites: a.cites }] : []; }),
    stopped,
  };
}

export interface GapResult {
  /** The paper's references that could be read, and how many of them have a reference list. */
  referencesRead: number;
  referencesWithLists: number;
  gaps: { gap: Gap; paper: Candidate | null }[];
  /** The references that were read, with their own reference lists (the second level starts from these). */
  records: { id: string; referencedWorks: string[] }[];
  stopped: string | null;
}

/** For one paper: what many of its references cite that it does not (see `citationGaps`). */
export async function fetchCitationGaps(paper: { id: string; referencedWorks: readonly string[] }, deps: NetworkDeps, minCount = 3, top = 15): Promise<GapResult> {
  const refs = paper.referencedWorks.slice(0, MAX_GAP_REFERENCES);
  const read = await worksById(refs, deps);
  const withIds = read.papers.flatMap((p) => { const id = shortOpenAlexId(p.openalexId); return id ? [{ id, referencedWorks: p.referencedWorks ?? [] }] : []; });
  const gaps = citationGaps(paper, withIds, minCount, top);
  const details = await worksById(gaps.map((g) => g.id), deps);
  const byId = new Map(details.papers.flatMap((p) => { const id = shortOpenAlexId(p.openalexId); return id ? [[id, p] as const] : []; }));
  return {
    referencesRead: read.papers.length,
    referencesWithLists: withIds.filter((r) => r.referencedWorks.length > 0).length,
    gaps: gaps.map((gap) => ({ gap, paper: byId.get(gap.id) ?? null })),
    records: withIds,
    stopped: read.stopped ?? details.stopped,
  };
}
