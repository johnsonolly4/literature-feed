// Signals 2a and 2b of the citation-gaps tool (from the owner's refcheck): among the works that cite a paper's references, the ones that share
// several of them are "similar papers"; the most similar are the neighbours; what many neighbours cite and the paper does not is signal 2b.
// Plain counts and shares, no combined score. Pointers, not verdicts: the neighbour set is a modelling choice (how many, how many shared).
// Pure: the citing works come from `fetchCiters` (network-fetch.ts). Neighbours are not filtered for reviews or self-citation yet (refcheck's
// optional filters, planned as R4).
import type { Citer } from "../openalex/client";

export const MIN_SHARED = 5;
export const NEIGHBOURS = 30;
/** Fewer similar papers than this and the neighbour counts are thin: the tool says so. */
export const THIN_SIMILAR = 10;

/** A reference of the paper and how often it is cited. */
export interface FocalRef {
  id: string;
  citedBy: number;
}

export interface SimilarPaper {
  id: string;
  year: number | null;
  /** Which of the paper's references it also cites. */
  shared: string[];
  /** Shared references weighted towards the less-cited ones (1 / ln(2 + citations) each). */
  weighted: number;
  /** shared / (its references + the paper's references − shared). */
  jaccard: number;
  referencedWorks: string[];
}

export interface SimilarOptions {
  minShared?: number;
  /** Citing works published after this year are left out (the paper's own year). */
  maxYear?: number | null;
  /** The paper itself never counts as similar. */
  paperId?: string;
}

/** The citing works that share at least `minShared` of the references, most similar first (weighted, then shared, then id). Each work once. */
export function similarPapers(citers: readonly Citer[], focal: readonly FocalRef[], opts: SimilarOptions = {}): SimilarPaper[] {
  const { minShared = MIN_SHARED, maxYear = null, paperId } = opts;
  const focalById = new Map(focal.map((f) => [f.id, f.citedBy]));
  const seen = new Set<string>();
  const out: SimilarPaper[] = [];
  for (const c of citers) {
    if (seen.has(c.id) || focalById.has(c.id) || c.id === paperId) continue;
    seen.add(c.id);
    if (maxYear !== null && c.year !== null && c.year > maxYear) continue;
    const theirs = new Set(c.referencedWorks);
    const shared = [...focalById.keys()].filter((id) => theirs.has(id));
    if (shared.length < minShared) continue;
    const weighted = shared.reduce((sum, id) => sum + 1 / Math.log(2 + (focalById.get(id) ?? 0)), 0);
    out.push({ id: c.id, year: c.year, shared, weighted, jaccard: shared.length / (theirs.size + focalById.size - shared.length), referencedWorks: c.referencedWorks });
  }
  return out.sort((a, b) => b.weighted - a.weighted || b.shared.length - a.shared.length || a.id.localeCompare(b.id));
}

/** How many neighbours must cite a work for signal 2b: a tenth of them, at least 3. */
export function neighbourMinimum(neighbourCount: number): number {
  return Math.max(3, Math.ceil(0.1 * neighbourCount));
}

export interface NeighbourRow {
  id: string;
  /** How many neighbours cite it, and the share of the neighbours. */
  count: number;
  share: number;
}

/** What the neighbours cite that is not among the paper's references (or the paper, or a neighbour), each work once per neighbour. */
export function neighbourCounts(neighbours: readonly SimilarPaper[], focalIds: ReadonlySet<string>, paperId?: string): NeighbourRow[] {
  const nbIds = new Set(neighbours.map((n) => n.id));
  const min = neighbourMinimum(neighbours.length);
  const counts = new Map<string, number>();
  for (const n of neighbours) {
    for (const w of new Set(n.referencedWorks)) {
      if (focalIds.has(w) || nbIds.has(w) || w === paperId || w === n.id) continue;
      counts.set(w, (counts.get(w) ?? 0) + 1);
    }
  }
  return [...counts]
    .filter(([, count]) => count >= min)
    .map(([id, count]) => ({ id, count, share: count / neighbours.length }))
    .sort((a, b) => b.count - a.count || a.id.localeCompare(b.id));
}

/** Share of the neighbours minus share of the references that cite it, in percentage points (a fact, not a score). */
export function gapPoints(neighbourShare: number, referenceShare: number): number {
  return 100 * (neighbourShare - referenceShare);
}

export interface Neighbourhood {
  similar: SimilarPaper[];
  neighbours: SimilarPaper[];
  /** Signal 2b: works the neighbours cite, at least `minimum` of them. */
  rows: NeighbourRow[];
  /** What each row needed ("needs 3 of your 30 neighbours"). */
  minimum: number;
  minShared: number;
  /** Set when there are too few similar papers for the counts to mean much. */
  warning: string | null;
}

export function neighbourhood(citers: readonly Citer[], focal: readonly FocalRef[], opts: SimilarOptions & { neighbours?: number } = {}): Neighbourhood {
  const similar = similarPapers(citers, focal, opts);
  const neighbours = similar.slice(0, opts.neighbours ?? NEIGHBOURS);
  const rows = neighbourCounts(neighbours, new Set(focal.map((f) => f.id)), opts.paperId);
  return {
    similar, neighbours, rows, minimum: neighbourMinimum(neighbours.length), minShared: opts.minShared ?? MIN_SHARED,
    warning: similar.length < THIN_SIMILAR ? `Only ${similar.length} similar paper${similar.length === 1 ? "" : "s"} found (fewer than ${THIN_SIMILAR}): the counts below rest on very few papers.` : null,
  };
}

/** The works on both routes: cited by many of the references (signal 1) and by many of the neighbours (signal 2b). */
export function bothRoutes(signal1: readonly { id: string }[], rows: readonly NeighbourRow[]): Set<string> {
  const one = new Set(signal1.map((g) => g.id));
  return new Set(rows.filter((r) => one.has(r.id)).map((r) => r.id));
}
