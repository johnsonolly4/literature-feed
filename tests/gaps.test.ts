// The citation-gaps tool: reading what the user typed or pasted, the Zotero search, the estimate, and the run against a fake OpenAlex.
import { describe, expect, it } from "vitest";
import { buildTitleSearchUrl, buildWorksByDoiUrl, filterSafeDoi, type Candidate } from "../src/openalex/client";
import { Budget } from "../src/review/budget";
import { emptyCache, getTitle, normaliseCache } from "../src/review/cache";
import { MAX_TITLE_SEARCHES, emptyGapsSession, estimateGaps, normaliseGapsSession, parseReferenceList, parseWorkInput, searchZoteroIndex, titleInReference } from "../src/review/gaps-input";
import { gapsRecordFromNote, renderGapsNote } from "../src/review/gaps-note";
import { runGaps, type GapsClient } from "../src/review/gaps-fetch";
import type { ZoteroIndex } from "../src/zotero/library-index";

function cand(n: number, refs: number[] | undefined, overrides: Partial<Candidate> = {}): Candidate {
  return {
    title: `A study of lipoic polymers number ${n}`, abstract: null, doi: `https://doi.org/10.1000/p.${n}`, year: 2020 + (n % 5),
    openalexId: `https://openalex.org/W${n}`, authors: ["A. Author"], venue: null, publicationDate: null, citedByCount: n,
    ...(refs ? { referencedWorks: refs.map((r) => `W${r}`) } : {}), ...overrides,
  };
}

describe("reading what the user typed", () => {
  it("finds a DOI or an OpenAlex id in a link, a bare value or a sentence", () => {
    expect(parseWorkInput("10.1021/jacs.3c08248")).toEqual({ doi: "10.1021/jacs.3c08248", id: null });
    expect(parseWorkInput("https://doi.org/10.1021/JACS.3C08248.")).toEqual({ doi: "10.1021/jacs.3c08248", id: null });
    expect(parseWorkInput("see doi:10.1002/anie.202215329)")).toEqual({ doi: "10.1002/anie.202215329", id: null });
    expect(parseWorkInput("https://openalex.org/W4385432100")).toEqual({ doi: null, id: "W4385432100" });
    expect(parseWorkInput("W4385432100")).toEqual({ doi: null, id: "W4385432100" });
    expect(parseWorkInput("a title with no identifier")).toBeNull();
    expect(parseWorkInput("")).toBeNull();
  });

  it("splits a pasted reference list into DOIs and lines to search, without repeats", () => {
    const text = [
      "1. Albanese, K. R.; Morris, P. T. Controlled-radical polymerization of lipoic acid. J. Am. Chem. Soc. 2023, 145, 22728. https://doi.org/10.1021/jacs.3c08248",
      "[2] Smith J, Doe A. Degradable vinyl copolymers made with lipoic acid and RAFT. Macromolecules 2024.",
      "[2] Smith J, Doe A. Degradable vinyl copolymers made with lipoic acid and RAFT. Macromolecules 2024.",
      "",
      "10.1021/jacs.3c08248",
      "short",
      "3) Another reference line that has no identifier at all, 2022.",
    ].join("\n");
    const r = parseReferenceList(text);
    expect(r.dois).toEqual(["10.1021/jacs.3c08248"]);
    expect(r.lines).toEqual([
      "Smith J, Doe A. Degradable vinyl copolymers made with lipoic acid and RAFT. Macromolecules 2024.",
      "Another reference line that has no identifier at all, 2022.",
    ]);
    expect(parseReferenceList("   \n\n")).toEqual({ dois: [], lines: [] });
  });

  it("accepts a work's title when nearly all its words are in the reference line", () => {
    const line = "Albanese, K. R.; Morris, P. T. Controlled-radical polymerization of lipoic acid: a general route to degradable vinyl copolymers. J. Am. Chem. Soc. 2023";
    expect(titleInReference("Controlled-Radical Polymerization of α-Lipoic Acid: A General Route to Degradable Vinyl Copolymers", line)).toBe(true); // one word of fourteen may differ
    expect(titleInReference("Controlled-Radical Polymerization of Lipoic Acid: A General Route to Degradable Vinyl Copolymers", line)).toBe(true);
    expect(titleInReference("Lipoic acid", line)).toBe(false); // too short to trust
    expect(titleInReference("Something quite different about hydrogels", line)).toBe(false);
  });

  it("only puts DOIs in a filter that cannot be split by it", () => {
    expect(filterSafeDoi("10.1021/jacs.3c08248")).toBe(true);
    expect(filterSafeDoi("10.1000/a,b")).toBe(false);
    expect(filterSafeDoi("10.1000/a|b")).toBe(false);
    expect(filterSafeDoi("not a doi")).toBe(false);
    const url = new URL(buildWorksByDoiUrl(["10.1000/a", "10.1000/b,c", "10.1000/d"]));
    expect(url.searchParams.get("filter")).toBe("doi:10.1000/a|10.1000/d");
    const search = new URL(buildTitleSearchUrl("Smith, J.: A study (2020) [x]"));
    expect(search.searchParams.get("search")).toBe("Smith J A study 2020 x");
  });
});

