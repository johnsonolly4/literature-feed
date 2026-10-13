// Ranking by overlap with papers the user already knows: references and authors they share, a seed judged by the others only.
import { describe, expect, it } from "vitest";
import type { Candidate } from "../src/openalex/client";
import { orderPapers, type ReviewPaper } from "../src/review/collect";
import { buildSeedProfile, seedDois, seedLine, seedScore } from "../src/review/seeds";


const cand = (n: number, refs: string[], authors: string[]): Candidate => ({
  title: `Seed ${n}`, abstract: null, doi: `https://doi.org/10.1/s${n}`, year: 2020, openalexId: `https://openalex.org/W${n}`, authors, venue: null, publicationDate: null, referencedWorks: refs,
});
const seeds = [cand(1, ["R1", "R2", "R3"], ["Ann Lee", "Bob Roe"]), cand(2, ["R2", "R3", "R4"], ["Ann Lee", "Cy Poe"]), cand(3, ["R3", "R9"], ["Bob Roe", "Dee Fox"])];
const profile = buildSeedProfile(["10.1/s1", "10.1/s2", "10.1/s3", "10.1/s4"], seeds);

describe("seed profile", () => {
  it("counts the seeds citing each work and the seeds by each author, and names the DOIs OpenAlex lacked", () => {
    expect(profile.refs).toMatchObject({ R1: 1, R2: 2, R3: 3, R4: 1, R9: 1 });
    expect(profile.authors["lee|a"]).toBe(2);
    expect(profile.authors["poe|c"]).toBe(1);
    expect(profile.ids).toEqual(["W1", "W2", "W3"]);
    expect(profile.missing).toEqual(["10.1/s4"]);
  });

  it("picks DOIs out of any pasted text", () => {
    expect(seedDois("see https://doi.org/10.1039/D2PY00040G and (10.1021/jacs.3c08248).\n10.1039/d2py00040g")).toEqual(["10.1039/d2py00040g", "10.1021/jacs.3c08248"]);
  });
});

describe("seed score", () => {
  it("counts shared references (1 each) and authors on two or more seeds (3 each)", () => {
    const s = seedScore({ id: "W50", referencedWorks: ["R2", "R3", "RX"], authors: ["A. Lee", "Cy Poe"] }, profile);
    expect(s).toMatchObject({ refs: 2, authors: 1, score: 5, isSeed: false });
    expect(seedScore({ id: "W51", referencedWorks: [], authors: [] }, profile).score).toBe(0);
  });

  it("judges a seed by the other seeds only", () => {
    const s = seedScore({ id: "W1", referencedWorks: ["R1", "R2", "R3"], authors: ["Ann Lee", "Bob Roe"] }, profile);
    expect(s).toMatchObject({ refs: 2, authors: 2, isSeed: true });
  });

  it("uses every author when there are only one or two seeds", () => {
    const small = buildSeedProfile(["10.1/s1"], [seeds[0]]);
    expect(seedScore({ id: "W9", referencedWorks: [], authors: ["Ann Lee"] }, small).authors).toBe(1);
  });

  it("describes the overlap in a line, or nothing", () => {
    expect(seedLine({ refs: 1, authors: 2, score: 7, isSeed: false })).toBe("shares 1 reference and 2 authors with the papers I already know");
    expect(seedLine({ refs: 0, authors: 0, score: 0, isSeed: false })).toBe("");
  });
});

describe("ordering by seeds", () => {
  const paper = (id: string, score: number, over: Partial<ReviewPaper> = {}): ReviewPaper => ({
    id, title: id, authors: [], venue: null, year: 2020, publicationDate: null, doi: null, abstract: null, isPreprint: false, citedByCount: 0, referencedWorks: [],
    tier: "strong", finds: [{ feedId: "a", tier: "strong", matched: [], topics: [1] }], seed: { refs: score, authors: 0, score, isSeed: false }, ...over,
  });

  it("puts the paper that overlaps most first within a rank, but rank still comes first", () => {
    const list = [paper("low", 1), paper("high", 30), paper("top", 0, { tier: "priority" })];
    expect(orderPapers(list, "seeds").map((p) => p.id)).toEqual(["top", "high", "low"]);
  });
});
