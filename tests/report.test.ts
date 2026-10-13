import { describe, expect, it } from "vitest";
import { emptyLedger, recordDefinitions, recordScan, type Ledger, type LedgerPaper } from "../src/ledger/ledger";
import { MIN_DECIDED, TOP_TERMS, buildReport, rateOf, reportMarkdown, titleWords } from "../src/ledger/report";
import type { FeedConfig } from "../src/settings/data";

const TODAY = "2026-10-13";
const OLD = "2026-08-03"; // long past: unticked papers are dismissed
const NEW = "2026-10-12"; // this week: unticked papers are undecided

function feed(id = "a", overrides: Partial<FeedConfig> = {}): FeedConfig {
  return {
    id, name: `Feed ${id}`, enabled: true, topics: ["first query", "second query"], groups: [], drop: [], lower: [], yearsFrom: null,
    zoteroCollection: "", project: "", ...overrides,
  };
}

function rec(overrides: Partial<LedgerPaper> = {}): LedgerPaper {
  return { title: "A paper", tier: "strong", start: OLD, topics: [1], terms: [], def: 1, ...overrides };
}

function ledgerWith(papers: Record<string, LedgerPaper>): Ledger {
  const ledger = emptyLedger();
  ledger.papers = papers;
  return ledger;
}

describe("buildReport", () => {
  it("counts wanted, dismissed and undecided; the rate leaves out the undecided", () => {
    const ledger = ledgerWith({
      "a/W1": rec({ ticked: "2026-08-05" }),
      "a/W2": rec({ read: "2026-08-20", synced: "2026-08-06" }),
      "a/W3": rec(),
      "a/W4": rec({ start: NEW }),
    });
    const [f] = buildReport(ledger, [feed()], TODAY, 4).feeds;
    expect(f.totals).toEqual({ listed: 4, interested: 2, dismissed: 1, undecided: 1, read: 1, noAccess: 0 });
    expect(f.rate).toBeCloseTo(2 / 3);
  });

  it("splits by tier in tier order, by topic (a paper counts under each topic) and by month", () => {
    const ledger = ledgerWith({
      "a/W1": rec({ tier: "possible", topics: [1, 2], ticked: "2026-08-05" }),
      "a/W2": rec({ tier: "priority", topics: [2] }),
      "a/W3": rec({ tier: "priority", topics: [1], start: "2026-09-07", ticked: "2026-09-08" }),
    });
    const [f] = buildReport(ledger, [feed()], TODAY, 4).feeds;
    expect(f.byTier.map((t) => [t.tier, t.counts.listed, t.counts.interested])).toEqual([["priority", 2, 1], ["possible", 1, 1]]);
    expect(f.byTopic.map((t) => [t.topic, t.text, t.counts.listed, t.counts.interested])).toEqual([[1, "first query", 2, 2], [2, "second query", 2, 1]]);
    expect(f.byMonth.map((m) => [m.month, m.counts.listed])).toEqual([["2026-08", 2], ["2026-09", 1]]);
  });

  it("adds what the scan log says about each topic", () => {
    const ledger = ledgerWith({ "a/W1": rec({ topics: [1] }) });
    recordScan(ledger, "2026-10-05", [{ feedId: "a", topics: [{ returned: 10, listed: 2, dropped: 3 }, { returned: 4, listed: 0, dropped: 1 }] }]);
    recordScan(ledger, "2026-10-12", [{ feedId: "a", topics: [{ returned: 6, listed: 1, dropped: 0 }] }]);
    const [f] = buildReport(ledger, [feed()], TODAY, 4).feeds;
    expect(f.byTopic.map((t) => [t.topic, t.returned, t.dropped, t.scans])).toEqual([[1, 16, 3, 2], [2, 4, 1, 1]]);
  });

  it("lists feed terms and title words that do better or worse than the average, once they have enough decided papers", () => {
    const papers: Record<string, LedgerPaper> = {};
    // "good" in 4 wanted papers, "poor" in 4 dismissed ones, "rare" in only 2 (below the floor), "mixed" in both groups (50% against 60% overall).
    for (let i = 0; i < 4; i++) papers[`a/G${i}`] = rec({ title: "Flowing polymer", terms: ["Good", "mixed"], ticked: "2026-08-05" });
    for (let i = 0; i < 4; i++) papers[`a/P${i}`] = rec({ title: "Gold particles", terms: ["poor", "mixed"] });
    for (let i = 0; i < 2; i++) papers[`a/R${i}`] = rec({ title: "Rare thing", terms: ["rare"], ticked: "2026-08-05" });
    const [f] = buildReport(ledgerWith(papers), [feed()], TODAY, 4).feeds;
    expect(f.termsHigh.map((t) => t.term)).toEqual(["good"]);
    expect(f.termsLow.map((t) => t.term)).toEqual(["poor", "mixed"]);
    expect(f.termsHigh[0]).toMatchObject({ decided: 4, interested: 4, rate: 1 });
    expect(f.wordsHigh.map((t) => t.term)).toEqual(["flowing", "polymer"]);
    expect(f.wordsLow.map((t) => t.term)).toEqual(["gold", "particles"]);
    expect(f.wordsHigh.concat(f.wordsLow).some((t) => t.term === "rare")).toBe(false);
  });

  it("leaves undecided papers out of the term tallies and lists at most TOP_TERMS each way", () => {
    const papers: Record<string, LedgerPaper> = {};
    for (let i = 0; i < MIN_DECIDED; i++) papers[`a/U${i}`] = rec({ terms: ["waiting"], start: NEW });
    for (let t = 0; t < TOP_TERMS + 3; t++) {
      for (let i = 0; i < MIN_DECIDED; i++) papers[`a/T${t}-${i}`] = rec({ terms: [`term${t}`], ticked: "2026-08-05" });
    }
    for (let i = 0; i < 6; i++) papers[`a/X${i}`] = rec({ terms: ["other"] });
    const [f] = buildReport(ledgerWith(papers), [feed()], TODAY, 4).feeds;
    expect(f.termsHigh).toHaveLength(TOP_TERMS);
    expect(f.termsHigh.some((t) => t.term === "waiting")).toBe(false);
  });

  it("gives each rule version its own counts and the change text", () => {
    const ledger = ledgerWith({ "a/W1": rec({ def: 1, ticked: "2026-08-05" }), "a/W2": rec({ def: 2 }), "a/W3": rec({ def: 2 }) });
    recordDefinitions(ledger, [feed()], "2026-08-01");
    recordDefinitions(ledger, [feed("a", { drop: ["x"] })], "2026-09-01");
    const [f] = buildReport(ledger, [feed("a", { drop: ["x"] })], TODAY, 4).feeds;
    expect(f.versions.map((v) => [v.n, v.at, v.change, v.counts.listed, rateOf(v.counts)])).toEqual([
      [1, "2026-08-01", "first scan with these rules", 1, 1], [2, "2026-09-01", "drop added: x", 2, 0],
    ]);
  });

  it("orders searches as in the settings, then those the settings no longer have, and marks them", () => {
    const ledger = ledgerWith({ "b/W1": rec(), "a/W1": rec(), "gone/W1": rec(), "never/W1": rec() });
    ledger.names.gone = "Old search";
    const report = buildReport(ledger, [feed("b"), feed("a"), feed("unused")], TODAY, 4);
    expect(report.feeds.map((f) => [f.feedId, f.name, f.known])).toEqual([
      ["b", "Feed b", true], ["a", "Feed a", true], ["gone", "Old search", false], ["never", "never", false],
    ]);
  });

  it("is empty for an empty ledger", () => {
    expect(buildReport(emptyLedger(), [feed()], TODAY, 4).feeds).toEqual([]);
  });
});