describe("searching the Zotero index", () => {
  const index: ZoteroIndex = {
    version: 1, libraryVersion: 3,
    items: { K1: { doi: "10.1000/a", title: "Degradable lipoic acid polymers" }, K2: { doi: "", title: "Lipoic acid in medicine" }, K3: { doi: "10.1000/c", title: "Hydrogels" } },
  };
  it("matches every word of the query in the title, or the DOI", () => {
    expect(searchZoteroIndex(index, "lipoic acid").map((h) => h.key)).toEqual(["K1", "K2"]);
    expect(searchZoteroIndex(index, "LIPOIC medicine").map((h) => h.key)).toEqual(["K2"]);
    expect(searchZoteroIndex(index, "https://doi.org/10.1000/c").map((h) => h.key)).toEqual(["K3"]);
    expect(searchZoteroIndex(index, "")).toEqual([]);
    expect(searchZoteroIndex(index, "nothing like it")).toEqual([]);
    expect(searchZoteroIndex(index, "lipoic", 1)).toHaveLength(1);
  });
});

describe("what a run costs", () => {
  it("one paper by DOI: the record is free, two lists for its references, one for the details", () => {
    const e = estimateGaps({ kind: "work", doi: "10.1000/a", id: null });
    expect(e).toMatchObject({ free: 1, filtered: 3, searches: 0 });
    expect(e.usd).toBeCloseTo(0.0003);
  });

  it("a paper found by title costs one search more", () => {
    const e = estimateGaps({ kind: "title", title: "x" });
    expect(e.searches).toBe(1);
    expect(e.usd).toBeCloseTo(0.0013);
  });

  it("a pasted list: DOIs in lists of 50, a search for each other line up to the cap", () => {
    const dois = Array.from({ length: 60 }, (_, i) => `10.1000/${i}`);
    const lines = Array.from({ length: 30 }, (_, i) => `reference line number ${i}`);
    const e = estimateGaps({ kind: "references", dois, lines });
    expect(e.filtered).toBe(3); // two DOI lists and the details
    expect(e.searches).toBe(MAX_TITLE_SEARCHES);
    expect(e.skippedLines).toBe(5);
    expect(e.usd).toBeCloseTo(3 * 0.0001 + MAX_TITLE_SEARCHES * 0.001);
    expect(estimateGaps({ kind: "references", dois: [], lines: [] }).usd).toBe(0);
  });
});

// ---- a fake OpenAlex ------------------------------------------------------------------------------------------------------

function fake(works: Candidate[]): { client: GapsClient; calls: string[] } {
  const calls: string[] = [];
  const byId = new Map(works.map((w) => [w.openalexId.replace("https://openalex.org/", ""), w]));
  const byDoi = new Map(works.map((w) => [(w.doi ?? "").replace("https://doi.org/", ""), w]));
  const client: GapsClient = {
    citingPage: () => Promise.resolve({ papers: [], fetched: 0, count: 0, costUsd: 0 }),
    getWorks: (ids) => { calls.push(`works:${ids.length}`); return Promise.resolve({ papers: ids.flatMap((i) => byId.get(i) ?? []), costUsd: 0.0001 }); },
    getFullWork: (ref) => { calls.push("full"); return Promise.resolve((ref.id ? byId.get(ref.id) : byDoi.get(ref.doi ?? "")) ?? null); },
    getWorksByDoi: (dois) => { calls.push(`dois:${dois.length}`); return Promise.resolve({ papers: dois.flatMap((d) => byDoi.get(d) ?? []), costUsd: 0.0001 }); },
    findByTitle: (t) => {
      calls.push("search");
      const hit = works.filter((w) => titleInReference(w.title, t));
      return Promise.resolve({ papers: hit, costUsd: 0.001 });
    },
  };
  return { client, calls };
}

