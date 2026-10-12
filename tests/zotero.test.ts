import { describe, expect, it } from "vitest";
import {
  ZoteroClient, ZoteroError, describeCollections, pathParts, planCollection, titleKey,
  type HttpRequest, type HttpResponse, type ZoteroCollection, type ZoteroFound,
} from "../src/zotero/client";

// Responses are hand-written to the documented shapes of the Zotero Web API v3 (not recorded yet: see BACKLOG).
// The key below is a made-up string, not a key of any service.
const KEY = "test-key-not-real";

function res(status: number, json: unknown = null, headers: Record<string, string> = {}): HttpResponse {
  return { status, json, headers };
}

function fake(answers: HttpResponse[]) {
  const calls: HttpRequest[] = [];
  const sleeps: number[] = [];
  const request = async (req: HttpRequest): Promise<HttpResponse> => {
    calls.push(req);
    const answer = answers.shift();
    if (!answer) throw new Error("fake HTTP ran out of answers");
    return answer;
  };
  const client = new ZoteroClient({
    request, userId: "123456", apiKey: KEY, sleep: async (ms) => { sleeps.push(ms); },
    writeToken: () => "0123456789abcdef0123456789abcdef",
  });
  return { client, calls, sleeps };
}

const row = (key: string, name: string, parent: string | false = false) => ({ key, version: 1, data: { key, name, parentCollection: parent } });

describe("collection paths", () => {
  const cols: ZoteroCollection[] = [
    { key: "AAAA1111", name: "Inbox", parent: null },
    { key: "BBBB2222", name: "Lipoic acid copolymers", parent: "AAAA1111" },
    { key: "CCCC3333", name: "Lipoic acid copolymers", parent: null }, // same name, different parent
  ];

  it("splits a path into trimmed names", () => {
    expect(pathParts(" Inbox / Lipoic acid copolymers /")).toEqual(["Inbox", "Lipoic acid copolymers"]);
    expect(pathParts("")).toEqual([]);
  });

  it("finds the collection with the right parent", () => {
    expect(planCollection(cols, "Inbox/Lipoic acid copolymers")).toEqual({ key: "BBBB2222", toCreate: [], parentKey: "BBBB2222" });
    expect(planCollection(cols, "Lipoic acid copolymers").key).toBe("CCCC3333");
  });

  it("says what is missing and where it would go", () => {
    expect(planCollection(cols, "Inbox/Other feed")).toEqual({ key: null, toCreate: ["Other feed"], parentKey: "AAAA1111" });
    expect(planCollection(cols, "Projects/Lipoic acid copolymerisation")).toEqual({
      key: null, toCreate: ["Projects", "Lipoic acid copolymerisation"], parentKey: null,
    });
  });
});

