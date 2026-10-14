import { describe, expect, it } from "vitest";
import { barWidths, buildCards, countsLine, homeSummary, parseLimit, summariseRows } from "../src/inbox/cards";
import { makeRows } from "../src/inbox/table";
import type { FeedConfig, ScanCounts } from "../src/settings/data";
import type { ParsedPaper } from "../src/inbox/write";

function paper(id: string, overrides: Partial<ParsedPaper> = {}): ParsedPaper {
  return {
    openalexId: id, feedId: "a", tier: "strong", ticked: false, synced: false, list: "ranked", key: null, doi: null, read: false,
    title: `Paper ${id}`, topics: [], authors: "", venue: "", year: 2026, preprint: false, titleOnly: false, readLink: null, matched: [], dismissed: null, ...overrides,
  };
}

const toRead = (id: string, o: Partial<ParsedPaper> = {}) => paper(id, { synced: true, ticked: true, list: "synced", ...o });

function feed(id: string, overrides: Partial<FeedConfig> = {}): FeedConfig {
  return {
    id, name: `Feed ${id}`, enabled: true, topics: ["one", "two"], groups: [], drop: [], lower: [],
    yearsFrom: null, zoteroCollection: "", project: "", seedCollection: "", knownDois: [], ...overrides,
  };
}

function scan(feeds: ScanCounts["feeds"]): ScanCounts {
  return { at: "2026-10-12", priority: 0, strong: 0, possible: 0, unchecked: 0, dropped: 0, failed: 0, feeds };
}

describe("counts", () => {
  const rows = makeRows([
    toRead("W1"), toRead("W2"), paper("W3"), paper("W4", { ticked: true }), paper("W5", { read: true }), paper("W6", { read: true }),
  ], new Set(["a|W6"]));

  it("counts to read, ticked, new and read (processed counts as read)", () => {
    expect(summariseRows(rows)).toEqual({ toRead: 2, ticked: 1, new: 1, read: 2, dismissed: 0 });
    expect(countsLine(summariseRows(rows))).toBe("2 to read · 1 new · 1 ticked · 2 read");
  });

  it("makes bar widths that are whole percents summing to 100, or all zero when empty", () => {
    for (const c of [{ toRead: 1, ticked: 1, new: 1, read: 0, dismissed: 0 }, { toRead: 2, ticked: 1, new: 1, read: 2, dismissed: 0 }, { toRead: 7, ticked: 0, new: 0, read: 0, dismissed: 0 }]) {
      const w = barWidths(c);
      expect(w.toRead + w.ticked + w.new + w.read).toBe(100);
    }
    expect(barWidths({ toRead: 1, ticked: 1, new: 1, read: 0, dismissed: 0 })).toEqual({ toRead: 34, ticked: 33, new: 33, read: 0, dismissed: 0 });
    expect(barWidths({ toRead: 0, ticked: 0, new: 0, read: 0, dismissed: 0 })).toEqual({ toRead: 0, ticked: 0, new: 0, read: 0, dismissed: 0 });
  });
});

