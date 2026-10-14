// The record of a literature review: what is kept so that the search can be repeated, the readable section, the block the plugin
// reads back, and the comparison with a repeat. Nothing calls the network.
import { describe, expect, it } from "vitest";
import type { ReviewPaper, ReviewResult } from "../src/review/collect";
import { renderReviewNote } from "../src/review/note";
import {
  buildRecord, diffPapers, feedFromSnapshot, normaliseRecord, normaliseRun, parseRecord, recordBlock, recordFromNote, renderRecordSection, runInfo, sha256Hex, snapshotFeed,
  type ReviewRecord,
} from "../src/review/record";
import { describeSession, normaliseSession, type ReviewSession } from "../src/review/session";
import type { FeedConfig } from "../src/settings/data";

function feed(overrides: Partial<FeedConfig> = {}): FeedConfig {
  return {
    id: "lipoic", name: "Lipoic acid copolymers", enabled: true, topics: ["lipoic acid copolymer", "\"thioctic acid\" AND vinyl"],
    groups: [{ name: "Lipoic", role: "required", terms: ["lipoic acid", "thioctic acid"] }, { name: "Degradable", role: "priority", terms: ["degradable"] }],
    drop: ["clinical trial"], lower: ["adhesive"], yearsFrom: 2021, zoteroCollection: "Lit", project: "p1", seedCollection: "", knownDois: [], ...overrides,
  };
}

function paper(n: number, tier: ReviewPaper["tier"] = "strong"): ReviewPaper {
  return {
    id: `W${n}`, title: `Paper ${n}`, authors: ["A B"], venue: null, year: 2024, publicationDate: null, doi: `10.1000/${n}`, abstract: "text", isPreprint: false,
    citedByCount: 10 - n, referencedWorks: ["W1"], finds: [{ feedId: "lipoic", tier, matched: ["lipoic acid"], topics: [1] }], tier,
  };
}

function result(papers: ReviewPaper[]): ReviewResult {
  return {
    papers, total: 172, spentUsd: 0.01, stopped: null,
    topics: [{ feedId: "lipoic", topic: "lipoic acid copolymer", count: 120, fetched: 100, fromCache: false }, { feedId: "lipoic", topic: "\"thioctic acid\" AND vinyl", count: 52, fetched: 52, fromCache: true }],
  };
}

const OPTS = { fromDate: "2021-01-01", capPerTopic: 300, maxPapers: 60, minTier: "possible" as const, refresh: false };

function record(llm = true): ReviewRecord {
  const run = runInfo(new Date("2026-10-13T12:04:00Z"), [feed()], OPTS, true);
  return buildRecord({
    run, result: result([paper(1), paper(2, "priority")]), coverage: { withList: 2, total: 2 }, missing: [{ label: "M1", id: "W99", count: 3 }], citing: [],
    llm: llm ? { name: "Test model 1", promptChars: 1234, promptHash: "abc123", promptNote: "04 Literature/Reviews/Literature review prompt 2026-10-13.md", answer: "{\"themes\":[]}" } : null,
  });
}

describe("what is recorded", () => {
  it("keeps the search definitions as they were, even if the feed is edited later", () => {
    const f = feed();
    const run = runInfo(new Date("2026-10-13T12:04:00Z"), [f], OPTS, true);
    f.topics.push("added later");
    f.groups[0].terms.push("later term");
    f.drop.length = 0;
    expect(run.feeds[0].topics).toHaveLength(2);
    expect(run.feeds[0].groups[0].terms).toEqual(["lipoic acid", "thioctic acid"]);
    expect(run.feeds[0].drop).toEqual(["clinical trial"]);
    expect(run.feeds[0]).not.toHaveProperty("zoteroCollection");
  });

  it("records the window, the sort, the cap, the tier limit and the first request of each topic without a key", () => {
    const r = record();
    expect(r).toMatchObject({ fromDate: "2021-01-01", sort: "relevance_score:desc", capPerTopic: 300, pageSize: 100, minTier: "possible", maxPapers: 60, abstracts: true });
    const url = new URL(r.topics[0].url);
    expect(url.hostname).toBe("api.openalex.org");
    expect(url.searchParams.get("search.title_and_abstract")).toBe("lipoic acid copolymer");
    expect(url.searchParams.get("filter")).toBe("from_publication_date:2021-01-01");
    expect(url.searchParams.get("sort")).toBe("relevance_score:desc");
    expect(r.topics[0].url).not.toMatch(/key|mailto/i);
    expect(r.topics[1]).toMatchObject({ count: 52, fetched: 52, fromCache: true });
  });

  it("fixes which paper is P1, P2 with its id, rank, matched terms and citations", () => {
    const r = record();
    expect(r.papers.map((p) => [p.label, p.id, p.tier, p.citedBy])).toEqual([["P1", "W1", "strong", 9], ["P2", "W2", "priority", 8]]);
    expect(r.papers[0].matched).toEqual(["lipoic acid"]);
    expect(r.missing).toEqual([{ label: "M1", id: "W99", count: 3 }]);
  });

  it("turns a snapshot back into a feed that can be run", () => {
    const f = feedFromSnapshot(snapshotFeed(feed()));
    expect(f).toMatchObject({ id: "lipoic", name: "Lipoic acid copolymers", enabled: true, yearsFrom: 2021, drop: ["clinical trial"], lower: ["adhesive"] });
    expect(f.topics).toHaveLength(2);
    expect(f.groups[1]).toEqual({ name: "Degradable", role: "priority", terms: ["degradable"] });
  });
});