describe("requests", () => {
  it("sends the key and the API version, and the user ID in the path, but never the key in the address", async () => {
    const { client, calls } = fake([res(200, [])]);
    await client.listCollections();
    expect(calls[0].url).toBe("https://api.zotero.org/users/123456/collections?limit=100&start=0");
    expect(calls[0].headers["Zotero-API-Key"]).toBe(KEY);
    expect(calls[0].headers["Zotero-API-Version"]).toBe("3");
    expect(calls[0].url).not.toContain(KEY);
  });

  it("refuses a user ID that is not a number", () => {
    expect(() => new ZoteroClient({ request: async () => res(200), userId: "me/../x", apiKey: KEY, sleep: async () => undefined })).toThrow(ZoteroError);
  });

  it("reads every page of collections", async () => {
    const page1 = Array.from({ length: 100 }, (_, i) => row(`K${String(i).padStart(7, "0")}`, `c${i}`));
    const page2 = [row("LASTKEY1", "last", "K0000000")];
    const { client, calls } = fake([res(200, page1, { "total-results": "101" }), res(200, page2, { "total-results": "101" })]);
    const out = await client.listCollections();
    expect(out).toHaveLength(101);
    expect(out[100]).toEqual({ key: "LASTKEY1", name: "last", parent: "K0000000" });
    expect(out[0].parent).toBeNull();
    expect(calls[1].url).toContain("start=100");
  });

  it("creates a collection with its parent, or at the top, and uses a write token", async () => {
    const { client, calls } = fake([res(200, { successful: { "0": { key: "NEWKEY01", version: 5 } }, failed: {} }), res(200, { successful: { "0": { key: "NEWKEY02" } } })]);
    expect(await client.createCollection("Child", "PARENT01")).toBe("NEWKEY01");
    expect(await client.createCollection("Top", null)).toBe("NEWKEY02");
    expect(JSON.parse(calls[0].body ?? "")).toEqual([{ name: "Child", parentCollection: "PARENT01" }]);
    expect(JSON.parse(calls[1].body ?? "")).toEqual([{ name: "Top", parentCollection: false }]);
    expect(calls[0].method).toBe("POST");
    expect(calls[0].headers["Zotero-Write-Token"]).toMatch(/^[0-9a-f]{32}$/);
    expect(calls[0].headers["Content-Type"]).toBe("application/json");
  });

  it("reports a rejected collection with Zotero's reason", async () => {
    const { client } = fake([res(200, { successful: {}, failed: { "0": { code: 400, message: "Collection name too long" } } })]);
    await expect(client.createCollection("x", null)).rejects.toThrow("Collection name too long");
  });
});

describe("trashed collections and reading an item back", () => {
  it("leaves collections that Zotero marks deleted out of the usable list, but shows them in the raw list", async () => {
    const trashed = { key: "OLD00001", version: 3, data: { key: "OLD00001", name: "Gone", parentCollection: false, deleted: true } };
    const asNumber = { key: "OLD00002", version: 3, data: { key: "OLD00002", name: "Gone too", parentCollection: false, deleted: 1 } };
    const rows = [row("LIVE0001", "Live"), trashed, asNumber];
    const raw = await fake([res(200, rows)]).client.listCollectionsRaw();
    expect(raw.map((r) => [r.name, r.deleted])).toEqual([["Live", false], ["Gone", true], ["Gone too", true]]);
    expect(await fake([res(200, rows)]).client.listCollections()).toEqual([{ key: "LIVE0001", name: "Live", parent: null }]);
  });

  it("describes the collections as paths with their keys, and marks the ones in the trash", () => {
    expect(describeCollections([
      { key: "A0000001", name: "Inbox", parent: null, deleted: false },
      { key: "B0000002", name: "Feed", parent: "A0000001", deleted: true },
      { key: "C0000003", name: "Projects", parent: null, deleted: false },
    ])).toEqual(["Inbox  ·  key A0000001", "Inbox/Feed  ·  key B0000002  ·  IN TRASH", "Projects  ·  key C0000003"]);
  });

  it("reads an item back by its key, with its collections and whether it is in the trash", async () => {
    const { client, calls } = fake([
      res(200, { key: "ITEM0001", version: 9, data: { itemType: "journalArticle", collections: ["C1", "C2"], tags: [{ tag: "feed/a" }] } }),
      res(200, { key: "ITEM0002", version: 4, data: { itemType: "journalArticle", deleted: 1 } }),
    ]);
    expect(await client.getItem("ITEM0001")).toEqual({ key: "ITEM0001", version: 9, collections: ["C1", "C2"], tags: [{ tag: "feed/a" }], deleted: false });
    expect((await client.getItem("ITEM0002"))?.deleted).toBe(true);
    expect(calls[0].url).toBe("https://api.zotero.org/users/123456/items/ITEM0001");
  });

  it("says there is no such item on a 404, and fails on other errors", async () => {
    expect(await fake([res(404)]).client.getItem("NOPE0000")).toBeNull();
    await expect(fake([res(500)]).client.getItem("ITEM0001")).rejects.toThrow("while trying to read the item back (HTTP 500)");
  });
});