// W1 is the paper; it cites W2, W3, W4. W2, W3, W4 each cite W9 (three times: a gap) and W2 and W3 cite W8 (twice: not enough).
const WORKS = [
  cand(1, [2, 3, 4]), cand(2, [9, 8]), cand(3, [9, 8]), cand(4, [9]), cand(8, []), cand(9, [], { title: "The missing foundational paper about lipoic acid" }),
];

function deps(works: Candidate[], limit = 0.05) {
  const { client, calls } = fake(works);
  return { calls, deps: { client, cache: emptyCache(), now: 1000, budget: new Budget(limit) } };
}

describe("runGaps", () => {
  it("finds what the references cite and the paper does not, from a DOI, at the price of two lists and the details", async () => {
    const { deps: d, calls } = deps(WORKS);
    const run = await runGaps({ kind: "work", doi: "10.1000/p.1", id: null }, d);
    expect(run.subject).toMatchObject({ doi: "10.1000/p.1", id: "W1" });
    expect(run.gaps.map((g) => [g.gap.id, g.gap.count])).toEqual([["W9", 3]]);
    expect(run.gaps[0].paper?.title).toContain("missing foundational");
    expect(run.referencesRead).toBe(3);
    expect(calls).toEqual(["full", "works:3", "works:1"]);
    expect(run.spentUsd).toBeCloseTo(0.0002);
  });

  it("works from an OpenAlex id and uses the cache the second time", async () => {
    const { deps: d, calls } = deps(WORKS);
    await runGaps({ kind: "work", doi: null, id: "W1" }, d);
    const before = calls.length;
    const again = await runGaps({ kind: "work", doi: null, id: "W1" }, d);
    expect(again.gaps).toHaveLength(1);
    expect(calls.length).toBe(before); // the record and every work came from the cache
  });

  it("says so when OpenAlex has no record or no references", async () => {
    const { deps: d } = deps(WORKS);
    expect((await runGaps({ kind: "work", doi: "10.1000/none", id: null }, d)).message).toContain("no record");
    const { deps: d2 } = deps([cand(5, [])]);
    const none = await runGaps({ kind: "work", doi: null, id: "W5" }, d2);
    expect(none.message).toContain("no references");
    expect(none.subject?.id).toBe("W5");
  });

  it("finds the paper by title when it has no DOI (one search)", async () => {
    const { deps: d, calls } = deps(WORKS);
    const run = await runGaps({ kind: "title", title: "A study of lipoic polymers number 1" }, d);
    expect(run.gaps.map((g) => g.gap.id)).toEqual(["W9"]);
    expect(calls[0]).toBe("search");
    expect(getTitle(d.cache, "astudyoflipoicpolymersnumber1", d.now)).toEqual({ id: "W1" });
  });

  it("works from a pasted list: DOIs by lookup, other lines by search, and says what it could not find", async () => {
    const { deps: d, calls } = deps(WORKS);
    const run = await runGaps({
      kind: "references",
      dois: ["10.1000/p.2", "10.1000/p.3", "10.1000/missing"],
      lines: ["Author A. A study of lipoic polymers number 4. J. Test 2020.", "Somebody. A reference that exists nowhere in this fake database. 2019."],
    }, d);
    expect(run.referencesRead).toBe(3);
    expect(run.gaps.map((g) => [g.gap.id, g.gap.count])).toEqual([["W9", 3]]);
    expect(run.unresolved).toEqual(["10.1000/missing", "Somebody. A reference that exists nowhere in this fake database. 2019."]);
    expect(run.searches).toBe(2);
    expect(calls.filter((c) => c === "search")).toHaveLength(2);
    // the pasted list is not "the paper": the gap work W9 is cited by all three, and none of them is the paper itself
    expect(run.subject).toBeNull();
  });

  it("does not search again for a line searched before", async () => {
    const { deps: d, calls } = deps(WORKS);
    const input = { kind: "references" as const, dois: [], lines: ["Author A. A study of lipoic polymers number 4. J. Test 2020.", "Author B. A study of lipoic polymers number 2. J. Test 2020.", "Author C. A study of lipoic polymers number 3. J. Test 2020."] };
    await runGaps(input, d);
    const searched = calls.filter((c) => c === "search").length;
    await runGaps(input, d);
    expect(calls.filter((c) => c === "search").length).toBe(searched);
  });

  it("stops at the budget, keeps what it has and says so", async () => {
    const { deps: d, calls } = deps(WORKS, 0.0015);
    const lines = [2, 3, 4].map((n) => `Author. A study of lipoic polymers number ${n}. J. Test 2020.`);
    const run = await runGaps({ kind: "references", dois: [], lines }, d);
    expect(calls.filter((c) => c === "search")).toHaveLength(1);
    expect(run.stopped).toContain("stopped");
    expect(run.referencesRead).toBe(1);
  });

  it("copes with a list in which nothing is found", async () => {
    const { deps: d } = deps(WORKS);
    const run = await runGaps({ kind: "references", dois: ["10.1000/nope"], lines: [] }, d);
    expect(run.message).toContain("None of the references");
    expect(run.unresolved).toEqual(["10.1000/nope"]);
  });
});

