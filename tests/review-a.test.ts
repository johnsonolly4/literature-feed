// Phase A of the literature review: budget, cache, collecting within a budget, flags, the Zotero index, the prompt and its answer,
// and the client calls the review makes. Nothing calls the network.
import { describe, expect, it } from "vitest";
import { OpenAlexClient, buildCitingUrl, buildSearchUrl, buildWorksByIdUrl, shortWorkId, toCandidate, type Candidate, type OpenAlexWork, type Requester } from "../src/openalex/client";
import { ZoteroClient, type HttpRequest, type HttpResponse } from "../src/zotero/client";
import { emptyLedger } from "../src/ledger/ledger";
import { buildLiteratureIndex } from "../src/inbox/state";
import { LIT_REVIEW_EXAMPLE, buildLitReviewPrompt, checkLitReviewAnswer, cutAbstract, paperLabel } from "../src/review/prompt";
import { Budget, CAP_PER_TOPIC, addSpend, emptyTally, estimateSearch, monthOf, monthTotal, normaliseTally, overBudget, pagesFor, passesMonthlyLimit } from "../src/review/budget";
import { CACHE_TTL_MS, MAX_TOPIC_ENTRIES, emptyCache, getTopic, getWork, normaliseCache, putTopic, putWorks, topicKey } from "../src/review/cache";
import { fitScore, orderPapers, planReview, runReview, type ReviewClient, type ReviewOptions, type ReviewPaper } from "../src/review/collect";
import { countFlags, flagsFor } from "../src/review/flags";
import { buildLookup, doiOfItem, emptyIndex, findInZotero, mergeIndex, normaliseIndex, type IndexedCollection, type LibraryItemRow } from "../src/zotero/library-index";
import type { FeedConfig } from "../src/settings/data";

const noSleep = async (): Promise<void> => { /* tests do not wait */ };

function feed(id: string, topics: string[], overrides: Partial<FeedConfig> = {}): FeedConfig {
  return {
    id, name: `Feed ${id}`, enabled: true, topics,
    groups: [{ name: "Poly", role: "required", terms: ["polymer"] }, { name: "Flow", role: "priority", terms: ["flow"] }],
    drop: ["clinical"], lower: [], yearsFrom: null, zoteroCollection: "", project: "", seedCollection: "", knownDois: [], ...overrides,
  };
}

function cand(n: number, overrides: Partial<Candidate> = {}): Candidate {
  return {
    title: `Polymer paper ${n}`, abstract: `A study of polymer ${n}.`, doi: `https://doi.org/10.1000/p.${n}`, year: 2024,
    openalexId: `https://openalex.org/W${n}`, authors: ["A. Author"], venue: "J", publicationDate: "2024-05-01", citedByCount: n, referencedWorks: [], ...overrides,
  };
}

// ---- the OpenAlex client calls ---------------------------------------------------------------------------------------

describe("OpenAlex URLs for the review", () => {
  it("asks for the extra fields only when told to, and can sort", () => {
    const plain = new URL(buildSearchUrl("a"));
    expect(plain.searchParams.get("select")).not.toContain("referenced_works");
    const extra = new URL(buildSearchUrl("a", { extra: true, sort: "relevance_score:desc" }));
    expect(extra.searchParams.get("select")).toContain("cited_by_count,referenced_works");
    expect(extra.searchParams.get("sort")).toBe("relevance_score:desc");
    expect(new URL(buildSearchUrl("a", { perPage: 1, select: "id" })).searchParams.get("select")).toBe("id");
  });

  it("builds the by-id and citing addresses, short ids only, at most 50", () => {
    const ids = Array.from({ length: 60 }, (_, i) => `W${i + 1}`);
    const byId = new URL(buildWorksByIdUrl([...ids, "bogus"]));
    expect(byId.searchParams.get("filter")?.split("|")).toHaveLength(50);
    expect(byId.searchParams.get("filter")?.startsWith("openalex:W1|W2")).toBe(true);
    expect(byId.searchParams.get("per_page")).toBe("50");
    const citing = new URL(buildCitingUrl(["W1", "W2"], 2));
    expect(citing.searchParams.get("filter")).toBe("cites:W1|W2");
    expect(citing.searchParams.get("page")).toBe("2");
  });

  it("reads citations and references into a candidate, with short ids", () => {
    const work: OpenAlexWork = {
      id: "https://openalex.org/W9", title: "T", cited_by_count: 42, referenced_works: ["https://openalex.org/W1", "https://openalex.org/W2", "junk"],
    };
    expect(toCandidate(work)).toMatchObject({ citedByCount: 42, referencedWorks: ["W1", "W2"] });
    expect(toCandidate({ id: "https://openalex.org/W9", title: "T" })).not.toHaveProperty("citedByCount");
    expect(shortWorkId("https://openalex.org/W77")).toBe("W77");
    expect(shortWorkId("nope")).toBeNull();
  });
});

