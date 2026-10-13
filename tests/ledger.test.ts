import { describe, expect, it } from "vitest";
import {
  DROPPED_CAP, SCAN_CAP, currentDef, describeChange, emptyLedger, forgetFeeds, normaliseLedger, recordDefinitions, recordDropped, recordScan, snapshotOf, updateFromNotes, verdictOf,
  type LedgerPaper,
} from "../src/ledger/ledger";
import type { FeedConfig } from "../src/settings/data";
import type { ParsedPaper } from "../src/inbox/write";

function paper(id: string, overrides: Partial<ParsedPaper> = {}): ParsedPaper {
  return {
    openalexId: id, feedId: "a", tier: "strong", ticked: false, synced: false, list: "ranked", key: null, doi: null, read: false,
    title: `Paper ${id}`, topics: [1], authors: "", venue: "", year: 2026, preprint: false, titleOnly: false, readLink: null, matched: ["alpha", "beta"], ...overrides,
  };
}

function feed(overrides: Partial<FeedConfig> = {}): FeedConfig {
  return {
    id: "a", name: "Feed a", enabled: true, topics: ["one", "two"], groups: [{ name: "G", role: "required", terms: ["x"] }], drop: ["bad"], lower: [],
    yearsFrom: null, zoteroCollection: "", project: "", ...overrides,
  };
}

const NOTE = "2026-W42 Reading inbox.md"; // week of Monday 2026-10-12

describe("updateFromNotes", () => {
  it("makes an entry per paper with its week, topics, terms and tier", () => {
    const ledger = emptyLedger();
    expect(updateFromNotes(ledger, [{ name: NOTE, papers: [paper("W1", { topics: [1, 3] })] }], "2026-10-13")).toBe(true);
    expect(ledger.papers["a/W1"]).toMatchObject({ title: "Paper W1", tier: "strong", start: "2026-10-12", topics: [1, 3], terms: ["alpha", "beta"], def: 0 });
    expect(ledger.papers["a/W1"].ticked).toBeUndefined();
  });

  it("stamps each outcome once, on the day it is first seen, and never takes it back", () => {
    const ledger = emptyLedger();
    updateFromNotes(ledger, [{ name: NOTE, papers: [paper("W1")] }], "2026-10-13");
    expect(updateFromNotes(ledger, [{ name: NOTE, papers: [paper("W1")] }], "2026-10-14")).toBe(false);
    updateFromNotes(ledger, [{ name: NOTE, papers: [paper("W1", { ticked: true })] }], "2026-10-15");
    updateFromNotes(ledger, [{ name: NOTE, papers: [paper("W1", { ticked: true, synced: true })] }], "2026-10-16");
    updateFromNotes(ledger, [{ name: NOTE, papers: [paper("W1", { ticked: false, synced: true, read: true })] }], "2026-10-17");
    updateFromNotes(ledger, [{ name: NOTE, papers: [paper("W1", { ticked: true, synced: true, read: true })] }], "2026-10-18");
    expect(ledger.papers["a/W1"]).toMatchObject({ ticked: "2026-10-15", synced: "2026-10-16", read: "2026-10-17" });
  });

  it("keeps the same paper under two feeds apart, and ignores lines outside any feed", () => {
    const ledger = emptyLedger();
    updateFromNotes(ledger, [{ name: NOTE, papers: [paper("W1"), paper("W1", { feedId: "b" }), paper("W2", { feedId: "" })] }], "2026-10-13");
    expect(Object.keys(ledger.papers).sort()).toEqual(["a/W1", "b/W1"]);
  });

  it("fills in topics and terms that an older record lacked, but does not overwrite them", () => {
    const ledger = emptyLedger();
    updateFromNotes(ledger, [{ name: NOTE, papers: [paper("W1", { topics: [], matched: [] })] }], "2026-10-13");
    updateFromNotes(ledger, [{ name: NOTE, papers: [paper("W1", { topics: [2], matched: ["x"] })] }], "2026-10-14");
    updateFromNotes(ledger, [{ name: NOTE, papers: [paper("W1", { topics: [3], matched: ["y"] })] }], "2026-10-15");
    expect(ledger.papers["a/W1"]).toMatchObject({ topics: [2], terms: ["x"] });
  });

  it("has no week for a note whose name has none", () => {
    const ledger = emptyLedger();
    updateFromNotes(ledger, [{ name: "Reading inbox.md", papers: [paper("W1")] }], "2026-10-13");
    expect(ledger.papers["a/W1"].start).toBe("");
  });

  it("takes the number of the feed's current rules", () => {
    const ledger = emptyLedger();
    recordDefinitions(ledger, [feed()], "2026-10-12");
    updateFromNotes(ledger, [{ name: NOTE, papers: [paper("W1")] }], "2026-10-13");
    expect(ledger.papers["a/W1"].def).toBe(1);
  });
});

