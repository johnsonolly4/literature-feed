// The citation network of a set of papers, from what OpenAlex says each paper cites. Pure: no network here. Edges are citations
// between papers in the set; "missing" papers are works the set cites often that are not in it; "also cite" papers are works outside
// the set that cite several of its papers; the charts' numbers (per year, authors, most cited, most networked) come from here too.
import type { ReviewPaper } from "./collect";

export interface Network {
  /** `from` cites `to`; both are in the set (short OpenAlex ids). */
  edges: { from: string; to: string }[];
  /** Citations inside the set, per paper. */
  degree: Map<string, { in: number; out: number }>;
  /** Paper ids, the most cited inside the set first (at most `topHubs`, none with no citations). */
  hubs: string[];
  /** Groups of papers that cite each other, biggest first; papers with no link to any other are in `isolated`. */
  clusters: string[][];
  isolated: string[];
  /** Works the set cites that are not in it: how many papers of the set cite each, and which. Most first. */
  missing: { id: string; count: number; citers: string[] }[];
}

export interface NetworkOptions {
  /** A work must be cited by at least this many papers of the set to be called missing. */
  minMissing: number;
  topMissing: number;
  topHubs: number;
}

export const DEFAULT_NETWORK_OPTIONS: NetworkOptions = { minMissing: 2, topMissing: 20, topHubs: 10 };

/** Groups by connected pieces, then splits a piece that holds most of the set by label propagation (deterministic). */
function clustersOf(ids: readonly string[], edges: readonly { from: string; to: string }[]): { clusters: string[][]; isolated: string[] } {
  const neighbours = new Map<string, string[]>(ids.map((id) => [id, []]));
  for (const e of edges) {
    neighbours.get(e.from)?.push(e.to);
    neighbours.get(e.to)?.push(e.from);
  }
  const isolated = ids.filter((id) => (neighbours.get(id) ?? []).length === 0);
  const linked = ids.filter((id) => (neighbours.get(id) ?? []).length > 0);
  const label = new Map<string, string>();
  // Connected pieces first: every node takes the smallest id reachable.
  const seen = new Set<string>();
  for (const start of [...linked].sort()) {
    if (seen.has(start)) continue;
    const piece: string[] = [];
    const stack = [start];
    seen.add(start);
    while (stack.length > 0) {
      const id = stack.pop() as string;
      piece.push(id);
      for (const n of neighbours.get(id) ?? []) if (!seen.has(n)) { seen.add(n); stack.push(n); }
    }
    const root = [...piece].sort()[0];
    for (const id of piece) label.set(id, root);
  }
  // A piece holding more than 60% of the linked papers is split by label propagation, so a clear core is not one blob.
  const sizes = new Map<string, number>();
  for (const l of label.values()) sizes.set(l, (sizes.get(l) ?? 0) + 1);
  for (const [root, size] of sizes) {
    if (size < 8 || size <= linked.length * 0.6) continue;
    const members = linked.filter((id) => label.get(id) === root).sort();
    const own = new Map(members.map((id) => [id, id]));
    for (let round = 0; round < 12; round++) {
      let changed = false;
      for (const id of members) {
        const counts = new Map<string, number>();
        for (const n of neighbours.get(id) ?? []) {
          const l = own.get(n);
          if (l !== undefined) counts.set(l, (counts.get(l) ?? 0) + 1);
        }
        let best = own.get(id) as string;
        let bestCount = counts.get(best) ?? 0;
        for (const [l, c] of [...counts].sort((a, b) => a[0].localeCompare(b[0]))) {
          if (c > bestCount) { best = l; bestCount = c; }
        }
        if (best !== own.get(id)) { own.set(id, best); changed = true; }
      }
      if (!changed) break;
    }
    for (const [id, l] of own) label.set(id, `${root}/${l}`);
  }
  const groups = new Map<string, string[]>();
  for (const id of linked) {
    const l = label.get(id) as string;
    groups.set(l, [...(groups.get(l) ?? []), id]);
  }
  const clusters = [...groups.values()].map((g) => g.sort()).sort((a, b) => b.length - a.length || a[0].localeCompare(b[0]));
  return { clusters, isolated };
}

