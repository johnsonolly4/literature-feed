// Finding DOIs for pasted references: the Crossref client (pauses, back-off, bad answers), the resolver (statuses, DOIs in the text,
// software, errors, the limit, stopping) and the text it produces. A fake stands in for Crossref.
import { describe, expect, it } from "vitest";
import { CrossrefClient, CrossrefError, buildBibliographicUrl, type CrossrefRequest } from "../src/refs/crossref";
import { listWithDois, toCsv, toMarkdownTable } from "../src/refs/export";
import type { CrossrefItem } from "../src/refs/match";
import { MAX_REFERENCES, countStatuses, includedByDefault, resolveReferences, type ReferenceSearcher } from "../src/refs/resolve";
import { splitReferences } from "../src/refs/split";

function work(doi: string, title: string, family: string, year: number, volume: string, page: string): CrossrefItem {
  return { DOI: doi, title: [title], author: [{ given: "A.", family }, { given: "B.", family: "Other" }], volume, page, issued: { "date-parts": [[year]] }, "container-title": ["J. Test"], publisher: "Pub", "is-referenced-by-count": 7 };
}

const TEXT = [
  "1. Veldmar, K. R. Controlled radical polymerization of lipoic acid and vinyl monomers. J. Test 2023, 145, 100-110.",
  "2. Smith, J. A study of dithiolane ring-opening polymerization for recyclable networks. J. Test 2022, 12, 5-9.",
  "3. Nobody, N. A reference that Crossref knows nothing about at all. J. Test 2021, 1, 1-2.",
  "4. Doe, J. A tool for things. GitHub repository, https://github.com/doe/tool, 2022.",
  "5. Known, K. A paper with its DOI in the text. J. Test 2020, 3, 4-5. https://doi.org/10.1000/KNOWN.1",
].join("\n");

function fakeSearch(): { searcher: ReferenceSearcher; calls: string[] } {
  const calls: string[] = [];
  const searcher: ReferenceSearcher = {
    search: (text) => {
      calls.push(text);
      if (text.startsWith("Veldmar")) return Promise.resolve([work("10.1000/ALB.1", "Controlled radical polymerization of lipoic acid and vinyl monomers", "Veldmar", 2023, "145", "100-110")]);
      if (text.startsWith("Smith")) return Promise.resolve([work("10.1000/smith.2", "A study of dithiolane ring-opening polymerization for recyclable networks", "Smith", 2022, "13", "5-9")]);
      return Promise.resolve([work("10.1000/wrong", "Hydrogels for wound healing in diabetic mice", "Else", 2015, "1", "1")]);
    },
  };
  return { searcher, calls };
}

describe("resolveReferences", () => {
  it("judges each reference: OK, CHECK with its reasons, NOT FOUND, MANUAL, and a DOI in the text", async () => {
    const { searcher, calls } = fakeSearch();
    const { rows, skipped, cancelled } = await resolveReferences(splitReferences(TEXT), searcher);
    expect(rows.map((r) => r.status)).toEqual(["OK", "CHECK", "NOT FOUND", "MANUAL", "OK"]);
    expect(rows[0]).toMatchObject({ doi: "10.1000/alb.1", authors: "Veldmar A; Other B", journal: "J. Test", year: "2023", citedBy: 7, fromText: false });
    expect(rows[1].reasons).toEqual(["volume differs (12 vs 13)"]);
    expect(rows[1].doi).toBe("10.1000/smith.2");
    expect(rows[2]).toMatchObject({ doi: "", crossrefTitle: "Hydrogels for wound healing in diabetic mice" });
    expect(rows[3].doi).toBe("");
    expect(rows[4]).toMatchObject({ doi: "10.1000/known.1", fromText: true, reasons: ["DOI in the text"] });
    expect(calls).toHaveLength(3); // the software reference and the one with a DOI were not looked up
    expect(skipped).toBe(0);
    expect(cancelled).toBe(false);
    expect(rows.map(includedByDefault)).toEqual([true, true, false, false, true]);
    expect(countStatuses(rows)).toEqual({ OK: 2, CHECK: 1, "NOT FOUND": 1, MANUAL: 1, ERROR: 0 });
  });

  it("marks a failed lookup ERROR and goes on", async () => {
    let n = 0;
    const searcher: ReferenceSearcher = { search: () => (n++ === 0 ? Promise.reject(new CrossrefError("Crossref asked for fewer requests (HTTP 429) after 3 tries", 429)) : Promise.resolve([])) };
    const { rows } = await resolveReferences(splitReferences(TEXT.split("\n").slice(0, 3).join("\n")), searcher);
    expect(rows[0]).toMatchObject({ status: "ERROR", doi: "" });
    expect(rows[0].reasons[0]).toContain("429");
    expect(rows[1].status).toBe("NOT FOUND");
    expect(rows[1].reasons).toEqual(["no Crossref results"]);
  });

  it("stops at the limit and says how many were left out", async () => {
    const many = Array.from({ length: 5 }, (_, i) => `${i + 1}. Author, A. Reference title number ${i} about lipoic acid chemistry. J. Test 2020, 1, 1-2.`).join("\n");
    const { searcher } = fakeSearch();
    const r = await resolveReferences(splitReferences(many), searcher, { max: 3 });
    expect(r.rows).toHaveLength(3);
    expect(r.skipped).toBe(2);
    expect(MAX_REFERENCES).toBe(200);
  });

  it("can be stopped, keeps what it has, and reports progress", async () => {
    const { searcher } = fakeSearch();
    const progress: string[] = [];
    let done = 0;
    const r = await resolveReferences(splitReferences(TEXT), searcher, { onProgress: (d, t) => { done = d; progress.push(`${d}/${t}`); }, isCancelled: () => done >= 2 });
    expect(r.rows).toHaveLength(2);
    expect(r.cancelled).toBe(true);
    expect(progress).toEqual(["1/5", "2/5"]);
  });
});

