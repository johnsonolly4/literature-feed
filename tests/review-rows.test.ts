// The review's papers table: rows in the result's order, chips, and the known-paper columns (invented papers with known answers).
import { describe, expect, it } from "vitest";
import type { Candidate } from "../src/openalex/client";
import { orderPapers, type ReviewPaper } from "../src/review/collect";
import type { Flags } from "../src/review/flags";
import { REVIEW_COLUMNS, buildReviewRows, fitText, reviewChips, reviewSearchText } from "../src/review/review-rows";
import { buildSeedProfile, seedScore } from "../src/review/seeds";
import { viewRows, chipCounts, rowsToCsv, type TableModel } from "../src/ui/table-model";

const cand = (n: number, refs: string[], authors: string[]): Candidate => ({
  title: `Seed ${n}`, abstract: null, doi: `https://doi.org/10.1/s${n}`, year: 2020, openalexId: `https://openalex.org/W${n}`, authors, venue: null, publicationDate: null, referencedWorks: refs,
});
const seeds = [cand(1, ["R1", "R2", "R3"], ["Ann Lee", "Bob Roe"]), cand(2, ["R2", "R3", "R4"], ["Ann Lee", "Cy Poe"]), cand(3, ["R3", "R9"], ["Bob Roe", "Dee Fox"])];
const profile = buildSeedProfile(["10.1/s1", "10.1/s2", "10.1/s3"], seeds);

const paper = (id: string, refs: string[], authors: string[], over: Partial<ReviewPaper> = {}): ReviewPaper => {
  const p: ReviewPaper = {
    id, title: `Paper ${id}`, authors, venue: null, year: 2021, publicationDate: null, doi: null, abstract: null, isPreprint: false, citedByCount: 5, referencedWorks: refs,
    tier: "strong", finds: [{ feedId: "a", tier: "strong", matched: [], topics: [1] }], ...over,
  };
  return { ...p, seed: seedScore(p, profile) };
};

// Overlap with the seeds: W1 is a seed; "near" shares R2, R3 and Ann Lee (2 + 3 = 5); "far" shares R9 (1); "none" shares nothing.
const papers = orderPapers([
  paper("far", ["R9"], ["Zed Q"]),
  paper("W1", ["R1", "R2", "R3"], ["Ann Lee", "Bob Roe"]),
  paper("near", ["R2", "R3", "RX"], ["Ann Lee"], { finds: [{ feedId: "a", tier: "strong", matched: [], topics: [1] }, { feedId: "b", tier: "strong", matched: [], topics: [1] }] }),
  paper("none", ["RZ"], ["Zed Q"], { tier: "priority" }),
], "seeds");
const names = new Map([["a", "Alpha"], ["b", "Beta"]]);
const flags: Flags[] = papers.map((p) => ({ zotero: p.id === "near" ? "ZK1" : null, vault: null, listedBefore: [] }));
const rows = buildReviewRows(papers, flags, names, profile);
const model = (hasSeeds = true): TableModel<(typeof rows)[number]> => ({ columns: REVIEW_COLUMNS, chips: reviewChips([{ id: "a", name: "Alpha" }, { id: "b", name: "Beta" }], hasSeeds), searchText: reviewSearchText });
const ids = (v: ReturnType<typeof viewRows<(typeof rows)[number]>>): string[] => v.map((r) => r.key);

describe("review rows", () => {
  it("keep the order of the result and label papers like the prompt", () => {
    // Rank first (none is priority), then overlap with the known papers: W1 (8, judged by the other seeds), near (5), far (1).
    expect(ids(rows)).toEqual(["none", "W1", "near", "far"]);
    expect(rows.map((r) => r.label)).toEqual(["P1", "P2", "P3", "P4"]);
  });

  it("carry the overlap, and the default sort reproduces the result's order", () => {
    expect(rows.map((r) => r.seed?.score)).toEqual([0, 8, 5, 1]);
    const view = viewRows(rows, model(), { chip: "all", query: "", sort: { by: "order", desc: false } });
    expect(ids(view)).toEqual(["none", "W1", "near", "far"]);
    expect(ids(viewRows(rows, model(), { chip: "all", query: "", sort: { by: "order", desc: true } }))).toEqual(["far", "near", "W1", "none"]);
  });

  it("find the known paper and say which papers fit", () => {
    const m = model();
    expect(ids(viewRows(rows, m, { chip: "known", query: "", sort: { by: "order", desc: false } }))).toEqual(["W1"]);
    expect(rows.find((r) => r.key === "W1")?.fit).toBeNull();
    expect(fitText(rows.find((r) => r.key === "W1")!)).toBe("Known");
    expect(rows.find((r) => r.key === "near")?.fit?.fits).toBe(true);
    expect(rows.find((r) => r.key === "none")?.fit?.fits).toBe(false);
    expect(ids(viewRows(rows, m, { chip: "fits", query: "", sort: { by: "order", desc: false } }))).toEqual(["near"]);
  });

  it("filter by rank, search and what you have, with counts that match the clicks", () => {
    const m = model();
    const counts = chipCounts(rows, m, "");
    expect(counts.get("all")).toBe(4);
    expect(counts.get("tier:priority")).toBe(1);
    expect(counts.get("tier:strong")).toBe(3);
    expect(counts.get("search:a")).toBe(4);
    expect(counts.get("search:b")).toBe(1);
    expect(counts.get("have")).toBe(1);
    expect(counts.get("missing")).toBe(3);
    expect(rows.find((r) => r.key === "near")?.searches).toEqual(["Alpha", "Beta"]);
  });

  it("sort by overlap, search by title or P-label, and write a CSV", () => {
    const byOverlap = viewRows(rows, model(), { chip: "all", query: "", sort: { by: "overlap", desc: true } });
    expect(ids(byOverlap)).toEqual(["W1", "near", "far", "none"]);
    expect(ids(viewRows(rows, model(), { chip: "all", query: "paper far", sort: { by: "order", desc: false } }))).toEqual(["far"]);
    const csv = rowsToCsv(rows, REVIEW_COLUMNS).split("\n");
    expect(csv[0]).toBe("No.,Paper,Year,Cited,Rank,Overlap,Fit,Have,Searches");
    expect(csv).toHaveLength(5);
  });

  it("show no fit or known marks when there are no known papers", () => {
    const plain = buildReviewRows(papers.map((p) => ({ ...p, seed: undefined })), flags, names, null);
    expect(plain.every((r) => r.fit === null && r.seed === null)).toBe(true);
  });
});
