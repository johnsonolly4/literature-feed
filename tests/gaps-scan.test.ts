// The similar-paper scan inside the gaps tool (signals 2a and 2b), against a fake OpenAlex with invented works.
import { describe, expect, it } from "vitest";
import type { Candidate, Citer } from "../src/openalex/client";
import { Budget } from "../src/review/budget";
import { emptyCache } from "../src/review/cache";
import { emptyGapsSession, estimateGaps, normaliseGapsSession } from "../src/review/gaps-input";
import { runGaps, type GapsClient, type ScanEstimate } from "../src/review/gaps-fetch";
import { gapsRecordFromNote, gapsSnapshot, parseGapsSnapshot, renderGapsNote, sessionFromRecord } from "../src/review/gaps-note";
import { WORK_CHIPS, WORK_COLUMNS, buildWorkRows, workSearchText } from "../src/review/gaps-rows";
import { viewRows, type TableModel } from "../src/ui/table-model";

function cand(n: number, refs: number[], over: Partial<Candidate> = {}): Candidate {
  return { title: `Invented work ${n}`, abstract: null, doi: `https://doi.org/10.1000/s.${n}`, year: 2020, openalexId: `https://openalex.org/W${n}`, authors: ["A. Author"], venue: null, publicationDate: null, citedByCount: 20 + n, referencedWorks: refs.map((r) => `W${r}`), ...over };
}

// P = W100 cites R1..R6 (W1..W6). Each reference cites W200 (R1 to R3) or something of its own (R4 to R6). R6 is cited 2500 times (heavy).
const REFS = [1, 2, 3, 4, 5, 6];
const WORKS = [
  cand(100, REFS, { year: 2022 }), cand(1, [200]), cand(2, [200]), cand(3, [200]), cand(4, [301]), cand(5, [302]), cand(6, [303], { citedByCount: 2500 }),
  cand(200, [], { title: "Found on both routes" }), cand(201, [], { title: "Only the neighbours cite this" }), cand(301, []), cand(302, []), cand(303, []),
];
// Citing works: C11 shares five references, C12 five, C13 all six, C14 two, C15 none. The first three also cite W200 and W201.
const CITERS: Citer[] = [
  { id: "W11", year: 2021, referencedWorks: ["W1", "W2", "W3", "W4", "W5", "W200", "W201"] },
  { id: "W12", year: 2021, referencedWorks: ["W2", "W3", "W4", "W5", "W6", "W200", "W201"] },
  { id: "W13", year: 2021, referencedWorks: ["W1", "W2", "W3", "W4", "W5", "W6", "W200", "W201"] },
  { id: "W14", year: 2021, referencedWorks: ["W1", "W2", "W200"] },
  { id: "W15", year: 2021, referencedWorks: ["W201"] },
];

function fake(): { client: GapsClient; asked: string[][] } {
  const byId = new Map(WORKS.map((w) => [w.openalexId.replace("https://openalex.org/", ""), w]));
  const asked: string[][] = [];
  const client: GapsClient = {
    citingPage: () => Promise.resolve({ papers: [], fetched: 0, count: 0, costUsd: 0 }),
    getWorks: (ids) => Promise.resolve({ papers: ids.flatMap((i) => byId.get(i) ?? []), costUsd: 0.0001 }),
    getFullWork: (ref) => Promise.resolve((ref.id ? byId.get(ref.id) : undefined) ?? null),
    getWorksByDoi: () => Promise.resolve({ papers: [], costUsd: 0 }),
    findByTitle: () => Promise.resolve({ papers: [], costUsd: 0 }),
    citersPage: (ids) => { asked.push([...ids]); return Promise.resolve({ citers: asked.length === 1 ? CITERS : [], nextCursor: null, count: 0, costUsd: 0.0001 }); },
  };
  return { client, asked };
}

const input = { kind: "work" as const, doi: null, id: "W100" };
const mk = (limit = 0.05) => { const f = fake(); return { ...f, deps: { client: f.client, cache: emptyCache(), now: 1000, budget: new Budget(limit) } }; };

describe("the similar-paper scan", () => {
  it("is not run unless asked for, and then old runs have no scan", async () => {
    const { deps, asked } = mk();
    const run = await runGaps(input, deps, 3);
    expect(run.similar).toBeNull();
    expect(asked).toEqual([]);
  });

  it("finds the similar papers, the neighbours' citations and the works on both routes, skipping the heavy reference", async () => {
    const { deps, asked } = mk();
    let shown: ScanEstimate | null = null;
    const run = await runGaps(input, deps, 3, null, [], { confirm: (e) => { shown = e; return Promise.resolve(true); } });
    expect(shown).toMatchObject({ scanned: 5, requests: 5 });
    expect(shown!.heavy.map((h) => h.id)).toEqual(["W6"]);
    expect(asked).toEqual([["W1", "W2", "W3", "W4", "W5"]]);
    const s = run.similar!;
    expect(s).toMatchObject({ skipped: false, referenceCount: 6, similarFound: 3, neighbours: 3, minimum: 3, minShared: 5, citersRead: 5, unscanned: 0 });
    expect(s.heavySkipped).toEqual([{ id: "W6", title: "Invented work 6", citedBy: 2500 }]);
    expect(s.rows.map((r) => [r.gap.id, r.gap.count])).toEqual([["W200", 3], ["W201", 3]]);
    expect(s.bothIds).toEqual(["W200"]);
    expect(s.warning).toMatch(/Only 3 similar/);
  });

  it("skips the scan, and says so, when the price is not accepted", async () => {
    const { deps, asked } = mk();
    const run = await runGaps(input, deps, 3, null, [], { confirm: () => Promise.resolve(false) });
    expect(asked).toEqual([]);
    expect(run.similar).toMatchObject({ skipped: true, message: "The scan for similar papers was skipped." });
    expect(run.similar?.heavySkipped).toHaveLength(1);
  });

  it("reports a budget stop instead of throwing", async () => {
    const { deps } = mk(0.0003);
    const run = await runGaps(input, deps, 3, null, [], {});
    expect(run.similar?.stopped).toMatch(/stopped at/);
  });
});