describe("OpenAlexClient review calls", () => {
  function client(answers: { status: number; json: unknown }[], costs: number[] = []) {
    const urls: string[] = [];
    const request: Requester = async (req) => {
      urls.push(req.url);
      const a = answers.shift();
      if (!a) throw new Error("out of answers");
      return a;
    };
    return { urls, client: new OpenAlexClient({ request, sleep: noSleep, onCost: (usd) => costs.push(usd) }) };
  }

  it("counts a topic with one tiny request and reports the cost to the tally", async () => {
    const costs: number[] = [];
    const { client: c, urls } = client([{ status: 200, json: { meta: { count: 812, cost_usd: 0.001 }, results: [] } }], costs);
    expect(await c.countTopic("polymer", { fromDate: "2020-01-01" })).toEqual({ count: 812, costUsd: 0.001 });
    expect(new URL(urls[0]).searchParams.get("per_page")).toBe("1");
    expect(new URL(urls[0]).searchParams.get("select")).toBe("id");
    expect(costs).toEqual([0.001]);
  });

  it("fetches a page with the extra fields and leaves out works without a title", async () => {
    const page = { meta: { count: 3, cost_usd: 0.001 }, results: [
      { id: "https://openalex.org/W1", title: "One", cited_by_count: 5, referenced_works: ["https://openalex.org/W2"] }, { id: "https://openalex.org/W2", title: null },
    ] };
    const { client: c, urls } = client([{ status: 200, json: page }]);
    const got = await c.searchPage("polymer", 2, { extra: true });
    expect(got).toMatchObject({ fetched: 2, count: 3, costUsd: 0.001 });
    expect(got.papers.map((p) => p.openalexId)).toEqual(["https://openalex.org/W1"]);
    expect(new URL(urls[0]).searchParams.get("page")).toBe("2");
  });

  it("gets works by id in batches of 50 and pages through the citing works", async () => {
    const ids = Array.from({ length: 60 }, (_, i) => `W${i + 1}`);
    const batch = (n: number) => ({ status: 200, json: { meta: { cost_usd: 0.001 }, results: Array.from({ length: n }, (_, i) => ({ id: `https://openalex.org/W${i + 1}`, title: `T${i}` })) } });
    const { client: c, urls } = client([batch(50), batch(10)]);
    const got = await c.getWorks(ids);
    expect(got.papers).toHaveLength(60);
    expect(got.costUsd).toBeCloseTo(0.002);
    expect(urls).toHaveLength(2);
    const { client: d } = client([{ status: 200, json: { meta: { count: 1, cost_usd: 0.001 }, results: [{ id: "https://openalex.org/W5", title: "Citing" }] } }]);
    expect((await d.citingPage(["W1"])).papers[0].title).toBe("Citing");
  });
});

// ---- budget, tally, cache --------------------------------------------------------------------------------------------

describe("budget", () => {
  it("works out pages and cost from the counts, with the cap, and treats cached topics as free", () => {
    expect(pagesFor(0)).toEqual({ fetch: 0, pages: 0 });
    expect(pagesFor(95)).toEqual({ fetch: 95, pages: 1 });
    expect(pagesFor(100)).toEqual({ fetch: 100, pages: 1 });
    expect(pagesFor(101)).toEqual({ fetch: 101, pages: 2 });
    expect(pagesFor(5000)).toEqual({ fetch: CAP_PER_TOPIC, pages: CAP_PER_TOPIC / 100 });
    const est = estimateSearch([
      { key: "a", topic: "a", count: 812, fromCache: false }, { key: "b", topic: "b", count: 50, fromCache: false }, { key: "c", topic: "c", count: 400, fromCache: true },
    ], 300);
    expect(est.requests).toBe(4);
    expect(est.works).toBe(300 + 50 + 300);
    expect(est.usd).toBeCloseTo(0.004);
    expect(estimateSearch([{ key: "a", topic: "a", count: 10, fromCache: false }], 300, 5).requests).toBe(6);
  });

  it("says when an estimate is over the budget", () => {
    expect(overBudget({ usd: 0.051 }, 0.05)).toBe(true);
    expect(overBudget({ usd: 0.05 }, 0.05)).toBe(false);
  });

  it("tracks spending against its limit", () => {
    const b = new Budget(0.003);
    expect(b.canAfford()).toBe(true);
    b.add(0.001);
    b.add(0.001);
    expect(b.remaining).toBeCloseTo(0.001);
    expect(b.canAfford()).toBe(true);
    b.add(0.001);
    expect(b.canAfford()).toBe(false);
    b.add(-5);
    expect(b.spent).toBeCloseTo(0.003);
  });

  it("tallies requests by month, reads the file tolerantly, and checks a monthly soft limit", () => {
    const tally = emptyTally();
    addSpend(tally, "2026-10", 0.004);
    addSpend(tally, "2026-10", 0.001, 2);
    addSpend(tally, "2026-11", 0.002);
    expect(monthTotal(tally, "2026-10")).toEqual({ requests: 3, usd: 0.005 });
    expect(monthTotal(tally, "2020-01")).toEqual({ requests: 0, usd: 0 });
    expect(monthOf(new Date(2026, 9, 13))).toBe("2026-10");
    expect(normaliseTally(JSON.parse(JSON.stringify(tally)))).toEqual(tally);
    expect(normaliseTally({ months: { "2026-10": { requests: "x", usd: 1 }, bad: { requests: 1, usd: 1 }, "2026-09": { requests: 2, usd: 0.1 } } }).months).toEqual({ "2026-09": { requests: 2, usd: 0.1 } });
    for (const x of [null, 3, [], { months: [] }]) expect(normaliseTally(x)).toEqual(emptyTally());
    expect(passesMonthlyLimit(tally, "2026-10", 0.01, 0.01)).toBe(true);
    expect(passesMonthlyLimit(tally, "2026-10", 0.005, 0.01)).toBe(false);
    expect(passesMonthlyLimit(tally, "2026-10", 5, 0)).toBe(false);
  });
});

