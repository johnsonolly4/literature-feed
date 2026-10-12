import { describe, expect, it } from "vitest";
import { describeSync, findPending, runSync, type SyncDeps } from "../src/inbox/sync";
import { markSynced, renderNote, type InboxPaper } from "../src/inbox/write";
import type { OpenAlexWork } from "../src/openalex/client";
import type { FeedConfig } from "../src/settings/data";
import type { ZoteroCollection, ZoteroFound } from "../src/zotero/client";
import { lipoicFeed } from "./fixtures/lipoic-feed";

const feedA: FeedConfig = { ...lipoicFeed, id: "a", name: "Feed A", enabled: true, topics: ["t"], yearsFrom: null, zoteroCollection: "Inbox/Feed A", project: "Projects/Proj" };
const feedB: FeedConfig = { ...feedA, id: "b", name: "Feed B", zoteroCollection: "Inbox/Feed B", project: "" };

function paper(n: number, tier: InboxPaper["tier"] = "strong"): InboxPaper {
  return { openalexId: `W${n}`, title: `Paper ${n}`, authors: ["A. Author"], venue: "J", year: 2026, publicationDate: "2026-09-10", doi: `10.1000/p.${n}`, isPreprint: false, noAbstract: false, tier, matched: [] };
}

function note(sections: { feedId: string; papers: InboxPaper[] }[]): string {
  return renderNote({ week: "2026-W42", scanned: "2026-10-12", sections: sections.map((s) => ({ ...s, feedName: s.feedId })) });
}

const tick = (text: string, n: number): string => text.replace(new RegExp(`> - \\[ \\] (⭐ )?\\*\\*Paper ${n}\\*\\*`), (m) => m.replace("[ ]", "[x]"));

describe("findPending", () => {
  it("lists ticked papers without a Zotero link, across notes", () => {
    const first = markSynced(tick(tick(note([{ feedId: "a", papers: [paper(1), paper(2), paper(3)] }]), 1), 2), [{ feedId: "a", openalexId: "W2", key: "ABCD2345" }]);
    const second = tick(note([{ feedId: "b", papers: [paper(1)] }]), 1);
    expect(findPending([{ path: "n1.md", text: first }, { path: "n2.md", text: second }])).toEqual([
      { path: "n1.md", feedId: "a", openalexId: "W1" },
      { path: "n2.md", feedId: "b", openalexId: "W1" },
    ]);
  });

  it("finds nothing when nothing is ticked", () => {
    expect(findPending([{ path: "n.md", text: note([{ feedId: "a", papers: [paper(1)] }]) }])).toEqual([]);
  });
});

/** Fakes for both clients that remember what they were asked. */
function fakes(opts: { collections?: ZoteroCollection[]; existing?: Record<string, ZoteroFound>; failWork?: string[]; failCreate?: string[]; confirm?: boolean } = {}) {
  const log: string[] = [];
  const collections: ZoteroCollection[] = [...(opts.collections ?? [])];
  let n = 0;
  const items = new Map<string, ZoteroFound>(Object.entries(opts.existing ?? {}));
  const deps: SyncDeps = {
    zotero: {
      listCollections: async () => collections.map((c) => ({ ...c })),
      createCollection: async (name, parent) => {
        log.push(`collection:${name}<${parent ?? "top"}`);
        const key = `COL${String(++n).padStart(5, "0")}`;
        collections.push({ key, name, parent });
        return key;
      },
      findByDoi: async (doi) => { log.push(`find:${doi}`); return items.get(doi) ?? null; },
      findByTitle: async (title) => { log.push(`findTitle:${title}`); return null; },
      createItem: async (item) => {
        log.push(`create:${String(item.DOI ?? item.title)}`);
        if (opts.failCreate?.includes(String(item.DOI))) throw new Error("Zotero rejected the item: bad field");
        const made: ZoteroFound = { key: `ITM${String(++n).padStart(5, "0")}`, version: 1, collections: item.collections as string[], tags: item.tags as { tag: string }[] };
        items.set(String(item.DOI), made);
        return made;
      },
      addToCollectionsAndTag: async (found, cols, tags) => {
        log.push(`add:${found.key}:${cols.join("+")}:${tags.join("+")}`);
        const next: ZoteroFound = { ...found, collections: [...new Set([...found.collections, ...cols])], tags: [...found.tags, ...tags.map((tag) => ({ tag }))] };
        return { item: next, changed: true };
      },
    },
    openalex: {
      getWork: async (id): Promise<OpenAlexWork> => {
        log.push(`work:${id}`);
        if (opts.failWork?.includes(id)) throw new Error("OpenAlex request failed (HTTP 500)");
        return { id: `https://openalex.org/${id}`, title: `Title ${id}`, doi: `https://doi.org/10.1000/p.${id.slice(1)}`, type: "article" };
      },
    },
  };
  return { deps, log, collections, items };
}

