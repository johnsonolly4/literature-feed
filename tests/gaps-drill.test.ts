// The authors drill-down: short author lists, who wrote what, whether an uncited work could have been cited, the address that asks
// for an author's other work on the same ground, and the lookup itself against a fake OpenAlex.
import { describe, expect, it } from "vitest";
import { buildAuthorWorksUrl, toCandidate, type Candidate, type OpenAlexWork } from "../src/openalex/client";
import { authorsLineShort, authorsShort } from "../src/review/authors-text";
import { Budget } from "../src/review/budget";
import { emptyCache } from "../src/review/cache";
import { findAuthorWork, toWorkRef, type GapsClient } from "../src/review/gaps-fetch";
import { authorIdFor, couldHaveBeenCited, worksBy, type WorkRef } from "../src/review/gaps-authors";
import { googleUrl, scholarUrl, searchQuery } from "../src/review/search-links";

describe("authorsShort", () => {
  it("shows the first three names and then et al.", () => {
    expect(authorsShort([])).toBe("");
    expect(authorsShort(["A One"])).toBe("A One");
    expect(authorsShort(["A One", "B Two", "C Three"])).toBe("A One, B Two, C Three");
    expect(authorsShort(["A One", "B Two", "C Three", "D Four"])).toBe("A One, B Two, C Three et al.");
    expect(authorsShort(["A One", "", " B Two "], 5)).toBe("A One, B Two");
  });

  it("shortens a line joined by semicolons", () => {
    expect(authorsLineShort("A One; B Two; C Three; D Four")).toBe("A One, B Two, C Three et al.");
    expect(authorsLineShort("A One; B Two; et al.")).toBe("A One, B Two et al.");
    expect(authorsLineShort("")).toBe("");
  });
});

describe("web search links", () => {
  it("prefers the title, falls back to the text, cuts long text, and escapes", () => {
    expect(searchQuery("A <i>title</i>  here", "ignored")).toBe("A title here");
    expect(searchQuery("", "Some reference text")).toBe("Some reference text");
    expect(searchQuery("", "word ".repeat(80)).length).toBeLessThanOrEqual(200);
    expect(googleUrl("a b&c")).toBe("https://www.google.com/search?q=a%20b%26c");
    expect(scholarUrl("x")).toBe("https://scholar.google.com/scholar?q=x");
  });
});

const work = (id: string, authors: string[], authorIds: string[], year: number | null = 2020): WorkRef => ({ id, title: `Work ${id}`, year, doi: null, authors, authorIds, citedBy: 1 });

describe("who wrote what", () => {
  const works = [work("W1", ["Ann Ash", "Bo Birch"], ["A1", "A2"]), work("W2", ["A. Ash"], ["A1"]), work("W3", ["Cy Cedar"], [""])];

  it("finds the works of an author by family name and first initial", () => {
    expect(worksBy("ash|a", works).map((w) => w.id)).toEqual(["W1", "W2"]);
    expect(worksBy("cedar|c", works).map((w) => w.id)).toEqual(["W3"]);
    expect(worksBy("nobody|x", works)).toEqual([]);
  });

  it("gives the OpenAlex id most often given to the author, or null", () => {
    expect(authorIdFor("ash|a", works)).toBe("A1");
    expect(authorIdFor("cedar|c", works)).toBeNull();
    expect(authorIdFor("ash|a", [work("W9", ["Ann Ash"], ["A7"]), work("W8", ["Ann Ash"], ["A7"]), work("W7", ["Ann Ash"], ["A6"])])).toBe("A7");
  });

  it("says whether an uncited work was out before the paper", () => {
    expect(couldHaveBeenCited(2019, 2023)).toBe("before");
    expect(couldHaveBeenCited(2023, 2023)).toBe("before");
    expect(couldHaveBeenCited(2025, 2023)).toBe("after");
    expect(couldHaveBeenCited(null, 2023)).toBe("unknown");
    expect(couldHaveBeenCited(2020, null)).toBe("unknown");
  });
});

