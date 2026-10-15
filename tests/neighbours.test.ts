// Signals 2a and 2b and the citer scan, on invented works.
import { describe, expect, it } from "vitest";
import { OpenAlexClient, buildCitersUrl, type Citer } from "../src/openalex/client";
import { Budget } from "../src/review/budget";
import { fetchCiters, estimateCiterScan, splitHeavy, type CiterClient } from "../src/review/network-fetch";
import { bothRoutes, gapPoints, neighbourCounts, neighbourMinimum, neighbourhood, similarPapers, type FocalRef } from "../src/review/neighbours";

const focal: FocalRef[] = ["R1", "R2", "R3", "R4", "R5", "R6"].map((id, i) => ({ id, citedBy: 10 * (i + 1) }));
const cite = (id: string, refs: string[], extra: string[] = [], year = 2020): Citer => ({ id, year, referencedWorks: [...refs, ...extra] });
const all = focal.map((f) => f.id);
// Sharing 5, 5, 6, 2 and 0 of the six references.
const citers: Citer[] = [
  cite("W1", all.slice(0, 5), ["X1"]), cite("W2", all.slice(1), ["X1", "X2"]), cite("W3", all, ["X1"]),
  cite("W4", all.slice(0, 2), ["X1"]), cite("W5", [], ["X1"]),
];

describe("similarPapers", () => {
  it("keeps the citing works sharing at least five references, most similar first", () => {
    const s = similarPapers(citers, focal);
    expect(s.map((x) => x.id)).toEqual(["W3", "W1", "W2"]);
    expect(s.map((x) => x.shared.length)).toEqual([6, 5, 5]);
    // W1 shares the rarer references and W2 the more-cited ones, so W1 comes first although both share five.
  });

  it("weights the less-cited references more and gives the Jaccard share", () => {
    const s = similarPapers(citers, focal);
    expect(s[0].weighted).toBeCloseTo(focal.reduce((t, f) => t + 1 / Math.log(2 + f.citedBy), 0));
    expect(s[0].jaccard).toBeCloseTo(6 / 7);
    expect(s.map((x) => x.id).indexOf("W1")).toBeLessThan(s.map((x) => x.id).indexOf("W2"));
  });

  it("leaves out the paper, its own references, repeats and works from after its year", () => {
    const more = [...citers, cite("W3", all), cite("P", all), cite("R1", all), cite("W9", all, [], 2030)];
    expect(similarPapers(more, focal, { paperId: "P", maxYear: 2022 }).map((x) => x.id)).toEqual(["W3", "W1", "W2"]);
  });
});

describe("signal 2b", () => {
  it("counts what the neighbours cite, once each, and needs a tenth of them (at least 3)", () => {
    expect(neighbourMinimum(30)).toBe(3);
    expect(neighbourMinimum(10)).toBe(3);
    expect(neighbourMinimum(50)).toBe(5);
    const s = similarPapers(citers, focal);
    const rows = neighbourCounts(s, new Set(all));
    expect(rows).toEqual([{ id: "X1", count: 3, share: 1 }]);
  });

  it("keeps a neighbour as a candidate when three other neighbours cite it, but never counts a neighbour citing itself", () => {
    const cs: Citer[] = ["W1", "W2", "W3", "W4"].map((id, i) => cite(id, all.slice(0, 5), i === 0 ? ["W2", "W1"] : ["W1"]));
    const rows = neighbourCounts(similarPapers(cs, focal), new Set(all));
    expect(rows).toEqual([{ id: "W1", count: 3, share: 0.75 }]);
  });

  it("finds works on both routes and gives the gap in points", () => {
    const n = neighbourhood(citers, focal);
    expect([...bothRoutes([{ id: "X1" }, { id: "X9" }], n.rows)]).toEqual(["X1"]);
    expect(gapPoints(1, 0.5)).toBe(50);
  });

  it("warns when fewer than ten similar papers are found, and says what it needed", () => {
    const n = neighbourhood(citers, focal);
    expect(n.warning).toMatch(/Only 3 similar papers/);
    expect(n.minimum).toBe(3);
    expect(n.minShared).toBe(5);
  });
});

