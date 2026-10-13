import { describe, expect, it } from "vitest";
import { addDays, describeCounts, describeFeedRow, inboxPath, localDay, runScan, scanCounts, seenKey, topicsFor, updatedSeen, windowStart, type ScanDeps } from "../src/inbox/scan";
import type { Candidate, ScanResult } from "../src/openalex/client";
import { SEEN_CAP, defaultSettings, type FeedConfig, type Settings } from "../src/settings/data";
import { lipoicFeed } from "./fixtures/lipoic-feed";
import { droppedNoLipoic, possible, priorityFlow, strongComonomer } from "./fixtures/lipoic-papers";

const NOW = new Date(2026, 9, 12, 9, 30); // Monday 2026-10-12, week 42

function feed(id: string, overrides: Partial<FeedConfig> = {}): FeedConfig {
  return { ...lipoicFeed, id, name: `Feed ${id}`, enabled: true, topics: ["t1", "t2"], yearsFrom: null, zoteroCollection: "", project: "", ...overrides };
}

function cand(c: { title: string; abstract: string | null }, n: number): Candidate {
  return {
    title: c.title, abstract: c.abstract, openalexId: `https://openalex.org/W${n}`, doi: `https://doi.org/10.1000/x.${n}`,
    year: 2026, authors: ["A. Author"], venue: "J", publicationDate: "2026-10-01",
  };
}

function scanResult(papers: Candidate[], costUsd = 0.004): ScanResult {
  return { perTopic: [], papers, costUsd };
}

/** A client that answers per call from a function and remembers the windows it was asked for. */
function fakeClient(answer: (topics: readonly string[], fromDate: string | undefined, call: number) => ScanResult | Error) {
  const windows: (string | undefined)[] = [];
  let call = 0;
  return {
    windows,
    client: {
      scan: async (topics: readonly string[], opts?: { fromDate?: string }): Promise<ScanResult> => {
        windows.push(opts?.fromDate);
        const r = answer(topics, opts?.fromDate, call++);
        if (r instanceof Error) throw r;
        return r;
      },
    } as ScanDeps["client"],
  };
}

function settings(overrides: Partial<Settings> = {}): Settings {
  return { ...defaultSettings(), feeds: [feed("a")], ...overrides };
}

describe("dates", () => {
  it("formats a local day and adds days across month and year ends", () => {
    expect(localDay(new Date(2026, 0, 5, 23, 59))).toBe("2026-01-05");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(addDays("2026-01-02", -14)).toBe("2025-12-19");
    expect(addDays("2024-03-01", -1)).toBe("2024-02-29");
  });

  it("starts 30 days back on the first scan and 14 days before the last scan after that", () => {
    expect(windowStart(null, "", "2026-10-12")).toBe("2026-09-12");
    expect(windowStart(null, "2026-10-05", "2026-10-12")).toBe("2026-09-21");
  });

  it("never starts before the feed's years from", () => {
    expect(windowStart(2026, "", "2026-10-12")).toBe("2026-09-12");
    expect(windowStart(2026, "2026-01-05", "2026-10-12")).toBe("2026-01-01");
    expect(windowStart(2020, "2026-01-05", "2026-10-12")).toBe("2025-12-22");
  });

  it("puts the note in the inbox folder, or at the vault root", () => {
    expect(inboxPath("04 Literature/Suggested", NOW)).toBe("04 Literature/Suggested/2026-W42 Reading inbox.md");
    expect(inboxPath("", NOW)).toBe("2026-W42 Reading inbox.md");
  });
});