describe("cache", () => {
  it("returns a fresh topic result and not an expired or future one", () => {
    const cache = emptyCache();
    const key = topicKey("polymer", "2020-01-01", 300);
    putTopic(cache, key, { at: 1000, count: 5, papers: [cand(1)] });
    expect(getTopic(cache, key, 1000 + CACHE_TTL_MS - 1)?.count).toBe(5);
    expect(getTopic(cache, key, 1000 + CACHE_TTL_MS)).toBeNull();
    expect(getTopic(cache, key, 500)).toBeNull();
    expect(getTopic(cache, topicKey("polymer", "2021-01-01", 300), 1000)).toBeNull();
  });

  it("keeps the newest topic results up to the limit and the works by id", () => {
    const cache = emptyCache();
    for (let i = 0; i < MAX_TOPIC_ENTRIES + 3; i++) putTopic(cache, `k${i}`, { at: i, count: 1, papers: [] });
    expect(Object.keys(cache.topics)).toHaveLength(MAX_TOPIC_ENTRIES);
    expect(cache.topics.k0).toBeUndefined();
    putWorks(cache, [cand(7)], 10);
    expect(getWork(cache, "W7", 11)?.title).toBe("Polymer paper 7");
    expect(getWork(cache, "W7", 10 + CACHE_TTL_MS)).toBeNull();
  });

  it("reads a damaged file without throwing", () => {
    const cache = emptyCache();
    putTopic(cache, "k", { at: 1, count: 2, papers: [cand(1)] });
    expect(normaliseCache(JSON.parse(JSON.stringify(cache)))).toEqual(cache);
    const odd = normaliseCache({ topics: { a: { at: "x" }, b: { at: 1, count: 1, papers: [3, cand(2)] } }, works: { W1: { at: 1, paper: { title: 1 } }, bad: {} } });
    expect(odd.topics.a).toBeUndefined();
    expect(odd.topics.b.papers).toHaveLength(1);
    expect(odd.works).toEqual({});
    for (const x of [null, 3, "x", []]) expect(normaliseCache(x)).toEqual(emptyCache());
  });
});

// ---- collecting within a budget ---------------------------------------------------------------------------------------

/** A client whose topics return given works, 100 to a page, charging $0.001 a request, and remembering what it was asked. */
function fakeReview(topics: Record<string, Candidate[]>) {
  const log: string[] = [];
  const client: ReviewClient = {
    async countTopic(topic) {
      log.push(`count ${topic}`);
      return { count: topics[topic]?.length ?? 0, costUsd: 0.001 };
    },
    async searchPage(topic, page) {
      log.push(`page ${topic} ${page}`);
      const all = topics[topic] ?? [];
      const slice = all.slice((page - 1) * 100, page * 100);
      return { papers: slice, fetched: slice.length, count: all.length, costUsd: 0.001 };
    },
  };
  return { client, log };
}

const OPTS: ReviewOptions = { fromDate: "2020-01-01", capPerTopic: 300, maxPapers: 10, minTier: "possible", refresh: false };
const NOW = 1_000_000;