describe("the citer scan", () => {
  const refs = [{ id: "W1", citedBy: 3000, title: "Big" }, { id: "W2", citedBy: 250 }, { id: "W3", citedBy: 5 }];

  it("skips the heavy references and prices the rest before any request", () => {
    const { scan, heavy } = splitHeavy(refs);
    expect(heavy.map((r) => r.id)).toEqual(["W1"]);
    expect(estimateCiterScan(scan)).toMatchObject({ requests: 4, works: 255 });
    expect(estimateCiterScan(scan).costUsd).toBeCloseTo(0.0004);
  });

  it("builds a slim cursor address", () => {
    const url = new URL(buildCitersUrl(["W2", "W3", "nope"], "abc="));
    expect(url.searchParams.get("filter")).toBe("cites:W2|W3");
    expect(url.searchParams.get("cursor")).toBe("abc=");
    expect(url.searchParams.get("select")).toBe("id,publication_year,referenced_works");
  });

  function fake(pages: Citer[][]): { client: CiterClient; asked: string[][] } {
    const asked: string[][] = [];
    let n = 0;
    return { asked, client: { async citersPage(ids) { asked.push([...ids]); const citers = pages[n] ?? []; n++; return { citers, nextCursor: n < pages.length ? `c${n}` : null, count: 0, costUsd: 0 }; } } };
  }

  it("reads the rarest reference first and follows the cursor to the end", async () => {
    const f = fake([[cite("A", [])], [cite("B", [])]]);
    const res = await fetchCiters(splitHeavy(refs).scan, { client: f.client, budget: new Budget(1) });
    expect(f.asked).toEqual([["W3", "W2"], ["W3", "W2"]]);
    expect(res).toMatchObject({ requests: 2, unscanned: [], stopped: null });
    expect(res.citers.map((c) => c.id)).toEqual(["A", "B"]);
  });

  it("stops when the budget cannot pay and says which references were not read", async () => {
    const f = fake([[cite("A", [])]]);
    const res = await fetchCiters(refs, { client: f.client, budget: new Budget(0.00005) });
    expect(f.asked).toEqual([]);
    expect(res.stopped).toMatch(/stopped at/);
    expect(res.unscanned).toEqual(["W3", "W2", "W1"]);
  });

  it("stops at the work limit", async () => {
    const f = fake([[cite("A", []), cite("B", [])], [cite("C", [])]]);
    const res = await fetchCiters(refs, { client: f.client, budget: new Budget(1) }, 2);
    expect(res.stopped).toMatch(/limit/);
    expect(res.citers).toHaveLength(2);
    expect(res.unscanned.length).toBeGreaterThan(0);
  });
});

describe("citersPage", () => {
  it("maps the slim records and the next cursor", async () => {
    const json = { meta: { count: 2, cost_usd: 0.0001, next_cursor: "n1" }, results: [
      { id: "https://openalex.org/W7", publication_year: 2021, referenced_works: ["https://openalex.org/W2", "junk"] },
      { id: "https://openalex.org/W8", publication_year: null, referenced_works: null },
    ] };
    const client = new OpenAlexClient({ request: async () => ({ status: 200, json }), sleep: async () => undefined });
    const res = await client.citersPage(["W2"], "*");
    expect(res.citers).toEqual([{ id: "W7", year: 2021, referencedWorks: ["W2"] }, { id: "W8", year: null, referencedWorks: [] }]);
    expect(res).toMatchObject({ nextCursor: "n1", count: 2, costUsd: 0.0001 });
    const last = await new OpenAlexClient({ request: async () => ({ status: 200, json: { meta: { next_cursor: null }, results: [] } }), sleep: async () => undefined }).citersPage(["W2"]);
    expect(last.nextCursor).toBeNull();
  });
});