describe("finding an item already in the library", () => {
  const item = (key: string, data: Record<string, unknown>) => ({ key, version: 7, data: { itemType: "journalArticle", ...data } });

  it("matches on the DOI whatever its case or prefix, and reads collections and tags", async () => {
    const { client, calls } = fake([res(200, [
      item("OTHER001", { title: "Same title", DOI: "10.1000/other" }),
      item("MATCH001", { title: "T", DOI: "https://doi.org/10.1021/JACS.6C02848", collections: ["COLL0001"], tags: [{ tag: "x", type: 1 }, { tag: "feed/a" }] }),
    ])]);
    const found = await client.findByDoi("10.1021/jacs.6c02848");
    expect(found).toEqual({ key: "MATCH001", version: 7, collections: ["COLL0001"], tags: [{ tag: "x", type: 1 }, { tag: "feed/a" }] });
    expect(calls[0].url).toContain("q=10.1021%2Fjacs.6c02848");
    expect(calls[0].url).toContain("qmode=everything");
    expect(calls[0].url).toContain("itemType=-attachment");
    expect(calls[0].url.match(/itemType=/g)).toHaveLength(1);
  });

  it("does not take an item with a different DOI, even with the same title", async () => {
    const { client } = fake([res(200, [item("OTHER001", { title: "Same title", DOI: "10.1000/other" })])]);
    expect(await client.findByDoi("10.1000/mine")).toBeNull();
  });

  it("finds a paper without a DOI by its title, apart from case and punctuation", async () => {
    const { client } = fake([res(200, [item("T0000001", { title: "Lipoic-acid copolymers: a study" })])]);
    expect((await client.findByTitle("Lipoic acid copolymers - A Study"))?.key).toBe("T0000001");
    const none = fake([res(200, [item("T0000001", { title: "Something else" })])]);
    expect(await none.client.findByTitle("Lipoic acid copolymers")).toBeNull();
  });

  it("asks nothing when there is nothing to look for", async () => {
    const { client, calls } = fake([]);
    expect(await client.findByDoi("")).toBeNull();
    expect(await client.findByTitle("  ")).toBeNull();
    expect(calls).toHaveLength(0);
    expect(titleKey("A–B, c!")).toBe("abc");
  });
});

describe("creating and updating items", () => {
  it("creates one item and returns its key, version, collections and tags", async () => {
    const { client, calls } = fake([res(200, { successful: { "0": { key: "ITEM0001", version: 12 } }, unchanged: {}, failed: {} }, { "last-modified-version": "12" })]);
    const made = await client.createItem({ itemType: "journalArticle", title: "T", collections: ["C1"], tags: [{ tag: "feed/a" }] });
    expect(made).toEqual({ key: "ITEM0001", version: 12, collections: ["C1"], tags: [{ tag: "feed/a" }] });
    expect(JSON.parse(calls[0].body ?? "")).toEqual([{ itemType: "journalArticle", title: "T", collections: ["C1"], tags: [{ tag: "feed/a" }] }]);
    expect(calls[0].headers["Zotero-Write-Token"]).toHaveLength(32);
  });

  it("turns a failed item into an error with Zotero's message", async () => {
    const { client } = fake([res(200, { successful: {}, failed: { "0": { key: "", code: 400, message: "'publicationTitle' is not a valid field for type 'preprint'" } } })]);
    await expect(client.createItem({ itemType: "preprint" })).rejects.toThrow("not a valid field");
  });

  const found: ZoteroFound = { key: "ITEM0001", version: 7, collections: ["C1"], tags: [{ tag: "x", type: 1 }] };

  it("adds collections and tags to an existing item, keeping what it has, with the version check", async () => {
    const { client, calls } = fake([res(204, null, { "last-modified-version": "8" })]);
    const { item, changed } = await client.addToCollectionsAndTag(found, ["C1", "C2"], ["feed/a"]);
    expect(changed).toBe(true);
    expect(calls[0].method).toBe("PATCH");
    expect(calls[0].url).toBe("https://api.zotero.org/users/123456/items/ITEM0001");
    expect(calls[0].headers["If-Unmodified-Since-Version"]).toBe("7");
    expect(JSON.parse(calls[0].body ?? "")).toEqual({ collections: ["C1", "C2"], tags: [{ tag: "x", type: 1 }, { tag: "feed/a" }] });
    expect(item).toEqual({ key: "ITEM0001", version: 8, collections: ["C1", "C2"], tags: [{ tag: "x", type: 1 }, { tag: "feed/a" }] });
  });

  it("sends nothing when the item already has them all", async () => {
    const { client, calls } = fake([]);
    const { item, changed } = await client.addToCollectionsAndTag({ ...found, tags: [{ tag: "feed/a" }] }, ["C1"], ["feed/a"]);
    expect(changed).toBe(false);
    expect(item.version).toBe(7);
    expect(calls).toHaveLength(0);
  });

  it("says to press Sync again when the item changed meanwhile", async () => {
    const { client } = fake([res(412)]);
    await expect(client.addToCollectionsAndTag(found, ["C2"], [])).rejects.toThrow("Press Sync again");
  });
});