describe("author ids and the address for an author's other work", () => {
  it("keeps the OpenAlex author ids next to the names", () => {
    const w: OpenAlexWork = { id: "https://openalex.org/W5", title: "T", authorships: [{ author: { id: "https://openalex.org/A111", display_name: "Ann Ash" } }, { author: { display_name: "No Id" } }, { author: { id: "https://openalex.org/A9", display_name: " " } }] };
    const c = toCandidate(w);
    expect(c?.authors).toEqual(["Ann Ash", "No Id"]);
    expect(c?.authorIds).toEqual(["A111", ""]);
  });

  it("asks for the author's works that cite some works, most cited first, with short ids only and at most 50", () => {
    const ids = Array.from({ length: 60 }, (_, i) => `W${i + 1}`);
    const url = new URL(buildAuthorWorksUrl("A123", [...ids, "bogus"]));
    expect(url.searchParams.get("filter")?.startsWith("authorships.author.id:A123,cites:W1|W2")).toBe(true);
    expect(url.searchParams.get("filter")?.split("|")).toHaveLength(50);
    expect(url.searchParams.get("sort")).toBe("cited_by_count:desc");
    expect(toWorkRef({ title: "T", abstract: null, doi: "https://doi.org/10.1/x", year: 2020, openalexId: "https://openalex.org/W1", authors: ["A"], authorIds: ["A1"], venue: null, publicationDate: null, citedByCount: 4 })).toMatchObject({ id: "W1", doi: "10.1/x", authorIds: ["A1"], citedBy: 4 });
  });
});

describe("findAuthorWork", () => {
  const cand = (n: number, refs: number[], citedBy: number, authorIds: string[]): Candidate => ({
    title: `Paper ${n}`, abstract: null, doi: null, year: 2020, openalexId: `https://openalex.org/W${n}`, authors: authorIds.map((_, i) => `Author ${i}`), authorIds, venue: null,
    publicationDate: null, citedByCount: citedBy, referencedWorks: refs.map((r) => `W${r}`),
  });
  // The paper (W1) cites W2 to W4. Author A5 wrote W2 (cited by the paper), W7 (cites W2, W3: shared 2), W8 (cites W4: shared 1) and W1 itself.
  const works = [cand(1, [2, 3, 4], 5, ["A5"]), cand(2, [], 50, ["A5"]), cand(7, [2, 3], 10, ["A5"]), cand(8, [4], 30, ["A5"]), cand(9, [2], 99, ["A6"])];

  function client(): { c: GapsClient; calls: string[] } {
    const calls: string[] = [];
    const c = {
      authorWorks: (id: string, cited: readonly string[]) => {
        calls.push(`${id}:${cited.length}`);
        return Promise.resolve({ papers: works.filter((w) => (w.authorIds ?? []).includes(id) && (w.referencedWorks ?? []).some((r) => cited.includes(r))), costUsd: 0.0001 });
      },
    } as unknown as GapsClient;
    return { c, calls };
  }

  it("lists the author's works that cite the paper's references, not the paper's own references or the paper, most shared first", async () => {
    const { c, calls } = client();
    const res = await findAuthorWork("A5", ["W2", "W3", "W4"], "W1", { client: c, cache: emptyCache(), now: 1, budget: new Budget(0.05) });
    expect(res.works.map((w) => [w.paper.openalexId.split("/").pop(), w.shared])).toEqual([["W7", 2], ["W8", 1]]);
    expect(calls).toEqual(["A5:3"]);
    expect(res.stopped).toBeNull();
  });

  it("reads references in lists of 50 (two requests for 100) and stops at the budget", async () => {
    const refs = Array.from({ length: 100 }, (_, i) => `W${i + 2}`);
    const a = client();
    await findAuthorWork("A5", refs, "W1", { client: a.c, cache: emptyCache(), now: 1, budget: new Budget(0.05) });
    expect(a.calls).toEqual(["A5:50", "A5:50"]);
    const b = client();
    const tight = await findAuthorWork("A5", refs, "W1", { client: b.c, cache: emptyCache(), now: 1, budget: new Budget(0.00015) });
    expect(b.calls).toHaveLength(1);
    expect(tight.stopped).toContain("stopped");
  });
});
