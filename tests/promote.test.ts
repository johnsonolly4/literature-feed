// Promote to seeds on invented papers with known answers: the distortion check, the confirmation text, the collection write and undo.
import { describe, expect, it } from "vitest";
import type { Candidate } from "../src/openalex/client";
import { confirmText, distortionCheck, promoteItem, seedTarget, undoPromote, type PromoteClient } from "../src/review/promote";
import { authorKey } from "../src/review/gaps-authors";
import { buildSeedProfile } from "../src/review/seeds";
import type { FeedConfig } from "../src/settings/data";
import { ZoteroClient, type HttpRequest, type HttpResponse, type ZoteroFound, type ZoteroStored } from "../src/zotero/client";
import { emptyIndex, type ZoteroIndex } from "../src/zotero/library-index";

const cand = (n: number, title: string, abstract: string, refs: string[], authors: string[]): Candidate => ({
  title, abstract, doi: `https://doi.org/10.1/c${n}`, year: 2020, openalexId: `https://openalex.org/W${n}`, authors, venue: null, publicationDate: null, referencedWorks: refs,
});
const A = ["A1", "A2", "A3", "A4", "A5"];
const seeds = [
  cand(1, "Bayesian optimisation of flow chemistry", "Bayesian optimisation drives a self-driving flow reactor.", [...A, "X1"], ["Ann Lee"]),
  cand(2, "Bayesian optimisation of self-driving labs", "Bayesian optimisation in self-driving flow labs.", [...A, "X2"], ["Ann Lee", "Bob Roe"]),
  cand(3, "Closed-loop Bayesian optimisation", "Closed-loop Bayesian optimisation of a flow reactor.", [...A.slice(0, 4), "X3"], ["Bob Roe"]),
];
const profile = buildSeedProfile(seeds.map((c) => c.doi ?? ""), seeds);
const node = (id: string, title: string, refs: string[], authors: string[]) => ({ id, title, abstract: null, refs, authors });
const related = node("W8", "Another optimisation paper", [...A, "Q1"], [authorKey("Ann Lee")]);
const unrelated = node("W9", "Lipoic acid copolymers", ["Q1", "Q2"], [authorKey("Fay Moss")]);

describe("distortion check", () => {
  it("says a linked paper fits and does not make it an outlier", () => {
    const d = distortionCheck(profile, related);
    expect(d?.fit?.fits).toBe(true);
    expect(d?.outlierAfter).toBe(false);
  });

  it("says an unlinked paper does not fit and would be an outlier", () => {
    const d = distortionCheck(profile, unrelated);
    expect(d?.fit?.fits).toBe(false);
    expect(d?.outlierAfter).toBe(true);
  });

  it("gives no check for a profile saved without links and words", () => {
    const { perPaper: _p, ...old } = profile;
    expect(distortionCheck(old, related)).toBeNull();
  });
});

describe("confirmation text", () => {
  const where = "Inbox/SDL/seeds";
  it("names the paper, the search and the collection, and says only the collection changes", () => {
    const text = confirmText(distortionCheck(profile, related), "Another optimisation paper", "SDL", where);
    expect(text).toContain("Another optimisation paper");
    expect(text).toContain("SDL");
    expect(text).toContain(where);
    expect(text).toContain("Only its collection changes");
    expect(text).toContain("It fits your seeds.");
  });

  it("warns about a paper that does not fit", () => {
    const text = confirmText(distortionCheck(profile, unrelated), "Lipoic acid copolymers", "SDL", where);
    expect(text).toContain("does not fit");
    expect(text).toContain("almost none of the seeds");
  });

  it("says the fit was not checked when there is no check (the inbox)", () => {
    expect(confirmText(null, "P", "SDL", where)).toContain("Fit not checked here");
  });
});