describe("verdictOf", () => {
  const base: LedgerPaper = { title: "t", tier: "strong", start: "2026-09-14", topics: [], terms: [], def: 0 };

  it("is interested once ticked, sent or read", () => {
    for (const o of [{ ticked: "2026-09-15" }, { synced: "2026-09-15" }, { read: "2026-09-15" }]) {
      expect(verdictOf({ ...base, ...o }, "2026-10-13", 4)).toBe("interested");
    }
  });

  it("is dismissed only after the note's week plus N weeks, and undecided before", () => {
    // The week of 2026-09-14 runs to 2026-09-20; the same rule as the archive (state.ts): from the Monday 4 weeks after that, 2026-10-19.
    expect(verdictOf(base, "2026-10-18", 4)).toBe("undecided");
    expect(verdictOf(base, "2026-10-19", 4)).toBe("dismissed");
    expect(verdictOf(base, "2026-10-19", 8)).toBe("undecided");
  });

  it("is undecided when the week is unknown", () => {
    expect(verdictOf({ ...base, start: "" }, "2030-01-01", 4)).toBe("undecided");
  });
});

describe("rule versions", () => {
  it("numbers a new version only when the rules differ, and keeps names", () => {
    const ledger = emptyLedger();
    expect(recordDefinitions(ledger, [feed()], "2026-10-12")).toBe(true);
    expect(recordDefinitions(ledger, [feed()], "2026-10-19")).toBe(false);
    expect(recordDefinitions(ledger, [feed({ drop: ["bad", "worse"] })], "2026-10-26")).toBe(true);
    expect(ledger.defs.a.map((d) => [d.n, d.at])).toEqual([[1, "2026-10-12"], [2, "2026-10-26"]]);
    expect(currentDef(ledger, "a")).toBe(2);
    expect(currentDef(ledger, "zzz")).toBe(0);
    expect(ledger.names.a).toBe("Feed a");
  });

  it("describes what changed", () => {
    const before = snapshotOf(feed());
    expect(describeChange(null, before)).toBe("first scan with these rules");
    expect(describeChange(before, snapshotOf(feed()))).toBe("changed");
    expect(describeChange(before, snapshotOf(feed({ topics: ["one", "TWO", "three"] })))).toBe("topic 2 changed; topic 3 added");
    expect(describeChange(before, snapshotOf(feed({ topics: ["one"] })))).toBe("topic 2 removed");
    expect(describeChange(before, snapshotOf(feed({ drop: ["bad", "worse"], lower: ["meh"] })))).toBe("drop added: worse; lower added: meh");
    expect(describeChange(before, snapshotOf(feed({ drop: [] })))).toBe("drop removed: bad");
    expect(describeChange(before, snapshotOf(feed({ groups: [{ name: "G", role: "boost", terms: ["x", "y"] }, { name: "H", role: "boost", terms: [] }] }))))
      .toBe("group \"G\" now boost; group \"G\" terms added: y; group \"H\" added");
    expect(describeChange(before, snapshotOf(feed({ yearsFrom: 2024 })))).toBe("years from none to 2024");
  });
});

describe("the scan log", () => {
  it("keeps the newest scans up to the cap and ignores an empty list", () => {
    const ledger = emptyLedger();
    expect(recordScan(ledger, "2026-10-12", [])).toBe(false);
    for (let i = 0; i < SCAN_CAP + 5; i++) recordScan(ledger, "2026-10-12", [{ feedId: "a", topics: [{ returned: i, listed: 0, dropped: 0 }] }]);
    expect(ledger.scans).toHaveLength(SCAN_CAP);
    expect(ledger.scans[SCAN_CAP - 1].topics[0].returned).toBe(SCAN_CAP + 4);
  });
});