describe("rateOf and titleWords", () => {
  it("has no rate before anything is decided", () => {
    expect(rateOf({ interested: 0, dismissed: 0 })).toBeNull();
    expect(rateOf({ interested: 1, dismissed: 3 })).toBe(0.25);
  });

  it("takes lower-case words of four letters or more, once each, without common words", () => {
    expect(titleWords("The Synthesis of Self-Immolative Poly(disulfide)s: a study of polymer, POLYMER and gel")).toEqual(
      ["synthesis", "self", "immolative", "poly", "disulfide", "polymer"],
    );
    expect(titleWords("Café résumé")).toEqual(["cafe", "resume"]);
  });
});

describe("reportMarkdown", () => {
  const ledger = ledgerWith({
    "a/W1": rec({ ticked: "2026-08-05", terms: ["x|y"] }), "a/W2": rec(), "a/W3": rec({ start: NEW }),
  });

  it("says how to read it and, for a small search, that the rates are weak", () => {
    const text = reportMarkdown(buildReport(ledger, [feed()], TODAY, 4));
    expect(text).toContain("# Search effectiveness");
    expect(text).toContain("## Feed a");
    expect(text).toContain("3 listed, 2 decided (50% wanted), 1 undecided.");
    expect(text).toContain("weak evidence");
    expect(text).toContain("| strong | 3 | 1 | 1 | 1 | 0 | 0 | 50% |");
    expect(text).toContain("| 1 | first query |");
  });

  it("marks a search that is no longer in the settings, and says so when nothing is recorded", () => {
    expect(reportMarkdown(buildReport(ledger, [], TODAY, 4))).toContain("## a (no longer in the settings)");
    expect(reportMarkdown(buildReport(emptyLedger(), [feed()], TODAY, 4))).toContain("Nothing recorded yet");
  });

  it("escapes the bar in a table cell", () => {
    const papers: Record<string, LedgerPaper> = {};
    for (let i = 0; i < MIN_DECIDED; i++) papers[`a/G${i}`] = rec({ terms: ["x|y"], ticked: "2026-08-05" });
    for (let i = 0; i < MIN_DECIDED; i++) papers[`a/H${i}`] = rec({ terms: ["z"] });
    papers["a/I"] = rec({ terms: ["x|y"], ticked: "2026-08-05" });
    const text = reportMarkdown(buildReport(ledgerWith(papers), [feed()], TODAY, 4));
    expect(text).toContain("| x\\|y |");
  });
});
