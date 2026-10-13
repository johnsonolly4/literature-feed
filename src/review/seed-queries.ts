// Search strings built from papers the user already knows: the phrases the papers share (in their titles and abstracts) are mined,
// combined into short AND-of-OR strings in the form OpenAlex takes, and each string is tested against the papers themselves, so a
// string comes with the list of known papers it finds, and the list it misses. Pure and free: only the optional size check asks
// OpenAlex anything (one count, $0.0001). The leave-one-out test says how likely a string built this way finds a paper it was not
// built from.
import { containsTerm, normaliseText, spellingForms, termVariants } from "../match/score";

export interface SeedText {
  id: string;
  title: string;
  abstract: string | null;
}

/** One search string: every group must match, and a group matches when any of its terms does. */
export interface SeedQuery {
  groups: string[][];
  /** Ids of the known papers it matches (title or abstract). */
  matches: string[];
  /** The string to put in a search. */
  text: string;
}

const STOP = new Set(("a an and are as at be been but by can for from had has have here how in into is it its may more most new not of on one or our out over so such than that the their then there these they this those through to two three up use used using via was we were what when which while who will with within without also between both each other only some very well show shown shows study studies work paper results result based novel approach method methods high low large small present presented report reported demonstrate demonstrated").split(" "));
const MAX_WORDS = 4;
const MAX_COMMON = 0.35;

/** Whether a paper's title or abstract matches every group of the query (the same whole-word, either-spelling test the search rules use). */
export function matchesQuery(groups: readonly (readonly string[])[], p: SeedText): boolean {
  return groups.length > 0 && groups.every((g) => g.some((t) => containsTerm(p.title, t) || containsTerm(p.abstract ?? "", t)));
}

/** The string as OpenAlex takes it: terms of more than one word in quotes, both spellings, groups joined by AND. */
export function queryText(groups: readonly (readonly string[])[]): string {
  const group = (g: readonly string[]): string => {
    const forms = [...new Set(g.flatMap((t) => spellingForms(t)))].map((t) => (/\s/.test(t) ? `"${t}"` : t));
    return forms.length === 1 ? forms[0] : `(${forms.join(" OR ")})`;
  };
  return groups.map(group).join(" AND ");
}

interface Mined {
  term: string;
  words: number;
  /** Indexes of the papers whose text has it. */
  seeds: Set<number>;
  /** The share of the background papers that have it (0 to 1), or null when there is no background. */
  common: number | null;
}

/**
 * The phrases (one to four words) that several of the papers share, longest first when a longer one has the same papers. A single
 * word is kept only when it is an acronym in the papers (RAFT, SAXS): plain words are too common to search on.
 */
export function mineTerms(papers: readonly SeedText[], minPapers = 2, background: readonly string[] = []): Mined[] {
  const acronyms = new Map<string, Set<number>>();
  const grams = new Map<string, Set<number>>();
  papers.forEach((p, i) => {
    const raw = `${p.title}\n${p.abstract ?? ""}`;
    for (const m of raw.matchAll(/\b[A-Z][A-Z0-9]{2,7}\b/g)) {
      const k = normaliseText(m[0]);
      acronyms.set(k, (acronyms.get(k) ?? new Set()).add(i));
    }
    const words = normaliseText(raw).split(" ").filter(Boolean);
    const seen = new Set<string>();
    for (let n = 1; n <= MAX_WORDS; n++) {
      for (let s = 0; s + n <= words.length; s++) {
        const gram = words.slice(s, s + n);
        if (STOP.has(gram[0]) || STOP.has(gram[n - 1]) || gram.some((w) => /^\d+$/.test(w) || w.length < 2)) continue;
        seen.add(gram.join(" "));
      }
    }
    for (const g of seen) grams.set(g, (grams.get(g) ?? new Set()).add(i));
  });
  const keep = (g: string, set: Set<number>): boolean => {
    if (set.size < minPapers) return false;
    if (g.includes(" ")) return true;
    return (acronyms.get(g)?.size ?? 0) >= minPapers;
  };
  const bg = background.map((t) => ` ${normaliseText(t)} `);
  const common = (term: string): number | null => {
    if (bg.length === 0) return null;
    const forms = termVariants(term).map((v) => ` ${v} `);
    return bg.filter((t) => forms.some((f) => t.includes(f))).length / bg.length;
  };
  const all = [...grams]
    .filter(([g, set]) => keep(g, set))
    .map(([term, seeds]): Mined => ({ term, words: term.split(" ").length, seeds, common: common(term) }))
    // A phrase in more than a third of the background papers says nothing about what these papers have in common.
    .filter((m) => m.common === null || m.common <= MAX_COMMON);
  // A phrase inside a longer one found in the same papers adds nothing: keep the longer.
  return all
    .filter((a) => !all.some((b) => b !== a && b.words > a.words && b.seeds.size === a.seeds.size && ` ${b.term} `.includes(` ${a.term} `)))
    .sort((a, b) => b.seeds.size - a.seeds.size || b.words - a.words || a.term.localeCompare(b.term));
}

