// Whether the papers a search is built on form one coherent path: how strongly each pair is linked (shared references, shared authors),
// which papers are linked to almost none of the others (outliers), which groups are linked more to each other than to the rest
// (strands), and whether a new paper fits. Pure and free: it reads the seed profile that was already fetched.
import { mineTerms, type SeedText } from "./seed-queries";
import type { SeedProfile } from "./seeds";

/** A paper's references (work ids) and authors (author keys). */
export interface LinkNode {
  id: string;
  refs: readonly string[];
  authors: readonly string[];
}

export interface Strand {
  ids: string[];
  /** Phrases the strand's papers share, most shared first (at most 3). */
  phrases: string[];
}

export interface Coherence {
  /** "ok" when the papers could be judged; otherwise why not. */
  status: "ok" | "too-few" | "no-data";
  /** Link between every pair, as `idA|idB` (ids in the order of the profile). */
  links: Record<string, number>;
  /** Total link of each paper to all the others. */
  totals: Record<string, number>;
  /** Ids of papers linked to none or almost none of the others, or alone in their group. */
  outliers: string[];
  /** Groups of two or more papers linked more to each other than to the rest. */
  strands: Strand[];
}

const OUTLIER_SHARE = 0.25;
const MIN_PAPERS = 3;

const count = (a: readonly string[], b: ReadonlySet<string>): number => a.filter((x) => b.has(x)).length;

/** Shared references count 1 each, shared authors 3 each (the weights `seedScore` uses). */
export function pairLinks(a: LinkNode, b: LinkNode): number {
  return count(a.refs, new Set(b.refs)) + 3 * count(a.authors, new Set(b.authors));
}

const median = (xs: readonly number[]): number => {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[m] : (s[m - 1] + s[m]) / 2;
};

export const pairKey = (a: string, b: string): string => `${a}|${b}`;

export function coherence(profile: SeedProfile): Coherence {
  const empty = (status: Coherence["status"]): Coherence => ({ status, links: {}, totals: {}, outliers: [], strands: [] });
  const nodes = profile.perPaper;
  if (!nodes) return empty("no-data");
  if (nodes.length < MIN_PAPERS) return empty("too-few");

  const links: Record<string, number> = {};
  const totals: Record<string, number> = Object.fromEntries(nodes.map((n) => [n.id, 0]));
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const l = pairLinks(nodes[i], nodes[j]);
      links[pairKey(nodes[i].id, nodes[j].id)] = l;
      totals[nodes[i].id] += l;
      totals[nodes[j].id] += l;
    }
  }

  const medTotal = median(Object.values(totals));
  const isOutlier = new Set(nodes.filter((n) => totals[n.id] === 0 || totals[n.id] < medTotal * OUTLIER_SHARE).map((n) => n.id));

  // Connected groups of the other papers, joined by links at or above the median link (union-find).
  const medLink = median(Object.values(links).filter((l) => l > 0));
  const parent = new Map(nodes.map((n) => [n.id, n.id]));
  const find = (x: string): string => { let r = x; while (parent.get(r) !== r) r = parent.get(r) ?? r; return r; };
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i].id, b = nodes[j].id;
      if (isOutlier.has(a) || isOutlier.has(b) || links[pairKey(a, b)] < medLink || links[pairKey(a, b)] === 0) continue;
      parent.set(find(a), find(b));
    }
  }
  const groups = new Map<string, string[]>();
  for (const n of nodes) if (!isOutlier.has(n.id)) groups.set(find(n.id), [...(groups.get(find(n.id)) ?? []), n.id]);

  const texts = new Map<string, SeedText>((profile.papers ?? []).map((p) => [p.id, p]));
  const strands: Strand[] = [];
  for (const ids of groups.values()) {
    if (ids.length === 1) { isOutlier.add(ids[0]); continue; } // a strand of one paper is an outlier
    const papers = ids.flatMap((id) => { const t = texts.get(id); return t ? [t] : []; });
    strands.push({ ids, phrases: mineTerms(papers, 2).slice(0, 3).map((m) => m.term) });
  }
  strands.sort((a, b) => b.ids.length - a.ids.length);
  return { status: "ok", links, totals, outliers: nodes.filter((n) => isOutlier.has(n.id)).map((n) => n.id), strands };
}

/** The mean link of a paper to the papers of a profile (leaving itself out when it is one of them). */
function meanOverlap(p: LinkNode, nodes: readonly LinkNode[]): number {
  const others = nodes.filter((n) => n.id !== p.id);
  return others.length === 0 ? 0 : others.reduce((s, n) => s + pairLinks(p, n), 0) / others.length;
}

export interface Fit {
  /** The paper's mean link to the known papers, and the lowest mean link a known paper has to the others. */
  overlap: number;
  lowest: number;
  fits: boolean;
  /** The name of another search whose known papers the paper overlaps more (and fits), when it does not fit this one. */
  betterSearch: string | null;
}

/** Whether a new paper fits a search: its overlap with the known papers against the lowest overlap of a known paper with the rest. */
export function fitOfNew(paper: LinkNode, profile: SeedProfile, others: readonly { name: string; profile: SeedProfile }[] = []): Fit | null {
  const nodes = profile.perPaper;
  if (!nodes || nodes.length < MIN_PAPERS) return null;
  const overlap = meanOverlap(paper, nodes);
  const lowest = Math.min(...nodes.map((n) => meanOverlap(n, nodes)));
  const fits = overlap > 0 && overlap >= lowest;
  let betterSearch: string | null = null;
  if (!fits) {
    let best = overlap;
    for (const o of others) {
      const on = o.profile.perPaper;
      if (!on || on.length < MIN_PAPERS) continue;
      const ov = meanOverlap(paper, on);
      const low = Math.min(...on.map((n) => meanOverlap(n, on)));
      if (ov > best && ov > 0 && ov >= low) { best = ov; betterSearch = o.name; }
    }
  }
  return { overlap, lowest, fits, betterSearch };
}

/** Lines for the known papers box: outliers first, then the strands. Empty when there is nothing to say. */
export function coherenceLines(c: Coherence, title: (id: string) => string): string[] {
  if (c.status === "no-data") return ["Press the button again to check how the papers link (this profile was saved before links were kept)."];
  if (c.status === "too-few") return [];
  const lines = c.outliers.map((id) => `${title(id)}: linked to almost none of your other papers. It does not belong here, or this search needs a second strand.`);
  if (c.strands.length > 1) {
    c.strands.forEach((s, i) => lines.push(`Strand ${i + 1} (${s.ids.length} papers${s.phrases.length > 0 ? `; ${s.phrases.join(", ")}` : ""}): ${s.ids.map(title).join("; ")}`));
  } else if (c.strands.length === 1 && c.outliers.length === 0) {
    lines.push("Your papers link to each other: they look like one strand.");
  }
  return lines;
}
