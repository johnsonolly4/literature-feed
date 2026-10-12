import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Feed, Paper } from "../src/match/feed";
import { containsTerm, normaliseText, scorePaper, termVariants } from "../src/match/score";
import { lipoicFeed } from "./fixtures/lipoic-feed";
import {
  dropSentences,
  lowerSentences,
  possible,
  priorityFlow,
  strongComonomer,
  tierCases,
  withSentence,
} from "./fixtures/lipoic-papers";

describe("tiers (lipoic acid feed)", () => {
  it.each(tierCases)("$id is $tier", (c) => {
    const score = scorePaper(c, lipoicFeed);
    expect(score.tier).toBe(c.tier);
    expect(score.groups.map((g) => g.name)).toEqual(c.groups);
    expect(score.dropTerms).toEqual([]);
    expect(score.lowerTerms).toEqual([]);
  });

  it("lists the configured terms that matched, in feed order", () => {
    const score = scorePaper(priorityFlow, lipoicFeed);
    expect(score.groups.find((g) => g.name === "Lipoic acid")?.terms).toEqual(["lipoic acid"]);
    expect(score.groups.find((g) => g.name === "Comonomer class")?.terms).toEqual(["acrylamide"]);
    expect(scorePaper({ title: "Lipoic acid and thioctic acid polymers" }, lipoicFeed).groups[0].terms).toEqual([
      "lipoic acid",
      "thioctic acid",
    ]);
  });
});

describe("drop terms", () => {
  it("the base paper is Priority without the drop sentence", () => {
    expect(scorePaper(priorityFlow, lipoicFeed).tier).toBe("priority");
  });

  it.each(lipoicFeed.drop)("%s drops an otherwise Priority paper", (term) => {
    const score = scorePaper(withSentence(priorityFlow, dropSentences[term]), lipoicFeed);
    expect(score.dropTerms).toEqual([term]);
    expect(score.tier).toBe("dropped");
  });

  it("every drop term has a fixture sentence", () => {
    expect(Object.keys(dropSentences).sort()).toEqual([...lipoicFeed.drop].sort());
  });

  it("matches a drop term in the title as well", () => {
    const paper: Paper = { ...priorityFlow, title: "Lipoic acid copolymers on gold nanoparticles" };
    expect(scorePaper(paper, lipoicFeed).tier).toBe("dropped");
  });
});

describe("lower terms", () => {
  it("the base paper is Strong without the lower sentence", () => {
    expect(scorePaper(strongComonomer, lipoicFeed).tier).toBe("strong");
  });

  it.each(lipoicFeed.lower)("%s moves a Strong paper down to Possible", (term) => {
    const score = scorePaper(withSentence(strongComonomer, lowerSentences[term]), lipoicFeed);
    expect(score.lowerTerms).toEqual([term]);
    expect(score.tier).toBe("possible");
  });

  it("every lower term has a fixture sentence", () => {
    expect(Object.keys(lowerSentences).sort()).toEqual([...lipoicFeed.lower].sort());
  });

  it("moves Priority to Strong", () => {
    expect(scorePaper(withSentence(priorityFlow, lowerSentences["self-healing"]), lipoicFeed).tier).toBe("strong");
  });

  it("moves Possible to Dropped", () => {
    expect(scorePaper(withSentence(possible, lowerSentences.adhesive), lipoicFeed).tier).toBe("dropped");
  });

  it("moves down only one tier however many lower terms match", () => {
    const paper = withSentence(withSentence(strongComonomer, lowerSentences["self-healing"]), lowerSentences.adhesive);
    const score = scorePaper(paper, lipoicFeed);
    expect(score.lowerTerms).toEqual(["self-healing", "adhesive"]);
    expect(score.tier).toBe("possible");
  });

  it("a drop term wins over a lower term", () => {
    const paper = withSentence(withSentence(priorityFlow, lowerSentences.adhesive), dropSentences["clinical trial"]);
    expect(scorePaper(paper, lipoicFeed).tier).toBe("dropped");
  });
});