describe("forgetFeeds", () => {
  it("removes everything about feeds that are not kept and says how many papers went", () => {
    const ledger = emptyLedger();
    recordDefinitions(ledger, [feed(), feed({ id: "b", name: "Feed b" })], "2026-10-12");
    recordScan(ledger, "2026-10-12", [{ feedId: "a", topics: [] }, { feedId: "b", topics: [] }]);
    updateFromNotes(ledger, [{ name: NOTE, papers: [paper("W1"), paper("W2", { feedId: "b" }), paper("W3", { feedId: "b" })] }], "2026-10-13");
    expect(forgetFeeds(ledger, new Set(["a"]))).toBe(2);
    expect(Object.keys(ledger.papers)).toEqual(["a/W1"]);
    expect(ledger.scans.map((s) => s.feedId)).toEqual(["a"]);
    expect(Object.keys(ledger.defs)).toEqual(["a"]);
    expect(Object.keys(ledger.names)).toEqual(["a"]);
  });
});

describe("normaliseLedger", () => {
  it("round-trips a ledger through JSON", () => {
    const ledger = emptyLedger();
    recordDefinitions(ledger, [feed()], "2026-10-12");
    recordScan(ledger, "2026-10-12", [{ feedId: "a", topics: [{ returned: 5, listed: 2, dropped: 1 }] }]);
    updateFromNotes(ledger, [{ name: NOTE, papers: [paper("W1", { ticked: true })] }], "2026-10-13");
    const stored: unknown = JSON.parse(JSON.stringify(ledger));
    expect(JSON.parse(JSON.stringify(normaliseLedger(stored)))).toEqual(stored);
  });

  it("returns an empty ledger for anything that is not one, and drops damaged parts", () => {
    for (const raw of [null, undefined, 3, "x", [], {}]) expect(normaliseLedger(raw)).toEqual(emptyLedger());
    const out = normaliseLedger({
      papers: { "a/W1": { title: "ok", tier: "strong", start: "2026-10-12", topics: [1, "x"], terms: ["t", 3], def: 1.5 }, "a/W2": { title: 3 }, "a/W3": { title: "t", tier: "nonsense" } },
      scans: [{ at: "bad", feedId: "a", topics: [] }, { at: "2026-10-12", feedId: "a", topics: [{ returned: "7" }] }, 4],
      defs: { a: [{ n: 1, at: "2026-10-12", snap: { topics: ["t"] } }, { n: "x" }], b: "no" },
      names: { a: "A", b: 3 },
    });
    expect(Object.keys(out.papers)).toEqual(["a/W1"]);
    expect(out.papers["a/W1"]).toMatchObject({ topics: [1], terms: ["t"], def: 0 });
    expect(out.scans).toEqual([{ at: "2026-10-12", feedId: "a", topics: [{ returned: 7, listed: 0, dropped: 0 }] }]);
    expect(out.defs.a).toHaveLength(1);
    expect(out.defs.b).toBeUndefined();
    expect(out.names).toEqual({ a: "A" });
  });
});

describe("dropped ids", () => {
  it("adds ids per search without repeats, keeps the newest up to the cap, and says whether anything was added", () => {
    const ledger = emptyLedger();
    expect(recordDropped(ledger, [{ feedId: "a", ids: ["W1", "W2", "W1"] }, { feedId: "b", ids: [] }])).toBe(true);
    expect(ledger.droppedIds).toEqual({ a: ["W1", "W2"] });
    expect(recordDropped(ledger, [{ feedId: "a", ids: ["W2", "W1"] }])).toBe(false);
    expect(recordDropped(ledger, [{ feedId: "a", ids: ["W3"] }])).toBe(true);
    expect(ledger.droppedIds.a).toEqual(["W1", "W2", "W3"]);
    const many = Array.from({ length: DROPPED_CAP + 5 }, (_, i) => `W${i + 10}`);
    recordDropped(ledger, [{ feedId: "a", ids: many }]);
    expect(ledger.droppedIds.a).toHaveLength(DROPPED_CAP);
    expect(ledger.droppedIds.a[DROPPED_CAP - 1]).toBe(`W${DROPPED_CAP + 14}`);
  });

  it("is cleared with the search by forgetFeeds, and read back tolerantly", () => {
    const ledger = emptyLedger();
    recordDropped(ledger, [{ feedId: "a", ids: ["W1"] }, { feedId: "b", ids: ["W2"] }]);
    forgetFeeds(ledger, new Set(["a"]));
    expect(ledger.droppedIds).toEqual({ a: ["W1"] });
    const back = normaliseLedger({ droppedIds: { a: ["W1", "W1", "x", 3, "W2"], b: "no", c: [] } });
    expect(back.droppedIds).toEqual({ a: ["W1", "W2"] });
    expect(normaliseLedger(JSON.parse(JSON.stringify(ledger))).droppedIds).toEqual({ a: ["W1"] });
  });
});
