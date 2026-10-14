// Coherence of a search's known papers: outliers, strands, and the fit of a new paper, on invented papers with known answers.
import { describe, expect, it } from "vitest";
import type { Candidate } from "../src/openalex/client";
import { coherence, coherenceLines, fitOfNew, pairLinks } from "../src/review/coherence";
import { buildSeedProfile } from "../src/review/seeds";

const cand = (n: number, title: string, refs: string[], authors: string[]): Candidate => ({
  title, abstract: null, doi: `https://doi.org/10.1/c${n}`, year: 2020, openalexId: `https://openalex.org/W${n}`, authors, venue: null, publicationDate: null, referencedWorks: refs,
});
const profileOf = (cs: Candidate[]) => buildSeedProfile(cs.map((c) => c.doi ?? ""), cs);

// Strand A: optimisation (W1-W3). Strand B: dispersion in flow (W5-W7). W4 links to both only weakly.
const A = ["A1", "A2", "A3", "A4", "A5"];
const B = ["B1", "B2", "B3", "B4", "B5"];
const strands = [
  cand(1, "Bayesian optimisation of flow chemistry", [...A, "X1"], ["Ann Lee"]),
  cand(2, "Bayesian optimisation of self-driving labs", [...A, "X2"], ["Ann Lee", "Bob Roe"]),
  cand(3, "Closed-loop Bayesian optimisation", [...A.slice(0, 4), "X3"], ["Bob Roe"]),
  cand(4, "A bridging paper", ["A1", "B1", "Y1"], ["Cy Poe"]),
  cand(5, "RAFT dispersion in flow reactors", [...B, "Z1"], ["Dee Fox"]),
  cand(6, "RAFT dispersion in tubular flow", [...B, "Z2"], ["Dee Fox", "Eli Kay"]),
  cand(7, "Residence time dispersion for RAFT in flow", [...B.slice(0, 4), "Z3"], ["Eli Kay"]),
];

describe("pair links", () => {
  it("counts a shared reference 1 and a shared author 3", () => {
    expect(pairLinks({ id: "a", refs: ["R1", "R2"], authors: ["lee|a"] }, { id: "b", refs: ["R2"], authors: ["lee|a", "roe|b"] })).toBe(4);
  });
});

describe("coherence", () => {
  it("finds two strands and keeps the weakly linked bridge out of them", () => {
    const c = coherence(profileOf(strands));
    expect(c.status).toBe("ok");
    const groups = c.strands.map((s) => [...s.ids].sort());
    expect(groups).toContainEqual(["W1", "W2", "W3"]);
    expect(groups).toContainEqual(["W5", "W6", "W7"]);
    expect(c.strands).toHaveLength(2);
    expect(c.strands.find((s) => s.ids.includes("W5"))?.phrases.length).toBeGreaterThan(0);
  });

  it("flags a paper that links to none of the others", () => {
    const c = coherence(profileOf([...strands.slice(0, 3), cand(9, "Lipoic acid copolymers", ["Q1", "Q2"], ["Fay Moss"])]));
    expect(c.outliers).toEqual(["W9"]);
    expect(c.strands.map((s) => [...s.ids].sort())).toEqual([["W1", "W2", "W3"]]);
    expect(coherenceLines(c, (id) => id)[0]).toContain("W9");
  });

  it("calls a coherent set one strand with no outliers", () => {
    const c = coherence(profileOf(strands.slice(0, 3)));
    expect(c.outliers).toEqual([]);
    expect(c.strands).toHaveLength(1);
    expect(coherenceLines(c, (id) => id)).toEqual(["Your papers link to each other: they look like one strand."]);
  });

  it("gives no verdict for fewer than three papers, or for a profile saved without links", () => {
    expect(coherence(profileOf(strands.slice(0, 2))).status).toBe("too-few");
    const { perPaper: _drop, ...old } = profileOf(strands);
    expect(coherence(old).status).toBe("no-data");
    expect(coherenceLines(coherence(old), (id) => id)[0]).toContain("saved before");
  });
});

describe("fit of a new paper", () => {
  const mine = profileOf(strands.slice(0, 3));
  const other = profileOf(strands.slice(4));
  const node = (refs: string[], authors: string[] = []) => ({ id: "NEW", refs, authors });

  it("fits when it overlaps the known papers as much as they overlap each other", () => {
    expect(fitOfNew(node(A, ["lee|a"]), mine)?.fits).toBe(true);
  });

  it("does not fit when it shares nothing, and names no other search then", () => {
    const f = fitOfNew(node(["Q1"]), mine, [{ name: "Other", profile: other }]);
    expect(f).toMatchObject({ fits: false, betterSearch: null });
  });

  it("names another search that it fits better", () => {
    const f = fitOfNew(node(B, ["fox|d"]), mine, [{ name: "Dispersion", profile: other }]);
    expect(f).toMatchObject({ fits: false, betterSearch: "Dispersion" });
  });

  it("says nothing when there are too few known papers", () => {
    expect(fitOfNew(node(["A1"]), profileOf(strands.slice(0, 2)))).toBeNull();
  });
});
