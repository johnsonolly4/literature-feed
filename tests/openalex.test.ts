import { describe, expect, it } from "vitest";
import {
  OpenAlexClient, OpenAlexError, buildSearchUrl, rebuildAbstract, toCandidate,
  type RequestOptions, type Requester,
} from "../src/openalex/client";
import { journalWork, page, preprintWork, sparseWork, untitledWork } from "./fixtures/openalex-responses";

/** A requester that answers from a queue and remembers what it was asked. */
function fakeRequester(answers: { status: number; json: unknown }[]) {
  const calls: RequestOptions[] = [];
  const request: Requester = async (req) => {
    calls.push(req);
    const answer = answers.shift();
    if (!answer) throw new Error("fake requester ran out of answers");
    return answer;
  };
  return { request, calls };
}

const noSleep = async (): Promise<void> => { /* tests do not wait */ };

describe("buildSearchUrl", () => {
  const topic = '("lipoic acid" OR lipoate) AND copolymer';

  it("puts the topic in search.title_and_abstract, URL-encoded", () => {
    const url = new URL(buildSearchUrl(topic, { fromDate: "2026-09-01", page: 2, perPage: 50 }));
    expect(url.origin + url.pathname).toBe("https://api.openalex.org/works");
    expect(url.searchParams.get("search.title_and_abstract")).toBe(topic);
    expect(url.searchParams.get("filter")).toBe("from_publication_date:2026-09-01");
    expect(url.searchParams.get("per_page")).toBe("50");
    expect(url.searchParams.get("page")).toBe("2");
    expect(url.searchParams.get("select")).toContain("abstract_inverted_index");
  });

  it("leaves out the filter when there is no date", () => {
    const url = new URL(buildSearchUrl(topic));
    expect(url.searchParams.has("filter")).toBe(false);
    expect(url.searchParams.get("per_page")).toBe("100");
  });

  it("can use the filter form of the query", () => {
    const url = new URL(buildSearchUrl(topic, { fromDate: "2026-09-01", form: "filter" }));
    expect(url.searchParams.has("search.title_and_abstract")).toBe(false);
    expect(url.searchParams.get("filter")).toBe(`from_publication_date:2026-09-01,title_and_abstract.search:${topic}`);
  });

  it("keeps a comma in a topic from splitting the filter", () => {
    const url = new URL(buildSearchUrl("a, b", { form: "filter" }));
    expect(url.searchParams.get("filter")).toBe("title_and_abstract.search:a  b");
  });
});

describe("rebuildAbstract", () => {
  it("puts words back in position order, repeated words included", () => {
    expect(rebuildAbstract(journalWork.abstract_inverted_index)).toBe("Lipoic acid copolymers are reported copolymers");
  });

  it("returns null for a missing or empty index", () => {
    expect(rebuildAbstract(null)).toBeNull();
    expect(rebuildAbstract(undefined)).toBeNull();
    expect(rebuildAbstract({})).toBeNull();
  });
});

describe("toCandidate", () => {
  it("maps a journal article", () => {
    expect(toCandidate(journalWork)).toEqual({
      title: "Radical copolymerisation of lipoic acid with acrylamides",
      abstract: "Lipoic acid copolymers are reported copolymers",
      doi: "https://doi.org/10.1000/example.1",
      year: 2026,
      isPreprint: false,
      openalexId: "https://openalex.org/W1000000001",
      authors: ["A. Author", "B. Writer"],
      venue: "Example Polymer Journal",
      publicationDate: "2026-09-30",
    });
  });

  it("marks a preprint (by type and by repository source)", () => {
    expect(toCandidate(preprintWork)?.isPreprint).toBe(true);
    expect(toCandidate({ ...journalWork, type: "article", primary_location: { source: { type: "repository" } } })?.isPreprint).toBe(true);
  });

  it("copes with missing fields", () => {
    expect(toCandidate(sparseWork)).toMatchObject({
      abstract: null, doi: null, authors: [], venue: null, publicationDate: null, isPreprint: false,
    });
  });

  it("returns null for a work without a title", () => {
    expect(toCandidate(untitledWork)).toBeNull();
    expect(toCandidate({ ...journalWork, title: "   " })).toBeNull();
  });
});

