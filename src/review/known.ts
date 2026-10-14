// The papers a search knows are what it is after: the items directly in its seed collection (`<its Zotero collection>/seeds`) in
// the local Zotero index, plus DOIs added by hand. Pure: no requests; the index is read from `zotero-index.json`.
import type { FeedConfig } from "../settings/data";
import { pathParts } from "../zotero/client";
import type { IndexedCollection, ZoteroIndex } from "../zotero/library-index";
import { COST_FILTER } from "./budget";
import { seedDois } from "./seeds";

/** The seed collection of a search as a path: the one set in the search, else `<Zotero collection>/seeds`, else null (not set). */
export function seedCollectionPath(feed: Pick<FeedConfig, "zoteroCollection" | "seedCollection">): string | null {
  const explicit = pathParts(feed.seedCollection);
  if (explicit.length > 0) return explicit.join("/");
  const inbox = pathParts(feed.zoteroCollection);
  return inbox.length > 0 ? [...inbox, "seeds"].join("/") : null;
}

function pathOf(collections: readonly IndexedCollection[], c: IndexedCollection): string {
  const names = [c.name];
  const seen = new Set([c.key]);
  for (let p = c.parent; p !== null; ) {
    const parent = collections.find((x) => x.key === p);
    if (!parent || seen.has(parent.key)) break;
    names.unshift(parent.name);
    seen.add(parent.key);
    p = parent.parent;
  }
  return names.join("/");
}

/** Walks a path through the collections not in the Trash; `same` decides when a name matches. Null when a name is missing. */
function walk(live: readonly IndexedCollection[], parts: readonly string[], same: (a: string, b: string) => boolean): IndexedCollection | null {
  let parent: string | null = null;
  let found: IndexedCollection | null = null;
  for (const part of parts) {
    found = live.find((c) => c.parent === parent && same(c.name, part)) ?? null;
    if (!found) return null;
    parent = found.key;
  }
  return found;
}

export interface SeedCollectionLookup {
  /** The collection's key, or null when there is none at exactly this path. */
  key: string | null;
  /** When not found: collections that look like it (the same path in another case, or another collection called the same as the last name). */
  nearMisses: string[];
}

/** The collection at this path: exact names (case included), collections in Zotero's Trash left out. */
export function resolveSeedCollection(collections: readonly IndexedCollection[], path: string): SeedCollectionLookup {
  const live = collections.filter((c) => !c.trashed);
  const parts = pathParts(path);
  const exact = walk(live, parts, (a, b) => a === b);
  if (exact) return { key: exact.key, nearMisses: [] };
  const nearMisses: string[] = [];
  const otherCase = walk(live, parts, (a, b) => a.toLowerCase() === b.toLowerCase());
  if (otherCase) nearMisses.push(pathOf(live, otherCase));
  const last = (parts[parts.length - 1] ?? "").toLowerCase();
  for (const c of live) {
    const p = pathOf(live, c);
    if (last !== "" && c.name.toLowerCase() === last && !nearMisses.includes(p)) nearMisses.push(p);
  }
  return { key: null, nearMisses };
}

export interface KnownPapers {
  /** "not-set": no seed collection for this search. "not-found": none at that path. "empty": it has no items. */
  status: "not-set" | "not-found" | "empty" | "ok";
  /** The seed collection's path, or null when not set. */
  path: string | null;
  nearMisses: string[];
  /** The known papers' DOIs: the seed collection's, then the extra ones, each once. */
  dois: string[];
  /** Seed items that have no DOI (they cannot be read), to be given one in Zotero. */
  withoutDoi: { key: string; title: string }[];
  counts: {
    /** Items directly in the seed collection. */
    items: number;
    withDoi: number;
    without: number;
    /** DOIs left out because they were already listed (the same paper twice, or an extra DOI that is also a seed). */
    repeats: number;
    /** Items that are not papers (notes). */
    notCounted: number;
    /** Extra DOIs added by hand and recognised. */
    extra: number;
  };
}

/** A search's known papers from the index: the items directly in its seed collection (not its subcollections) and its extra DOIs. */
export function knownPapers(feed: FeedConfig, index: ZoteroIndex): KnownPapers {
  const path = seedCollectionPath(feed);
  const extras = seedDois(feed.knownDois.join("\n"));
  const out: KnownPapers = {
    status: "not-set", path, nearMisses: [], dois: [], withoutDoi: [],
    counts: { items: 0, withDoi: 0, without: 0, repeats: 0, notCounted: 0, extra: extras.length },
  };
  const dois = new Set<string>();
  if (path !== null) {
    const found = resolveSeedCollection(index.collections, path);
    out.nearMisses = found.nearMisses;
    out.status = "not-found";
    if (found.key !== null) {
      for (const [key, item] of Object.entries(index.items)) {
        if (!item.collections.includes(found.key)) continue;
        out.counts.items++;
        if (item.note) out.counts.notCounted++;
        else if (item.doi === "") out.withoutDoi.push({ key, title: item.title });
        else {
          out.counts.withDoi++;
          if (dois.has(item.doi)) out.counts.repeats++;
          dois.add(item.doi);
        }
      }
      out.counts.without = out.withoutDoi.length;
      out.status = out.counts.items === 0 ? "empty" : "ok";
    }
  }
  for (const doi of extras) {
    if (dois.has(doi)) out.counts.repeats++;
    dois.add(doi);
  }
  out.dois = [...dois];
  return out;
}

/** What reading N papers from OpenAlex costs: a filtered list of up to 50 per request. */
export function readCostUsd(papers: number): number {
  return COST_FILTER * Math.ceil(papers / 50);
}

/** Sentences for the review window about a search's known papers, before anything is read; `warn` marks a problem to fix. */
export function describeKnown(k: KnownPapers, searchName: string): { text: string; warn: boolean }[] {
  const lines: { text: string; warn: boolean }[] = [];
  const add = (text: string, warn: boolean): void => { lines.push({ text, warn }); };
  if (k.status === "not-set") {
    add(`${searchName} has no seed collection: it has no Zotero collection set. Set one in the search, or give a seed collection path.`, true);
  } else if (k.status === "not-found") {
    add(`Collection not found in Zotero: ${k.path ?? ""}. Names are matched exactly, capitals included, and a collection in the Trash does not count. Sync Zotero desktop first if you just made it.`, true);
    if (k.nearMisses.length > 0) add(`Did you mean: ${k.nearMisses.join("; ")}?`, true);
  } else if (k.status === "empty") {
    add(`The collection ${k.path ?? ""} is empty. Add the papers you know are right to it in Zotero, then fill again.`, true);
  }
  const c = k.counts;
  if (k.status === "ok" || c.extra > 0) {
    const parts = [
      k.status === "ok" ? `${c.items} items in ${k.path ?? ""}: ${c.withDoi} with a DOI, ${c.without} without${c.notCounted > 0 ? `, ${c.notCounted} not papers` : ""}` : "",
      c.extra > 0 ? `${c.extra} extra DOIs` : "",
      c.repeats > 0 ? `${c.repeats} repeats left out` : "",
    ].filter((p) => p !== "");
    add(`${parts.join("; ")}. ${k.dois.length} papers to read, about $${readCostUsd(k.dois.length).toFixed(4)}.`, false);
  }
  if (k.withoutDoi.length > 0) add(`${k.withoutDoi.length} seed items have no DOI and are left out. Add the DOI in Zotero (the DOI field, or a line "DOI: …" in Extra for types without one): ${k.withoutDoi.map((p) => p.title || p.key).join("; ")}`, true);
  return lines;
}