describe("rows with a scan", () => {
  it("marks both routes, adds the neighbours-only works, and gives the gap in points", async () => {
    const { deps } = mk();
    const run = await runGaps(input, deps, 3, null, [], {});
    const none = { zotero: null, vault: null, listedBefore: [] };
    const rows = buildWorkRows(run, (l) => l.map(() => none));
    expect(rows.map((r) => [r.key, r.route, r.similarCount, r.similarOf])).toEqual([["1:W200", "both", 3, 3], ["s:W201", "similar", 3, 3]]);
    expect(rows[0].gap).toBeCloseTo(50); // 3 of 3 neighbours, 3 of 6 references
    expect(rows[1].gap).toBeCloseTo(100);
    const model: TableModel<(typeof rows)[number]> = { columns: WORK_COLUMNS, chips: WORK_CHIPS(false, true, true), searchText: workSearchText };
    const view = { chip: "both", query: "", sort: { by: "", desc: false } };
    expect(viewRows(rows, model, view).map((r) => r.key)).toEqual(["1:W200"]);
    expect(viewRows(rows, model, { ...view, chip: "first" }).map((r) => r.key)).toEqual(["1:W200"]);
    expect(WORK_CHIPS(false, true, false).filter((c) => !c.when || c.when()).map((c) => c.key)).not.toContain("both");
    expect(WORK_COLUMNS.find((c) => c.key === "similar")?.csv?.(rows[0])).toBe("3 of 3");
  });

  it("builds the same rows as before for a run without a scan", async () => {
    const { deps } = mk();
    const run = await runGaps(input, deps, 3);
    const none = { zotero: null, vault: null, listedBefore: [] };
    const rows = buildWorkRows(run, (l) => l.map(() => none));
    expect(rows.map((r) => [r.key, r.route, r.similarCount, r.gap])).toEqual([["1:W200", "refs", null, null]]);
  });
});

describe("the saved switch", () => {
  it("is off by default and survives a save", () => {
    expect(emptyGapsSession().similar).toBe(false);
    expect(normaliseGapsSession({ ...emptyGapsSession(), similar: true })?.similar).toBe(true);
    expect(normaliseGapsSession({ ...emptyGapsSession(), similar: "yes" })?.similar).toBe(false);
  });

  it("says the scan is priced later and leaves the estimate unchanged", () => {
    const base = estimateGaps({ kind: "work", doi: "10.1000/a", id: null });
    const withScan = estimateGaps({ kind: "work", doi: "10.1000/a", id: null }, false, 0, true);
    expect(base.scanLater).toBe(false);
    expect(withScan).toEqual({ ...base, scanLater: true });
  });
});

describe("the gaps note with a scan", () => {
  const none = { zotero: null, vault: null, listedBefore: [] };
  const render = async (scan: Parameters<typeof runGaps>[5]) => {
    const { deps } = mk();
    const run = await runGaps(input, deps, 3, null, [], scan);
    const text = renderGapsNote({ date: "2026-10-15", ranAt: "2026-10-15T10:00:00Z", input, minCount: 3, run, flags: run.gaps.map(() => none), similarFlags: (run.similar?.rows ?? []).map(() => none) });
    return { run, text };
  };

  it("lists what the neighbours cite with the thresholds and the skipped references", async () => {
    const { text } = await render({});
    expect(text).toContain("## Cited by similar papers");
    expect(text).toContain("at least 3 of them");
    expect(text).toContain("Skipped (cited 2000 times or more): Invented work 6.");
    const row = (name: string): string => text.split(/\r?\n/).find((l) => l.startsWith("|") && l.includes(name) && l.includes("of 3")) ?? "";
    expect(row("Only the neighbours cite this")).toContain("| 3 of 3 |  |");
    expect(row("Found on both routes")).toContain("| 3 of 3 | yes |");
  });

  it("keeps the scan in the record and the snapshot, and repeating the run switches it on", async () => {
    const { run, text } = await render({});
    const rec = gapsRecordFromNote(text)!;
    expect(rec.similar).toMatchObject({ minShared: 5, neighbours: 3, minimum: 3 });
    expect(rec.similar?.rows.map((r) => r.id)).toEqual(["W200", "W201"]);
    expect(sessionFromRecord(rec, emptyGapsSession()).similar).toBe(true);
    const snap = parseGapsSnapshot(JSON.parse(JSON.stringify(gapsSnapshot("t", input, 3, run))))!;
    expect(snap.run.similar?.rows[0].paper?.abstract).toBeNull();
    expect(snap.run.similar?.bothIds).toEqual(["W200"]);
  });

  it("has no scan section when the scan did not run, and the old record repeats without it", async () => {
    const { text } = await render(null);
    expect(text).not.toContain("Cited by similar papers");
    const rec = gapsRecordFromNote(text)!;
    expect(rec.similar ?? null).toBeNull();
    expect(sessionFromRecord(rec, emptyGapsSession()).similar).toBe(false);
  });
});