const pending = (...specs: [string, string][]) => specs.map(([feedId, openalexId]) => ({ path: "n.md", feedId, openalexId }));

const NONE = { createInboxCollections: false, createProjectCollections: false };
const ALL = { createInboxCollections: true, createProjectCollections: true };
const col = (key: string, name: string, parent: string | null = null): ZoteroCollection => ({ key, name, parent });
/** The top-level parents exist; the feeds' own collections do not. */
const PARENTS = [col("INBOX001", "Inbox"), col("PROJS001", "Projects")];
/** Everything the two feeds name exists. */
const EXISTING = [...PARENTS, col("FEEDA001", "Feed A", "INBOX001"), col("FEEDB001", "Feed B", "INBOX001"), col("PROJ0001", "Proj", "PROJS001")];

describe("runSync: collections", () => {
  it("never creates anything when the settings are off: it stops, sends nothing, and says what to do", async () => {
    const { deps, log } = fakes({ collections: PARENTS });
    const result = await runSync([feedA], pending(["a", "W1"]), deps, NONE);
    expect(result.blocked.map((b) => b.path)).toEqual(["Inbox/Feed A", "Projects/Proj"]);
    expect(result.blocked[0].reason).toBe('"Feed A" is missing in Zotero; create it there, or switch on "Create missing inbox collections" in the settings');
    expect(result.blocked[1].reason).toContain('"Create missing project collections"');
    expect(log.some((l) => l.startsWith("collection") || l.startsWith("create") || l.startsWith("work"))).toBe(false);
    expect(result.synced).toEqual([]);
    expect(describeSync(result)).toContain("Sync stopped, nothing was sent.");
    expect(describeSync(result)).toContain("Then press Sync again.");
  });

  it("creates only the last name of a path, inside the existing parent, when its setting is on", async () => {
    const { deps, log, collections } = fakes({ collections: PARENTS });
    const result = await runSync([feedA], pending(["a", "W1"]), deps, ALL);
    expect(log.filter((l) => l.startsWith("collection"))).toEqual(["collection:Feed A<INBOX001", "collection:Proj<PROJS001"]);
    expect(collections).toHaveLength(4);
    expect(result.created).toEqual(["Inbox/Feed A", "Projects/Proj"]);
    expect(result.blocked).toEqual([]);
    expect(result.synced[0].outcome).toBe("added");
  });

  it("inbox and project are separate: with only the inbox setting on, a missing project collection stops everything and nothing is created", async () => {
    const { deps, log } = fakes({ collections: PARENTS });
    const result = await runSync([feedA], pending(["a", "W1"]), deps, { createInboxCollections: true, createProjectCollections: false });
    expect(result.blocked.map((b) => b.path)).toEqual(["Projects/Proj"]);
    expect(log.some((l) => l.startsWith("collection") || l.startsWith("create"))).toBe(false);
    expect(result.created).toEqual([]);
  });

  it("with only the inbox setting on and the project collection present, it creates just the inbox collection", async () => {
    const { deps, log } = fakes({ collections: [...PARENTS, col("PROJ0001", "Proj", "PROJS001")] });
    const result = await runSync([feedA], pending(["a", "W1"]), deps, { createInboxCollections: true, createProjectCollections: false });
    expect(log.filter((l) => l.startsWith("collection"))).toEqual(["collection:Feed A<INBOX001"]);
    expect(result.created).toEqual(["Inbox/Feed A"]);
    expect(result.synced).toHaveLength(1);
  });

  it("never creates a parent: two missing levels stop the sync even when the setting is on", async () => {
    const { deps, log } = fakes();
    const result = await runSync([feedA], pending(["a", "W1"]), deps, ALL);
    expect(result.blocked[0].reason).toBe('"Inbox" is missing in Zotero; create it there first (the plugin creates only the last name of a path)');
    expect(log.some((l) => l.startsWith("collection") || l.startsWith("create"))).toBe(false);
  });

  it("does not create anything when every collection exists, and uses their keys", async () => {
    const { deps, log } = fakes({ collections: EXISTING });
    const result = await runSync([feedA], pending(["a", "W1"]), deps, NONE);
    expect(log.some((l) => l.startsWith("collection"))).toBe(false);
    expect(result.created).toEqual([]);
    expect(result.blocked).toEqual([]);
    expect(result.synced[0].outcome).toBe("added");
  });

  it("an empty collection or project setting is not a path to check", async () => {
    const { deps } = fakes({ collections: EXISTING });
    const result = await runSync([{ ...feedA, zoteroCollection: "", project: "" }], pending(["a", "W1"]), deps, NONE);
    expect(result.blocked).toEqual([]);
    expect(result.synced).toHaveLength(1);
  });
});