describe("buildCards", () => {
  const rows = makeRows([
    toRead("W1", { feedId: "a", tier: "possible" }), toRead("W2", { feedId: "a", tier: "priority" }), toRead("W3", { feedId: "a" }),
    toRead("W4", { feedId: "a", tier: "priority" }), paper("W5", { feedId: "a" }), paper("W6", { feedId: "a", ticked: true }),
    paper("W7", { feedId: "a", read: true }),
    paper("W8", { feedId: "b" }),
    paper("W9", { feedId: "gone" }),
  ], new Set());

  const last = scan([
    { id: "a", name: "Feed a", priority: 1, strong: 1, possible: 1, unchecked: 0, dropped: 7, failed: false },
    { id: "b", name: "Feed b", priority: 0, strong: 0, possible: 0, unchecked: 0, dropped: 0, failed: true },
  ]);

  it("makes a card per feed: settings order, then feeds the settings no longer know", () => {
    const cards = buildCards(rows, [feed("b"), feed("a")], last);
    expect(cards.map((c) => c.feedId)).toEqual(["b", "a", "gone"]);
    expect(cards[2].name).toBe("gone");
  });

  it("leaves out a switched-off feed with no papers, and shows a switched-off one that still has papers", () => {
    expect(buildCards(rows, [feed("a"), feed("off", { enabled: false })], last).map((c) => c.feedId)).toEqual(["a", "b", "gone"]);
    expect(buildCards(rows, [feed("a", { enabled: false })], last).map((c) => c.feedId)).toContain("a");
  });

  it("shows a feed that is switched on although it has no papers in the note", () => {
    const [card] = buildCards([], [feed("a")], null);
    expect(card.funnel).toEqual({ listed: 0, ticked: 0, read: 0 });
    expect(card.badge).toEqual({ text: "nothing to read", waiting: false });
    expect(card.bar).toEqual({ toRead: 0, ticked: 0, new: 0, read: 0, dismissed: 0 });
  });

  it("counts per feed with the funnel: listed, ticked (shown interest) and read", () => {
    const a = buildCards(rows, [feed("a")], last)[0];
    expect(a.counts).toEqual({ toRead: 4, ticked: 1, new: 1, read: 1, dismissed: 0 });
    expect(a.funnel).toEqual({ listed: 7, ticked: 6, read: 1 });
    expect(a.badge).toEqual({ text: "4 to read", waiting: true });
    expect(a.bar.toRead + a.bar.ticked + a.bar.new + a.bar.read).toBe(100);
  });

  it("lists the first papers to read in the table's order (tier first) and how many more", () => {
    const a = buildCards(rows, [feed("a")], last, 3)[0];
    expect(a.toRead.map((r) => r.paper.openalexId)).toEqual(["W2", "W4", "W3"]);
    expect(a.moreToRead).toBe(1);
    expect(buildCards(rows, [feed("a")], last, 10)[0].moreToRead).toBe(0);
  });

  it("describes the topics and the last scan, with what is known", () => {
    const cards = buildCards(rows, [feed("a", { topics: ["x"] }), feed("b")], last);
    expect(cards[0].description).toBe("1 topic · last scan 2026-10-12: 3 new, 7 dropped");
    expect(cards[1].description).toBe("2 topics · last scan 2026-10-12: failed");
    expect(buildCards(rows, [feed("a")], null)[0].description).toBe("2 topics");
    expect(buildCards(rows, [feed("c")], last)[0].description).toBe("2 topics");
  });

  it("takes the name of a feed the settings no longer know from the last scan", () => {
    const cards = buildCards(rows, [], scan([{ id: "gone", name: "Old search", priority: 0, strong: 0, possible: 0, unchecked: 0, dropped: 0, failed: false }]));
    expect(cards.find((c) => c.feedId === "gone")?.name).toBe("Old search");
  });
});

describe("homeSummary", () => {
  const rows = makeRows([toRead("W1"), toRead("W2", { tier: "priority" }), toRead("W3"), toRead("W4"), paper("W5")], new Set());

  it("counts everything and lists the first papers to read", () => {
    const s = homeSummary(rows, 2);
    expect(s.counts).toEqual({ toRead: 4, ticked: 0, new: 1, read: 0, dismissed: 0 });
    expect(s.toRead.map((r) => r.paper.openalexId)).toEqual(["W2", "W1"]);
    expect(s.more).toBe(2);
  });

  it("has nothing to list when nothing waits", () => {
    expect(homeSummary(makeRows([paper("W1")], new Set()))).toMatchObject({ toRead: [], more: 0 });
  });
});

describe("parseLimit", () => {
  it("reads limit: N from the block, from 1 to 20, and defaults to 3", () => {
    expect(parseLimit("show: home\nlimit: 5")).toBe(5);
    expect(parseLimit("limit:12")).toBe(12);
    expect(parseLimit("limit: 99")).toBe(20);
    expect(parseLimit("limit: 0")).toBe(3);
    expect(parseLimit("show: home")).toBe(3);
    expect(parseLimit("limit: many")).toBe(3);
  });
});
