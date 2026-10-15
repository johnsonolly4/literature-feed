// The library map: the papers of the Zotero library grouped by how they link (shared references, shared authors) and named from
// the phrases each group shares, so the user can judge the groups before any seed collection is made from them. Pure and free:
// the papers' references are read elsewhere (OpenAlex) and passed in. Nothing here writes to Zotero.
import type { Candidate } from "../openalex/client";
import { shortOpenAlexId } from "../inbox/write";
import { coherence } from "../review/coherence";
import { mineTerms, type SeedText } from "../review/seed-queries";
import { buildSeedProfile } from "../review/seeds";
import type { ZoteroIndex } from "../zotero/library-index";

/** A library paper that can be read from OpenAlex: its Zotero key and DOI. */
export interface LibraryPaper {
  key: string;
  doi: string;
  title: string;
}

export interface LibraryPapers {
  withDoi: LibraryPaper[];
  /** Papers with no DOI: they cannot be read, so they are not grouped. */
  withoutDoi: { key: string; title: string }[];
}

export interface MapGroup {
  id: string;
  /** What the user calls the group (the phrases it shares until renamed). */
  name: string;
  /** Phrases the group's papers share, most shared first (at most 3). */
  phrases: string[];
  /** Zotero item keys. */
  keys: string[];
  /** The search whose seed collection this group would become, or null while unassigned. */
  feedId: string | null;
}

export interface LibraryMap {
  status: "ok" | "too-few" | "no-data";
  groups: MapGroup[];
  /** Keys of papers linked to almost none of the others, or alone in their group. */
  outliers: string[];
  /** Keys of papers whose DOI OpenAlex had no record of. */
  notFound: string[];
}

/** The library's papers from the index (notes are left out), split by whether they have a DOI. */
export function libraryPapers(index: ZoteroIndex): LibraryPapers {
  const out: LibraryPapers = { withDoi: [], withoutDoi: [] };
  const seen = new Set<string>();
  for (const [key, item] of Object.entries(index.items)) {
    if (item.note) continue;
    if (item.doi === "") out.withoutDoi.push({ key, title: item.title });
    else if (!seen.has(item.doi)) {
      seen.add(item.doi);
      out.withDoi.push({ key, doi: item.doi, title: item.title });
    }
  }
  return out;
}

const bareDoi = (doi: string): string => doi.toLowerCase().replace(/^https?:\/\/(dx\.)?doi\.org\//, "");

/** Groups the papers OpenAlex returned for the library's DOIs. */
export function mapLibrary(papers: readonly LibraryPaper[], found: readonly Candidate[]): LibraryMap {
  const empty = (status: LibraryMap["status"], notFound: string[] = []): LibraryMap => ({ status, groups: [], outliers: [], notFound });
  const keyOfDoi = new Map(papers.map((p) => [bareDoi(p.doi), p.key]));
  const keyOfId = new Map<string, string>();
  for (const c of found) {
    const id = shortOpenAlexId(c.openalexId);
    const key = c.doi ? keyOfDoi.get(bareDoi(c.doi)) : undefined;
    if (id !== null && key !== undefined && !keyOfId.has(id)) keyOfId.set(id, key);
  }
  const have = new Set(keyOfId.values());
  const notFound = papers.filter((p) => !have.has(p.key)).map((p) => p.key);

  const profile = buildSeedProfile(papers.map((p) => p.doi), found);
  const c = coherence(profile);
  if (c.status !== "ok") return empty(c.status, notFound);

  const texts = new Map<string, SeedText>((profile.papers ?? []).map((p) => [p.id, p]));
  const keys = (ids: readonly string[]): string[] => ids.flatMap((id) => { const k = keyOfId.get(id); return k === undefined ? [] : [k]; });
  const groups = c.strands.map((s, i): MapGroup => {
    const inside = new Set(s.ids);
    // Phrases common to the rest of the library say nothing about this group, so the rest is the background.
    const background = [...texts.values()].filter((t) => !inside.has(t.id)).map((t) => `${t.title}\n${t.abstract ?? ""}`);
    const mine = s.ids.flatMap((id) => { const t = texts.get(id); return t ? [t] : []; });
    const phrases = mineTerms(mine, 2, background).slice(0, 3).map((m) => m.term);
    return { id: `g${i + 1}`, name: phrases[0] ?? `Group ${i + 1}`, phrases, keys: keys(s.ids), feedId: null };
  });
  return { status: "ok", groups, outliers: keys(c.outliers), notFound };
}

const without = (keys: readonly string[], drop: ReadonlySet<string>): string[] => keys.filter((k) => !drop.has(k));
const nextId = (m: LibraryMap): string => `g${Math.max(0, ...m.groups.map((g) => Number(g.id.slice(1)) || 0)) + 1}`;

export function renameGroup(m: LibraryMap, id: string, name: string): LibraryMap {
  const clean = name.trim();
  return clean === "" ? m : { ...m, groups: m.groups.map((g) => (g.id === id ? { ...g, name: clean } : g)) };
}

export function assignGroup(m: LibraryMap, id: string, feedId: string | null): LibraryMap {
  return { ...m, groups: m.groups.map((g) => (g.id === id ? { ...g, feedId } : g)) };
}

/** The listed groups become the first one (its name and search are kept); the others disappear. */
export function mergeGroups(m: LibraryMap, ids: readonly string[]): LibraryMap {
  const chosen = m.groups.filter((g) => ids.includes(g.id));
  if (chosen.length < 2) return m;
  const [first, ...rest] = chosen;
  const merged: MapGroup = { ...first, keys: chosen.flatMap((g) => g.keys), phrases: [...new Set(chosen.flatMap((g) => g.phrases))].slice(0, 3) };
  return { ...m, groups: m.groups.filter((g) => !rest.some((r) => r.id === g.id)).map((g) => (g.id === first.id ? merged : g)) };
}

/** Moves one paper to a group, or to the outliers (`null`). A group left with no paper is dropped. */
export function movePaper(m: LibraryMap, key: string, to: string | null): LibraryMap {
  if (to !== null && !m.groups.some((g) => g.id === to)) return m;
  const drop = new Set([key]);
  const groups = m.groups
    .map((g) => (g.id === to ? { ...g, keys: [...without(g.keys, drop), key] } : { ...g, keys: without(g.keys, drop) }))
    .filter((g) => g.keys.length > 0);
  return { ...m, groups, outliers: to === null ? [...without(m.outliers, drop), key] : without(m.outliers, drop) };
}

/** Takes the papers out of a group into a new group of their own (named after the first of them if the caller gives no name). */
export function splitGroup(m: LibraryMap, id: string, keys: readonly string[], name: string): LibraryMap {
  const group = m.groups.find((g) => g.id === id);
  const take = new Set(keys.filter((k) => group?.keys.includes(k)));
  if (!group || take.size === 0 || take.size === group.keys.length) return m;
  const fresh: MapGroup = { id: nextId(m), name: name.trim() || `Split from ${group.name}`, phrases: [], keys: [...take], feedId: null };
  return { ...m, groups: [...m.groups.map((g) => (g.id === id ? { ...g, keys: without(g.keys, take) } : g)), fresh] };
}
