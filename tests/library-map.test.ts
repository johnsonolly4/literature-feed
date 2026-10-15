// The library map on an invented library: two clear groups, one outlier, papers without a DOI, names from shared phrases, and the edits.
import { describe, expect, it } from "vitest";
import { assignGroup, libraryPapers, mapLibrary, mergeGroups, movePaper, renameGroup, splitGroup } from "../src/improve/library-map";
import type { Candidate } from "../src/openalex/client";
import { readCostUsd } from "../src/review/known";
import type { ZoteroIndex } from "../src/zotero/library-index";

const cand = (n: number, title: string, abstract: string, refs: string[], authors: string[]): Candidate => ({
  title, abstract, doi: `https://doi.org/10.1/c${n}`, year: 2020, openalexId: `https://openalex.org/W${n}`, authors, venue: null, publicationDate: null, referencedWorks: refs,
});
const A = ["A1", "A2", "A3", "A4"];
const B = ["B1", "B2", "B3", "B4"];
const found = [
  cand(1, "Bayesian optimisation of flow chemistry", "Bayesian optimisation drives a self-driving flow reactor.", [...A, "X1"], ["Ann Lee"]),
  cand(2, "Bayesian optimisation of self-driving labs", "Bayesian optimisation in self-driving flow labs.", [...A, "X2"], ["Ann Lee"]),
  cand(3, "Closed-loop Bayesian optimisation", "Closed-loop Bayesian optimisation of a flow reactor.", [...A, "X3"], ["Ann Lee"]),
  cand(4, "Bayesian optimisation of reactor conditions", "Bayesian optimisation of reactor conditions in flow.", [...A, "X4"], ["Ann Lee"]),
  cand(5, "Hydrolytic degradation of polyester", "Hydrolytic degradation of polyester films in water.", [...B, "Y1"], ["Bo Chen"]),
  cand(6, "Hydrolytic degradation of polyester blends", "Hydrolytic degradation of polyester blends in water.", [...B, "Y2"], ["Bo Chen"]),
  cand(7, "Hydrolytic degradation kinetics of polyester", "Kinetics of hydrolytic degradation of polyester in water.", [...B, "Y3"], ["Bo Chen"]),
  cand(8, "Hydrolytic degradation of polyester fibres", "Hydrolytic degradation of polyester fibres in water.", [...B, "Y4"], ["Bo Chen"]),
  cand(9, "A survey of museum lighting", "Lighting of museum galleries.", ["Z1", "Z2"], ["Cy Dunn"]),
];
const papers = found.map((c, i) => ({ key: `K${i + 1}`, doi: `10.1/c${i + 1}`, title: c.title }));

const index = (items: ZoteroIndex["items"]): ZoteroIndex => ({ version: 2, libraryVersion: 1, collections: [], items });

describe("libraryPapers", () => {
  it("lists papers with a DOI, counts those without one, and leaves out notes and repeated DOIs", () => {
    const got = libraryPapers(index({
      a: { doi: "10.1/x", title: "One", collections: [] },
      b: { doi: "10.1/x", title: "One again", collections: [] },
      c: { doi: "", title: "No DOI", collections: [] },
      d: { doi: "", title: "A note", collections: [], note: true },
    }));
    expect(got.withDoi.map((p) => p.key)).toEqual(["a"]);
    expect(got.withoutDoi.map((p) => p.key)).toEqual(["c"]);
  });
});

describe("mapLibrary", () => {
  const map = mapLibrary(papers, found);

  it("finds the two groups and the outlier", () => {
    expect(map.status).toBe("ok");
    expect(map.groups.map((g) => [...g.keys].sort())).toEqual([["K1", "K2", "K3", "K4"], ["K5", "K6", "K7", "K8"]]);
    expect(map.outliers).toEqual(["K9"]);
  });

  it("names each group from the phrases it shares that the rest of the library does not", () => {
    const names = map.groups.map((g) => g.phrases.join(" | "));
    expect(names[0]).toContain("bayesian optimisation");
    expect(names[1]).toContain("hydrolytic degradation");
    expect(map.groups[0].name).toBe(map.groups[0].phrases[0]);
    expect(map.groups.every((g) => g.feedId === null)).toBe(true);
  });

  it("lists papers OpenAlex did not have, and says when there are too few to group", () => {
    const m = mapLibrary([...papers, { key: "K10", doi: "10.1/zzz", title: "Unknown" }], found);
    expect(m.notFound).toEqual(["K10"]);
    expect(mapLibrary(papers.slice(0, 2), found.slice(0, 2)).status).toBe("too-few");
  });

  it("prices the read like the known papers", () => {
    expect(readCostUsd(300)).toBeCloseTo(0.0006);
  });
});

describe("edits", () => {
  const map = mapLibrary(papers, found);
  const [g1, g2] = map.groups;

  it("renames (ignoring an empty name) and assigns a search", () => {
    expect(renameGroup(map, g1.id, "  Self-driving labs ").groups[0].name).toBe("Self-driving labs");
    expect(renameGroup(map, g1.id, "  ").groups[0].name).toBe(g1.name);
    expect(assignGroup(map, g2.id, "sdl").groups[1].feedId).toBe("sdl");
    expect(assignGroup(assignGroup(map, g2.id, "sdl"), g2.id, null).groups[1].feedId).toBeNull();
  });

  it("merges groups into the first one", () => {
    const m = mergeGroups(map, [g1.id, g2.id]);
    expect(m.groups).toHaveLength(1);
    expect(m.groups[0].name).toBe(g1.name);
    expect([...m.groups[0].keys].sort()).toEqual(["K1", "K2", "K3", "K4", "K5", "K6", "K7", "K8"]);
    expect(mergeGroups(map, [g1.id])).toBe(map);
  });

  it("moves a paper to a group or to the outliers, and drops a group that is left empty", () => {
    const m = movePaper(map, "K9", g1.id);
    expect(m.outliers).toEqual([]);
    expect(m.groups[0].keys).toContain("K9");
    const out = movePaper(map, "K1", null);
    expect(out.outliers).toEqual(["K9", "K1"]);
    expect(out.groups[0].keys).toHaveLength(3);
    expect(movePaper(map, "K1", "nope")).toBe(map);
    let single = map;
    for (const k of g2.keys) single = movePaper(single, k, g1.id);
    expect(single.groups.map((g) => g.id)).toEqual([g1.id]);
  });

  it("splits chosen papers into a new group, but not all of them or none", () => {
    const m = splitGroup(map, g1.id, ["K1", "K2"], "Split off");
    expect(m.groups).toHaveLength(3);
    expect(m.groups[0].keys.sort()).toEqual(["K3", "K4"]);
    expect(m.groups[2]).toMatchObject({ name: "Split off", keys: ["K1", "K2"], feedId: null });
    expect(m.groups[2].id).not.toBe(g1.id);
    expect(splitGroup(map, g1.id, g1.keys, "x")).toBe(map);
    expect(splitGroup(map, g1.id, [], "x")).toBe(map);
    expect(splitGroup(map, g1.id, ["K5"], "x")).toBe(map);
  });
});
