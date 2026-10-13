// Phase B of the literature review: the citation network, missing papers, citation gaps of one paper, the charts' numbers and specs,
// the canvas, the network text and the note's extra tables. Nothing calls the network.
import { describe, expect, it } from "vitest";
import type { Candidate } from "../src/openalex/client";
import { Budget } from "../src/review/budget";
import { buildCanvas } from "../src/review/canvas";
import { CHART_BLOCK, chartBlock, chartSpecs, parseChartSpec } from "../src/review/chart";
import { emptyCache, getWork } from "../src/review/cache";
import type { ReviewPaper } from "../src/review/collect";
import { alsoCites, buildNetwork, chartData, citationGaps, referenceCoverage } from "../src/review/network";
import { CITING_PAGES, MAX_GAP_REFERENCES, SEED_BATCH, estimateGapRequests, estimateNetworkRequests, fetchCitationGaps, fetchNetworkExtras, type NetworkClient } from "../src/review/network-fetch";
import { buildExtraRows, networkMarkdown, networkText } from "../src/review/network-text";
import { renderReviewNote } from "../src/review/note";
import { paperLabel } from "../src/review/prompt";

function paper(id: number, refs: number[] = [], overrides: Partial<ReviewPaper> = {}): ReviewPaper {
  return {
    id: `W${id}`, title: `Paper ${id}`, authors: ["A. Author"], venue: "J", year: 2020 + (id % 5), publicationDate: null, doi: `10.1000/${id}`, abstract: null,
    isPreprint: false, citedByCount: id, referencedWorks: refs.map((r) => `W${r}`), finds: [{ feedId: "a", tier: "strong", matched: [], topics: [1] }], tier: "strong", ...overrides,
  };
}

function cand(id: number, refs: number[] = [], overrides: Partial<Candidate> = {}): Candidate {
  return { title: `Work ${id}`, abstract: null, doi: null, year: 2021, openalexId: `https://openalex.org/W${id}`, authors: [], venue: null, publicationDate: null, citedByCount: id, referencedWorks: refs.map((r) => `W${r}`), ...overrides };
}

const noFlags = { zotero: null, vault: null, listedBefore: [] as string[] };

describe("buildNetwork", () => {
  // 1 cites 2 and 3; 2 cites 3; 4 cites 3 and 99; 5 cites 99; 6 stands alone. Outside the set: 99 (cited by 4, 5 and 7), 98 (by 1 only).
  const papers = [paper(1, [2, 3, 98]), paper(2, [3]), paper(3), paper(4, [3, 99]), paper(5, [99]), paper(6), paper(7, [99])];

  it("finds the citations inside the set, degrees, hubs and isolated papers", () => {
    const net = buildNetwork(papers);
    expect(net.edges).toEqual([{ from: "W1", to: "W2" }, { from: "W1", to: "W3" }, { from: "W2", to: "W3" }, { from: "W4", to: "W3" }]);
    expect(net.degree.get("W3")).toEqual({ in: 3, out: 0 });
    expect(net.degree.get("W1")).toEqual({ in: 0, out: 3 === 3 ? 2 : 0 });
    expect(net.hubs).toEqual(["W3", "W2"]);
    expect(net.isolated.sort()).toEqual(["W5", "W6", "W7"]);
  });

  it("groups papers that cite each other, biggest first", () => {
    const net = buildNetwork(papers);
    expect(net.clusters).toEqual([["W1", "W2", "W3", "W4"]]);
  });

  it("counts works the set cites that are not in it, with a threshold", () => {
    const net = buildNetwork(papers);
    expect(net.missing).toEqual([{ id: "W99", count: 3, citers: ["W4", "W5", "W7"] }]);
    expect(buildNetwork(papers, { minMissing: 1, topMissing: 5, topHubs: 10 }).missing.map((m) => m.id)).toEqual(["W99", "W98"]);
    expect(buildNetwork(papers, { minMissing: 1, topMissing: 1, topHubs: 10 }).missing).toHaveLength(1);
  });

  it("ignores a paper citing itself and repeated references, and copes with an empty set", () => {
    const net = buildNetwork([paper(1, [1, 2, 2]), paper(2)]);
    expect(net.edges).toEqual([{ from: "W1", to: "W2" }]);
    const empty = buildNetwork([]);
    expect(empty).toMatchObject({ edges: [], hubs: [], clusters: [], isolated: [], missing: [] });
  });

  it("splits one big connected piece into groups by label propagation, deterministically", () => {
    // Two dense groups (1-5 and 6-10) joined by a single citation.
    const dense = (ids: number[]) => ids.map((id) => paper(id, ids.filter((x) => x !== id)));
    const ps = [...dense([1, 2, 3, 4, 5]), ...dense([6, 7, 8, 9, 10]).map((p) => (p.id === "W6" ? { ...p, referencedWorks: [...p.referencedWorks, "W1"] } : p))];
    const a = buildNetwork(ps);
    const b = buildNetwork([...ps].reverse());
    expect(a.clusters).toEqual(b.clusters);
    expect(a.clusters).toHaveLength(2);
    expect(a.clusters.map((c) => c.length)).toEqual([5, 5]);
  });
});

