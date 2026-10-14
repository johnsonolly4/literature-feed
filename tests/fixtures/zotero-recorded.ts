// Shapes of Zotero API v3 answers (`/items?includeTrashed=1`, `/collections`, `/deleted`) with invented keys, titles and DOIs.
// No authors, no real library; user ID 123456. Used to test the index and the seed collection.

const item = (key: string, version: number, data: Record<string, unknown>) => ({ key, version, data: { key, version, ...data } });

/** Collections: Inbox / SDL / seeds (with a subcollection "more"), a trashed "old", Other / seeds, and a trashed Trashed / seeds. */
export const COLLECTIONS_PAGE = [
  { key: "INBX0001", data: { name: "Inbox", parentCollection: false } },
  { key: "SDLX0001", data: { name: "SDL", parentCollection: "INBX0001" } },
  { key: "SEED0001", data: { name: "seeds", parentCollection: "SDLX0001" } },
  { key: "MORE0001", data: { name: "more", parentCollection: "SEED0001" } },
  { key: "OLDX0001", data: { name: "old", parentCollection: "INBX0001", deleted: true } },
  { key: "OTHR0001", data: { name: "Other", parentCollection: "INBX0001" } },
  { key: "SEED0002", data: { name: "seeds", parentCollection: "OTHR0001" } },
  { key: "TRSD0001", data: { name: "Trashed", parentCollection: "INBX0001" } },
  { key: "SEED0003", data: { name: "seeds", parentCollection: "TRSD0001", deleted: true } },
];

export const ITEMS_PAGE = [
  item("ITEM0001", 11, { itemType: "journalArticle", title: "Self-driving polymer synthesis", DOI: "10.1000/sdl.1", collections: ["SEED0001", "SDLX0001"] }),
  item("ITEM0002", 12, { itemType: "thesis", title: "Closed-loop optimisation of RAFT", extra: "DOI: 10.1000/SDL.2", collections: ["SEED0001"] }),
  item("ITEM0003", 13, { itemType: "bookSection", title: "Flow chemistry chapter without a DOI", collections: ["SEED0001"] }),
  item("ITEM0004", 14, { itemType: "journalArticle", title: "In the SDL collection, not in seeds", DOI: "10.1000/sdl.4", collections: ["SDLX0001"] }),
  item("ITEM0005", 15, { itemType: "journalArticle", title: "In a subcollection of seeds", DOI: "10.1000/sdl.5", collections: ["MORE0001"] }),
  item("ITEM0006", 16, { itemType: "journalArticle", title: "Trashed seed", DOI: "10.1000/sdl.6", collections: ["SEED0001"], deleted: 1 }),
  item("ITEM0007", 17, { itemType: "note", note: "<p>a loose note</p>", collections: ["SEED0001"] }),
  item("ITEM0008", 18, { itemType: "note", note: "<p>a child note</p>", parentItem: "ITEM0001", collections: [] }),
  item("ITEM0009", 19, { itemType: "journalArticle", title: "Self-driving polymer synthesis (preprint)", DOI: "https://doi.org/10.1000/SDL.1", collections: ["SEED0001"] }),
  item("ITEM0010", 20, { itemType: "journalArticle", title: "Also in a collection that is gone", DOI: "10.1000/sdl.10", collections: ["SEED0001", "GONE0001"] }),
];

/** `/deleted?since=…`: an item that was removed for good since the last refresh. */
export const DELETED_ANSWER = { collections: [], items: ["OLDITEM1"], searches: [], tags: [], settings: [] };
