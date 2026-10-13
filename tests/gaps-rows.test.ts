// The rows behind the gaps report's tables, and old saved runs (from before author details were kept) loading without throwing.
import { describe, expect, it } from "vitest";
import type { Candidate } from "../src/openalex/client";
import { worksBy } from "../src/review/gaps-authors";
import { emptyGapsSession, normaliseGapsSession, withRunDefaults } from "../src/review/gaps-input";
import type { GapsRun } from "../src/review/gaps-fetch";
import { AUTHOR_CHIPS, WORK_CHIPS, WORK_COLUMNS, buildWorkRows, findAuthorRow, workSearchText } from "../src/review/gaps-rows";
import { authorShares } from "../src/review/gaps-authors";
import { viewRows, type TableModel } from "../src/ui/table-model";

function cand(n: number, year: number, authors: string[]): Candidate {
  return { title: `Work ${n}`, abstract: null, doi: `https://doi.org/10.1000/w.${n}`, year, openalexId: `https://openalex.org/W${n}`, authors, venue: null, publicationDate: null, citedByCount: n };
}

function run(): GapsRun {
  return {
    subject: { title: "The paper", doi: null, id: "W1", year: 2022, authors: ["Pat Own"] }, referencesRead: 10, referencesWithLists: 9,
    gaps: [{ gap: { id: "W11", count: 5, share: 0.55 }, paper: cand(11, 2019, ["Ann Lee"]) }, { gap: { id: "W12", count: 3, share: 0.33 }, paper: cand(12, 2024, ["Bob Roe"]) }],
    unresolved: [], searches: 0, stopped: null, citedAuthors: [], addedDois: [], citedWorks: [], referenceIds: [], message: null, spentUsd: 0,
    deeper: { gaps: [{ gap: { id: "W21", count: 4, share: 0.4 }, paper: cand(21, 2010, ["Cy Poe"]) }], hubsRead: 12, hubsWithLists: 10, minCount: 3 },
  };
}

const none = { zotero: null, vault: null, listedBefore: [] };

describe("works rows", () => {
  const flagged = (list: GapsRun["gaps"]) => list.map((g) => (g.gap.id === "W11" ? { zotero: "K1", vault: null, listedBefore: [] } : none));
  const rows = buildWorkRows(run(), flagged);

  it("lists the first level then the second, with levels, shares and when each could have been cited", () => {
    expect(rows.map((r) => [r.key, r.level, r.count, r.of, r.timing])).toEqual([
      ["1:W11", 1, 5, 9, "before"], ["1:W12", 1, 3, 9, "after"], ["2:W21", 2, 4, 10, "before"],
    ]);
  });

  it("filters by chip and sorts by column", () => {
    const model: TableModel<(typeof rows)[number]> = { columns: WORK_COLUMNS, chips: WORK_CHIPS(true, true), searchText: workSearchText };
    const view = { chip: "all", query: "", sort: { by: "count", desc: true } };
    expect(viewRows(rows, model, view).map((r) => r.key)).toEqual(["1:W11", "2:W21", "1:W12"]);
    expect(viewRows(rows, model, { ...view, chip: "second" }).map((r) => r.key)).toEqual(["2:W21"]);
    expect(viewRows(rows, model, { ...view, chip: "have" }).map((r) => r.key)).toEqual(["1:W11"]);
    expect(viewRows(rows, model, { ...view, chip: "early" }).map((r) => r.key)).toEqual(["1:W11", "2:W21"]);
    expect(viewRows(rows, model, { ...view, query: "bob" }).map((r) => r.key)).toEqual(["1:W12"]);
  });

  it("hides the chips that do not apply", () => {
    expect(WORK_CHIPS(false, false).filter((c) => !c.when || c.when()).map((c) => c.key)).toEqual(["all", "first", "have", "missing"]);
  });
});

