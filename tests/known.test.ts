// A search's known papers: the seed collection in the Zotero index (built here through the client from recorded-shape answers),
// extra DOIs, and the sentences the review window shows. Nothing calls the network.
import { describe, expect, it } from "vitest";
import { describeKnown, knownPapers, readCostUsd, resolveSeedCollection, seedCollectionPath } from "../src/review/known";
import type { FeedConfig } from "../src/settings/data";
import { ZoteroClient, type HttpRequest, type HttpResponse } from "../src/zotero/client";
import { emptyIndex, mergeIndex, type ZoteroIndex } from "../src/zotero/library-index";
import { COLLECTIONS_PAGE, DELETED_ANSWER, ITEMS_PAGE } from "./fixtures/zotero-recorded";

const feed = (over: Partial<FeedConfig> = {}): FeedConfig => ({
  id: "sdl", name: "SDL", enabled: true, topics: ["t"], groups: [], drop: [], lower: [], yearsFrom: null,
  zoteroCollection: "Inbox/SDL", project: "", seedCollection: "", knownDois: [], ...over,
});

/** The index after one refresh against the recorded-shape answers, read through the real client. */
async function refreshed(): Promise<{ index: ZoteroIndex; calls: HttpRequest[] }> {
  const calls: HttpRequest[] = [];
  const client = new ZoteroClient({
    userId: "123456", apiKey: "test-key-not-real", sleep: async () => { /* tests do not wait */ },
    request: async (req): Promise<HttpResponse> => {
      calls.push(req);
      if (req.url.includes("/items?")) return { status: 200, json: ITEMS_PAGE, headers: { "last-modified-version": "20" } };
      if (req.url.includes("/collections?")) return { status: 200, json: COLLECTIONS_PAGE, headers: { "total-results": String(COLLECTIONS_PAGE.length) } };
      if (req.url.includes("/deleted")) return { status: 200, json: DELETED_ANSWER, headers: {} };
      throw new Error(`unexpected request ${req.url}`);
    },
  });
  const items = await client.listLibraryItems(0);
  const deleted = await client.listDeleted(0);
  const collections = await client.listCollectionsRaw();
  const index = mergeIndex(emptyIndex(), items.items, deleted, items.libraryVersion, collections.map((c) => ({ key: c.key, name: c.name, parent: c.parent, trashed: c.deleted })));
  return { index, calls };
}

describe("the recorded answers", () => {
  it("become an index with collections, without trashed items or child notes", async () => {
    const { index, calls } = await refreshed();
    expect(calls[0].url).toContain("includeTrashed=1");
    expect(Object.keys(index.items).sort()).toEqual(["ITEM0001", "ITEM0002", "ITEM0003", "ITEM0004", "ITEM0005", "ITEM0007", "ITEM0009", "ITEM0010"]);
    expect(index.items.ITEM0002.doi).toBe("10.1000/sdl.2");
    expect(index.items.ITEM0007.note).toBe(true);
    expect(index.items.ITEM0010.collections).toEqual(["SEED0001"]);
    expect(index.collections.find((c) => c.key === "OLDX0001")?.trashed).toBe(true);
    expect(index.libraryVersion).toBe(20);
  });
});

describe("seedCollectionPath", () => {
  it("is the Zotero collection plus /seeds, unless the search names its own, and null without either", () => {
    expect(seedCollectionPath(feed())).toBe("Inbox/SDL/seeds");
    expect(seedCollectionPath(feed({ zoteroCollection: " Inbox / SDL " }))).toBe("Inbox/SDL/seeds");
    expect(seedCollectionPath(feed({ seedCollection: "Library/Known SDL" }))).toBe("Library/Known SDL");
    expect(seedCollectionPath(feed({ zoteroCollection: "", seedCollection: "Mine" }))).toBe("Mine");
    expect(seedCollectionPath(feed({ zoteroCollection: "" }))).toBeNull();
    expect(seedCollectionPath(feed({ zoteroCollection: " / ", seedCollection: " " }))).toBeNull();
  });

  it("follows the Zotero collection, not the name of the search", () => {
    expect(seedCollectionPath(feed({ name: "Renamed search" }))).toBe("Inbox/SDL/seeds");
  });
});

describe("resolveSeedCollection", () => {
  it("finds an exact path, case included, and leaves out collections in the Trash", async () => {
    const { index } = await refreshed();
    expect(resolveSeedCollection(index.collections, "Inbox/SDL/seeds").key).toBe("SEED0001");
    expect(resolveSeedCollection(index.collections, "Inbox/Other/seeds").key).toBe("SEED0002");
    expect(resolveSeedCollection(index.collections, "Inbox/Trashed/seeds").key).toBeNull();
    expect(resolveSeedCollection(index.collections, "Inbox/old").key).toBeNull();
  });

  it("names near-misses instead of finding the wrong collection", async () => {
    const { index } = await refreshed();
    const wrongCase = resolveSeedCollection(index.collections, "inbox/sdl/Seeds");
    expect(wrongCase.key).toBeNull();
    expect(wrongCase.nearMisses[0]).toBe("Inbox/SDL/seeds");
    const elsewhere = resolveSeedCollection(index.collections, "Inbox/Lipoic/seeds");
    expect(elsewhere.key).toBeNull();
    expect(elsewhere.nearMisses).toEqual(["Inbox/SDL/seeds", "Inbox/Other/seeds"]);
  });
});

