import { describe, expect, it } from "vitest";
import { dedupe, normaliseDoi } from "../src/match/dedupe";
import type { Paper } from "../src/match/feed";

const paper = (title: string, doi?: string | null, isPreprint = false): Paper & { id: string } => ({
  id: `${title}|${doi ?? ""}|${isPreprint}`,
  title,
  doi,
  isPreprint,
});

describe("normaliseDoi", () => {
  it("strips prefixes, case and trailing punctuation", () => {
    expect(normaliseDoi("https://doi.org/10.1000/ABC.1")).toBe("10.1000/abc.1");
    expect(normaliseDoi("http://dx.doi.org/10.1000/abc.1")).toBe("10.1000/abc.1");
    expect(normaliseDoi("doi: 10.1000/abc.1.")).toBe("10.1000/abc.1");
    expect(normaliseDoi("  10.1000/abc.1 ")).toBe("10.1000/abc.1");
  });

  it("returns an empty string when there is no DOI", () => {
    expect(normaliseDoi(undefined)).toBe("");
    expect(normaliseDoi(null)).toBe("");
    expect(normaliseDoi("")).toBe("");
  });
});

describe("dedupe", () => {
  it("merges the same DOI written in different forms; first seen wins", () => {
    const a = paper("Lipoic acid copolymers", "https://doi.org/10.1000/ABC");
    const b = paper("A different title", "10.1000/abc");
    expect(dedupe([a, b])).toEqual([a]);
  });

  it("merges the same title when there is no DOI, ignoring case, punctuation and accents", () => {
    const a = paper("Lipoic acid–acrylamide copolymers");
    const b = paper("LIPOIC ACID ACRYLAMIDE COPOLYMERS.");
    expect(dedupe([a, b])).toEqual([a]);
  });

  it("merges a preprint and its journal version (different DOIs, same title); the journal version is kept", () => {
    const preprint = paper("Flow synthesis of lipoic acid copolymers", "10.26434/chemrxiv-1", true);
    const journal = paper("Flow synthesis of lipoic acid copolymers", "10.1021/jacs.1");
    expect(dedupe([preprint, journal])).toEqual([journal]);
    expect(dedupe([journal, preprint])).toEqual([journal]);
  });

  it("keeps the first seen when both are preprints or both are journal versions", () => {
    const a = paper("Same title", "10.1/a", true);
    const b = paper("Same title", "10.1/b", true);
    expect(dedupe([a, b])).toEqual([a]);
  });

  it("links a chain: A and B share a DOI, B and C share a title", () => {
    const a = paper("Title one", "10.1/x", true);
    const b = paper("Title two", "10.1/x");
    const c = paper("Title two", "10.1/y", true);
    expect(dedupe([a, b, c])).toEqual([b]);
  });

  it("never merges empty titles or missing DOIs", () => {
    const a = paper("", null);
    const b = paper("   ", undefined);
    const c = paper("Real title", null);
    expect(dedupe([a, b, c])).toEqual([a, b, c]);
  });

  it("keeps different papers in first-seen order", () => {
    const a = paper("One", "10.1/1");
    const b = paper("Two", "10.1/2");
    const c = paper("Three", "10.1/3");
    const dupOfA = paper("One again", "10.1/1");
    expect(dedupe([a, b, dupOfA, c])).toEqual([a, b, c]);
  });

  it("returns an empty list for no input and does not change its input", () => {
    expect(dedupe([])).toEqual([]);
    const items = [paper("A", "10.1/1"), paper("A", "10.1/2")];
    const copy = [...items];
    dedupe(items);
    expect(items).toEqual(copy);
  });
});
