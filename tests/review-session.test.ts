// The saved state of a literature review in progress: what is kept, what a damaged file does, and the line shown to resume.
import { describe, expect, it } from "vitest";
import type { ReviewPaper } from "../src/review/collect";
import { describeSession, normaliseSession, type ReviewSession } from "../src/review/session";

function paper(n: number): ReviewPaper {
  return {
    id: `W${n}`, title: `Paper ${n}`, authors: ["A B"], venue: null, year: 2024, publicationDate: null, doi: `10.1000/${n}`, abstract: "text", isPreprint: false,
    citedByCount: n, referencedWorks: ["W1"], finds: [{ feedId: "lipoic", tier: "strong", matched: ["lipoic"], topics: [1] }], tier: "strong",
  };
}

function session(): ReviewSession {
  return {
    version: 1, savedAt: Date.UTC(2026, 9, 13, 12, 0), selected: ["lipoic"], fromYear: "2021", maxPapers: 60, minTier: "possible", abstracts: true,
    result: { papers: [paper(1), paper(2)], total: 172, topics: [{ feedId: "lipoic", topic: "lipoic acid", count: 172, fetched: 100, fromCache: false }], spentUsd: 0.01, stopped: null },
    extras: { missing: [{ paper: { title: "Old", abstract: null, doi: null, year: 2010, openalexId: "https://openalex.org/W9", authors: [], venue: null, publicationDate: null }, count: 2, citers: ["W1", "W2"] }], alsoCite: [], stopped: null },
    answerText: "{\"themes\":[]}",
  };
}

describe("normaliseSession", () => {
  it("returns what was saved", () => {
    const s = session();
    expect(normaliseSession(JSON.parse(JSON.stringify(s)))).toEqual(s);
  });

  it("returns null for a file that holds no review", () => {
    for (const x of [null, 3, "x", [], {}, { version: 2 }, { version: 1 }, { version: 1, result: {} }, { version: 1, result: { papers: [] } }, { version: 1, result: { papers: [{ id: 1 }] } }]) {
      expect(normaliseSession(x)).toBeNull();
    }
  });

  it("leaves out damaged papers and keeps the rest", () => {
    const raw = JSON.parse(JSON.stringify(session())) as { result: { papers: unknown[] } };
    raw.result.papers.push({ id: "W7", title: 5 }, null, "x");
    const back = normaliseSession(raw);
    expect(back?.result.papers.map((p) => p.id)).toEqual(["W1", "W2"]);
  });

  it("falls back to defaults for odd settings and drops damaged lookups", () => {
    const raw = JSON.parse(JSON.stringify(session())) as Record<string, unknown>;
    raw.minTier = "unchecked";
    raw.maxPapers = "lots";
    raw.selected = [1, 2];
    raw.extras = { missing: [{ paper: 1 }], alsoCite: "no" };
    const back = normaliseSession(raw);
    expect(back?.minTier).toBe("possible");
    expect(back?.maxPapers).toBe(60);
    expect(back?.selected).toEqual([]);
    expect(back?.extras).toBeNull();
  });
});

describe("describeSession", () => {
  it("names the searches, the day, the papers and the cost", () => {
    const names = new Map([["lipoic", "Lipoic acid copolymers"]]);
    expect(describeSession(session(), names)).toBe("Lipoic acid copolymers, 2026-10-13, 2 papers, $0.010");
  });

  it("copes with a search that no longer exists and with no date", () => {
    const s = { ...session(), savedAt: 0 };
    expect(describeSession(s, new Map())).toBe("Earlier review, date unknown, 2 papers, $0.010");
  });
});
