// The Improve tab's model on invented reports and papers: what each section says, and what it says when it has nothing.
import { describe, expect, it } from "vitest";
import { buildImprove, pairFrom } from "../src/improve/model";
import type { PairRow } from "../src/ledger/overlap";
import { emptyCounts, type FeedReport, type Report } from "../src/ledger/report";
import type { Candidate } from "../src/openalex/client";
import type { KnownPapers } from "../src/review/known";
import { buildSeedProfile } from "../src/review/seeds";

const counts = (interested: number, dismissed: number, undecided = 0) => ({ ...emptyCounts(), listed: interested + dismissed + undecided, interested, dismissed, undecided });
const feedReport = (feedId: string, c = counts(0, 0)): FeedReport => ({
  feedId, name: feedId.toUpperCase(), known: true, totals: c, rate: null, byTier: [], byTopic: [], byMonth: [], termsHigh: [], termsLow: [], wordsHigh: [], wordsLow: [], versions: [],
});
const pair = (over: Partial<PairRow> = {}): PairRow => ({
  a: "sdl", b: "lipoic", aName: "SDL", bName: "Lipoic", aListed: 10, bListed: 20, both: 4, bothRate: null, restRate: null,
  aDropsOfB: { count: 2, wanted: 1 }, bDropsOfA: { count: 3, wanted: 0 }, lines: [], ...over,
});
const report = (feeds: FeedReport[], pairs: PairRow[] = []): Report => ({ today: "2026-10-14", dismissAfterWeeks: 4, feeds, overlap: { pairs, topics: [] } });
const known = (dois: string[]): KnownPapers => ({ status: dois.length > 0 ? "ok" : "empty", path: "Inbox/SDL/seeds", dois, withoutDoi: [], counts: { items: dois.length, withDoi: dois.length, without: 0, repeats: 0, notCounted: 0, extra: 0 } } as unknown as KnownPapers);

const cand = (n: number, title: string, abstract: string, refs: string[], authors: string[]): Candidate => ({
  title, abstract, doi: `https://doi.org/10.1/c${n}`, year: 2020, openalexId: `https://openalex.org/W${n}`, authors, venue: null, publicationDate: null, referencedWorks: refs,
});
const A = ["A1", "A2", "A3", "A4"];
const seeds = [
  cand(1, "Bayesian optimisation of flow chemistry", "Bayesian optimisation drives a self-driving flow reactor.", [...A, "X1"], ["Ann Lee"]),
  cand(2, "Bayesian optimisation of self-driving labs", "Bayesian optimisation in self-driving flow labs.", [...A, "X2"], ["Ann Lee"]),
  cand(3, "Closed-loop Bayesian optimisation", "Closed-loop Bayesian optimisation of a flow reactor.", [...A, "X3"], ["Ann Lee"]),
];
const sdl = { id: "sdl", name: "SDL" };

describe("how it is doing", () => {
  it("says there is nothing yet for a search with no papers in the ledger", () => {
    expect(buildImprove(sdl, report([feedReport("sdl")]), known([]), null).doing.status).toBe("none");
    expect(buildImprove(sdl, report([]), known([]), null).doing.status).toBe("none");
  });

  it("gives the wanted rate and calls fewer than 20 decided weak evidence", () => {
    const d = buildImprove(sdl, report([feedReport("sdl", counts(6, 4, 3))]), known([]), null).doing;
    expect(d.status).toBe("ok");
    expect(d.decided).toBe(10);
    expect(d.rate).toBeCloseTo(0.6);
    expect(d.weak).toBe(true);
  });

  it("is no longer weak at 20 decided papers", () => {
    expect(buildImprove(sdl, report([feedReport("sdl", counts(12, 8))]), known([]), null).doing.weak).toBe(false);
  });
});

describe("overlap", () => {
  it("keeps only the pairs that include this search and reads them from its side", () => {
    const other = pair({ a: "x", b: "y" });
    const m = buildImprove(sdl, report([feedReport("sdl")], [pair(), other]), known([]), null);
    expect(m.overlap.pairs).toHaveLength(1);
    const v = pairFrom(m.overlap.pairs[0], "sdl");
    expect(v).toMatchObject({ other: "Lipoic", mine: 10, theirs: 20, both: 4 });
    expect(v.myRulesDropped).toEqual({ count: 2, wanted: 1 }); // papers SDL (A) dropped that Lipoic (B) listed
    expect(v.theirRulesDropped).toEqual({ count: 3, wanted: 0 });
    const w = pairFrom(m.overlap.pairs[0], "lipoic");
    expect(w).toMatchObject({ other: "SDL", mine: 20, theirs: 10 });
  });

  it("is empty when no pair has this search", () => {
    expect(buildImprove(sdl, report([feedReport("sdl")], [pair({ a: "x", b: "y" })]), known([]), null).overlap.pairs).toEqual([]);
  });
});

describe("known papers", () => {
  it("asks for the papers to be read before it judges links or strings", () => {
    const m = buildImprove(sdl, report([feedReport("sdl")]), known(["10.1/c1"]), null);
    expect(m.hasKnown).toBe(true);
    expect(m.coherence.status).toBe("no-profile");
    expect(m.strings.status).toBe("no-profile");
  });

  it("builds strings with what each finds and the leave-one-out test from a profile", () => {
    const profile = buildSeedProfile(seeds.map((c) => c.doi ?? ""), seeds);
    const m = buildImprove(sdl, report([feedReport("sdl")]), known(profile.dois), profile);
    expect(m.coherence.status).toBe("ok");
    expect(m.strings.status).toBe("ok");
    expect(m.strings.queries.length).toBeGreaterThan(0);
    expect(m.strings.queries[0].matches.length).toBeGreaterThan(1);
    expect(m.strings.test?.total).toBe(3);
  });

  it("needs two papers for strings", () => {
    const profile = buildSeedProfile([seeds[0].doi ?? ""], [seeds[0]]);
    expect(buildImprove(sdl, report([feedReport("sdl")]), known([]), profile).strings.status).toBe("too-few");
  });
});