describe("planning and running a review", () => {
  const feeds = [feed("a", ["t1", "t2"]), feed("b", ["t2"])];

  it("counts each distinct topic once and estimates the pages", async () => {
    const works = { t1: Array.from({ length: 250 }, (_, i) => cand(i + 1)), t2: Array.from({ length: 40 }, (_, i) => cand(i + 1000)) };
    const { client, log } = fakeReview(works);
    const budget = new Budget(0.05);
    const plan = await planReview(feeds, OPTS, { client, cache: emptyCache(), now: NOW, budget });
    expect(log).toEqual(["count t1", "count t2"]);
    expect(plan.topics.map((t) => [t.topic, t.count, t.pages, t.feedIds])).toEqual([["t1", 250, 3, ["a"]], ["t2", 40, 1, ["a", "b"]]]);
    expect(plan.estimate.requests).toBe(4);
    expect(plan.overBudget).toBe(false);
    expect(budget.spent).toBeCloseTo(0.002);
  });

  it("flags a plan that would pass the budget and a budget too small even to count", async () => {
    const works = { t1: Array.from({ length: 900 }, (_, i) => cand(i + 1)) };
    const { client } = fakeReview(works);
    const plan = await planReview([feed("a", ["t1"])], OPTS, { client, cache: emptyCache(), now: NOW, budget: new Budget(0.003) });
    expect(plan.overBudget).toBe(true); // 1 counting + 3 pages = 4 requests
    await expect(planReview(feeds, OPTS, { client, cache: emptyCache(), now: NOW, budget: new Budget(0.0005) })).rejects.toThrow("budget is used up");
  });

  it("fetches, scores with each search's rules, merges across searches, sorts and caps", async () => {
    const works = {
      t1: [cand(1, { citedByCount: 5 }), cand(2, { title: "Polymer flow study", abstract: "polymer flow reactor", citedByCount: 1 }), cand(3, { title: "Clinical polymer trial", abstract: "a clinical trial of a polymer" })],
      t2: [cand(1, { citedByCount: 5 }), cand(4, { title: "Unrelated chemistry", abstract: "no match here" })],
    };
    const { client } = fakeReview(works);
    const deps = { client, cache: emptyCache(), now: NOW, budget: new Budget(0.05) };
    const plan = await planReview(feeds, OPTS, deps);
    const res = await runReview(feeds, plan, OPTS, deps);
    expect(res.stopped).toBeNull();
    // W3 is dropped by the "clinical" term, W4 fails the required group; W2 is Priority (flow), W1 Possible, found by both searches.
    expect(res.papers.map((p) => [p.id, p.tier])).toEqual([["W2", "priority"], ["W1", "possible"]]);
    const w1 = res.papers.find((p) => p.id === "W1");
    expect(w1?.finds.map((f) => f.feedId)).toEqual(["a", "b"]);
    expect(w1?.finds[0].topics).toEqual([1, 2]);
    expect(res.total).toBe(2);
    expect(res.topics.find((t) => t.feedId === "a" && t.topic === "t1")).toMatchObject({ count: 3, fetched: 3, fromCache: false });
  });

  it("applies the cap on the prompt and the minimum tier", async () => {
    const works = { t1: Array.from({ length: 30 }, (_, i) => cand(i + 1, { citedByCount: i })) };
    const { client } = fakeReview(works);
    const deps = { client, cache: emptyCache(), now: NOW, budget: new Budget(0.05) };
    const one = [feed("a", ["t1"])];
    const plan = await planReview(one, OPTS, deps);
    const res = await runReview(one, plan, { ...OPTS, maxPapers: 5 }, deps);
    expect(res.papers).toHaveLength(5);
    expect(res.total).toBe(30);
    expect(res.papers[0].citedByCount).toBe(29);
    const strict = await runReview(one, plan, { ...OPTS, minTier: "strong" }, deps);
    expect(strict.total).toBe(0);
  });

  it("stops at the budget, keeps what it fetched, says so, and does not cache a partial topic", async () => {
    const works = { t1: Array.from({ length: 300 }, (_, i) => cand(i + 1)) };
    const { client } = fakeReview(works);
    const cache = emptyCache();
    const budget = new Budget(0.003); // one count and two pages
    const deps = { client, cache, now: NOW, budget };
    const one = [feed("a", ["t1"])];
    const plan = await planReview(one, OPTS, deps);
    const res = await runReview(one, plan, OPTS, deps);
    expect(res.stopped).toContain("stopped at $0.003");
    expect(res.topics[0].fetched).toBe(200);
    expect(res.papers.length).toBeGreaterThan(0);
    expect(Object.keys(cache.topics)).toEqual([]);
    expect(res.spentUsd).toBeCloseTo(0.003);
  });

  it("ends the run, keeping the works, when a request fails", async () => {
    const works = { t1: Array.from({ length: 250 }, (_, i) => cand(i + 1)) };
    const { client } = fakeReview(works);
    let calls = 0;
    const flaky: ReviewClient = { countTopic: client.countTopic.bind(client), searchPage: async (t, p, o) => { if (++calls === 2) throw new Error("HTTP 500"); return client.searchPage(t, p, o); } };
    const deps = { client: flaky, cache: emptyCache(), now: NOW, budget: new Budget(0.05) };
    const one = [feed("a", ["t1"])];
    const plan = await planReview(one, OPTS, deps);
    const res = await runReview(one, plan, OPTS, deps);
    expect(res.stopped).toContain("HTTP 500");
    expect(res.topics[0].fetched).toBe(100);
  });

  it("a second run costs nothing: topics come from the cache, unless refresh is asked for", async () => {
    const works = { t1: Array.from({ length: 150 }, (_, i) => cand(i + 1)) };
    const first = fakeReview(works);
    const cache = emptyCache();
    const one = [feed("a", ["t1"])];
    const deps1 = { client: first.client, cache, now: NOW, budget: new Budget(0.05) };
    await runReview(one, await planReview(one, OPTS, deps1), OPTS, deps1);
    expect(first.log).toEqual(["count t1", "page t1 1", "page t1 2"]);

    const second = fakeReview(works);
    const budget = new Budget(0.05);
    const deps2 = { client: second.client, cache, now: NOW + 1000, budget };
    const plan = await planReview(one, OPTS, deps2);
    expect(plan.estimate.requests).toBe(0);
    const res = await runReview(one, plan, OPTS, deps2);
    expect(second.log).toEqual([]);
    expect(budget.spent).toBe(0);
    expect(res.topics[0].fromCache).toBe(true);
    expect(res.total).toBe(150);

    const third = fakeReview(works);
    const deps3 = { client: third.client, cache, now: NOW + 1000, budget: new Budget(0.05) };
    const refreshed = await planReview(one, { ...OPTS, refresh: true }, deps3);
    expect(third.log).toEqual(["count t1"]);
    expect(refreshed.estimate.requests).toBe(2);
    const later = fakeReview(works);
    await planReview(one, OPTS, { client: later.client, cache, now: NOW + CACHE_TTL_MS + 1, budget: new Budget(0.05) });
    expect(later.log).toEqual(["count t1"]);
  });
});