describe("normalising and matching", () => {
  it("lower-cases, strips accents and turns punctuation into single spaces", () => {
    expect(normaliseText("  Ring‑Opening–Polymerisation (RÖP)/Thio­ctic  ")).toBe("ring opening polymerisation rop thioctic");
    expect(normaliseText("Café")).toBe("cafe");
  });

  it("matches across hyphen styles", () => {
    expect(containsTerm("Self healing gels", "self-healing")).toBe(true);
    expect(containsTerm("self‑healing gels", "self-healing")).toBe(true);
    expect(containsTerm("Radical ring opening of dithiolanes", "radical ring-opening")).toBe(true);
  });

  it("matches both spellings from either spelling", () => {
    expect(containsTerm("Copolymerization of lipoic acid", "copolymerisation")).toBe(true);
    expect(containsTerm("Copolymerisation of lipoic acid", "copolymerization")).toBe(true);
    expect(containsTerm("Catalyze the reaction", "catalyse")).toBe(true);
    expect(containsTerm("Optimisation of flow", "optimization")).toBe(true);
  });

  it("allows a plural on the last word only", () => {
    expect(containsTerm("Gold nanoparticles", "gold nanoparticle")).toBe(true);
    expect(containsTerm("Copolymers", "copolymer")).toBe(true);
    expect(containsTerm("Golds nanoparticle", "gold nanoparticle")).toBe(false);
  });

  it("matches whole words only", () => {
    expect(containsTerm("DNA polymerase activity", "polymer")).toBe(false);
    expect(containsTerm("Polymer coatings", "polymer")).toBe(true);
    expect(containsTerm("Workflow design", "flow")).toBe(false);
    expect(containsTerm("Lipoated proteins", "lipoate")).toBe(false);
  });

  it("matches a phrase only when its words are adjacent", () => {
    expect(containsTerm("Lipoic and other acid species", "lipoic acid")).toBe(false);
  });

  it("does not let a phrase span the title and the abstract", () => {
    const feed: Feed = { name: "t", groups: [{ name: "g", role: "required", terms: ["lipoic acid"] }], drop: [], lower: [] };
    expect(scorePaper({ title: "A study of lipoic", abstract: "Acid in polymers." }, feed).tier).toBe("dropped");
  });

  it("ignores empty or punctuation-only terms", () => {
    expect(termVariants("  ")).toEqual([]);
    expect(termVariants("--")).toEqual([]);
    const feed: Feed = { name: "t", groups: [{ name: "g", role: "required", terms: [""] }], drop: [" "], lower: ["-"] };
    const score = scorePaper({ title: "Anything" }, feed);
    expect(score.dropTerms).toEqual([]);
    expect(score.lowerTerms).toEqual([]);
    expect(score.tier).toBe("dropped");
  });

  it("handles a missing or null abstract", () => {
    expect(scorePaper({ title: "Lipoic acid copolymers" }, lipoicFeed).tier).toBe("possible");
    expect(scorePaper({ title: "Lipoic acid copolymers", abstract: null }, lipoicFeed).tier).toBe("possible");
  });
});

describe("feeds without every role", () => {
  const polymers = { name: "polymers", role: "required", terms: ["polymer"] } as const;

  it("a feed with no required group scores every paper Possible, unless dropped", () => {
    const feed: Feed = { name: "t", groups: [], drop: ["clinical trial"], lower: [] };
    expect(scorePaper({ title: "Anything at all" }, feed).tier).toBe("possible");
    expect(scorePaper({ title: "A clinical trial" }, feed).tier).toBe("dropped");
  });

  it("a priority group alone, with the required group met, is Priority (no boost needed)", () => {
    const feed: Feed = { name: "t", groups: [polymers, { name: "p", role: "priority", terms: ["flow"] }], drop: [], lower: [] };
    expect(scorePaper({ title: "Polymer flow" }, feed).tier).toBe("priority");
  });

  it("priority outranks boost when both match", () => {
    const feed: Feed = {
      name: "t",
      groups: [polymers, { name: "b", role: "boost", terms: ["acrylate"] }, { name: "p", role: "priority", terms: ["flow"] }],
      drop: [],
      lower: [],
    };
    expect(scorePaper({ title: "Polymer acrylate flow" }, feed).tier).toBe("priority");
  });

  it("every required group is needed", () => {
    const feed: Feed = { name: "t", groups: [polymers, { name: "r2", role: "required", terms: ["lipoic acid"] }], drop: [], lower: [] };
    expect(scorePaper({ title: "Polymer" }, feed).tier).toBe("dropped");
    expect(scorePaper({ title: "Polymer lipoic acid" }, feed).tier).toBe("possible");
  });
});

describe("src/match is pure", () => {
  it("has no Obsidian imports", () => {
    const dir = new URL("../src/match/", import.meta.url);
    const files = readdirSync(dir).filter((f) => f.endsWith(".ts"));
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      expect(readFileSync(new URL(file, dir), "utf8"), file).not.toMatch(/from\s+["']obsidian["']|require\(["']obsidian["']\)|import\(["']obsidian["']\)/);
    }
  });
});