describe("alsoCites", () => {
  it("keeps works outside the set that cite enough of its papers, most first", () => {
    const set = new Set(["W1", "W2", "W3", "W4"]);
    const citing = [
      { id: "W50", referencedWorks: ["W1", "W2", "W3", "W9"] }, { id: "W51", referencedWorks: ["W1", "W2"] }, { id: "W52", referencedWorks: ["W1", "W2", "W3", "W4"] },
      { id: "W1", referencedWorks: ["W2", "W3", "W4"] },
    ];
    expect(alsoCites(citing, set)).toEqual([{ id: "W52", count: 4, cites: ["W1", "W2", "W3", "W4"] }, { id: "W50", count: 3, cites: ["W1", "W2", "W3"] }]);
    expect(alsoCites(citing, set, 2, 1)).toHaveLength(1);
  });
});

describe("citationGaps", () => {
  it("finds what many of a paper's references cite but the paper does not", () => {
    const target = { id: "W1", referencedWorks: ["W10", "W11", "W12", "W13"] };
    const refs = [
      { id: "W10", referencedWorks: ["W50", "W51", "W11"] }, { id: "W11", referencedWorks: ["W50", "W51", "W1"] }, { id: "W12", referencedWorks: ["W50", "W52"] },
      { id: "W13", referencedWorks: [] },
    ];
    const gaps = citationGaps(target, refs, 2);
    // W50 is cited by 3 of the 3 references with lists; W51 by 2; W11 is the paper's own reference; W1 is the paper itself.
    expect(gaps).toEqual([{ id: "W50", count: 3, share: 1 }, { id: "W51", count: 2, share: 2 / 3 }]);
    expect(citationGaps(target, refs, 3).map((g) => g.id)).toEqual(["W50"]);
    expect(citationGaps(target, [], 1)).toEqual([]);
  });
});