// ---- flags and the Zotero index ---------------------------------------------------------------------------------------

const row = (key: string, doi: string, title: string, over: Partial<LibraryItemRow> = {}): LibraryItemRow => ({ key, doi, title, collections: [], trashed: false, note: false, ...over });
const coll = (key: string, name: string, parent: string | null = null, trashed = false): IndexedCollection => ({ key, name, parent, trashed });

describe("the Zotero index", () => {
  it("takes a DOI from the field or from a line in Extra, in any form", () => {
    expect(doiOfItem({ DOI: " https://doi.org/10.1000/ABC " })).toBe("10.1000/abc");
    expect(doiOfItem({ extra: "OpenAlex: W1\nDOI: 10.1000/Thesis.1" })).toBe("10.1000/thesis.1");
    expect(doiOfItem({})).toBe("");
  });

  it("merges a refresh: adds and replaces, removes deleted and emptied items, keeps the highest library version", () => {
    let index = mergeIndex(emptyIndex(), [row("AAAAAAAA", "10.1/a", "Paper A"), row("BBBBBBBB", "", "Paper B")], [], 10, []);
    expect(index.libraryVersion).toBe(10);
    index = mergeIndex(index, [row("AAAAAAAA", "10.1/a", "Paper A renamed"), row("CCCCCCCC", "10.1/c", "C")], ["BBBBBBBB"], 12, []);
    expect(Object.keys(index.items).sort()).toEqual(["AAAAAAAA", "CCCCCCCC"]);
    expect(index.items.AAAAAAAA.title).toBe("Paper A renamed");
    index = mergeIndex(index, [row("CCCCCCCC", "", "")], [], 5, []);
    expect(index.items.CCCCCCCC).toBeUndefined();
    expect(index.libraryVersion).toBe(12);
  });

  it("finds an item by DOI first and then by title, and reads a damaged file without throwing", () => {
    const index = mergeIndex(emptyIndex(), [row("AAAAAAAA", "10.1/a", "Alpha Beta"), row("BBBBBBBB", "", "Gamma: Delta")], [], 3, []);
    const lookup = buildLookup(index);
    expect(findInZotero(lookup, "https://doi.org/10.1/A", "other title")).toBe("AAAAAAAA");
    expect(findInZotero(lookup, null, "gamma delta")).toBe("BBBBBBBB");
    expect(findInZotero(lookup, "10.9/none", "Unknown")).toBeNull();
    expect(normaliseIndex(JSON.parse(JSON.stringify(index)))).toEqual(index);
    const odd = normaliseIndex({ libraryVersion: "x", items: { AAAAAAAA: { doi: "d", title: "t" }, short: { doi: "", title: "" }, BBBBBBBB: { doi: 1 } } });
    expect(Object.keys(odd.items)).toEqual(["AAAAAAAA"]);
    expect(odd.libraryVersion).toBe(0);
    for (const x of [null, 3, []]) expect(normaliseIndex(x)).toEqual(emptyIndex());
  });

  it("keeps collections with the items, removes trashed items, and brings a restored one back", () => {
    const cols = [coll("COLLAAAA", "Inbox"), coll("COLLBBBB", "seeds", "COLLAAAA")];
    let index = mergeIndex(emptyIndex(), [row("AAAAAAAA", "10.1/a", "A", { collections: ["COLLBBBB"] }), row("BBBBBBBB", "10.1/b", "B", { collections: ["COLLAAAA"] })], [], 10, cols);
    expect(index.items.AAAAAAAA.collections).toEqual(["COLLBBBB"]);
    expect(index.collections).toEqual(cols);
    index = mergeIndex(index, [row("AAAAAAAA", "10.1/a", "A", { collections: ["COLLBBBB"], trashed: true })], [], 11, cols);
    expect(Object.keys(index.items)).toEqual(["BBBBBBBB"]);
    index = mergeIndex(index, [row("AAAAAAAA", "10.1/a", "A", { collections: ["COLLBBBB"] })], [], 12, cols);
    expect(Object.keys(index.items).sort()).toEqual(["AAAAAAAA", "BBBBBBBB"]);
  });

  it("drops collection keys that are not in the collection list any more, in items that were not fetched too", () => {
    const both = [coll("COLLAAAA", "Inbox"), coll("COLLBBBB", "seeds", "COLLAAAA")];
    let index = mergeIndex(emptyIndex(), [row("AAAAAAAA", "10.1/a", "A", { collections: ["COLLAAAA", "COLLBBBB", "COLLGONE"] })], [], 10, both);
    expect(index.items.AAAAAAAA.collections).toEqual(["COLLAAAA", "COLLBBBB"]);
    index = mergeIndex(index, [], [], 11, [coll("COLLAAAA", "Inbox")]);
    expect(index.items.AAAAAAAA.collections).toEqual(["COLLAAAA"]);
    index = mergeIndex(index, [], [], 12, [coll("COLLAAAA", "Inbox", null, true)]);
    expect(index.items.AAAAAAAA.collections).toEqual(["COLLAAAA"]);
  });

  it("keeps a loose note only when it is in a collection, and never a child note", () => {
    const cols = [coll("COLLAAAA", "seeds")];
    const index = mergeIndex(emptyIndex(), [row("NOTEAAAA", "", "", { note: true, collections: ["COLLAAAA"] }), row("NOTEBBBB", "", "", { note: true })], [], 3, cols);
    expect(index.items).toEqual({ NOTEAAAA: { doi: "", title: "", collections: ["COLLAAAA"], note: true } });
  });

  it("reads a format 1 file with its items but as never refreshed, and the next refresh replaces them", () => {
    const old = normaliseIndex({ version: 1, libraryVersion: 40, items: { AAAAAAAA: { doi: "10.1/a", title: "A" }, GONEGONE: { doi: "10.1/g", title: "Deleted since" } } });
    expect(old.version).toBe(2);
    expect(old.libraryVersion).toBe(0);
    expect(old.items.AAAAAAAA).toEqual({ doi: "10.1/a", title: "A", collections: [] });
    expect(buildLookup(old).byDoi.get("10.1/a")).toBe("AAAAAAAA");
    const next = mergeIndex(old, [row("AAAAAAAA", "10.1/a", "A", { collections: ["COLLAAAA"] })], [], 50, [coll("COLLAAAA", "Inbox")]);
    expect(Object.keys(next.items)).toEqual(["AAAAAAAA"]);
    expect(next.libraryVersion).toBe(50);
  });

  it("reads a format 2 file back unchanged and ignores damaged collections and lists", () => {
    const index = mergeIndex(emptyIndex(), [row("AAAAAAAA", "10.1/a", "A", { collections: ["COLLAAAA"] })], [], 7, [coll("COLLAAAA", "Inbox"), coll("COLLBBBB", "seeds", "COLLAAAA", true)]);
    expect(normaliseIndex(JSON.parse(JSON.stringify(index)))).toEqual(index);
    const odd = normaliseIndex({ version: 2, libraryVersion: 3, collections: [null, { key: "x", name: "short key" }, { key: "COLLAAAA", name: 5 }, { key: "COLLBBBB", name: "ok", parent: "" }], items: { AAAAAAAA: { doi: "d", title: "t", collections: ["COLLBBBB", 4] } } });
    expect(odd.collections).toEqual([coll("COLLBBBB", "ok")]);
    expect(odd.items.AAAAAAAA.collections).toEqual(["COLLBBBB"]);
  });
});

