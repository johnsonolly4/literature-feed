// The citation-gaps tool's OpenAlex requests, each inside a budget and using the cache: one paper (by DOI, id or title) or a pasted
// list of references, resolved to OpenAlex works, then what many of them cite and the paper does not. The client is passed in
// (a fake in tests); nothing here touches Obsidian.
import { shortOpenAlexId } from "../inbox/write";
import { filterSafeDoi, type Candidate } from "../openalex/client";
import { titleKey } from "../zotero/client";
import { bareDoi } from "../zotero/map";
import { COST_FILTER, COST_SEARCH } from "./budget";
import { getTitle, getWork, putTitle, putWorks } from "./cache";
import { MAX_TITLE_SEARCHES, titleInReference, titleOverlap, type GapInput } from "./gaps-input";
import { type WorkRef } from "./gaps-authors";
import { citationGaps, sharedHubs, type Gap } from "./network";
import { bothRoutes, neighbourhood, type NeighbourRow } from "./neighbours";
import {
  MAX_DEEPER, MAX_GAPS, MAX_HUBS, estimateCiterScan, fetchCitationGaps, fetchCiters, splitHeavy, worksById,
  type CiterClient, type CiterRef, type NetworkClient, type NetworkDeps,
} from "./network-fetch";

export interface GapsClient extends NetworkClient, CiterClient {
  getFullWork(ref: { doi?: string | null; id?: string | null }): Promise<Candidate | null>;
  authorWorks(authorId: string, citedIds: readonly string[]): Promise<{ papers: Candidate[]; costUsd: number }>;
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

/** What the similar-paper scan found (signals 2a and 2b): kept with the run, absent when the scan was not asked for. */
export interface SimilarRun {
  /** The scan did not run: the user declined after seeing the price, or there was nothing to scan. `message` says why. */
  skipped: boolean;
  message: string | null;
  /** The references used as the paper's list, how many similar papers were found, how many of them are the neighbours. */
  referenceCount: number;
  similarFound: number;
  neighbours: number;
  /** What a work needed: `minShared` references shared to count as similar, `minimum` neighbours citing it for signal 2b. */
  minShared: number;
  minimum: number;
  /** Set when too few similar papers were found for the counts to mean much. */
  warning: string | null;
  /** References cited too often to scan (their citing works are not read), and how many references were not read before a stop. */
  heavySkipped: { id: string; title: string; citedBy: number }[];
  unscanned: number;
  citersRead: number;
  requests: number;
  /** The neighbours, most similar first: their ids, how many of the references they share and the weighted share (absent in runs saved before 2026-10-15 evening). */
  neighbourList?: { id: string; shared: number; weighted: number }[];
  /** Signal 2b: works the neighbours cite (not among the references), with their records. */
  rows: { gap: NeighbourRow; paper: Candidate | null; refCount?: number }[];
  /** The ids of the works found on both routes (signal 1 and signal 2b). */
  bothIds: string[];
  stopped: string | null;
}

/** What the user is shown before the scan runs. */
export interface ScanEstimate {
  requests: number;
  costUsd: number;
  works: number;
  scanned: number;
  heavy: CiterRef[];
}

export interface ScanOptions {
  /** Asked once, with the real price and the skipped heavy references, before any citing work is read. False skips the scan. */
  confirm?: (estimate: ScanEstimate) => Promise<boolean>;
}

export interface GapsRun {
  /** The paper asked about (not for a pasted list). */
  subject: { title: string; doi: string | null; id: string | null; year: number | null; authors: string[] } | null;
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
  /** The similar-paper scan, when it was asked for (absent in runs saved before it existed). */
  similar?: SimilarRun | null;
  /** The author names of each reference that was read (the cited side of the authors table). */
  citedAuthors: string[][];
  /** DOIs added by hand that OpenAlex knew. */
  addedDois: string[];
  /** The references that were read, as works (the cited side of the authors drill-down), and their ids. */
  citedWorks: WorkRef[];
  referenceIds: string[];
  /** False for a run saved before the author details were kept (they come back empty; run it again to get them). */
  detailsKept?: boolean;
  /** Something to tell the user instead of a list (no record, no references). */
  message: string | null;
  spentUsd: number;
}

function subjectOf(c: Candidate): NonNullable<GapsRun["subject"]> {
  return { title: c.title, doi: c.doi ? bareDoi(c.doi) : null, id: shortOpenAlexId(c.openalexId), year: c.year ?? null, authors: c.authors };
}

/** A candidate as a work reference. */
export function toWorkRef(c: Candidate): WorkRef {
  return { id: shortOpenAlexId(c.openalexId) ?? "", title: c.title, year: c.year ?? null, doi: c.doi ? bareDoi(c.doi) : null, authors: c.authors, authorIds: c.authorIds ?? [], citedBy: c.citedByCount ?? null };
}

const empty = (spentUsd: number, over: Partial<GapsRun>): GapsRun => ({
  subject: null, referencesRead: 0, referencesWithLists: 0, gaps: [], unresolved: [], searches: 0, stopped: null, deeper: null, citedAuthors: [], addedDois: [], citedWorks: [], referenceIds: [], message: null, spentUsd, ...over,
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

/** DOIs added by hand, looked up in lists of 50 (a filtered list each); the ones OpenAlex does not know are reported, never dropped. */
async function resolveExtra(dois: readonly string[], deps: GapsDeps): Promise<{ ids: string[]; found: string[]; notFound: string[]; stopped: string | null }> {
  const list = [...new Set(dois.map((d) => d.trim().toLowerCase()).filter((d) => d !== ""))];
  const safe = list.filter(filterSafeDoi);
  const ids: string[] = [];
  const found: string[] = [];
  let stopped: string | null = null;
  for (let i = 0; i < safe.length; i += 50) {
    if (!deps.budget.canAfford(COST_FILTER)) {
      stopped = `stopped at $${deps.budget.spent.toFixed(4)} before looking up the DOIs you added`;
      break;
    }
    const res = await deps.client.getWorksByDoi(safe.slice(i, i + 50));
    deps.budget.add(res.costUsd > 0 ? res.costUsd : COST_FILTER);
    putWorks(deps.cache, res.papers, deps.now);
    for (const p of res.papers) {
      const id = shortOpenAlexId(p.openalexId);
      if (id) ids.push(id);
      if (p.doi) found.push(bareDoi(p.doi));
    }
  }
  const got = new Set(found);
  return { ids, found, notFound: list.filter((d) => !got.has(d)), stopped };
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

const emptySimilar = (over: Partial<SimilarRun>): SimilarRun => ({
  skipped: true, message: null, referenceCount: 0, similarFound: 0, neighbours: 0, minShared: 0, minimum: 0, warning: null, heavySkipped: [], unscanned: 0, citersRead: 0, requests: 0, rows: [], bothIds: [], stopped: null, ...over,
});

/**
 * The similar-paper scan. The works that cite the references are read (the rarest reference first; references cited `HEAVY_CITATIONS` times
 * or more are left out and listed), the citing works sharing enough references are the similar papers, the most similar are the neighbours,
 * and what many neighbours cite and the paper does not is signal 2b. The reader sees the price first through `opts.confirm`.
 */
async function scanSimilar(
  paper: { id: string; year: number | null }, references: readonly Candidate[], signal1: readonly Gap[], deps: GapsDeps, opts: ScanOptions,
): Promise<SimilarRun> {
  const refs: CiterRef[] = references.flatMap((c) => { const id = shortOpenAlexId(c.openalexId); return id ? [{ id, citedBy: c.citedByCount ?? 0, title: c.title }] : []; });
  if (refs.length === 0) return emptySimilar({ message: "No reference could be read, so there is nothing to scan." });
  const { scan, heavy } = splitHeavy(refs);
  const heavySkipped = heavy.map((h) => ({ id: h.id, title: h.title ?? h.id, citedBy: h.citedBy }));
  const est = estimateCiterScan(scan);
  if (opts.confirm && !(await opts.confirm({ ...est, scanned: scan.length, heavy }))) {
    return emptySimilar({ message: "The scan for similar papers was skipped.", referenceCount: refs.length, heavySkipped });
  }
  const read = await fetchCiters(scan, { client: deps.client, budget: deps.budget });
  const focal = refs.map((r) => ({ id: r.id, citedBy: r.citedBy }));
  const hood = neighbourhood(read.citers, focal, { paperId: paper.id, maxYear: paper.year });
  const top = hood.rows.slice(0, MAX_GAPS);
  // How many of the references cite each listed work (0 when none), so the chart's x axis is the true share and not just those above the signal-1 limit.
  const refLists = references.map((c) => new Set(c.referencedWorks ?? []));
  const refCountOf = (id: string): number => refLists.filter((l) => l.has(id)).length;
  const details = await worksById(top.map((r) => r.id), deps);
  const byId = new Map(details.papers.flatMap((p) => { const id = shortOpenAlexId(p.openalexId); return id ? [[id, p] as const] : []; }));
  return {
    skipped: false, message: null, referenceCount: refs.length, similarFound: hood.similar.length, neighbours: hood.neighbours.length,
    minShared: hood.minShared, minimum: hood.minimum, warning: hood.warning, heavySkipped, unscanned: read.unscanned.length,
    citersRead: read.citers.length, requests: read.requests, neighbourList: hood.neighbours.map((n) => ({ id: n.id, shared: n.shared.length, weighted: Math.round(n.weighted * 1000) / 1000 })), rows: top.map((gap) => ({ gap, paper: byId.get(gap.id) ?? null, refCount: refCountOf(gap.id) })),
    bothIds: [...bothRoutes(signal1, hood.rows)], stopped: read.stopped ?? details.stopped,
  };
}

/**
 * Runs the tool for one input. `deeperMin` (null = off) adds the second level. Errors from the client propagate (the window shows
 * them); a budget stop is reported in the result.
 */
export async function runGaps(input: GapInput, deps: GapsDeps, minCount = 3, deeperMin: number | null = null, extraDois: readonly string[] = [], scan: ScanOptions | null = null): Promise<GapsRun> {
  if (input.kind === "references") return runReferenceList(input, deps, minCount, deeperMin, scan);

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
  const subject = subjectOf(record);
  const added = await resolveExtra(extraDois, deps);
  const notFound = added.notFound.map((d) => `${d} (added by hand)`);
  // The DOIs added by hand come first, so the limit on how many references are read never cuts them off.
  const refs = [...new Set([...added.ids, ...(record.referencedWorks ?? [])])];
  if (refs.length === 0) return empty(deps.budget.spent, { subject, unresolved: notFound, stopped: added.stopped, message: "OpenAlex lists no references for this paper, so its gaps cannot be worked out. Paste its reference list instead, or add DOIs by hand." });
  const id = shortOpenAlexId(record.openalexId) ?? "paper";
  const paper = { id, referencedWorks: refs };
  const g = await fetchCitationGaps(paper, deps, minCount, MAX_GAPS);
  const deep = deeperMin === null ? null : await goDeeper(paper, g.records, deps, deeperMin);
  const similar = scan === null ? null : await scanSimilar({ id, year: subject.year }, g.referencePapers, g.gaps.map((x) => x.gap), deps, scan);
  return empty(deps.budget.spent, {
    subject, referencesRead: g.referencesRead, referencesWithLists: g.referencesWithLists, gaps: g.gaps, stopped: g.stopped ?? deep?.stopped ?? similar?.stopped ?? added.stopped,
    deeper: deep?.deeper ?? null, similar, citedAuthors: g.referenceAuthors, addedDois: added.found, unresolved: notFound,
    citedWorks: g.referencePapers.map(toWorkRef), referenceIds: g.records.map((r) => r.id),
  });
}

async function runReferenceList(input: Extract<GapInput, { kind: "references" }>, deps: GapsDeps, minCount: number, deeperMin: number | null, scan: ScanOptions | null): Promise<GapsRun> {
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
  const authorsOf = new Map(resolved.flatMap((c) => { const id = shortOpenAlexId(c.openalexId); return id ? [[id, c.authors] as const] : []; }));
  if (unique.length === 0) return empty(deps.budget.spent, { unresolved, searches, stopped, message: "None of the references could be found in OpenAlex." });
  const pasted = { id: "pasted", referencedWorks: unique.map((r) => r.id) };
  const gaps = citationGaps(pasted, unique, minCount, MAX_GAPS);
  const details = await worksById(gaps.map((g) => g.id), deps);
  const byId = new Map(details.papers.flatMap((p) => { const id = shortOpenAlexId(p.openalexId); return id ? [[id, p] as const] : []; }));
  const deep = deeperMin === null ? null : await goDeeper(pasted, unique, deps, deeperMin);
  const uniqueResolved = resolved.filter((cand, i, all) => { const id = shortOpenAlexId(cand.openalexId); return id !== null && all.findIndex((o) => shortOpenAlexId(o.openalexId) === id) === i; });
  const similar = scan === null ? null : await scanSimilar({ id: "pasted", year: null }, uniqueResolved, gaps, deps, scan);
  return empty(deps.budget.spent, {
    referencesRead: unique.length, referencesWithLists: unique.filter((r) => r.referencedWorks.length > 0).length,
    gaps: gaps.map((gap) => ({ gap, paper: byId.get(gap.id) ?? null })), unresolved, searches, stopped: stopped ?? details.stopped ?? deep?.stopped ?? similar?.stopped ?? null, deeper: deep?.deeper ?? null, similar,
    citedAuthors: unique.map((r) => authorsOf.get(r.id) ?? []),
    citedWorks: resolved.filter((cand, i, all) => { const id = shortOpenAlexId(cand.openalexId); return id !== null && all.findIndex((o) => shortOpenAlexId(o.openalexId) === id) === i; }).map(toWorkRef),
    referenceIds: unique.map((r) => r.id),
  });
}

export interface AuthorWorkResult {
  /** The author's works that cite some of the paper's references and that the paper does not cite, most shared first. */
  works: { paper: Candidate; shared: number }[];
  stopped: string | null;
}

/**
 * An author's other work on the same ground: their works that cite at least one of the paper's references (read in lists of 50, so at
 * most two lookups), leaving out what the paper cites and the paper itself. Each is listed with how many of the references it cites.
 */
export async function findAuthorWork(authorId: string, referenceIds: readonly string[], subjectId: string | null, deps: GapsDeps): Promise<AuthorWorkResult> {
  const refs = [...new Set(referenceIds)].slice(0, 100);
  const refSet = new Set(refs);
  const found = new Map<string, Candidate>();
  let stopped: string | null = null;
  for (let i = 0; i < refs.length; i += 50) {
    if (!deps.budget.canAfford(COST_FILTER)) {
      stopped = `stopped at $${deps.budget.spent.toFixed(4)} before asking about the author's other work`;
      break;
    }
    const res = await deps.client.authorWorks(authorId, refs.slice(i, i + 50));
    deps.budget.add(res.costUsd > 0 ? res.costUsd : COST_FILTER);
    putWorks(deps.cache, res.papers, deps.now);
    for (const p of res.papers) {
      const id = shortOpenAlexId(p.openalexId);
      if (id !== null && !refSet.has(id) && id !== subjectId) found.set(id, p);
    }
  }
  const works = [...found.values()].map((paper) => ({ paper, shared: (paper.referencedWorks ?? []).filter((r) => refSet.has(r)).length }));
  works.sort((a, b) => b.shared - a.shared || (b.paper.citedByCount ?? 0) - (a.paper.citedByCount ?? 0) || a.paper.title.localeCompare(b.paper.title));
  return { works, stopped };
}
