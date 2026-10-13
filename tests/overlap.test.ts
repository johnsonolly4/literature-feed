import { describe, expect, it } from "vitest";
import { emptyLedger, type Ledger, type LedgerPaper } from "../src/ledger/ledger";
import { THIN, buildOverlap, overlapMarkdown } from "../src/ledger/overlap";
import { buildReport, reportMarkdown } from "../src/ledger/report";
import type { FeedConfig } from "../src/settings/data";

const TODAY = "2026-10-13";
const OLD = "2026-08-03"; // long past: an unticked paper counts as dismissed

function feed(id: string, name: string, topics: string[] = ["first", "second", "third"]): FeedConfig {
  return { id, name, enabled: true, topics, groups: [], drop: [], lower: [], yearsFrom: null, zoteroCollection: "", project: "" };
}

function paper(overrides: Partial<LedgerPaper> = {}): LedgerPaper {
  return { title: "t", tier: "strong", start: OLD, topics: [], terms: [], def: 0, ...overrides };
}

const wanted = { ticked: "2026-08-05" };

function ledgerOf(papers: Record<string, LedgerPaper>, droppedIds: Record<string, string[]> = {}): Ledger {
  const ledger = emptyLedger();
  ledger.papers = papers;
  ledger.droppedIds = droppedIds;
  return ledger;
}

const A = feed("a", "Alpha");
const B = feed("b", "Beta");

describe("buildOverlap: between searches", () => {
  // Alpha lists W1-W6, Beta lists W1, W2, W7, W8, W9. Shared: W1 (wanted under Alpha), W2 (not wanted).
  const ledger = ledgerOf({
    "a/W1": paper(wanted), "a/W2": paper(), "a/W3": paper(wanted), "a/W4": paper(), "a/W5": paper(), "a/W6": paper(),
    "b/W1": paper(), "b/W2": paper(), "b/W7": paper(wanted), "b/W8": paper(), "b/W9": paper(),
  }, { a: ["W7", "W8", "W99"], b: ["W3"] });

  it("counts what both list, with the wanted rate of the shared papers against the rest", () => {
    const [pair] = buildOverlap(ledger, [A, B], TODAY, 4).pairs;
    expect(pair).toMatchObject({ a: "a", b: "b", aName: "Alpha", bName: "Beta", aListed: 6, bListed: 5, both: 2 });
    expect(pair.bothRate).toBeCloseTo(0.5); // W1 wanted (under either line), W2 dismissed
    expect(pair.restRate).toBeCloseTo(2 / 7); // W3 and W7 wanted of W3-W9 minus nothing: 7 papers
  });

  it("counts papers one search's rules dropped that the other listed, and how many were wanted there", () => {
    const [pair] = buildOverlap(ledger, [A, B], TODAY, 4).pairs;
    expect(pair.aDropsOfB).toEqual({ count: 2, wanted: 1 }); // W7 (wanted) and W8; W99 is not listed by Beta
    expect(pair.bDropsOfA).toEqual({ count: 1, wanted: 1 }); // W3, wanted under Alpha
  });

  it("says it in plain lines", () => {
    const [pair] = buildOverlap(ledger, [A, B], TODAY, 4).pairs;
    expect(pair.lines[0]).toBe("Alpha and Beta both list 2 papers (33% of Alpha, 40% of Beta). Shared papers were wanted 50% of the time, against 29% for the rest.");
    expect(pair.lines).toContain("Alpha's rules dropped 2 papers that Beta listed (1 wanted): its rules may be too strict, or the searches overlap on purpose.");
    expect(pair.lines).toContain("Beta's rules dropped 1 paper that Alpha listed (1 wanted): its rules may be too strict, or the searches overlap on purpose.");
  });

  it("says when nothing is shared, when a search is empty, and when the data is thin", () => {
    const none = ledgerOf({ "a/W1": paper(), "b/W2": paper() });
    const [thin] = buildOverlap(none, [A, B], TODAY, 4).pairs;
    expect(thin.both).toBe(0);
    expect(thin.lines[0]).toBe("Alpha and Beta list no paper in common. (Too few papers to say much.)");
    const many = Object.fromEntries(Array.from({ length: THIN }, (_, i) => [[`a/W${i}`, paper()], [`b/V${i}`, paper()]]).flat());
    expect(buildOverlap(ledgerOf(many), [A, B], TODAY, 4).pairs[0].lines[0]).toBe("Alpha and Beta list no paper in common.");
    const empty = ledgerOf({ "a/W1": paper() }, { b: ["W5"] });
    expect(buildOverlap(empty, [A, B], TODAY, 4).pairs[0].lines[0]).toContain("Beta has no listed papers yet");
  });

  it("has no pairs for one search, and a pair for every two when there are three", () => {
    expect(buildOverlap(ledgerOf({ "a/W1": paper() }), [A, B], TODAY, 4).pairs).toEqual([]);
    const three = ledgerOf({ "a/W1": paper(), "b/W1": paper(), "c/W1": paper() });
    expect(buildOverlap(three, [A, B, feed("c", "Gamma")], TODAY, 4).pairs.map((p) => [p.a, p.b])).toEqual([["a", "b"], ["a", "c"], ["b", "c"]]);
  });

  it("takes a search the settings no longer have from the ledger's names, after the known ones", () => {
    const l = ledgerOf({ "a/W1": paper(), "old/W1": paper() });
    l.names.old = "Old search";
    const pairs = buildOverlap(l, [A], TODAY, 4).pairs;
    expect(pairs).toHaveLength(1);
    expect(pairs[0]).toMatchObject({ a: "a", b: "old", bName: "Old search", both: 1 });
  });
});