describe("ZoteroClient library calls", () => {
  function zotero(answers: HttpResponse[]) {
    const calls: HttpRequest[] = [];
    const client = new ZoteroClient({
      request: async (req) => { calls.push(req); const a = answers.shift(); if (!a) throw new Error("out of answers"); return a; },
      userId: "123456", apiKey: "test-key-not-real", sleep: noSleep,
    });
    return { client, calls };
  }
  const row = (n: number) => ({ key: `ITEM${String(n).padStart(4, "0")}`, data: { title: `T${n}`, DOI: `10.1/${n}`, itemType: "journalArticle" } });

  it("pages through the items, reads the library version, and skips rows without data", async () => {
    const page1 = Array.from({ length: 100 }, (_, i) => row(i));
    const { client, calls } = zotero([
      { status: 200, json: page1, headers: { "last-modified-version": "40" } },
      { status: 200, json: [row(100), { key: "NODATA00" }], headers: { "last-modified-version": "41" } },
    ]);
    const got = await client.listLibraryItems();
    expect(got.items).toHaveLength(101);
    expect(got.libraryVersion).toBe(41);
    expect(calls[0].url).toContain("itemType=-attachment");
    expect(calls[0].url).toContain("includeTrashed=1");
    expect(calls[0].url).not.toContain("since=");
    expect(calls[1].url).toContain("start=100");
    const second = zotero([{ status: 200, json: [], headers: { "last-modified-version": "41" } }]);
    await second.client.listLibraryItems(41);
    expect(second.calls[0].url).toContain("since=41");
  });

  it("lists the keys deleted since a version, and nothing for version 0", async () => {
    const { client, calls } = zotero([{ status: 200, json: { items: ["AAAAAAAA", 5, "BBBBBBBB"], collections: [] }, headers: {} }]);
    expect(await client.listDeleted(41)).toEqual(["AAAAAAAA", "BBBBBBBB"]);
    expect(calls[0].url).toContain("/deleted?since=41");
    expect(await client.listDeleted(0)).toEqual([]);
    expect(calls).toHaveLength(1);
  });
});

