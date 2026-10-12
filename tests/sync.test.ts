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
    confirmCreate: async (lines) => { log.push(`confirm:${lines.join("|")}`); return opts.confirm ?? true; },
  };
  return { deps, log, collections, items };
}

const pending = (...specs: [string, string][]) => specs.map(([feedId, openalexId]) => ({ path: "n.md", feedId, openalexId }));

describe("runSync", () => {
  it("asks before creating collections, creates parents first, then adds the paper to both collections", async () => {
    const { deps, log, collections } = fakes();
    const result = await runSync([feedA], pending(["a", "W1"]), deps);
    expect(log.filter((l) => l.startsWith("confirm"))).toEqual(["confirm:Inbox/Feed A (new: Inbox / Feed A)|Projects/Proj (new: Projects / Proj)"]);
    expect(log.filter((l) => l.startsWith("collection"))).toEqual(["collection:Inbox<top", "collection:Feed A<COL00001", "collection:Projects<top", "collection:Proj<COL00003"]);
    expect(log.indexOf("confirm:Inbox/Feed A (new: Inbox / Feed A)|Projects/Proj (new: Projects / Proj)")).toBeLessThan(log.findIndex((l) => l.startsWith("collection")));
    expect(collections).toHaveLength(4);
    expect(result.created).toEqual(["Inbox/Feed A", "Projects/Proj"]);
    expect(result.synced).toEqual([{ path: "n.md", feedId: "a", openalexId: "W1", key: expect.stringMatching(/^ITM/), outcome: "added" }]);
    expect(result.failed).toEqual([]);
  });

  it("sends nothing when the user says no to creating collections", async () => {
    const { deps, log } = fakes({ confirm: false });
    const result = await runSync([feedA], pending(["a", "W1"]), deps);
    expect(result.declined).toBe(true);
    expect(result.synced).toEqual([]);
    expect(log.some((l) => l.startsWith("collection") || l.startsWith("create") || l.startsWith("work"))).toBe(false);
  });

  it("does not ask when every collection exists, and uses their keys", async () => {
    const existing: ZoteroCollection[] = [
      { key: "INBOX001", name: "Inbox", parent: null }, { key: "FEEDA001", name: "Feed A", parent: "INBOX001" },
      { key: "PROJS001", name: "Projects", parent: null }, { key: "PROJ0001", name: "Proj", parent: "PROJS001" },
    ];
    const { deps, log } = fakes({ collections: existing });
    const result = await runSync([feedA], pending(["a", "W1"]), deps);
    expect(log.some((l) => l.startsWith("confirm") || l.startsWith("collection"))).toBe(false);
    expect(result.created).toEqual([]);
    expect(result.synced[0].outcome).toBe("added");
  });

  it("adds an existing item to the feed's collections and tag instead of making a copy", async () => {
    const existing: ZoteroCollection[] = [{ key: "INBOX001", name: "Inbox", parent: null }, { key: "FEEDB001", name: "Feed B", parent: "INBOX001" }];
    const { deps, log } = fakes({ collections: existing, existing: { "10.1000/p.1": { key: "OLDITEM1", version: 3, collections: ["ELSEWHER"], tags: [] } } });
    const result = await runSync([feedB], pending(["b", "W1"]), deps);
    expect(log).toContain("add:OLDITEM1:FEEDB001:feed/b");
    expect(log.some((l) => l.startsWith("create"))).toBe(false);
    expect(result.synced).toEqual([{ path: "n.md", feedId: "b", openalexId: "W1", key: "OLDITEM1", outcome: "existing" }]);
  });

  it("creates a paper found by two feeds once and adds the second feed to it", async () => {
    const { deps, log } = fakes();
    const result = await runSync([feedA, feedB], pending(["a", "W1"], ["b", "W1"]), deps);
    expect(log.filter((l) => l.startsWith("create"))).toHaveLength(1);
    expect(result.synced.map((s) => s.outcome)).toEqual(["added", "existing"]);
    expect(result.synced[0].key).toBe(result.synced[1].key);
    expect(log.filter((l) => l.startsWith("find:"))).toHaveLength(1); // the second feed used the item made in this run
  });

  it("goes on after a paper fails, and leaves that paper out of the synced list", async () => {
    const { deps } = fakes({ failWork: ["W2"], failCreate: ["10.1000/p.3"], collections: [
      { key: "INBOX001", name: "Inbox", parent: null }, { key: "FEEDB001", name: "Feed B", parent: "INBOX001" },
    ] });
    const result = await runSync([feedB], pending(["b", "W1"], ["b", "W2"], ["b", "W3"], ["b", "W4"]), deps);
    expect(result.synced.map((s) => s.openalexId)).toEqual(["W1", "W4"]);
    expect(result.failed.map((f) => [f.openalexId, f.message])).toEqual([["W2", "OpenAlex request failed (HTTP 500)"], ["W3", "Zotero rejected the item: bad field"]]);
  });

  it("skips papers whose feed was deleted, and does nothing at all when nothing is left", async () => {
    const { deps, log } = fakes();
    const result = await runSync([feedA], pending(["gone", "W1"]), deps);
    expect(result.skipped).toEqual([{ path: "n.md", feedId: "gone", openalexId: "W1", reason: "its feed no longer exists" }]);
    expect(log).toEqual([]);
  });

  it("uses the title when the work has no DOI", async () => {
    const { deps, log } = fakes({ collections: [{ key: "INBOX001", name: "Inbox", parent: null }, { key: "FEEDB001", name: "Feed B", parent: "INBOX001" }] });
    deps.openalex.getWork = async (id) => ({ id: `https://openalex.org/${id}`, title: "No DOI here", doi: null, type: "article" });
    await runSync([feedB], pending(["b", "W9"]), deps);
    expect(log).toContain("findTitle:No DOI here");
    expect(log.some((l) => l.startsWith("find:"))).toBe(false);
  });
});

describe("describeSync", () => {
  it("says what happened in one sentence", () => {
    const base = { synced: [], failed: [], skipped: [], created: [], declined: false };
    expect(describeSync({ ...base, declined: true })).toContain("nothing was sent");
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