describe("authors rows", () => {
  it("filters under- and over-cited authors and finds one by name", () => {
    const cited = [["Ann Lee"], ["Ann Lee"], ["Ann Lee"], ["Bob Roe"], ["Cy Poe"]];
    const uncited = [["Bob Roe"], ["Bob Roe"], ["Bob Roe"], ["Cy Poe"], ["Dee Fox"]];
    const t = authorShares(cited, uncited, { min: 2, own: ["Ann Lee"] });
    const model: TableModel<(typeof t.rows)[number]> = { columns: [], chips: AUTHOR_CHIPS, searchText: (r) => r.name };
    const view = { chip: "under", query: "", sort: { by: "", desc: false } };
    expect(viewRows(t.rows, model, view).map((r) => r.name)).toEqual(["Bob Roe"]);
    expect(viewRows(t.rows, model, { ...view, chip: "own" }).map((r) => r.name)).toEqual(["Ann Lee"]);
    expect(findAuthorRow(t.rows, "Lee, A.")?.name).toBe("Ann Lee");
    expect(findAuthorRow(t.rows, "Nobody")).toBeNull();
  });
});

describe("a run saved before author details were kept", () => {
  it("loads with empty details, says so, and does not throw when an author is looked up", () => {
    const old = { ...run() } as Record<string, unknown>;
    delete old.citedWorks;
    delete old.referenceIds;
    delete old.citedAuthors;
    const session = { ...emptyGapsSession(), last: { input: { kind: "work", doi: "10.1/x", id: null }, run: old, ranAt: "2026-10-01T00:00:00Z" } };
    const back = normaliseGapsSession(JSON.parse(JSON.stringify(session)));
    const loaded = back?.last?.run;
    expect(loaded?.detailsKept).toBe(false);
    expect(loaded?.citedWorks).toEqual([]);
    expect(worksBy("lee|a", loaded?.citedWorks ?? [])).toEqual([]);
    expect(withRunDefaults(run() as unknown as Record<string, unknown>).detailsKept).toBe(true);
  });
});

describe("reopening a report from its note", () => {
  const input = { kind: "work", doi: "10.1/x", id: null } as const;

  it("round-trips a run through the note's report block, without abstracts", async () => {
    const { renderGapsNote, parseGapsSnapshot, GAPS_KIND } = await import("../src/review/gaps-note");
    const { reportsInNote } = await import("../src/ui/report-block");
    const r = run();
    r.gaps[0].paper = { ...cand(11, 2019, ["Ann Lee"]), abstract: "A very long abstract", venue: "Journal" };
    const text = renderGapsNote({ date: "2026-10-13", ranAt: "2026-10-13T10:00:00Z", input, minCount: 3, run: r, flags: [], deeperFlags: [] });
    const found = reportsInNote(text);
    expect(found).toHaveLength(1);
    expect(found[0].kind).toBe(GAPS_KIND);
    expect(text).not.toContain("A very long abstract");
    const snap = parseGapsSnapshot(found[0].data);
    expect(snap?.run.gaps.map((g) => g.gap.id)).toEqual(["W11", "W12"]);
    expect(snap?.run.deeper?.gaps).toHaveLength(1);
    expect(snap?.run.subject?.title).toBe("The paper");
    expect(snap?.minCount).toBe(3);
  });

  it("rejects data that is not a snapshot", async () => {
    const { parseGapsSnapshot } = await import("../src/review/gaps-note");
    expect(parseGapsSnapshot(null)).toBeNull();
    expect(parseGapsSnapshot({ ranAt: "x" })).toBeNull();
  });

  it("puts the inputs of an older note's record back into the tool", async () => {
    const { sessionFromRecord } = await import("../src/review/gaps-note");
    const base = emptyGapsSession();
    const s = sessionFromRecord({ input, minCount: 2, addedDois: ["10.2/y"], deeper: { minCount: 4, hubsRead: 5, gaps: [] } }, base);
    expect(s).toMatchObject({ mode: "paper", paperText: "10.1/x", minCount: 2, extraDois: "10.2/y", deeper: true, deeperMin: 4, last: null });
    const p = sessionFromRecord({ input: { kind: "references", dois: ["10.3/z"], lines: ["A line"] }, minCount: 3, deeper: null }, base);
    expect(p).toMatchObject({ mode: "paste", pasted: "10.3/z\nA line", deeper: false, searchUnfound: true });
  });

  it("reads several report blocks and ignores broken ones", async () => {
    const { reportBlock, reportsInNote } = await import("../src/ui/report-block");
    const text = [...reportBlock("a", { n: 1 }, "one"), "", "```literature-feed-report", "{not json", "```", "", ...reportBlock("b", { n: 2 })].join("\n");
    expect(reportsInNote(text).map((x) => [x.kind, x.summary])).toEqual([["a", "one"], ["b", undefined]]);
  });
});