describe("flags", () => {
  const index = mergeIndex(emptyIndex(), [row("AAAAAAAA", "10.1000/p.1", "Polymer paper 1")], [], 1, []);
  const literature = buildLiteratureIndex([{ path: "Lit/note.md", frontmatter: { title: "Polymer paper 2", DOI: "10.1000/p.2" } }]);
  const ledger = emptyLedger();
  ledger.papers["a/W3"] = { title: "x", tier: "strong", start: "2026-10-05", topics: [], terms: [], def: 0 };

  it("flags what is in Zotero, in the vault and listed before, from the three sources", () => {
    const sources = { zotero: buildLookup(index), literature, ledger, seen: ["b/W3", "a/W4"] };
    expect(flagsFor({ id: "W1", doi: "https://doi.org/10.1000/p.1", title: "Polymer paper 1" }, sources)).toEqual({ zotero: "AAAAAAAA", vault: null, listedBefore: [] });
    expect(flagsFor({ id: "W2", doi: "10.1000/p.2", title: "Polymer paper 2" }, sources)).toEqual({ zotero: null, vault: "Lit/note.md", listedBefore: [] });
    expect(flagsFor({ id: "W3", doi: null, title: "Never seen title" }, sources)).toEqual({ zotero: null, vault: null, listedBefore: ["a", "b"] });
  });

  it("leaves a flag unset when its source is missing, and counts the flags", () => {
    const none = { zotero: null, literature: null, ledger: null, seen: [] };
    expect(flagsFor({ id: "W1", doi: "10.1000/p.1", title: "Polymer paper 1" }, none)).toEqual({ zotero: null, vault: null, listedBefore: [] });
    expect(countFlags([{ zotero: "K", vault: null, listedBefore: [] }, { zotero: null, vault: "p", listedBefore: ["a"] }, { zotero: "K", vault: "p", listedBefore: [] }])).toEqual({ zotero: 2, vault: 2, listedBefore: 1 });
  });
});

// ---- the prompt and its answer ----------------------------------------------------------------------------------------

describe("the literature review prompt", () => {
  const papers = [
    { id: "W1", title: "Flow polymers", authors: ["A", "B", "C", "D"], venue: "J Poly", year: 2025, publicationDate: "2025-01-01", doi: "10.1/1", abstract: "x".repeat(900), isPreprint: false, citedByCount: 12, referencedWorks: [], finds: [{ feedId: "a", tier: "priority" as const, matched: ["flow", "polymer"], topics: [1] }], tier: "priority" as const },
    { id: "W2", title: "Old polymer", authors: [], venue: null, year: null, publicationDate: null, doi: null, abstract: null, isPreprint: true, citedByCount: 0, referencedWorks: [], finds: [{ feedId: "a", tier: "possible" as const, matched: [], topics: [1] }, { feedId: "b", tier: "possible" as const, matched: [], topics: [1] }], tier: "possible" as const },
  ];
  const flags = [{ zotero: "AAAAAAAA", vault: null, listedBefore: ["a"] }, { zotero: null, vault: null, listedBefore: [] }];
  const names = new Map([["a", "Search A"], ["b", "Search B"]]);
  const input = { feeds: [feed("a", ["t1"]), feed("b", ["t2"])], papers, flags, total: 40, names };

  it("numbers the papers, carries the flags and what found each, and cuts long abstracts", () => {
    const text = buildLitReviewPrompt(input);
    expect(text).toContain("P1 | 2025 | J Poly | 12 citations | rank priority | found by Search A");
    expect(text).toContain("Flow polymers (A, B, C et al.)");
    expect(text).toContain("Old polymer [preprint]");
    expect(text).toContain("P2 | year unknown | venue unknown | 0 citations | rank possible | found by Search A, Search B");
    expect(text).toContain("Note: already in my Zotero library; listed before by Search A");
    expect(text).toContain("Matched terms: flow, polymer");
    expect(text).toContain("Abstract: (none returned)");
    expect(text).toContain(`Abstract: ${"x".repeat(599)}…`);
    expect(text).toContain("THE PAPERS (2 of the 40 that matched; the rest are left out; best match first)");
    expect(text).toContain("Search name: Feed a");
    expect(text).toContain("Answer with JSON only");
  });

  it("can leave the abstracts out, and prints the network text when there is some", () => {
    const text = buildLitReviewPrompt({ ...input, total: 2, networkText: "Hubs: P1", options: { includeAbstracts: false, abstractChars: 600 } });
    expect(text).not.toContain("Abstract:");
    expect(text).toContain("THE PAPERS (2; best match first)");
    expect(text).toContain("HOW THEY CITE EACH OTHER\nHubs: P1");
    expect(buildLitReviewPrompt(input)).not.toContain("HOW THEY CITE EACH OTHER");
  });

  it("prints an example that passes its own validator", () => {
    const text = buildLitReviewPrompt(input);
    const block = /```json\n([\s\S]*?)\n```/.exec(text)?.[1] ?? "";
    expect(JSON.parse(block)).toEqual(LIT_REVIEW_EXAMPLE);
    const labels = new Set(["P1", "P2", "P3", "P4"]);
    const checked = checkLitReviewAnswer(LIT_REVIEW_EXAMPLE, labels);
    expect(checked.ok).toBe(true);
    if (checked.ok) {
      expect(checked.warnings).toEqual([]);
      expect(checked.value.priorities.map((p) => p.level)).toEqual(["must", "should", "skim", "skip"]);
      expect(checked.value.searchSuggestions).toHaveLength(2);
    }
  });

  it("labels papers P1, P2, … and cuts abstracts at a word boundary with an ellipsis", () => {
    expect([0, 1, 9].map(paperLabel)).toEqual(["P1", "P2", "P10"]);
    expect(cutAbstract(null, 10)).toBe("");
    expect(cutAbstract("  a   b  c ", 100)).toBe("a b c");
    expect(cutAbstract("abcdefghij", 5)).toBe("abcd…");
  });
});