export function buildNetwork(papers: readonly ReviewPaper[], options: NetworkOptions = DEFAULT_NETWORK_OPTIONS): Network {
  const ids = papers.map((p) => p.id);
  const inSet = new Set(ids);
  const edges: Network["edges"] = [];
  const degree = new Map<string, { in: number; out: number }>(ids.map((id) => [id, { in: 0, out: 0 }]));
  const outside = new Map<string, string[]>();
  for (const p of papers) {
    for (const ref of new Set(p.referencedWorks)) {
      if (ref === p.id) continue;
      if (inSet.has(ref)) {
        edges.push({ from: p.id, to: ref });
        (degree.get(p.id) as { in: number; out: number }).out++;
        (degree.get(ref) as { in: number; out: number }).in++;
      } else {
        outside.set(ref, [...(outside.get(ref) ?? []), p.id]);
      }
    }
  }
  const hubs = [...ids]
    .filter((id) => (degree.get(id) as { in: number }).in > 0)
    .sort((a, b) => (degree.get(b) as { in: number }).in - (degree.get(a) as { in: number }).in || a.localeCompare(b))
    .slice(0, options.topHubs);
  const missing = [...outside]
    .filter(([, citers]) => citers.length >= options.minMissing)
    .map(([id, citers]) => ({ id, count: citers.length, citers }))
    .sort((a, b) => b.count - a.count || a.id.localeCompare(b.id))
    .slice(0, options.topMissing);
  return { edges, degree, hubs, ...clustersOf(ids, edges), missing };
}

/** Works outside the set that cite several of its papers: for each, how many (from a list of works that cite the seeds). */
export function alsoCites(
  citing: readonly { id: string; referencedWorks: readonly string[] }[], setIds: ReadonlySet<string>, minCount = 3, top = 20,
): { id: string; count: number; cites: string[] }[] {
  const out = new Map<string, string[]>();
  for (const c of citing) {
    if (setIds.has(c.id)) continue;
    const cites = [...new Set(c.referencedWorks.filter((r) => setIds.has(r)))];
    if (cites.length >= minCount) out.set(c.id, cites);
  }
  return [...out].map(([id, cites]) => ({ id, count: cites.length, cites })).sort((a, b) => b.count - a.count || a.id.localeCompare(b.id)).slice(0, top);
}

// ---- numbers for the charts -------------------------------------------------------------------------------------------

export interface ChartData {
  perYear: { year: number; count: number }[];
  topAuthors: { name: string; count: number }[];
  mostCited: { id: string; value: number }[];
  /** Papers with the most citations inside the set, in plus out. */
  mostNetworked: { id: string; value: number }[];
}

export function chartData(papers: readonly ReviewPaper[], network: Network, top = 10): ChartData {
  const years = new Map<number, number>();
  for (const p of papers) if (p.year !== null) years.set(p.year, (years.get(p.year) ?? 0) + 1);
  const perYear: ChartData["perYear"] = [];
  if (years.size > 0) {
    const min = Math.min(...years.keys());
    const max = Math.max(...years.keys());
    for (let y = min; y <= max; y++) perYear.push({ year: y, count: years.get(y) ?? 0 });
  }
  const authors = new Map<string, number>();
  for (const p of papers) for (const name of new Set(p.authors)) authors.set(name, (authors.get(name) ?? 0) + 1);
  const topAuthors = [...authors].filter(([, n]) => n >= 2).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)).slice(0, top);
  const mostCited = [...papers].filter((p) => p.citedByCount > 0).sort((a, b) => b.citedByCount - a.citedByCount || a.id.localeCompare(b.id)).slice(0, top).map((p) => ({ id: p.id, value: p.citedByCount }));
  const mostNetworked = [...papers]
    .map((p) => ({ id: p.id, value: (network.degree.get(p.id)?.in ?? 0) + (network.degree.get(p.id)?.out ?? 0) }))
    .filter((x) => x.value > 0)
    .sort((a, b) => b.value - a.value || a.id.localeCompare(b.id))
    .slice(0, top);
  return { perYear, topAuthors, mostCited, mostNetworked };
}

// ---- citation gaps of one paper ---------------------------------------------------------------------------------------

export interface Gap {
  id: string;
  /** How many of the paper's references cite this work. */
  count: number;
  /** The share of the paper's references (that have a reference list) that cite it, 0 to 1. */
  share: number;
}

/**
 * What a paper does not cite that many of its own references do. `references` are the paper's references with their own
 * reference lists; works the paper cites itself (and the paper) are left out. Needs at least `minCount` references citing a work.
 */
export function citationGaps(
  paper: { id: string; referencedWorks: readonly string[] },
  references: readonly { id: string; referencedWorks: readonly string[] }[],
  minCount = 3,
  top = 15,
): Gap[] {
  const own = new Set([paper.id, ...paper.referencedWorks]);
  const withLists = references.filter((r) => r.referencedWorks.length > 0);
  const counts = new Map<string, number>();
  for (const r of withLists) {
    for (const w of new Set(r.referencedWorks)) {
      if (own.has(w) || w === r.id) continue;
      counts.set(w, (counts.get(w) ?? 0) + 1);
    }
  }
  return [...counts]
    .filter(([, n]) => n >= minCount)
    .map(([id, count]) => ({ id, count, share: withLists.length === 0 ? 0 : count / withLists.length }))
    .sort((a, b) => b.count - a.count || a.id.localeCompare(b.id))
    .slice(0, top);
}