describe("limits and errors", () => {
  it("waits for Retry-After on 429 and tries again", async () => {
    const { client, calls, sleeps } = fake([res(429, null, { "retry-after": "3" }), res(200, [])]);
    await client.listCollections();
    expect(calls).toHaveLength(2);
    expect(sleeps).toEqual([3000]);
  });

  it("backs off with doubling waits when 429 has no Retry-After, and gives up after four tries", async () => {
    const { client, calls, sleeps } = fake([res(429), res(429), res(429), res(429)]);
    await expect(client.listCollections()).rejects.toThrow("too many requests");
    expect(calls).toHaveLength(4);
    expect(sleeps).toEqual([1000, 2000, 4000]);
  });

  it("obeys the Backoff header before the next request", async () => {
    const { client, sleeps } = fake([res(200, [], { backoff: "5" }), res(200, [])]);
    await client.listCollections();
    expect(sleeps).toEqual([]);
    await client.listCollections();
    expect(sleeps).toEqual([5000]);
  });

  it("names the step that failed and passes on Zotero's own explanation, one line, cut short", async () => {
    const reason = "Invalid value for field 'x'" + String.fromCharCode(10) + String.fromCharCode(10) + "second line " + "y".repeat(400);
    const { client } = fake([{ status: 400, json: null, headers: {}, text: reason }]);
    const message = ((await client.createItem({ itemType: "journalArticle" }).catch((e: unknown) => e)) as ZoteroError).message;
    expect(message).toContain("while trying to create the item (HTTP 400): Invalid value for field 'x' second line y");
    expect(message).not.toContain(String.fromCharCode(10));
    expect(message.length).toBeLessThan(400);
    const bare = fake([res(400)]);
    expect(((await bare.client.findByDoi("10.1000/x").catch((e: unknown) => e)) as ZoteroError).message).toBe("Zotero request failed while trying to look for the paper in your library (HTTP 400).");
  });

  it("gives plain messages that never contain the key or the address", async () => {
    for (const [status, text] of [[403, "refused the API key or user ID"], [409, "locked"], [500, "HTTP 500"], [404, "HTTP 404"]] as const) {
      const { client } = fake([res(status)]);
      const error = await client.listCollections().catch((e: unknown) => e);
      expect(error).toBeInstanceOf(ZoteroError);
      const message = (error as ZoteroError).message;
      expect(message).toContain(text);
      expect(message).not.toContain(KEY);
      expect(message).not.toContain("api.zotero.org");
    }
  });
});