describe("chartData and chartSpecs", () => {
  const papers = [
    paper(1, [2], { year: 2019, authors: ["A", "B"], citedByCount: 50 }), paper(2, [], { year: 2021, authors: ["A"], citedByCount: 10 }), paper(3, [1, 2], { year: 2021, authors: ["C"], citedByCount: 0 }),
    paper(4, [], { year: null, authors: [], citedByCount: 5 }),
  ];
  const net = buildNetwork(papers);

  it("counts papers per year with the empty years in between, top authors (two papers or more), most cited and most networked", () => {
    const d = chartData(papers, net);
    expect(d.perYear).toEqual([{ year: 2019, count: 1 }, { year: 2020, count: 0 }, { year: 2021, count: 2 }]);
    expect(d.topAuthors).toEqual([{ name: "A", count: 2 }]);
    expect(d.mostCited).toEqual([{ id: "W1", value: 50 }, { id: "W2", value: 10 }, { id: "W4", value: 5 }]);
    expect(d.mostNetworked.map((x) => [x.id, x.value])).toEqual([["W1", 2], ["W2", 2], ["W3", 2]]);
    expect(chartData([], buildNetwork([]))).toEqual({ perYear: [], topAuthors: [], mostCited: [], mostNetworked: [] });
  });

  it("makes a spec for each chart that has data, shortens long titles, and round-trips through a code block", () => {
    const specs = chartSpecs(chartData(papers, net), paperLabel2, (id) => `A very long title for ${id} ${"x".repeat(80)}`);
    expect(specs.map((s) => s.title)).toEqual(["Papers per year", "Authors with the most papers", "Most cited (all citations)", "Most connected inside this set"]);
    expect(specs[2].items[0].label.length).toBeLessThanOrEqual(50);
    const block = chartBlock(specs[0]);
    expect(block[0]).toBe("```" + CHART_BLOCK);
    expect(parseChartSpec(block[1])).toEqual(specs[0]);
    expect(chartSpecs({ perYear: [], topAuthors: [], mostCited: [], mostNetworked: [] }, paperLabel2, () => "")).toEqual([]);
  });

  it("reads a chart block tolerantly", () => {
    expect(parseChartSpec("not json")).toBeNull();
    expect(parseChartSpec('{"title":"t","kind":"pie","items":[]}')).toBeNull();
    expect(parseChartSpec('{"title":"t","kind":"bars","items":[{"label":"a","value":2},{"label":3,"value":1},{"label":"b","value":-1},5]}')).toEqual({ title: "t", kind: "bars", unit: "", items: [{ label: "a", value: 2 }] });
  });
});

function paperLabel2(id: string): string {
  return `P${id.slice(1)}`;
}

// ---- fetching within the budget -----------------------------------------------------------------------------------------

function fakeNetwork(opts: { citing?: Candidate[]; works?: Candidate[]; failAfter?: number } = {}) {
  const log: string[] = [];
  let calls = 0;
  const client: NetworkClient = {
    async citingPage(ids, page) {
      log.push(`citing ${ids.length} ${page}`);
      if (opts.failAfter !== undefined && ++calls > opts.failAfter) throw new Error("HTTP 500");
      const all = opts.citing ?? [];
      const slice = all.slice((page - 1) * 100, page * 100);
      return { papers: slice, fetched: slice.length, count: all.length, costUsd: 0.001 };
    },
    async getWorks(ids) {
      log.push(`works ${ids.length}`);
      if (opts.failAfter !== undefined && ++calls > opts.failAfter) throw new Error("HTTP 500");
      const have = new Map((opts.works ?? []).map((w) => [/W\d+$/.exec(w.openalexId)?.[0] ?? "", w]));
      return { papers: ids.flatMap((id) => (have.has(id) ? [have.get(id) as Candidate] : [])), costUsd: 0.001 };
    },
  };
  return { client, log };
}