describe("checkLitReviewAnswer", () => {
  const labels = new Set(["P1", "P2", "P3"]);

  it("keeps good entries, leaves out unknown labels and bad levels, and reports each", () => {
    const r = checkLitReviewAnswer({
      themes: [{ name: "T", summary: "s", papers: ["P1", "P9"] }, { summary: "no name" }],
      priorities: [{ paper: "P1", level: "must", reason: "r" }, { paper: "P9", level: "must" }, { paper: "P2", level: "maybe" }, { paper: "P1", level: "skip" }, { paper: "P3", level: "skim" }],
      gaps: ["g", 3],
      search_suggestions: ["s"],
    }, labels);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.themes).toEqual([{ name: "T", summary: "s", papers: ["P1"] }]);
      expect(r.value.priorities.map((p) => [p.paper, p.level])).toEqual([["P1", "must"], ["P3", "skim"]]);
      expect(r.value.gaps).toEqual(["g"]);
      expect(r.warnings.join("\n")).toContain("unknown paper label P9");
      expect(r.warnings.join("\n")).toContain('Priority 3: needs "paper"');
      expect(r.warnings.length).toBe(4);
    }
  });

  it("fails with the reasons when nothing is usable or the shape is wrong", () => {
    for (const bad of [null, [], "x", 3]) expect(checkLitReviewAnswer(bad, labels).ok).toBe(false);
    const r = checkLitReviewAnswer({ themes: "no", priorities: [{ paper: "P9", level: "must" }] }, labels);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.length).toBeGreaterThan(1);
  });
});

describe("the order of papers of one rank", () => {
  const paper = (id: string, over: Partial<ReviewPaper>): ReviewPaper => ({
    id, title: `Paper ${id}`, authors: [], venue: null, year: 2020, publicationDate: null, doi: null, abstract: null, isPreprint: false, citedByCount: 0, referencedWorks: [],
    tier: "strong", finds: [{ feedId: "a", tier: "strong", matched: ["x"], topics: [1] }], ...over,
  });
  const oldCited = paper("old", { year: 2015, citedByCount: 900 });
  const newFit = paper("new", { year: 2025, citedByCount: 3, finds: [{ feedId: "a", tier: "strong", matched: ["x", "y", "z"], topics: [1, 2, 3] }, { feedId: "b", tier: "strong", matched: ["x"], topics: [2] }] });
  const priority = paper("pri", { tier: "priority", citedByCount: 0 });

  it("puts a recent paper that fits many topics above an old, often-cited one that fits one", () => {
    expect(orderPapers([oldCited, newFit]).map((p) => p.id)).toEqual(["new", "old"]);
    expect(fitScore(newFit)).toBeGreaterThan(fitScore(oldCited));
  });

  it("still puts rank first, and offers the old orders", () => {
    expect(orderPapers([oldCited, newFit, priority]).map((p) => p.id)).toEqual(["pri", "new", "old"]);
    expect(orderPapers([newFit, oldCited], "cited").map((p) => p.id)).toEqual(["old", "new"]);
    expect(orderPapers([oldCited, newFit], "newest").map((p) => p.id)).toEqual(["new", "old"]);
  });
});