describe("runScan", () => {
  it("scans each enabled feed with its own window and builds the note input", async () => {
    const { client, windows } = fakeClient(() => scanResult([cand(priorityFlow, 1), cand(strongComonomer, 2), cand(possible, 3), cand(droppedNoLipoic, 4)]));
    const s = settings({ inboxFolder: "Inbox", lastScan: "2026-10-05", feeds: [feed("a"), feed("b", { yearsFrom: 2026 }), feed("off", { enabled: false }), feed("empty", { topics: [] })] });
    const out = await runScan(s, { client, now: NOW });

    expect(windows).toEqual(["2026-09-21", "2026-09-21"]);
    expect(out.feedsScanned).toBe(2);
    expect(out.note?.path).toBe("Inbox/2026-W42 Reading inbox.md");
    expect(out.note?.input).toMatchObject({ week: "2026-W42", scanned: "2026-10-12" });
    expect(out.note?.input.sections.map((x) => x.feedId)).toEqual(["a", "b"]);
    expect(out.perTier).toEqual({ priority: 2, strong: 2, possible: 2, unchecked: 0 });
    expect(out.dropped).toBe(2);
    expect(out.costUsd).toBeCloseTo(0.008, 10);
    expect(out.failures).toEqual([]);
    expect(out.lastScan).toBe("2026-10-12");
    expect(out.seenAdd).toEqual(["a/W1", "a/W2", "a/W3", "b/W1", "b/W2", "b/W3"]);
  });

  it("skips papers already seen for that feed, but not for another feed", async () => {
    const { client } = fakeClient(() => scanResult([cand(priorityFlow, 1), cand(possible, 2)]));
    const s = settings({ seen: [seenKey("a", "W1")], feeds: [feed("a"), feed("b")] });
    const out = await runScan(s, { client, now: NOW });
    const byFeed = Object.fromEntries((out.note?.input.sections ?? []).map((x) => [x.feedId, x.papers.map((p) => p.openalexId)]));
    expect(byFeed).toEqual({ a: ["W2"], b: ["W1", "W2"] });
  });

  it("writes nothing when nothing is new, but still moves the last scan date", async () => {
    const { client } = fakeClient(() => scanResult([cand(priorityFlow, 1)], 0.001));
    const out = await runScan(settings({ seen: ["a/W1"] }), { client, now: NOW });
    expect(out.note).toBeNull();
    expect(out.costUsd).toBeCloseTo(0.001, 10);
    expect(out.lastScan).toBe("2026-10-12");
  });

  it("reports a failing feed, goes on with the others and leaves the last scan date alone", async () => {
    const { client } = fakeClient((_t, _f, call) => (call === 0 ? new Error("OpenAlex request failed (HTTP 500)") : scanResult([cand(priorityFlow, 1)])));
    const out = await runScan(settings({ lastScan: "2026-10-05", feeds: [feed("a"), feed("b")] }), { client, now: NOW });
    expect(out.failures).toEqual([{ feed: "Feed a", message: "OpenAlex request failed (HTTP 500)" }]);
    expect(out.note?.input.sections.map((x) => x.feedId)).toEqual(["b"]);
    expect(out.lastScan).toBe("2026-10-05");
  });

  it("does no request and keeps the last scan date when no feed is switched on", async () => {
    const { client, windows } = fakeClient(() => scanResult([]));
    const out = await runScan(settings({ lastScan: "2026-10-05", feeds: [feed("a", { enabled: false })] }), { client, now: NOW });
    expect(windows).toEqual([]);
    expect(out.note).toBeNull();
    expect(out.feedsScanned).toBe(0);
    expect(out.lastScan).toBe("2026-10-05");
  });

  it("counts papers without an abstract as Unchecked", async () => {
    const { client } = fakeClient(() => scanResult([cand({ title: "Programmed recycling of triblock copolymers", abstract: null }, 9)]));
    const out = await runScan(settings(), { client, now: NOW });
    expect(out.perTier).toEqual({ priority: 0, strong: 0, possible: 0, unchecked: 1 });
    expect(out.note?.input.sections[0].papers[0].tier).toBe("unchecked");
  });

  it("a rescan with the first scan's seen list finds nothing new", async () => {
    const { client } = fakeClient(() => scanResult([cand(priorityFlow, 1), cand(possible, 2)]));
    const first = await runScan(settings(), { client, now: NOW });
    expect(first.note?.input.sections[0].papers).toHaveLength(2);
    const again = await runScan(settings({ seen: updatedSeen([], first.seenAdd), lastScan: first.lastScan }), { client, now: new Date(2026, 9, 14) });
    expect(again.note).toBeNull();
  });
});

describe("topicsFor and the topics of listed papers", () => {
  const a = cand(priorityFlow, 1);
  const b = cand(possible, 2);
  const topicResult = (papers: Candidate[]) => ({ papers });

  it("lists, in order and 1-based, the topics that returned the paper", () => {
    expect(topicsFor(a, [topicResult([a]), topicResult([b]), topicResult([a, b])])).toEqual([1, 3]);
    expect(topicsFor(b, [topicResult([a]), topicResult([b])])).toEqual([2]);
    expect(topicsFor(a, [])).toEqual([]);
  });

  it("counts a topic that returned the same paper under another OpenAlex id (a preprint and its journal version)", () => {
    const journal = { ...a, openalexId: "https://openalex.org/W900", title: a.title, doi: "https://doi.org/10.1000/other" };
    const preprint = { ...a, openalexId: "https://openalex.org/W901", doi: null };
    expect(topicsFor(journal, [topicResult([preprint]), topicResult([journal])])).toEqual([1, 2]); // same title
    const sameDoi = { ...b, openalexId: "https://openalex.org/W902", title: "Completely different title", doi: b.doi };
    expect(topicsFor(b, [topicResult([sameDoi])])).toEqual([1]); // same DOI
  });

  it("puts the topics on the papers a scan lists", async () => {
    const client = {
      scan: async (): Promise<ScanResult> => ({
        perTopic: [
          { topic: "t1", count: 1, papers: [a], costUsd: 0, truncated: false },
          { topic: "t2", count: 2, papers: [a, b], costUsd: 0, truncated: false },
        ],
        papers: [a, b], costUsd: 0.002,
      }),
    } as ScanDeps["client"];
    const out = await runScan(settings(), { client, now: NOW });
    const papers = out.note?.input.sections[0].papers ?? [];
    expect(papers.map((p) => [p.openalexId, p.topics])).toEqual([["W1", [1, 2]], ["W2", [2]]]);
  });
});