describe("OpenAlexClient.searchTopic", () => {
  it("pages until it has everything, sums cost and skips untitled works", async () => {
    const { request, calls } = fakeRequester([
      { status: 200, json: page([journalWork, untitledWork], 3, 0.0002) },
      { status: 200, json: page([sparseWork], 3, 0.0001) },
    ]);
    const client = new OpenAlexClient({ request, sleep: noSleep });
    const result = await client.searchTopic("lipoic", { perPage: 2, fromDate: "2026-09-01" });

    expect(calls).toHaveLength(2);
    expect(new URL(calls[0].url).searchParams.get("page")).toBe("1");
    expect(new URL(calls[1].url).searchParams.get("page")).toBe("2");
    expect(result.count).toBe(3);
    expect(result.papers.map((p) => p.openalexId)).toEqual([journalWork.id, sparseWork.id]);
    expect(result.costUsd).toBeCloseTo(0.0003, 10);
    expect(result.truncated).toBe(false);
  });

  it("stops on an empty page even if the count says more", async () => {
    const { request, calls } = fakeRequester([{ status: 200, json: page([], 5) }]);
    const result = await new OpenAlexClient({ request, sleep: noSleep }).searchTopic("x");
    expect(calls).toHaveLength(1);
    expect(result.papers).toEqual([]);
    expect(result.costUsd).toBe(0);
  });

  it("stops at the paging cap and says so", async () => {
    const answers = Array.from({ length: 100 }, () => ({ status: 200, json: page([journalWork], 20_000) }));
    const { request, calls } = fakeRequester(answers);
    const result = await new OpenAlexClient({ request, sleep: noSleep }).searchTopic("x", { perPage: 100 });
    expect(calls).toHaveLength(100);
    expect(result.truncated).toBe(true);
  });

  it("reports progress after each page", async () => {
    const { request } = fakeRequester([
      { status: 200, json: page([journalWork, preprintWork], 3) },
      { status: 200, json: page([sparseWork], 3) },
    ]);
    const seen: [number, number][] = [];
    await new OpenAlexClient({ request, sleep: noSleep }).searchTopic("x", { perPage: 2, onPage: (f, t) => seen.push([f, t]) });
    expect(seen).toEqual([[2, 3], [3, 3]]);
  });
});

describe("OpenAlexClient requests", () => {
  it("sends the key as a Bearer header and never in the URL", async () => {
    const { request, calls } = fakeRequester([{ status: 200, json: page([], 0) }]);
    await new OpenAlexClient({ request, sleep: noSleep, apiKey: "secret-key-123" }).searchTopic("x");
    expect(calls[0].headers?.Authorization).toBe("Bearer secret-key-123");
    expect(calls[0].url).not.toContain("secret-key-123");
    expect(calls[0].url).not.toContain("api_key");
  });

  it("sends no Authorization header without a key", async () => {
    const { request, calls } = fakeRequester([{ status: 200, json: page([], 0) }]);
    await new OpenAlexClient({ request, sleep: noSleep }).searchTopic("x");
    expect(calls[0].headers).not.toHaveProperty("Authorization");
  });

  it("backs off on 429 and then succeeds", async () => {
    const { request, calls } = fakeRequester([
      { status: 429, json: null },
      { status: 429, json: null },
      { status: 200, json: page([journalWork], 1, 0.0001) },
    ]);
    const waits: number[] = [];
    const client = new OpenAlexClient({ request, sleep: async (ms) => { waits.push(ms); }, backoffMs: 500 });
    const result = await client.searchTopic("x");
    expect(calls).toHaveLength(3);
    expect(waits).toEqual([500, 1000]);
    expect(result.papers).toHaveLength(1);
  });

  it("gives up after maxTries on 429 with a clear message", async () => {
    const { request, calls } = fakeRequester(Array.from({ length: 3 }, () => ({ status: 429, json: null })));
    const client = new OpenAlexClient({ request, sleep: noSleep, maxTries: 3, apiKey: "secret-key-123" });
    const error = await client.searchTopic("x").catch((e: unknown) => e);
    expect(calls).toHaveLength(3);
    expect(error).toBeInstanceOf(OpenAlexError);
    expect((error as OpenAlexError).status).toBe(429);
    expect((error as OpenAlexError).message).toContain("429");
    expect((error as OpenAlexError).message).not.toContain("secret-key-123");
  });

  it("says the key was refused on 401 and 403, without retrying", async () => {
    for (const status of [401, 403]) {
      const { request, calls } = fakeRequester([{ status, json: { error: "nope" } }]);
      const error = await new OpenAlexClient({ request, sleep: noSleep, apiKey: "secret-key-123" }).searchTopic("x").catch((e: unknown) => e);
      expect(calls).toHaveLength(1);
      expect((error as OpenAlexError).message).toContain(`HTTP ${status}`);
      expect((error as OpenAlexError).message).toContain("API key");
    }
  });

  it("names the status on other failures and on a body that is not JSON", async () => {
    const a = fakeRequester([{ status: 500, json: null }]);
    await expect(new OpenAlexClient({ request: a.request, sleep: noSleep }).searchTopic("x")).rejects.toThrow("HTTP 500");
    const b = fakeRequester([{ status: 200, json: null }]);
    await expect(new OpenAlexClient({ request: b.request, sleep: noSleep }).searchTopic("x")).rejects.toThrow("not JSON");
  });
});

describe("OpenAlexClient.scan", () => {
  it("reports count and cost per topic and merges papers found by several topics", async () => {
    const { request } = fakeRequester([
      { status: 200, json: page([journalWork], 1, 0.0002) },
      { status: 200, json: page([preprintWork, sparseWork], 2, 0.0003) },
    ]);
    const scan = await new OpenAlexClient({ request, sleep: noSleep }).scan(["topic one", "topic two"]);
    expect(scan.perTopic.map((t) => [t.topic, t.count, t.costUsd])).toEqual([
      ["topic one", 1, 0.0002],
      ["topic two", 2, 0.0003],
    ]);
    expect(scan.costUsd).toBeCloseTo(0.0005, 10);
    // The preprint and the journal article share a title: one paper, the journal version.
    expect(scan.papers.map((p) => p.openalexId)).toEqual([journalWork.id, sparseWork.id]);
  });
});