describe("fetchNetworkExtras", () => {
  const papers = [paper(1, [99, 98]), paper(2, [99]), paper(3, [99, 98]), paper(4)];
  const net = buildNetwork(papers);

  it("looks up what cites the set and the details of the missing and citing works, within the budget", async () => {
    const { client, log } = fakeNetwork({
      citing: [cand(60, [1, 2, 3]), cand(61, [1])],
      works: [cand(99, [], { title: "Foundational" }), cand(98, [], { title: "Second" }), cand(60, [1, 2, 3], { title: "Follow-up" })],
    });
    const deps = { client, cache: emptyCache(), now: 1000, budget: new Budget(0.05) };
    const extras = await fetchNetworkExtras(papers, net, deps);
    expect(extras.missing.map((m) => [m.paper.title, m.count])).toEqual([["Foundational", 3], ["Second", 2]]);
    expect(extras.alsoCite.map((a) => [a.paper.title, a.count])).toEqual([["Follow-up", 3]]);
    expect(extras.stopped).toBeNull();
    expect(log[0]).toBe("citing 4 1");
    expect(log).toContain("works 3");
    expect(getWork(deps.cache, "W99", 1001)?.title).toBe("Foundational");
  });

  it("uses the cache so a second run asks only for the citing works", async () => {
    const cache = emptyCache();
    const first = fakeNetwork({ citing: [], works: [cand(99), cand(98)] });
    await fetchNetworkExtras(papers, net, { client: first.client, cache, now: 1000, budget: new Budget(0.05) });
    const second = fakeNetwork({ citing: [], works: [cand(99), cand(98)] });
    const extras = await fetchNetworkExtras(papers, net, { client: second.client, cache, now: 2000, budget: new Budget(0.05) });
    expect(second.log).toEqual(["citing 4 1"]);
    expect(extras.missing).toHaveLength(2);
  });

  it("stops when the budget is used up, or a request fails, and says so", async () => {
    const tight = fakeNetwork({ citing: [cand(60, [1, 2, 3])], works: [cand(99)] });
    const budget = new Budget(0.001);
    budget.add(0.001);
    const a = await fetchNetworkExtras(papers, net, { client: tight.client, cache: emptyCache(), now: 1, budget });
    expect(a.stopped).toContain("stopped at $0.001");
    expect(tight.log).toEqual([]);
    const flaky = fakeNetwork({ citing: [], works: [cand(99)], failAfter: 1 });
    const b = await fetchNetworkExtras(papers, net, { client: flaky.client, cache: emptyCache(), now: 1, budget: new Budget(0.05) });
    expect(b.stopped).toContain("HTTP 500");
  });

  it("reads a second page of citing works only when the first was full", async () => {
    const many = Array.from({ length: 100 }, (_, i) => cand(200 + i, [1]));
    const { client, log } = fakeNetwork({ citing: [...many, cand(300, [1, 2, 3])] });
    await fetchNetworkExtras(papers, net, { client, cache: emptyCache(), now: 1, budget: new Budget(0.05) });
    expect(log.filter((l) => l.startsWith("citing"))).toEqual(["citing 4 1", "citing 4 2"]);
  });

  it("estimates the requests", () => {
    expect(estimateNetworkRequests(30, 25)).toBe(CITING_PAGES + 1);
    expect(estimateNetworkRequests(500, 120)).toBe(CITING_PAGES * Math.ceil(Math.min(500, SEED_BATCH) / SEED_BATCH) + 3);
    expect(estimateGapRequests(10)).toBe(2);
    expect(estimateGapRequests(500)).toBe(Math.ceil(MAX_GAP_REFERENCES / 50) + 1);
  });
});

describe("fetchCitationGaps", () => {
  it("reads the references of one paper and their reference lists, then the details of the gaps", async () => {
    const target = paper(1, [10, 11, 12]);
    const { client, log } = fakeNetwork({
      works: [cand(10, [50, 51]), cand(11, [50, 51, 1]), cand(12, [50]), cand(50, [], { title: "Gap fifty" }), cand(51, [], { title: "Gap fifty-one" })],
    });
    const out = await fetchCitationGaps(target, { client, cache: emptyCache(), now: 1, budget: new Budget(0.05) }, 2);
    expect(out.referencesRead).toBe(3);
    expect(out.referencesWithLists).toBe(3);
    expect(out.gaps.map((g) => [g.gap.id, g.gap.count, g.paper?.title])).toEqual([["W50", 3, "Gap fifty"], ["W51", 2, "Gap fifty-one"]]);
    expect(log).toEqual(["works 3", "works 2"]);
  });

  it("reads at most the first hundred references, and says when the budget stops it", async () => {
    const refs = Array.from({ length: 150 }, (_, i) => i + 10);
    const { client, log } = fakeNetwork({ works: [] });
    await fetchCitationGaps(paper(1, refs), { client, cache: emptyCache(), now: 1, budget: new Budget(0.05) });
    expect(log[0]).toBe("works 50");
    expect(log[1]).toBe("works 50");
    expect(log).toHaveLength(2);
    const budget = new Budget(0.001);
    budget.add(0.001);
    const out = await fetchCitationGaps(paper(1, [10]), { client: fakeNetwork().client, cache: emptyCache(), now: 1, budget });
    expect(out.stopped).toContain("stopped at");
  });
});

// ---- text, canvas and note --------------------------------------------------------------------------------------------

