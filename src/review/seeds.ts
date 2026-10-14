// Papers the user already knows are on the subject ("seeds") as a yardstick for a search's results: a paper that cites what the
// seeds cite, or is written by the people who wrote them, is probably what the user is looking for, however it words its title.
// Pure: the seeds are read elsewhere (OpenAlex) and passed in as candidates.
import type { Candidate } from "../openalex/client";
import { shortOpenAlexId } from "../inbox/write";
import { authorKey } from "./gaps-authors";
import { parseDoiList } from "./gaps-input";

/** What the seeds share, kept with the review so a result can be sorted again without reading them again. */
export interface SeedProfile {
  /** The DOIs asked for, and the ones OpenAlex had (short ids). */
  dois: string[];
  ids: string[];
  /** How many seeds cite each work (short id), and how many are by each author (family name and first initial). */
  refs: Record<string, number>;
  authors: Record<string, number>;
  /** DOIs OpenAlex had no record of. */
  missing: string[];
  /** The papers' words, for building search strings from them (absent in profiles saved before this existed). */
  papers?: { id: string; title: string; abstract: string | null }[];
  /** What each paper cites and who wrote it (author keys), for the links between papers (absent in profiles saved before this existed). */
  perPaper?: { id: string; refs: string[]; authors: string[] }[];
}

/** The DOIs in a pasted text, for the seeds (a reference list, links, one per line: anything). */
export const seedDois = (text: string): string[] => parseDoiList(text);

export function buildSeedProfile(dois: readonly string[], found: readonly Candidate[]): SeedProfile {
  const refs: Record<string, number> = {};
  const authors: Record<string, number> = {};
  const ids: string[] = [];
  const have = new Set<string>();
  for (const c of found) {
    const id = shortOpenAlexId(c.openalexId);
    if (id === null || ids.includes(id)) continue;
    ids.push(id);
    if (c.doi) have.add(c.doi.toLowerCase().replace(/^https?:\/\/(dx\.)?doi\.org\//, ""));
    for (const r of new Set(c.referencedWorks ?? [])) refs[r] = (refs[r] ?? 0) + 1;
    for (const k of new Set(c.authors.map(authorKey).filter((k) => k !== ""))) authors[k] = (authors[k] ?? 0) + 1;
  }
  const papers = found.flatMap((c) => { const id = shortOpenAlexId(c.openalexId); return id === null ? [] : [{ id, title: c.title, abstract: c.abstract ?? null }]; });
  const perPaper = found.flatMap((c) => { const id = shortOpenAlexId(c.openalexId); return id === null ? [] : [{ id, refs: [...new Set(c.referencedWorks ?? [])], authors: [...new Set(c.authors.map(authorKey).filter((k) => k !== ""))] }]; });
  return { dois: [...dois], ids, refs, authors, missing: dois.filter((d) => !have.has(d.toLowerCase())), papers, perPaper };
}

export interface SeedScore {
  /** References the paper shares with the seeds, and authors it shares with them (those on two or more seeds, or on the only seeds there are). */
  refs: number;
  authors: number;
  /** One number to sort by: a shared reference counts 1, a shared author 3. */
  score: number;
  /** The paper is one of the seeds. */
  isSeed: boolean;
}

export function seedScore(p: { id: string; referencedWorks: readonly string[]; authors: readonly string[] }, profile: SeedProfile): SeedScore {
  const isSeed = profile.ids.includes(p.id);
  // A seed is judged by the other seeds only, so it cannot rank itself high by being itself: its own references do not count, and an
  // author counts when they are on this seed and on another (their count includes the seed).
  const own = isSeed ? 1 : 0;
  const authorMin = profile.ids.length >= 3 ? 2 : 1;
  const refs = new Set(p.referencedWorks).size === 0 ? 0 : [...new Set(p.referencedWorks)].filter((r) => (profile.refs[r] ?? 0) - own >= 1).length;
  const authors = [...new Set(p.authors.map(authorKey).filter((k) => k !== ""))].filter((k) => (profile.authors[k] ?? 0) >= authorMin).length;
  return { refs, authors, score: refs + authors * 3, isSeed };
}

/** A short line for the prompt and the note, or "" when the paper shares nothing. */
export function seedLine(s: SeedScore): string {
  if (s.refs === 0 && s.authors === 0) return "";
  return `${s.isSeed ? "one of my known papers; " : ""}shares ${s.refs} reference${s.refs === 1 ? "" : "s"} and ${s.authors} author${s.authors === 1 ? "" : "s"} with the papers I already know`;
}