describe("buildOverlap: between topics", () => {
  it("counts listed, only-this-topic and the overlap with every other topic", () => {
    const l = ledgerOf({
      "a/W1": paper({ topics: [1, 2] }), "a/W2": paper({ topics: [1] }), "a/W3": paper({ topics: [2] }), "a/W4": paper({ topics: [1, 2, 3] }), "a/W5": paper({ topics: [] }),
    });
    const [t] = buildOverlap(l, [A], TODAY, 4).topics;
    expect(t.feedId).toBe("a");
    expect(t.topics.map((r) => [r.topic, r.text, r.listed, r.only])).toEqual([[1, "first", 3, 1], [2, "second", 3, 1], [3, "third", 1, 0]]);
    expect(t.topics[0].with).toEqual({ 1: 3, 2: 2, 3: 1 });
    expect(t.topics[2].with).toEqual({ 1: 1, 2: 1, 3: 1 });
  });

  it("says when a topic adds nothing beyond another, and when two topics found exactly the same papers", () => {
    const adds = ledgerOf({
      "a/W1": paper({ topics: [1, 2] }), "a/W2": paper({ topics: [1, 2] }), "a/W3": paper({ topics: [1, 2] }), "a/W4": paper({ topics: [1] }),
    });
    expect(buildOverlap(adds, [feed("a", "Alpha", ["x", "y"])], TODAY, 4).topics[0].lines).toEqual(["Topic 2 adds nothing: every paper it listed (3) was also found by topic 1."]);
    const twins = ledgerOf({ "a/W1": paper({ topics: [1, 2] }), "a/W2": paper({ topics: [1, 2] }), "a/W3": paper({ topics: [1, 2] }) });
    expect(buildOverlap(twins, [feed("a", "Alpha", ["x", "y"])], TODAY, 4).topics[0].lines).toEqual(["Topics 1 and 2 found exactly the same 3 papers: one of them is enough."]);
  });

  it("does not call a topic redundant on too few papers, and skips searches with no recorded topics", () => {
    const few = ledgerOf({ "a/W1": paper({ topics: [1, 2] }), "a/W2": paper({ topics: [1, 2] }) });
    expect(buildOverlap(few, [feed("a", "Alpha", ["x", "y"])], TODAY, 4).topics[0].lines).toEqual([]);
    expect(buildOverlap(ledgerOf({ "a/W1": paper() }), [A], TODAY, 4).topics).toEqual([]);
  });
});

describe("overlapMarkdown and the report", () => {
  const ledger = ledgerOf({
    "a/W1": paper({ ...wanted, topics: [1, 2] }), "a/W2": paper({ topics: [1] }), "b/W1": paper({ topics: [1] }),
  }, { b: ["W2"] });

  it("prints the pair table, its lines, and the topic matrix", () => {
    const text = overlapMarkdown(buildOverlap(ledger, [A, B], TODAY, 4)).join("\n");
    expect(text).toContain("## Overlap");
    expect(text).toContain("### Between searches");
    expect(text).toContain("| Search A | Search B | Listed A | Listed B | In both |");
    expect(text).toContain("| Alpha | Beta | 2 | 1 | 1 |");
    expect(text).toContain("### Between the topics of Alpha");
    expect(text).toContain("| Topic | Query | Listed | Only this topic | With topic 1 | With topic 2 | With topic 3 |");
    expect(text).toContain("Beta's rules dropped 1 paper that Alpha listed");
  });

  it("is empty when there is nothing to show, and is part of the search report", () => {
    expect(overlapMarkdown({ pairs: [], topics: [] })).toEqual([]);
    const md = reportMarkdown(buildReport(ledger, [A, B], TODAY, 4));
    expect(md).toContain("## Overlap");
    expect(md.indexOf("## Overlap")).toBeGreaterThan(md.indexOf("## Beta"));
    expect(reportMarkdown(buildReport(emptyLedger(), [A], TODAY, 4))).not.toContain("Overlap");
  });
});
