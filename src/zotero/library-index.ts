// A local index of the Zotero library (item key, bare DOI, title) so a literature review can say which papers you already have
// without one request per paper. Pure: the plugin reads and writes `zotero-index.json` and fetches with `ZoteroClient`. The index
// is read-only and stays on the device; it is refreshed incrementally with Zotero's library version (`since`).
import { bareDoi } from "./map";
import { titleKey } from "./client";

export interface IndexedItem {
  doi: string;
  title: string;
}

export interface ZoteroIndex {
  version: 1;
  /** Zotero's library version at the last refresh; 0 = never refreshed. */
  libraryVersion: number;
  /** Keyed by the item's Zotero key. */
  items: Record<string, IndexedItem>;
}

/** One item as the client reads it: the key and the fields the index needs. */
export interface LibraryItemRow {
  key: string;
  doi: string;
  title: string;
}

export function emptyIndex(): ZoteroIndex {
  return { version: 1, libraryVersion: 0, items: {} };
}

/** The DOI of an item: its DOI field, or, for types without one (a thesis), a `DOI: …` line in Extra. */
export function doiOfItem(data: { DOI?: unknown; extra?: unknown }): string {
  if (typeof data.DOI === "string" && data.DOI.trim() !== "") return bareDoi(data.DOI);
  const fromExtra = typeof data.extra === "string" ? /^\s*DOI:\s*(\S+)/im.exec(data.extra)?.[1] : undefined;
  return fromExtra ? bareDoi(fromExtra) : "";
}

/** The index after a refresh: fetched items added or replaced, deleted ones removed, the new library version stored. */
export function mergeIndex(index: ZoteroIndex, fetched: readonly LibraryItemRow[], deleted: readonly string[], libraryVersion: number): ZoteroIndex {
  const items = { ...index.items };
  for (const key of deleted) delete items[key];
  for (const row of fetched) {
    if (row.doi === "" && row.title === "") delete items[row.key];
    else items[row.key] = { doi: row.doi, title: row.title };
  }
  return { version: 1, libraryVersion: Math.max(index.libraryVersion, libraryVersion), items };
}

export function normaliseIndex(raw: unknown): ZoteroIndex {
  const out = emptyIndex();
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return out;
  const r = raw as { libraryVersion?: unknown; items?: unknown };
  if (typeof r.libraryVersion === "number" && Number.isInteger(r.libraryVersion) && r.libraryVersion >= 0) out.libraryVersion = r.libraryVersion;
  if (typeof r.items === "object" && r.items !== null && !Array.isArray(r.items)) {
    for (const [key, v] of Object.entries(r.items)) {
      if (!/^[A-Z0-9]{8}$/.test(key) || typeof v !== "object" || v === null) continue;
      const { doi, title } = v as { doi?: unknown; title?: unknown };
      if (typeof doi === "string" && typeof title === "string") out.items[key] = { doi, title };
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