describe("knownPapers", () => {
  it("takes the items directly in the seed collection: not the parent's, not a subcollection's, not trashed ones", async () => {
    const { index } = await refreshed();
    const k = knownPapers(feed(), index);
    expect(k.status).toBe("ok");
    expect(k.path).toBe("Inbox/SDL/seeds");
    expect(k.dois).toEqual(["10.1000/sdl.1", "10.1000/sdl.2", "10.1000/sdl.10"]);
    expect(k.withoutDoi).toEqual([{ key: "ITEM0003", title: "Flow chemistry chapter without a DOI" }]);
    expect(k.counts).toEqual({ items: 6, withDoi: 4, without: 1, repeats: 1, notCounted: 1, extra: 0 });
  });

  it("adds the extra DOIs once, counting one that is already a seed as a repeat", async () => {
    const { index } = await refreshed();
    const k = knownPapers(feed({ knownDois: ["https://doi.org/10.1000/SDL.2", "10.1000/extra.1 and 10.1000/extra.2", "no doi here"] }), index);
    expect(k.dois).toEqual(["10.1000/sdl.1", "10.1000/sdl.2", "10.1000/sdl.10", "10.1000/extra.1", "10.1000/extra.2"]);
    expect(k.counts.extra).toBe(3);
    expect(k.counts.repeats).toBe(2);
  });

  it("uses an explicit seed collection instead of the worked-out one", async () => {
    const { index } = await refreshed();
    const k = knownPapers(feed({ seedCollection: "Inbox/Other/seeds" }), index);
    expect(k.status).toBe("empty");
    expect(k.dois).toEqual([]);
  });

  it("says not set, not found or empty, never an empty set that looks like a result", async () => {
    const { index } = await refreshed();
    expect(knownPapers(feed({ zoteroCollection: "" }), index).status).toBe("not-set");
    const missing = knownPapers(feed({ zoteroCollection: "Inbox/Lipoic" }), index);
    expect(missing.status).toBe("not-found");
    expect(missing.nearMisses).toContain("Inbox/SDL/seeds");
    expect(knownPapers(feed({ zoteroCollection: "Inbox/Trashed" }), index).status).toBe("not-found");
    expect(knownPapers(feed({ zoteroCollection: "Inbox/Other" }), index).status).toBe("empty");
    expect(knownPapers(feed({ zoteroCollection: "" }), emptyIndex()).status).toBe("not-set");
  });

  it("still returns the extra DOIs when there is no seed collection", () => {
    const k = knownPapers(feed({ zoteroCollection: "", knownDois: ["10.1000/extra.1"] }), emptyIndex());
    expect(k.status).toBe("not-set");
    expect(k.dois).toEqual(["10.1000/extra.1"]);
  });

  it("shares no list with the index or the feed", async () => {
    const { index } = await refreshed();
    const k = knownPapers(feed(), index);
    k.dois.push("10.1/x");
    expect(knownPapers(feed(), index).dois).not.toContain("10.1/x");
  });
});

describe("describeKnown", () => {
  it("gives the counts and the price before anything is read, and lists seeds without a DOI as a warning", async () => {
    const { index } = await refreshed();
    const lines = describeKnown(knownPapers(feed(), index), "SDL");
    expect(lines[0].warn).toBe(false);
    expect(lines[0].text).toContain("6 items in Inbox/SDL/seeds: 4 with a DOI, 1 without, 1 not papers");
    expect(lines[0].text).toContain("1 repeats left out");
    expect(lines[0].text).toContain("3 papers to read, about $0.0001");
    expect(lines[1].warn).toBe(true);
    expect(lines[1].text).toContain("Flow chemistry chapter without a DOI");
    expect(lines[1].text).toContain("Extra");
  });

  it("explains each way there is nothing to read", async () => {
    const { index } = await refreshed();
    expect(describeKnown(knownPapers(feed({ zoteroCollection: "" }), index), "SDL")[0].text).toContain("no seed collection");
    const missing = describeKnown(knownPapers(feed({ zoteroCollection: "Inbox/Lipoic" }), index), "SDL");
    expect(missing[0].text).toContain("Collection not found in Zotero: Inbox/Lipoic/seeds");
    expect(missing[1].text).toContain("Did you mean: Inbox/SDL/seeds");
    expect(describeKnown(knownPapers(feed({ zoteroCollection: "Inbox/Other" }), index), "SDL")[0].text).toContain("is empty");
  });

  it("prices the reading as a filtered list of up to 50 papers per request", () => {
    expect(readCostUsd(0)).toBe(0);
    expect(readCostUsd(50)).toBeCloseTo(0.0001, 10);
    expect(readCostUsd(51)).toBeCloseTo(0.0002, 10);
  });
});
