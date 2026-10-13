// The citation-gaps tool's OpenAlex requests, each inside a budget and using the cache: one paper (by DOI, id or title) or a pasted
// list of references, resolved to OpenAlex works, then what many of them cite and the paper does not. The client is passed in
// (a fake in tests); nothing here touches Obsidian.
import { shortOpenAlexId } from "../inbox/write";
import type { Candidate } from "../openalex/client";
import { titleKey } from "../zotero/client";
import { bareDoi } from "../zotero/map";
import { COST_FILTER, COST_SEARCH } from "./budget";
import { getTitle, getWork, putTitle, putWorks } from "./cache";
import { MAX_TITLE_SEARCHES, titleInReference, titleOverlap, type GapInput } from "./gaps-input";
import { citationGaps, sharedHubs, type Gap } from "./network";
import { MAX_DEEPER, MAX_GAPS, MAX_HUBS, fetchCitationGaps, worksById, type NetworkClient, type NetworkDeps } from "./network-fetch";

export interface GapsClient extends NetworkClient {
  getFullWork(ref: { doi?: string | null; id?: string | null }): Promise<Candidate | null>;
  getWorksByDoi(dois: readonly string[]): Promise<{ papers: Candidate[]; costUsd: number }>;
  findByTitle(title: string): Promise<{ papers: Candidate[]; costUsd: number }>;
}

export interface GapsDeps extends NetworkDeps {
  client: GapsClient;
}

/** The second level: works cited by many of the shared works (the works that several references cite). */
export interface DeeperRun {
  gaps: { gap: Gap; paper: Candidate | null }[];
  /** Shared works whose records were read, and how many had a reference list. */
  hubsRead: number;
  hubsWithLists: number;
  /** A gap here is cited by at least this many shared works. */
  minCount: number;
}

export interface GapsRun {
  /** The paper asked about (not for a pasted list). */
  subject: { title: string; doi: string | null; id: string | null; year: number | null } | null;
  /** References read (with their own reference lists) and how many of them had a list. */
  referencesRead: number;
  referencesWithLists: number;
  gaps: { gap: Gap; paper: Candidate | null }[];
  /** DOIs and titles that were not found in OpenAlex or were left out. */
  unresolved: string[];
  searches: number;
  stopped: string | null;
  /** The second level, when it was asked for. */
  deeper: DeeperRun | null;
  /** Something to tell the user instead of a list (no record, no references). */
  message: string | null;
  spentUsd: number;
}

function subjectOf(c: Candidate): NonNullable<GapsRun["subject"]> {
  return { title: c.title, doi: c.doi ? bareDoi(c.doi) : null, id: shortOpenAlexId(c.openalexId), year: c.year ?? null };
}

const empty = (spentUsd: number, over: Partial<GapsRun>): GapsRun => ({
  subject: null, referencesRead: 0, referencesWithLists: 0, gaps: [], unresolved: [], searches: 0, stopped: null, deeper: null, message: null, spentUsd, ...over,
});

/** A reference line or title searched in OpenAlex (or remembered from before); "stop" when the budget does not allow another search. */
async function findTitle(title: string, deps: GapsDeps): Promise<Candidate | null | "stop"> {
  const key = titleKey(title);
  const known = getTitle(deps.cache, key, deps.now);
  if (known) {
    if (known.id === null) return null;
    const got = (await worksById([known.id], deps)).papers[0];
    return got ?? null;
  }
  if (!deps.budget.canAfford(COST_SEARCH)) return "stop";
  const res = await deps.client.findByTitle(title);
  deps.budget.add(res.costUsd > 0 ? res.costUsd : COST_SEARCH);
  putWorks(deps.cache, res.papers, deps.now);
  const hit = [...res.papers].filter((p) => titleInReference(p.title, title)).sort((a, b) => titleOverlap(b.title, title) - titleOverlap(a.title, title))[0] ?? null;
  putTitle(deps.cache, key, hit ? shortOpenAlexId(hit.openalexId) : null, deps.now);
  return hit;
}

/** One paper's record, from the cache or one free request. */
async function recordOf(input: Extract<GapInput, { kind: "work" }>, deps: GapsDeps): Promise<Candidate | null> {
  if (input.id) {
    const cached = getWork(deps.cache, input.id, deps.now);
    if (cached?.referencedWorks) return cached;
  }
  const got = await deps.client.getFullWork({ id: input.id, doi: input.doi });
  if (got) putWorks(deps.cache, [got], deps.now);
  return got;
}

/**
 * The second level. The shared works (cited by at least two of the references) are read, and what at least `minCount` of them cite is
 * reported, leaving out the paper, its references and the shared works themselves.
 */
async function goDeeper(paper: { id: string; referencedWorks: readonly string[] }, records: readonly { id: string; referencedWorks: readonly string[] }[], deps: GapsDeps, minCount: number): Promise<{ deeper: DeeperRun; stopped: string | null }> {
  const hubs = sharedHubs(records, new Set([paper.id]), 2, MAX_HUBS);
  const read = await worksById(hubs.map((h) => h.id), deps);
  const hubRecords = read.papers.flatMap((p) => { const id = shortOpenAlexId(p.openalexId); return id ? [{ id, referencedWorks: p.referencedWorks ?? [] }] : []; });
  const exclude = [...paper.referencedWorks, ...hubs.map((h) => h.id)];
  const gaps = citationGaps({ id: paper.id, referencedWorks: exclude }, hubRecords, minCount, MAX_DEEPER);
  const details = await worksById(gaps.map((g) => g.id), deps);
  const byId = new Map(details.papers.flatMap((p) => { const id = shortOpenAlexId(p.openalexId); return id ? [[id, p] as const] : []; }));
  return {
    deeper: { gaps: gaps.map((gap) => ({ gap, paper: byId.get(gap.id) ?? null })), hubsRead: hubRecords.length, hubsWithLists: hubRecords.filter((r) => r.referencedWorks.length > 0).length, minCount },
    stopped: read.stopped ?? details.stopped,
  };
}

