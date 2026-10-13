// Search strings built from known papers: shared phrases, strings in OpenAlex form, what each string finds, and the leave-one-out test.
import { describe, expect, it } from "vitest";
import { spellingForms } from "../src/match/score";
import { leaveOneOut, matchesQuery, mineTerms, queryText, suggestQueries, type SeedText } from "../src/review/seed-queries";

const p = (id: string, title: string, abstract: string | null = null): SeedText => ({ id, title, abstract });
const seeds = [
  p("a", "Flow reactor platform for RAFT dispersion polymerisation of block copolymer nanoparticles", "We report a continuous flow reactor with online monitoring."),
  p("b", "Autonomous optimisation of RAFT dispersion polymerization in a flow reactor", "A closed loop optimisation platform controls the flow reactor."),
  p("c", "Closed loop optimisation of nanoparticle synthesis", "Multi-objective Bayesian optimisation with a flow reactor."),
  p("d", "Unrelated study of lipid membranes", "Phospholipid bilayers were imaged."),
];

describe("spelling forms", () => {
  it("writes a term both ways without plurals", () => {
    expect(spellingForms("dispersion polymerisation").sort()).toEqual(["dispersion polymerisation", "dispersion polymerization"]);
    expect(spellingForms("flow reactor")).toEqual(["flow reactor"]);
  });
});

describe("mining shared phrases", () => {
  const terms = mineTerms(seeds).map((m) => m.term);

  it("keeps phrases that two or more papers share, and acronyms, not plain single words", () => {
    expect(terms).toContain("flow reactor");
    expect(terms.some((t) => t.includes("raft"))).toBe(true);
    expect(terms).not.toContain("flow");
    expect(terms).not.toContain("lipid membranes");
  });

  it("drops a phrase that sits inside a longer one found in the same papers", () => {
    expect(terms).not.toContain("closed loop");
    expect(terms).toContain("closed loop optimisation");
  });

  it("leaves out phrases that are common in the background", () => {
    const background = Array.from({ length: 10 }, () => "a flow reactor paper");
    expect(mineTerms(seeds, 2, background).map((m) => m.term)).not.toContain("flow reactor");
  });
});

describe("strings", () => {
  it("are written in OpenAlex form: quotes for phrases, both spellings, OR inside and AND between", () => {
    expect(queryText([["flow reactor"], ["dispersion polymerisation", "raft"]])).toBe('"flow reactor" AND ("dispersion polymerisation" OR "dispersion polymerization" OR raft)');
  });

  it("match a paper by title or abstract, in either spelling", () => {
    expect(matchesQuery([["flow reactor"], ["dispersion polymerisation"]], seeds[1])).toBe(true);
    expect(matchesQuery([["flow reactor"], ["lipid"]], seeds[1])).toBe(false);
    expect(matchesQuery([], seeds[1])).toBe(false);
  });

  it("are suggested so that together they find the papers, each with what it finds", () => {
    const qs = suggestQueries(seeds);
    expect(qs.length).toBeGreaterThan(0);
    const found = new Set(qs.flatMap((q) => q.matches));
    expect(found.has("a") && found.has("b") && found.has("c")).toBe(true);
    expect(found.has("d")).toBe(false);
    for (const q of qs) {
      expect(q.text.length).toBeGreaterThan(0);
      expect(q.matches.every((id) => matchesQuery(q.groups, seeds.find((s) => s.id === id) as SeedText))).toBe(true);
    }
  });

  it("give nothing when too few papers share anything", () => {
    expect(suggestQueries([p("x", "Alpha beta gamma delta"), p("y", "Completely different words here")])).toEqual([]);
  });
});

describe("leave-one-out", () => {
  it("counts the papers that strings built from the others would find", () => {
    const r = leaveOneOut(seeds);
    expect(r.total).toBe(4);
    expect(r.missed).toContain("d");
    expect(r.found + r.missed.length).toBe(4);
  });
});