describe("network text, canvas and note", () => {
  const papers = [paper(1, [2, 99], { year: 2019 }), paper(2, [], { year: 2021 }), paper(3, [99], { year: 2021 })];
  const net = buildNetwork(papers, { minMissing: 2, topMissing: 20, topHubs: 10 });
  const label = (id: string): string | undefined => { const i = papers.findIndex((p) => p.id === id); return i >= 0 ? paperLabel(i) : undefined; };
  const extras = {
    missing: [{ paper: cand(99, [], { title: "Foundational", year: 2010, citedByCount: 900, doi: "10.1000/99" }), count: 2, citers: ["W1", "W3"] }],
    alsoCite: [{ paper: cand(60, [1, 2, 3], { title: "Follow-up", year: 2024 }), count: 3, cites: ["W1", "W2", "W3"] }],
    stopped: null,
  };
  const rows = buildExtraRows(extras, label, () => ({ zotero: "KEY00001", vault: null, listedBefore: [] }));

  it("labels the missing and citing works M1 and C1 and says how they relate", () => {
    expect(rows.missing[0]).toMatchObject({ label: "M1", detail: "cited by 2 of these papers (P1, P3)" });
    expect(rows.alsoCite[0]).toMatchObject({ label: "C1", detail: "cites 3 of these papers (P1, P2, P3)" });
  });

  it("prints the network for the prompt: hubs, groups, isolated, missing and citing works with what you have", () => {
    const text = networkText(papers, net, rows, label);
    expect(text).toContain("1 citations among these 3 papers. OpenAlex lists references for 2 of them; the other 1 may cite more");
    expect(text).toContain("- P2: cited by 1 of them");
    expect(text).toContain("Group 1 (2 papers): P1, P2");
    expect(text).toContain("1 papers neither cite nor are cited");
    expect(text).toContain("M1 | 2010 | 900 citations | Foundational | cited by 2 of these papers (P1, P3) | already in my Zotero");
    expect(text).toContain("C1 | 2024 | 60 citations | Follow-up | cites 3 of these papers (P1, P2, P3) | already in my Zotero");
    expect(text).toContain("Rate the M and C works");
    expect(networkText(papers, net, { missing: [], alsoCite: [] }, label)).not.toContain("Rate the M and C works");
  });

  it("builds a reading board: a group per citing group, a card per paper, and one line per paper", () => {
    const file = buildCanvas(papers, papers.map(() => noFlags), net, rows, (id) => label(id) ?? id);
    const groups = file.nodes.filter((n) => n.type === "group");
    const cards = file.nodes.filter((n) => n.type === "text");
    expect(groups.map((g) => g.label)).toEqual(["Group 1: cited together, led by P2", "No citation to or from another paper here", "Possibly missing: cited by several of these papers", "Cite several of these papers"]);
    expect(cards).toHaveLength(5);
    expect(new Set(file.nodes.map((n) => n.id)).size).toBe(file.nodes.length);
    expect(file.nodes.find((n) => n.id === "m-W99")?.color).toBe("2");
    expect(file.nodes.find((n) => n.id === "c-W60")?.color).toBe("6");
    expect(file.nodes.find((n) => n.id === "p-W1")?.color).toBeUndefined();
    // every card lies inside its group
    for (const c of cards) expect(groups.some((g) => c.x >= g.x && c.y >= g.y && c.x + c.width <= g.x + g.width && c.y + c.height <= g.y + g.height)).toBe(true);
    // W1 cites W2 (in the set) and W99 (not): one line, W1 to W2
    expect(file.edges).toHaveLength(1);
    expect([file.edges[0].fromNode, file.edges[0].toNode]).toEqual(["p-W1", "p-W2"]);
    const ids = new Set(file.nodes.map((n) => n.id));
    for (const e of file.edges) {
      expect(ids.has(e.fromNode)).toBe(true);
      expect(ids.has(e.toNode)).toBe(true);
    }
    expect(JSON.parse(JSON.stringify(file))).toEqual(file);
    expect(buildCanvas([], [], buildNetwork([]), { missing: [], alsoCite: [] }, (id) => id)).toEqual({ nodes: [], edges: [] });
  });

  it("groups the board by the LLM's themes and colours and explains each card with its advice", () => {
    const answer = { themes: [{ name: "Methods", papers: ["P1", "P3"] }], priorities: [{ paper: "P1", level: "must" as const, reason: "The foundation of the topic." }, { paper: "M1", level: "skim" as const, reason: "Background." }] };
    const file = buildCanvas(papers, papers.map(() => noFlags), net, rows, (id) => label(id) ?? id, answer);
    expect(file.nodes.filter((n) => n.type === "group").map((g) => g.label)).toEqual(["Methods", "Other", "Possibly missing: cited by several of these papers", "Cite several of these papers"]);
    const p1 = file.nodes.find((n) => n.id === "p-W1");
    expect(p1?.color).toBe("4");
    expect(p1?.text).toContain("**Must read.** The foundation of the topic.");
    expect(file.nodes.find((n) => n.id === "m-W99")?.color).toBe("3");
    expect(file.nodes.find((n) => n.id === "p-W2")?.color).toBeUndefined();
    const groups = file.nodes.filter((n) => n.type === "group");
    const methods = groups[0];
    const other = groups[1];
    expect(p1 && p1.x >= methods.x && p1.x < methods.x + methods.width).toBe(true);
    const p2 = file.nodes.find((n) => n.id === "p-W2");
    expect(p2 && p2.y >= other.y && p2.x >= other.x).toBe(true);
  });

  it("puts the network section in the note, and lets the answer's priorities name M and C works", () => {
    const md = networkMarkdown(net, rows, label, (id) => papers.find((p) => p.id === id)?.title ?? id).join("\n");
    expect(md).toContain("## Citation network");
    expect(md).toContain("### Possibly missing papers (cited by several of these)");
    expect(md).toContain("| M1 | [Foundational](https://doi.org/10.1000/99) |  | 2010 | 900 |");
    expect(md).toContain("[in Zotero](zotero://select/library/items/KEY00001)");
    const note = renderReviewNote({
      date: "2026-10-13", searches: ["A"], fromDate: "2020", papers, flags: papers.map(() => noFlags), total: 3, spentUsd: 0.012, stopped: null,
      answer: { themes: [], priorities: [{ paper: "P1", level: "must", reason: "close" }, { paper: "M1", level: "should", reason: "foundational" }], gaps: [], searchSuggestions: [] },
      networkMarkdown: md.split("\n"), extraRows: [...rows.missing, ...rows.alsoCite],
    });
    expect(note).toContain("| Should read | [Foundational](https://doi.org/10.1000/99) (M1) |  | 2010 | 900 |");
    expect(note).toContain("| Must read | Paper 1 |".replace("Paper 1", "[Paper 1](https://doi.org/10.1000/1)"));
    expect(note.indexOf("## Reading priorities")).toBeLessThan(note.indexOf("## Citation network"));
  });
});

describe("referenceCoverage and the price of lookups", () => {
  it("counts the papers that have a reference list", () => {
    expect(referenceCoverage([paper(1, [2]), paper(2, []), paper(3, [1, 2])])).toEqual({ withList: 2, total: 3 });
    expect(referenceCoverage([])).toEqual({ withList: 0, total: 0 });
  });

  it("charges lookups by id and by citation as filtered lists ($0.0001), so a small budget still pays for them", async () => {
    const papers = [paper(1, [99]), paper(2, [99])];
    const net = buildNetwork(papers);
    const { client } = fakeNetwork({ citing: [], works: [cand(99)] });
    const budget = new Budget(0.0005);
    const extras = await fetchNetworkExtras(papers, net, { client: { ...client, citingPage: async () => ({ papers: [], fetched: 0, count: 0, costUsd: 0 }), getWorks: async (ids) => ({ papers: ids.length > 0 ? [cand(99)] : [], costUsd: 0 }) }, cache: emptyCache(), now: 1, budget });
    expect(extras.stopped).toBeNull();
    expect(budget.spent).toBeCloseTo(0.0002); // the fallback price when the answer states no cost: two requests at $0.0001
  });
});