/**
 * Runs the tool for one input. `deeperMin` (null = off) adds the second level. Errors from the client propagate (the window shows
 * them); a budget stop is reported in the result.
 */
export async function runGaps(input: GapInput, deps: GapsDeps, minCount = 3, deeperMin: number | null = null): Promise<GapsRun> {
  if (input.kind === "references") return runReferenceList(input, deps, minCount, deeperMin);

  let record: Candidate | null;
  if (input.kind === "work") {
    record = await recordOf(input, deps);
  } else {
    const found = await findTitle(input.title, deps);
    if (found === "stop") return empty(deps.budget.spent, { stopped: `stopped at $${deps.budget.spent.toFixed(4)} before searching for the title` });
    record = found;
    if (record && !record.referencedWorks) record = (await deps.client.getFullWork({ id: shortOpenAlexId(record.openalexId) })) ?? record;
  }
  if (record === null) return empty(deps.budget.spent, { message: "OpenAlex has no record for that paper, so there is nothing to compare. Try its DOI, or paste its reference list." });
  const refs = record.referencedWorks ?? [];
  const subject = subjectOf(record);
  if (refs.length === 0) return empty(deps.budget.spent, { subject, message: "OpenAlex lists no references for this paper, so its gaps cannot be worked out. Paste its reference list instead." });
  const id = shortOpenAlexId(record.openalexId) ?? "paper";
  const paper = { id, referencedWorks: refs };
  const g = await fetchCitationGaps(paper, deps, minCount, MAX_GAPS);
  const deep = deeperMin === null ? null : await goDeeper(paper, g.records, deps, deeperMin);
  return empty(deps.budget.spent, { subject, referencesRead: g.referencesRead, referencesWithLists: g.referencesWithLists, gaps: g.gaps, stopped: g.stopped ?? deep?.stopped ?? null, deeper: deep?.deeper ?? null });
}

async function runReferenceList(input: Extract<GapInput, { kind: "references" }>, deps: GapsDeps, minCount: number, deeperMin: number | null): Promise<GapsRun> {
  const resolved: Candidate[] = [];
  const unresolved: string[] = [];
  let stopped: string | null = null;
  let searches = 0;

  for (let i = 0; i < input.dois.length && stopped === null; i += 50) {
    const batch = input.dois.slice(i, i + 50);
    if (!deps.budget.canAfford(COST_FILTER)) {
      stopped = `stopped at $${deps.budget.spent.toFixed(4)} before looking up the DOIs`;
      break;
    }
    const res = await deps.client.getWorksByDoi(batch);
    deps.budget.add(res.costUsd > 0 ? res.costUsd : COST_FILTER);
    putWorks(deps.cache, res.papers, deps.now);
    resolved.push(...res.papers);
    const got = new Set(res.papers.map((p) => bareDoi(p.doi)));
    for (const d of batch) if (!got.has(d)) unresolved.push(d);
  }
  for (const title of input.lines.slice(0, MAX_TITLE_SEARCHES)) {
    if (stopped !== null) break;
    const found = await findTitle(title, deps);
    if (found === "stop") {
      stopped = `stopped at $${deps.budget.spent.toFixed(4)} before searching all the titles`;
      break;
    }
    searches++;
    if (found) resolved.push(found);
    else unresolved.push(title);
  }
  if (input.lines.length > MAX_TITLE_SEARCHES) unresolved.push(...input.lines.slice(MAX_TITLE_SEARCHES).map((t) => `${t} (not searched: the limit is ${MAX_TITLE_SEARCHES} references without a DOI)`));

  const refs = resolved.flatMap((c) => { const id = shortOpenAlexId(c.openalexId); return id ? [{ id, referencedWorks: c.referencedWorks ?? [] }] : []; });
  const unique = [...new Map(refs.map((r) => [r.id, r])).values()];
  if (unique.length === 0) return empty(deps.budget.spent, { unresolved, searches, stopped, message: "None of the references could be found in OpenAlex." });
  const pasted = { id: "pasted", referencedWorks: unique.map((r) => r.id) };
  const gaps = citationGaps(pasted, unique, minCount, MAX_GAPS);
  const details = await worksById(gaps.map((g) => g.id), deps);
  const byId = new Map(details.papers.flatMap((p) => { const id = shortOpenAlexId(p.openalexId); return id ? [[id, p] as const] : []; }));
  const deep = deeperMin === null ? null : await goDeeper(pasted, unique, deps, deeperMin);
  return empty(deps.budget.spent, {
    referencesRead: unique.length, referencesWithLists: unique.filter((r) => r.referencedWorks.length > 0).length,
    gaps: gaps.map((gap) => ({ gap, paper: byId.get(gap.id) ?? null })), unresolved, searches, stopped: stopped ?? details.stopped ?? deep?.stopped ?? null, deeper: deep?.deeper ?? null,
  });
}