describe("last scan counts", () => {
  it("turns an outcome into the stored counts, with the failed feeds counted", async () => {
    const { client } = fakeClient((_t, _f, call) => (call === 0 ? new Error("HTTP 500") : scanResult([cand(priorityFlow, 1), cand(possible, 2), cand(droppedNoLipoic, 3)])));
    const out = await runScan(settings({ feeds: [feed("a"), feed("b")] }), { client, now: NOW });
    expect(scanCounts(out, "2026-10-12")).toEqual({
      at: "2026-10-12", priority: 1, strong: 0, possible: 1, unchecked: 0, dropped: 1, failed: 1,
      feeds: [
        { id: "a", name: "Feed a", priority: 0, strong: 0, possible: 0, unchecked: 0, dropped: 0, failed: true },
        { id: "b", name: "Feed b", priority: 1, strong: 0, possible: 1, unchecked: 0, dropped: 1, failed: false },
      ],
    });
  });

  it("counts each feed's own papers, so the rows add up to the total", async () => {
    const { client } = fakeClient((_t, _f, call) => scanResult(call === 0 ? [cand(priorityFlow, 1)] : [cand(priorityFlow, 1), cand(possible, 2), cand(droppedNoLipoic, 3)]));
    const out = await runScan(settings({ feeds: [feed("a"), feed("b")] }), { client, now: NOW });
    expect(out.perFeed.map((f) => [f.id, f.priority, f.possible, f.dropped, f.failed])).toEqual([["a", 1, 0, 0, false], ["b", 1, 1, 1, false]]);
    expect(out.perTier.priority).toBe(2);
    expect(out.perFeed.reduce((n, f) => n + f.possible, 0)).toBe(out.perTier.possible);
  });

  it("describes a feed row, with and without a last scan, and when that scan failed", () => {
    const waiting = { priority: 1, strong: 2, possible: 0, unchecked: 1 };
    const last = { id: "a", name: "A", priority: 0, strong: 2, possible: 1, unchecked: 0, dropped: 11, failed: false };
    expect(describeFeedRow("Feed A", waiting, undefined)).toBe("Feed A: 4 waiting (1 priority, 2 strong, 0 possible, 1 without abstract)");
    expect(describeFeedRow("Feed A", waiting, last)).toBe("Feed A: 4 waiting (1 priority, 2 strong, 0 possible, 1 without abstract). Last scan: 3 new, 11 dropped.");
    expect(describeFeedRow("Feed A", waiting, { ...last, failed: true })).toContain("Last scan: failed.");
  });

  it("says in one sentence what the last scan found", () => {
    expect(describeCounts({ at: "2026-10-12", priority: 0, strong: 2, possible: 1, unchecked: 0, dropped: 11, failed: 0, feeds: [] }))
      .toBe("Last scan 2026-10-12: 3 new (0 priority, 2 strong, 1 possible, 0 without abstract), 11 dropped by the feed rules.");
    expect(describeCounts({ at: "2026-10-19", priority: 0, strong: 0, possible: 0, unchecked: 0, dropped: 0, failed: 0, feeds: [] }))
      .toBe("Last scan 2026-10-19: no new papers, 0 dropped by the feed rules.");
    expect(describeCounts({ at: "2026-10-19", priority: 1, strong: 0, possible: 0, unchecked: 0, dropped: 0, failed: 2, feeds: [] }))
      .toContain(", 2 feeds failed.");
    expect(describeCounts({ at: "2026-10-19", priority: 0, strong: 0, possible: 0, unchecked: 0, dropped: 0, failed: 1, feeds: [] }))
      .toContain(", 1 feed failed.");
  });
});

describe("updatedSeen", () => {
  it("appends new keys, drops repeats and keeps the newest SEEN_CAP", () => {
    expect(updatedSeen(["a", "b"], ["b", "c"])).toEqual(["a", "b", "c"]);
    const many = Array.from({ length: SEEN_CAP }, (_, i) => `k${i}`);
    const out = updatedSeen(many, ["new1", "new2"]);
    expect(out).toHaveLength(SEEN_CAP);
    expect(out.slice(-2)).toEqual(["new1", "new2"]);
    expect(out[0]).toBe("k2");
  });
});
