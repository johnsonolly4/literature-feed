// A local index of the Zotero library (item key, bare DOI, title, collections) so a literature review can say which papers you already
// have, and which are in a search's seed collection, without one request per paper. Pure: the plugin reads and writes `zotero-index.json` and fetches with `ZoteroClient`. The index
// is read-only and stays on the device; it is refreshed incrementally with Zotero's library version (`since`).
import { bareDoi } from "./map";
import { titleKey } from "./client";

export interface IndexedItem {
  doi: string;
  title: string;
  /** Keys of the collections the item is directly in, as the API reports it (the subcollections' items are not included). */
  collections: string[];
  /** A standalone note in a collection: it has no DOI or title and is never a known paper. */
  note?: true;
}

/** A collection of the library; one in Zotero's Trash stays listed but never counts. */
export interface IndexedCollection {
  key: string;
  name: string;
  /** Key of the parent collection, null for a top-level one. */
  parent: string | null;
  trashed: boolean;
}

export interface ZoteroIndex {
  /** 2: items also carry their collections, and the collection list is stored. A format 1 file is still read (see `normaliseIndex`). */
  version: 2;
  /** Zotero's library version at the last refresh; 0 = never refreshed (the next refresh reads the whole library). */
  libraryVersion: number;
  collections: IndexedCollection[];
  /** Keyed by the item's Zotero key. */
  items: Record<string, IndexedItem>;
}

/** One item as the client reads it: the key and the fields the index needs. */
export interface LibraryItemRow {
  key: string;
  doi: string;
  title: string;
  collections: string[];
  /** In Zotero's Trash: the item is removed from the index. */
  trashed: boolean;
  note: boolean;
}

export function emptyIndex(): ZoteroIndex {
  return { version: 2, libraryVersion: 0, collections: [], items: {} };
}

/** The DOI of an item: its DOI field, or, for types without one (a thesis), a `DOI: …` line in Extra. */
export function doiOfItem(data: { DOI?: unknown; extra?: unknown }): string {
  if (typeof data.DOI === "string" && data.DOI.trim() !== "") return bareDoi(data.DOI);
  const fromExtra = typeof data.extra === "string" ? /^\s*DOI:\s*(\S+)/im.exec(data.extra)?.[1] : undefined;
  return fromExtra ? bareDoi(fromExtra) : "";
}

/**
 * The index after a refresh: fetched items added or replaced, trashed and deleted ones removed, the collection list replaced, and
 * collection keys that are no longer in that list dropped from every item. When the index was never refreshed (library version 0,
 * which is also what a format 1 file gets) the fetched items replace the old ones: `/deleted` answers nothing for version 0, so
 * merging would keep items deleted since.
 */
export function mergeIndex(
  index: ZoteroIndex, fetched: readonly LibraryItemRow[], deleted: readonly string[], libraryVersion: number, collections: readonly IndexedCollection[],
): ZoteroIndex {
  const items: Record<string, IndexedItem> = index.libraryVersion === 0 ? {} : { ...index.items };
  for (const key of deleted) delete items[key];
  for (const row of fetched) {
    const identified = row.doi !== "" || row.title !== "" || (row.note && row.collections.length > 0);
    if (row.trashed || !identified) delete items[row.key];
    else items[row.key] = { doi: row.doi, title: row.title, collections: [...row.collections], ...(row.note ? { note: true as const } : {}) };
  }
  const known = new Set(collections.map((c) => c.key));
  for (const [key, item] of Object.entries(items)) {
    if (item.collections.some((c) => !known.has(c))) items[key] = { ...item, collections: item.collections.filter((c) => known.has(c)) };
  }
  return { version: 2, libraryVersion: Math.max(index.libraryVersion, libraryVersion), collections: collections.map((c) => ({ ...c })), items };
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

/** Reads a stored file. A format 1 file keeps its items (the flags still work) with library version 0, so the next refresh reads everything. */
export function normaliseIndex(raw: unknown): ZoteroIndex {
  const out = emptyIndex();
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return out;
  const r = raw as { version?: unknown; libraryVersion?: unknown; collections?: unknown; items?: unknown };
  if (r.version === 2 && typeof r.libraryVersion === "number" && Number.isInteger(r.libraryVersion) && r.libraryVersion >= 0) out.libraryVersion = r.libraryVersion;
  if (r.version === 2 && Array.isArray(r.collections)) {
    for (const c of r.collections) {
      if (typeof c !== "object" || c === null) continue;
      const { key, name, parent, trashed } = c as { key?: unknown; name?: unknown; parent?: unknown; trashed?: unknown };
      if (typeof key !== "string" || !/^[A-Z0-9]{8}$/.test(key) || typeof name !== "string") continue;
      out.collections.push({ key, name, parent: typeof parent === "string" && parent !== "" ? parent : null, trashed: trashed === true });
    }
  }
  if (typeof r.items === "object" && r.items !== null && !Array.isArray(r.items)) {
    for (const [key, v] of Object.entries(r.items)) {
      if (!/^[A-Z0-9]{8}$/.test(key) || typeof v !== "object" || v === null) continue;
      const { doi, title, collections, note } = v as { doi?: unknown; title?: unknown; collections?: unknown; note?: unknown };
      if (typeof doi === "string" && typeof title === "string") {
        out.items[key] = { doi, title, collections: stringList(collections), ...(note === true ? { note: true as const } : {}) };
      }
    }
  }
  return out;
}

export interface ZoteroLookup {
  byDoi: Map<string, string>;
  byTitle: Map<string, string>;
}

export function buildLookup(index: ZoteroIndex): ZoteroLookup {
  const byDoi = new Map<string, string>();
  const byTitle = new Map<string, string>();
  for (const [key, item] of Object.entries(index.items)) {
    if (item.doi !== "" && !byDoi.has(item.doi)) byDoi.set(item.doi, key);
    const t = titleKey(item.title);
    if (t !== "" && !byTitle.has(t)) byTitle.set(t, key);
  }
  return { byDoi, byTitle };
}

/** The Zotero key of the item with this DOI, else with the same title (letters and digits only); null when there is none. */
export function findInZotero(lookup: ZoteroLookup, doi: string | null | undefined, title: string): string | null {
  const bare = bareDoi(doi ?? "");
  if (bare !== "" && lookup.byDoi.has(bare)) return lookup.byDoi.get(bare) ?? null;
  const t = titleKey(title);
  return t !== "" ? lookup.byTitle.get(t) ?? null : null;
}