describe("runSync: papers", () => {
  it("adds an existing item to the feed's collections and tag instead of making a copy", async () => {
    const { deps, log } = fakes({ collections: EXISTING, existing: { "10.1000/p.1": { key: "OLDITEM1", version: 3, collections: ["ELSEWHER"], tags: [] } } });
    const result = await runSync([feedB], pending(["b", "W1"]), deps, NONE);
    expect(log).toContain("add:OLDITEM1:FEEDB001:feed/b");
    expect(log.some((l) => l.startsWith("create"))).toBe(false);
    expect(result.synced).toEqual([{ path: "n.md", feedId: "b", openalexId: "W1", key: "OLDITEM1", outcome: "existing" }]);
  });

  it("creates a paper found by two feeds once and adds the second feed to it", async () => {
    const { deps, log } = fakes({ collections: EXISTING });
    const result = await runSync([feedA, feedB], pending(["a", "W1"], ["b", "W1"]), deps, NONE);
    expect(log.filter((l) => l.startsWith("create"))).toHaveLength(1);
    expect(result.synced.map((s) => s.outcome)).toEqual(["added", "existing"]);
    expect(result.synced[0].key).toBe(result.synced[1].key);
    expect(log.filter((l) => l.startsWith("find:"))).toHaveLength(1); // the second feed used the item made in this run
  });

  it("goes on after a paper fails, and leaves that paper out of the synced list", async () => {
    const { deps } = fakes({ failWork: ["W2"], failCreate: ["10.1000/p.3"], collections: EXISTING });
    const result = await runSync([feedB], pending(["b", "W1"], ["b", "W2"], ["b", "W3"], ["b", "W4"]), deps, NONE);
    expect(result.synced.map((s) => s.openalexId)).toEqual(["W1", "W4"]);
    expect(result.failed.map((f) => [f.openalexId, f.message])).toEqual([["W2", "OpenAlex request failed (HTTP 500)"], ["W3", "Zotero rejected the item: bad field"]]);
  });

  it("skips papers whose feed was deleted, and does nothing at all when nothing is left", async () => {
    const { deps, log } = fakes();
    const result = await runSync([feedA], pending(["gone", "W1"]), deps, NONE);
    expect(result.skipped).toEqual([{ path: "n.md", feedId: "gone", openalexId: "W1", reason: "its feed no longer exists" }]);
    expect(log).toEqual([]);
  });

  it("uses the title when the work has no DOI", async () => {
    const { deps, log } = fakes({ collections: EXISTING });
    deps.openalex.getWork = async (id) => ({ id: `https://openalex.org/${id}`, title: "No DOI here", doi: null, type: "article" });
    await runSync([feedB], pending(["b", "W9"]), deps, NONE);
    expect(log).toContain("findTitle:No DOI here");
    expect(log.some((l) => l.startsWith("find:"))).toBe(false);
  });
});

describe("describeSync", () => {
  it("says what happened in one sentence", () => {
    const base = { synced: [], failed: [], skipped: [], created: [], blocked: [] };
    const text = describeSync({
      ...base,
      synced: [{ path: "n", feedId: "a", openalexId: "W1", key: "AAAAAAAA", outcome: "added" }, { path: "n", feedId: "a", openalexId: "W2", key: "BBBBBBBB", outcome: "existing" }],
      failed: [{ path: "n", feedId: "a", openalexId: "W3", message: "boom" }],
      created: ["Inbox/Feed A"],
      skipped: [{ path: "n", feedId: "x", openalexId: "W4", reason: "its feed no longer exists" }],
    });
    expect(text).toBe("1 added to Zotero, 1 already in your library (collections and tag added), 1 failed. Created collections: Inbox/Feed A. 1 skipped (its feed no longer exists). First failure: boom");
  });
});