describe("CrossrefClient", () => {
  const okBody = { message: { items: [{ DOI: "10.1/a", title: ["T"] }, { nodoi: true }, null] } };

  function client(responses: { status: number; json: unknown }[], mailto?: string): { c: CrossrefClient; urls: string[]; sleeps: number[] } {
    const urls: string[] = [];
    const sleeps: number[] = [];
    let i = 0;
    const c = new CrossrefClient({
      request: (req: CrossrefRequest) => { urls.push(req.url); return Promise.resolve(responses[Math.min(i++, responses.length - 1)]); },
      sleep: (ms) => { sleeps.push(ms); return Promise.resolve(); },
      mailto,
    });
    return { c, urls, sleeps };
  }

  it("builds a bibliographic search with the fields it needs, and no key or email unless given", () => {
    const url = new URL(buildBibliographicUrl("Smith, J.  A title\n here. 2020"));
    expect(url.hostname).toBe("api.crossref.org");
    expect(url.searchParams.get("query.bibliographic")).toBe("Smith, J. A title here. 2020");
    expect(url.searchParams.get("rows")).toBe("5");
    expect(url.searchParams.get("select")).toContain("is-referenced-by-count");
    expect(url.searchParams.has("mailto")).toBe(false);
  });

  it("returns only items with a DOI, waits between requests, and adds the contact email when given", async () => {
    const { c, urls, sleeps } = client([{ status: 200, json: okBody }], " me@example.org ");
    expect((await c.search("one")).map((i) => i.DOI)).toEqual(["10.1/a"]);
    expect(sleeps).toEqual([]);
    await c.search("two");
    expect(sleeps).toEqual([250]);
    expect(new URL(urls[0]).searchParams.get("mailto")).toBe("me@example.org");
  });

  it("backs off on 429 and on a server error, then succeeds", async () => {
    const { c, sleeps } = client([{ status: 429, json: null }, { status: 503, json: null }, { status: 200, json: okBody }]);
    expect(await c.search("x")).toHaveLength(1);
    expect(sleeps).toEqual([1000, 2000]);
  });

  it("gives up after the tries and says why, never including the address", async () => {
    const { c } = client([{ status: 429, json: null }]);
    await expect(c.search("x")).rejects.toThrow("HTTP 429");
    const { c: c2 } = client([{ status: 404, json: null }]);
    await expect(c2.search("x")).rejects.toThrow("HTTP 404");
    const { c: c3 } = client([{ status: 200, json: { nothing: true } }]);
    await expect(c3.search("x")).rejects.toThrow("not a list");
    const { c: c4 } = client([{ status: 200, json: null }]);
    await expect(c4.search("x")).rejects.toBeInstanceOf(CrossrefError);
  });
});

describe("the results as text", () => {
  it("lists the references with their DOIs and tags the ones that need a look", async () => {
    const { searcher } = fakeSearch();
    const { rows } = await resolveReferences(splitReferences(TEXT), searcher);
    const lines = listWithDois(rows).split("\n");
    expect(lines).toHaveLength(5);
    expect(lines[0].endsWith("https://doi.org/10.1000/alb.1")).toBe(true);
    expect(lines[1].startsWith("[CHECK] ")).toBe(true);
    expect(lines[2].startsWith("[NO DOI FOUND] ")).toBe(true);
    expect(lines[3].startsWith("[MANUAL] ")).toBe(true);
    expect(lines[2]).not.toContain("doi.org");
  });

  it("writes a CSV that quotes commas and quotes, and a Markdown table with DOI links", async () => {
    const { searcher } = fakeSearch();
    const { rows } = await resolveReferences(splitReferences(TEXT), searcher);
    const csv = toCsv(rows).split("\n");
    expect(csv[0]).toBe("n,reference,doi,status,reasons,crossref_title,crossref_authors,crossref_journal,crossref_year,crossref_volume,crossref_pages,crossref_publisher,crossref_cited_by");
    expect(csv[1].startsWith("1,\"Veldmar, K. R.")).toBe(true);
    expect(csv[1]).toContain(",10.1000/alb.1,OK,");
    expect(toCsv([])).toBe(csv[0]);
    const md = toMarkdownTable(rows).split("\n");
    expect(md[0]).toBe("| # | Reference | Authors | DOI | Status | Notes |");
    expect(md[2]).toContain("[10.1000/alb.1](https://doi.org/10.1000/alb.1)");
    expect(md[3]).toContain("volume differs");
  });
});