describe("seed collection of a search", () => {
  const feed: FeedConfig = {
    id: "sdl", name: "SDL", enabled: true, topics: ["t"], groups: [], drop: [], lower: [], yearsFrom: null,
    zoteroCollection: "Inbox/SDL", project: "", seedCollection: "", knownDois: [],
  };
  const index: ZoteroIndex = { ...emptyIndex(), collections: [
    { key: "I", name: "Inbox", parent: null, trashed: false }, { key: "S", name: "SDL", parent: "I", trashed: false }, { key: "SEED", name: "seeds", parent: "S", trashed: false },
  ] };

  it("finds the key and path", () => {
    expect(seedTarget(feed, index)).toEqual({ key: "SEED", path: "Inbox/SDL/seeds" });
  });

  it("says why when there is none", () => {
    expect(seedTarget({ ...feed, zoteroCollection: "" }, index)).toHaveProperty("error");
    expect(seedTarget({ ...feed, seedCollection: "Nowhere/seeds" }, index)).toHaveProperty("error");
  });
});

/** An in-memory item that behaves like the client: adding and removing change its collections. */
function memory(start: ZoteroStored | null) {
  let item = start;
  const writes: string[][] = [];
  const client: PromoteClient = {
    getItem: async () => item,
    addToCollectionsAndTag: async (found: ZoteroFound, collections: readonly string[]) => {
      const next = [...new Set([...found.collections, ...collections])];
      const changed = next.length !== found.collections.length;
      if (changed) { item = { ...(item as ZoteroStored), collections: next }; writes.push(next); }
      return { item: found, changed };
    },
    removeFromCollections: async (found: ZoteroFound, collections: readonly string[]) => {
      const next = found.collections.filter((c) => !collections.includes(c));
      const changed = next.length !== found.collections.length;
      if (changed) { item = { ...(item as ZoteroStored), collections: next }; writes.push(next); }
      return { item: found, changed };
    },
  };
  return { client, writes, get collections() { return item?.collections ?? []; } };
}
const stored = (collections: string[], deleted = false): ZoteroStored => ({ key: "ITEM0001", version: 3, collections, tags: [], deleted });

describe("promote and undo", () => {
  it("adds the item to the seed collection and undo takes it out, keeping its other collections", async () => {
    const m = memory(stored(["C1"]));
    expect((await promoteItem(m.client, "ITEM0001", "SEED")).status).toBe("added");
    expect(m.collections).toEqual(["C1", "SEED"]);
    expect((await undoPromote(m.client, "ITEM0001", "SEED")).status).toBe("removed");
    expect(m.collections).toEqual(["C1"]);
  });

  it("writes nothing when the item is already a seed, and says so", async () => {
    const m = memory(stored(["SEED"]));
    expect((await promoteItem(m.client, "ITEM0001", "SEED")).status).toBe("already");
    expect(m.writes).toHaveLength(0);
  });

  it("does not remove an item that is not in the collection", async () => {
    const m = memory(stored(["C1"]));
    expect((await undoPromote(m.client, "ITEM0001", "SEED")).status).toBe("not-there");
    expect(m.writes).toHaveLength(0);
  });

  it("reports an item that is gone or in the Trash, and writes nothing", async () => {
    const gone = memory(null);
    expect((await promoteItem(gone.client, "ITEM0001", "SEED")).status).toBe("missing");
    const trashed = memory(stored([], true));
    expect((await promoteItem(trashed.client, "ITEM0001", "SEED")).status).toBe("missing");
    expect(trashed.writes).toHaveLength(0);
  });
});

describe("through the real client", () => {
  it("reads the item, then sends one PATCH with the new collection list and the version it read", async () => {
    const calls: HttpRequest[] = [];
    const answers: HttpResponse[] = [
      { status: 200, json: { key: "ITEM0001", version: 3, data: { key: "ITEM0001", version: 3, collections: ["C1"], tags: [] } }, headers: {} },
      { status: 204, json: null, headers: { "last-modified-version": "4" } },
    ];
    const client = new ZoteroClient({
      userId: "123456", apiKey: "test-key-not-real", sleep: async () => { /* no waiting */ },
      request: async (req) => { calls.push(req); return answers.shift() as HttpResponse; },
    });
    expect((await promoteItem(client, "ITEM0001", "SEED")).status).toBe("added");
    expect(calls.map((c) => c.method)).toEqual(["GET", "PATCH"]);
    expect(calls[1].headers["If-Unmodified-Since-Version"]).toBe("3");
    expect(JSON.parse(calls[1].body ?? "")).toEqual({ collections: ["C1", "SEED"], tags: [] });
  });
});