describe("the block and the section", () => {
  it("reads the block back, with LF or CRLF line ends, from a note", () => {
    const r = record();
    const text = ["---", "kind: literature-review", "---", "", "## How this review was made", "", ...recordBlock(r), "", "more"].join("\n");
    expect(recordFromNote(text)).toEqual(r);
    expect(recordFromNote(text.replace(/\n/g, "\r\n"))).toEqual(r);
    expect(recordFromNote("no record here")).toBeNull();
  });

  it("returns null for a block that is damaged or not a record", () => {
    for (const x of ["", "not json", "{}", "[]", "{\"version\":2}", JSON.stringify({ ...record(), feeds: [] }), JSON.stringify({ ...record(), feeds: [{ id: 1 }] }), JSON.stringify({ ...record(), papers: [{ id: "W1" }] })]) {
      expect(parseRecord(x)).toBeNull();
    }
    expect(normaliseRecord(null)).toBeNull();
  });

  it("writes the searches, the rules, the dates and the LLM in plain text", () => {
    const text = renderRecordSection(record()).join("\n");
    expect(text).toContain("## How this review was made");
    expect(text).toContain("2026-10-13T12:04:00.000Z");
    expect(text).toContain("published on or after 2021-01-01");
    expect(text).toContain("1. `lipoic acid copolymer` — 120 matches, 100 fetched");
    expect(text).toContain("2. `\"thioctic acid\" AND vinyl` — 52 matches, 52 fetched (from saved results)");
    expect(text).toContain("- Lipoic (required): `lipoic acid`, `thioctic acid`");
    expect(text).toContain("- Drop the paper if it matches: `clinical trial`");
    expect(text).toContain("- Move it down one rank if it matches: `adhesive`");
    expect(text).toContain("Test model 1");
    expect(text).toContain("SHA-256 `abc123`");
    expect(text).toContain("[[04 Literature/Reviews/Literature review prompt 2026-10-13]]");
    expect(text).toContain("```literature-feed-record");
  });

  it("says plainly when no LLM answer was added", () => {
    expect(renderRecordSection(record(false)).join("\n")).toContain("no answer was added");
  });

  it("goes into the review note with properties, and the note without a record has none of it", () => {
    const base = { date: "2026-10-13", searches: ["Lipoic acid copolymers"], fromDate: "2021", papers: [paper(1)], flags: [{ zotero: null, vault: null, listedBefore: [] }], total: 1, spentUsd: 0.01, stopped: null, answer: null };
    const withRecord = renderReviewNote({ ...base, record: record() });
    expect(withRecord).toContain("review-run: \"2026-10-13T12:04:00.000Z\"");
    expect(withRecord).toContain("review-from: 2021-01-01");
    expect(withRecord).toContain("llm: \"Test model 1\"");
    expect(withRecord).toContain("## How this review was made");
    expect(withRecord.indexOf("---\n\n")).toBeGreaterThan(0);
    const without = renderReviewNote(base);
    expect(without).not.toContain("How this review was made");
    expect(without).not.toContain("review-run");
  });
});

describe("repeating a review", () => {
  it("lists what is new, what is gone and what changed rank", () => {
    const before = [paper(1), paper(2), paper(3)].map((p) => ({ id: p.id, title: p.title, tier: p.tier }));
    const after = [paper(1), paper(3, "priority"), paper(4)];
    const c = diffPapers(before, after);
    expect(c.added).toEqual([{ id: "W4", title: "Paper 4" }]);
    expect(c.removed).toEqual([{ id: "W2", title: "Paper 2" }]);
    expect(c.tierChanged).toEqual([{ title: "Paper 3", from: "strong", to: "priority" }]);
    expect(diffPapers(before, [])).toMatchObject({ added: [], removed: before.map((p) => ({ id: p.id, title: p.title })) });
  });

  it("hashes text with SHA-256", async () => {
    expect(await sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });

  it("reads the run information tolerantly", () => {
    const run = runInfo(new Date("2026-10-13T12:04:00Z"), [feed()], OPTS, false);
    expect(normaliseRun(JSON.parse(JSON.stringify(run)))).toEqual(run);
    for (const x of [null, 3, {}, { ...run, feeds: [{}] }, { ...run, ranAt: 5 }]) expect(normaliseRun(x)).toBeNull();
  });
});

describe("the saved session keeps the record fields", () => {
  const s: ReviewSession = {
    version: 1, savedAt: Date.UTC(2026, 9, 13, 12, 0), selected: ["lipoic"], fromYear: "2021", maxPapers: 60, capPerTopic: 800, minTier: "possible", abstracts: true,
    result: result([paper(1)]), extras: null, answerText: "", run: runInfo(new Date("2026-10-13T12:04:00Z"), [feed()], OPTS, true), llm: "Test model 1",
    promptNote: "Prompt.md", baseline: record(), snapshot: [snapshotFeed(feed())],
  };

  it("round-trips the run, the LLM, the prompt note, the baseline and the recorded definitions", () => {
    expect(normaliseSession(JSON.parse(JSON.stringify(s)))).toEqual(s);
    expect(describeSession(s, new Map([["lipoic", "Lipoic acid copolymers"]]))).toContain("1 papers");
  });

  it("copes with a session saved before these fields existed", () => {
    const { run: _run, llm: _llm, promptNote: _pn, baseline: _b, snapshot: _sn, ...old } = s;
    const back = normaliseSession(JSON.parse(JSON.stringify(old)));
    expect(back).toMatchObject({ run: null, llm: "", promptNote: null, baseline: null, snapshot: null });
  });
});