describe("the cache of searched titles", () => {
  it("is read tolerantly", () => {
    const back = normaliseCache({ titles: { ok: { at: 5, id: "W1" }, none: { at: 5, id: null }, bad: { at: "x", id: "W1" }, badid: { at: 5, id: "zzz" } } });
    expect(back.titles).toEqual({ ok: { at: 5, id: "W1" }, none: { at: 5, id: null } });
    expect(normaliseCache({}).titles).toBeUndefined();
  });
});

describe("the gaps note and the saved tool state", () => {
  it("writes the table with links and flags and a record that reads back", async () => {
    const { deps: d } = deps(WORKS);
    const input = { kind: "work" as const, doi: "10.1000/p.1", id: null };
    const run = await runGaps(input, d);
    const text = renderGapsNote({ date: "2026-10-13", ranAt: "2026-10-13T12:00:00.000Z", input, minCount: 3, run, flags: [{ zotero: "KEY00001", vault: null, listedBefore: [] }] });
    expect(text).toContain("kind: literature-gaps");
    expect(text).toContain("Read 3 references");
    expect(text).toContain("| [The missing foundational paper about lipoic acid](https://doi.org/10.1000/p.9) |");
    expect(text).toContain("3 (100%)");
    expect(text).toContain("zotero://select/library/items/KEY00001");
    expect(text).toContain("## How this was made");
    expect(text).toContain("DOI 10.1000/p.1");
    const rec = gapsRecordFromNote(text);
    expect(rec).toMatchObject({ version: 1, minCount: 3, input, referencesRead: 3 });
    expect(rec?.gaps).toEqual([{ id: "W9", count: 3, share: 1 }]);
    expect(gapsRecordFromNote(text.replace(/\n/g, "\r\n"))?.gaps).toHaveLength(1);
    expect(gapsRecordFromNote("nothing")).toBeNull();
  });

  it("says what was pasted and what was not found, and handles a run with no result", () => {
    const run = { subject: null, referencesRead: 0, referencesWithLists: 0, gaps: [], unresolved: ["10.1000/x"], searches: 0, stopped: null, message: "None of the references could be found in OpenAlex.", spentUsd: 0.0001 };
    const text = renderGapsNote({ date: "2026-10-13", ranAt: "t", input: { kind: "references", dois: ["10.1000/x"], lines: ["A reference line"] }, minCount: 3, run, flags: [] });
    expect(text).toContain("1 with a DOI and 1 without");
    expect(text).toContain("Not found in OpenAlex");
    expect(text).toContain("None of the references could be found");
    expect(text).not.toContain("## Possible gaps");
  });

  it("reads the saved state tolerantly", () => {
    expect(normaliseGapsSession(null)).toBeNull();
    expect(normaliseGapsSession({ version: 2 })).toBeNull();
    const s = normaliseGapsSession({ version: 1, mode: "paste", paperText: 5, pasted: "x", minCount: 99, last: { input: { kind: "work" }, run: {}, ranAt: "t" } });
    expect(s).toMatchObject({ mode: "paste", paperText: "", pasted: "x", minCount: 10, last: null });
    expect(normaliseGapsSession({ version: 1 })).toEqual(emptyGapsSession());
  });
});