/** How specific a phrase is: longer and rarer in the background is better. */
const weight = (m: Mined): number => (m.words >= 3 ? 3 : m.words === 2 ? 2 : 1) + (m.common === null ? 0 : 3 * (1 - m.common));

export interface SuggestOptions {
  /** The most strings to give (default 6). */
  max?: number;
  /** A phrase must be in this many papers (default 2). */
  minPapers?: number;
  /** Texts of other papers of the field (for example everything an earlier search fetched): phrases common in them are left out. */
  background?: readonly string[];
}

interface Candidate {
  groups: string[];
  seeds: Set<number>;
  score: number;
}

/**
 * Strings that together find the papers: greedily, the one that finds most of the papers not yet found, until none adds a paper.
 * A string is one phrase of three or more words, or two phrases joined by AND; each phrase is widened with the phrases that are in
 * nearly the same papers (synonyms such as "flow NMR" and "benchtop NMR"), and both spellings are written out.
 */
export function suggestQueries(papers: readonly SeedText[], opts: SuggestOptions = {}): SeedQuery[] {
  const mined = mineTerms(papers, opts.minPapers ?? 2, opts.background ?? []).slice(0, 80);
  const covered = new Set<number>();
  const out: SeedQuery[] = [];
  const candidates: Candidate[] = [];
  for (const a of mined) if (a.words >= 3) candidates.push({ groups: [a.term], seeds: a.seeds, score: weight(a) });
  for (let i = 0; i < mined.length; i++) {
    for (let j = i + 1; j < mined.length; j++) {
      const a = mined[i];
      const b = mined[j];
      if (` ${a.term} `.includes(` ${b.term} `) || ` ${b.term} `.includes(` ${a.term} `)) continue;
      const seeds = new Set([...a.seeds].filter((x) => b.seeds.has(x)));
      if (seeds.size >= 2) candidates.push({ groups: [a.term, b.term], seeds, score: weight(a) + weight(b) });
    }
  }
  const better = (c: Candidate, fresh: number, best: Candidate | null, bestFresh: number): boolean => {
    if (fresh !== bestFresh) return fresh > bestFresh;
    if (best === null) return false;
    return c.seeds.size > best.seeds.size || (c.seeds.size === best.seeds.size && c.score > best.score);
  };
  while (out.length < (opts.max ?? 6)) {
    let best: Candidate | null = null;
    let bestFresh = 0;
    for (const c of candidates) {
      const fresh = [...c.seeds].filter((x) => !covered.has(x)).length;
      if (fresh > 0 && better(c, fresh, best, bestFresh)) {
        best = c;
        bestFresh = fresh;
      }
    }
    if (best === null) break;
    const groups = best.groups.map((t) => widen(t, mined, best?.groups ?? []));
    const hit = new Set(papers.flatMap((p, i) => (matchesQuery(groups, p) ? [i] : [])));
    for (const x of hit) covered.add(x);
    out.push({ groups, matches: [...hit].map((i) => papers[i].id), text: queryText(groups) });
    candidates.splice(candidates.indexOf(best), 1);
  }
  return out;
}

/** A phrase and up to two others that are in nearly the same papers (Jaccard 0.6 or more) and not part of it. */
function widen(term: string, mined: readonly Mined[], used: readonly string[]): string[] {
  const base = mined.find((m) => m.term === term);
  if (!base) return [term];
  const extra = mined
    .filter((m) => m.words >= 2 && m.term !== term && !used.includes(m.term) && !` ${m.term} `.includes(` ${term} `) && !` ${term} `.includes(` ${m.term} `))
    .map((m) => ({ m, j: [...m.seeds].filter((x) => base.seeds.has(x)).length / new Set([...m.seeds, ...base.seeds]).size }))
    .filter((x) => x.j >= 0.6)
    .sort((a, b) => b.j - a.j)
    .slice(0, 2)
    .map((x) => x.m.term);
  return [term, ...extra];
}

export interface RecallTest {
  /** Papers found by strings built from all the others. */
  found: number;
  total: number;
  missed: string[];
}

/** Builds the strings without each paper in turn and asks whether they find it: how well the method generalises to a paper it was not built from. */
export function leaveOneOut(papers: readonly SeedText[], opts: SuggestOptions = {}): RecallTest {
  const missed: string[] = [];
  papers.forEach((p, i) => {
    const qs = suggestQueries(papers.filter((_, j) => j !== i), opts);
    if (!qs.some((q) => matchesQuery(q.groups, p))) missed.push(p.id);
  });
  return { found: papers.length - missed.length, total: papers.length, missed };
}
