import { describe, expect, it } from "vitest";
import { agesOutSoon, countsByStatus, filterRows, makeRows, orderRows, paperStatus, takeawayFilled, type TableRow } from "../src/inbox/table";
import type { ParsedPaper } from "../src/inbox/write";

function paper(id: string, overrides: Partial<ParsedPaper> = {}): ParsedPaper {
  return {
    openalexId: id, feedId: "a", tier: "strong", ticked: false, synced: false, list: "ranked", key: null, doi: null, read: false,
    title: `Paper ${id}`, topics: [], authors: "", venue: "", year: 2026, preprint: false, titleOnly: false, readLink: null, ...overrides,
  };
}

describe("paperStatus", () => {
  it("is New for an untouched paper", () => {
    expect(paperStatus(paper("W1"), false)).toBe("new");
  });

  it("is Ticked while a ticked paper waits to be sent, and for a resend request (unticked in the In Zotero list)", () => {
    expect(paperStatus(paper("W1", { ticked: true }), false)).toBe("ticked");
    expect(paperStatus(paper("W1", { synced: true, ticked: false, list: "synced" }), false)).toBe("ticked");
  });

  it("is In Zotero once it is sent and ticked, also for a linked line that is still in a normal list", () => {
    expect(paperStatus(paper("W1", { synced: true, ticked: true, list: "synced" }), false)).toBe("in-zotero");
    expect(paperStatus(paper("W1", { synced: true, ticked: true, list: "ranked" }), false)).toBe("in-zotero");
  });

  it("is Read with a literature note, and Processed when its takeaway is filled; Read wins over everything else", () => {
    expect(paperStatus(paper("W1", { read: true }), false)).toBe("read");
    expect(paperStatus(paper("W1", { read: true }), true)).toBe("processed");
    expect(paperStatus(paper("W1", { read: true, synced: true, ticked: true }), false)).toBe("read");
    expect(paperStatus(paper("W1", { read: false }), true)).toBe("new");
  });
});

describe("ordering, filtering and counts", () => {
  const papers = [
    paper("W1"),                                                             // new, strong
    paper("W2", { tier: "priority" }),                                       // new, priority
    paper("W3", { synced: true, ticked: true, list: "synced", tier: "possible" }), // in Zotero, possible
    paper("W4", { read: true }),                                             // read
    paper("W5", { ticked: true }),                                           // ticked
    paper("W6", { synced: true, ticked: true, list: "synced", tier: "priority" }), // in Zotero, priority
    paper("W7", { read: true }),                                             // processed
  ];
  const rows = makeRows(papers, new Set(["a|W7"]));
  const ids = (list: TableRow[]) => list.map((r) => r.paper.openalexId);

  it("puts what is waiting to be read first, then ticked, new, read and processed, by tier inside a group", () => {
    expect(ids(orderRows(rows))).toEqual(["W6", "W3", "W5", "W2", "W1", "W4", "W7"]);
  });

  it("sorts by a chosen column, reverses it on request, and falls back to the default order for ties", () => {
    expect(ids(orderRows(rows, { by: "tier", desc: false })).slice(0, 2)).toEqual(["W6", "W2"]); // both Priority, the one in Zotero first
    expect(orderRows(rows, { by: "tier", desc: false }).slice(0, 2).map((r) => r.paper.tier)).toEqual(["priority", "priority"]);
    expect(orderRows(rows, { by: "tier", desc: true })[0].paper.tier).toBe("possible");
    expect(ids(orderRows(rows, { by: "paper", desc: false }))).toEqual(["W1", "W2", "W3", "W4", "W5", "W6", "W7"]);
    expect(ids(orderRows(rows, { by: "paper", desc: true }))).toEqual(["W7", "W6", "W5", "W4", "W3", "W2", "W1"]);
    expect(ids(orderRows(rows, { by: "status", desc: true }))[0]).toBe("W7");
  });

  it("sorts by year with unknown years first when ascending", () => {
    const withYears = makeRows([paper("A", { year: 2026 }), paper("B", { year: null }), paper("C", { year: 2024 })], new Set());
    expect(ids(orderRows(withYears, { by: "year", desc: false }))).toEqual(["B", "C", "A"]);
    expect(ids(orderRows(withYears, { by: "year", desc: true }))).toEqual(["A", "C", "B"]);
  });

  it("does not change the rows it is given", () => {
    const before = ids(rows);
    orderRows(rows, { by: "paper", desc: true });
    expect(ids(rows)).toEqual(before);
  });

  it("filters by status and counts each", () => {
    expect(ids(filterRows(rows, "in-zotero"))).toEqual(["W3", "W6"]);
    expect(ids(filterRows(rows, "processed"))).toEqual(["W7"]);
    expect(filterRows(rows, "all")).toHaveLength(7);
    expect(countsByStatus(rows)).toEqual({ all: 7, new: 2, ticked: 1, "in-zotero": 2, read: 1, processed: 1 });
    expect(countsByStatus([])).toEqual({ all: 0, new: 0, ticked: 0, "in-zotero": 0, read: 0, processed: 0 });
  });
});

describe("agesOutSoon", () => {
  const name = "2026-W42 Reading inbox.md"; // week ends 2026-10-19; with N = 4 a paper ages out from 2026-11-16
  it("is true for New and In Zotero papers in the last week before they age out, and only then", () => {
    expect(agesOutSoon("new", name, "2026-11-08", 4)).toBe(false);
    expect(agesOutSoon("new", name, "2026-11-09", 4)).toBe(true);
    expect(agesOutSoon("in-zotero", name, "2026-11-15", 4)).toBe(true);
    expect(agesOutSoon("in-zotero", name, "2026-11-16", 4)).toBe(false);
  });

  it("is false for papers that are ticked, read or processed, and for a name without a week", () => {
    for (const status of ["ticked", "read", "processed"] as const) expect(agesOutSoon(status, name, "2026-11-12", 4)).toBe(false);
    expect(agesOutSoon("new", "Notes.md", "2026-11-12", 4)).toBe(false);
  });
});

describe("takeawayFilled", () => {
  it("is true when the field has text, in Lab Kit's bracket form, round brackets, or on its own line", () => {
    expect(takeawayFilled("> [takeaway:: Lipoic acid makes degradable polymers]")).toBe(true);
    expect(takeawayFilled("text (takeaway:: one line) more")).toBe(true);
    expect(takeawayFilled("takeaway:: plain line" + String.fromCharCode(10) + "next")).toBe(true);
  });

  it("is false for the empty field the template leaves, whitespace only, or no field", () => {
    expect(takeawayFilled("> [takeaway:: ]")).toBe(false);
    expect(takeawayFilled("> [takeaway::]")).toBe(false);
    expect(takeawayFilled("takeaway::   " + String.fromCharCode(10) + "next line has text")).toBe(false);
    expect(takeawayFilled("# A note with no field")).toBe(false);
  });

  it("is true if any takeaway field in the note has text", () => {
    expect(takeawayFilled("[takeaway:: ]" + String.fromCharCode(10) + "[takeaway:: filled]")).toBe(true);
  });
});
