// Dismissing a paper at any stage: the note format, the status, the counts, the archive rule, Sync and the ledger.
import { describe, expect, it } from "vitest";
import { barWidths, countsLine, summariseRows } from "../src/inbox/cards";
import { findPending } from "../src/inbox/sync";
import { isFinished } from "../src/inbox/state";
import { countsByStatus, filterRows, makeRows, orderRows, paperStatus } from "../src/inbox/table";
import {
  markRead, markSynced, parseInbox, renderNote, setDismissed, setTick, waitingByFeed, waitingByTier, type InboxPaper, type ParsedPaper,
} from "../src/inbox/write";
import { emptyLedger, normaliseLedger, updateFromNotes, verdictOf, type LedgerPaper } from "../src/ledger/ledger";
import { buildReport, reportMarkdown } from "../src/ledger/report";
import type { FeedConfig } from "../src/settings/data";

function made(n: number): InboxPaper {
  return {
    openalexId: `W${n}`, title: `Paper ${n}`, authors: ["A. Author"], venue: "J", year: 2026, publicationDate: "2026-09-10", doi: `10.1000/p.${n}`,
    isPreprint: false, noAbstract: false, tier: "strong", matched: ["alpha"], topics: [1],
  };
}

const note = (n = 3): string =>
  renderNote({ week: "2026-W42", scanned: "2026-10-12", sections: [{ feedId: "a", feedName: "A", papers: Array.from({ length: n }, (_, i) => made(i + 1)) }] });

const lineOf = (text: string, n: number): string => text.split("\n").find((l) => l.includes(`**Paper ${n}**`)) ?? "";
const paperOf = (text: string, n: number): ParsedPaper => parseInbox(text).papers.find((p) => p.title === `Paper ${n}`) as ParsedPaper;

describe("setDismissed and the note format", () => {
  it("dismisses a line with a cancelled checkbox and a hidden marker, and parses it back with the reason", () => {
    const base = note();
    const gone = setDismissed(base, "a", "W2", "irrelevant");
    expect(lineOf(gone, 2)).toContain("> - [-] **Paper 2**");
    expect(lineOf(gone, 2)).toContain(" %%dx:n%% %%oa:W2:s%%");
    expect(paperOf(gone, 2)).toMatchObject({ dismissed: "irrelevant", ticked: false, title: "Paper 2", year: 2026, venue: "J", matched: ["alpha"], topics: [1] });
    expect(paperOf(setDismissed(base, "a", "W2", "no-access"), 2).dismissed).toBe("no-access");
    expect(lineOf(gone, 1)).toBe(lineOf(base, 1));
    expect(paperOf(gone, 1).dismissed).toBeNull();
  });

  it("changes the reason without doubling the marker, and undoes to an empty box for an unsent paper", () => {
    const base = note();
    const twice = setDismissed(setDismissed(base, "a", "W2", "irrelevant"), "a", "W2", "no-access");
    expect(lineOf(twice, 2).match(/%%dx:/g)).toHaveLength(1);
    expect(paperOf(twice, 2).dismissed).toBe("no-access");
    expect(setDismissed(twice, "a", "W2", null)).toBe(base);
  });

  it("keeps the Zotero link and the Read link, and undoes to a ticked box for a sent paper", () => {
    const sent = markRead(markSynced(setTick(note(), "a", "W1", true), [{ feedId: "a", openalexId: "W1", key: "ABCD2345" }]), [{ feedId: "a", openalexId: "W1", link: "Lit/p1" }]);
    const gone = setDismissed(sent, "a", "W1", "irrelevant");
    expect(paperOf(gone, 1)).toMatchObject({ dismissed: "irrelevant", synced: true, key: "ABCD2345", read: true, ticked: false, list: "synced" });
    expect(setDismissed(gone, "a", "W1", null)).toBe(sent);
  });

  it("does nothing for a paper or feed that is not in the note, and undo on a line that is not dismissed", () => {
    const base = note();
    expect(setDismissed(base, "a", "W99", "irrelevant")).toBe(base);
    expect(setDismissed(base, "zzz", "W1", "irrelevant")).toBe(base);
    expect(setDismissed(base, "a", "W1", null)).toBe(base);
  });

  it("is not changed by a tick on its line", () => {
    const gone = setDismissed(note(), "a", "W2", "irrelevant");
    expect(setTick(gone, "a", "W2", true)).toBe(gone);
  });

  it("is not counted as waiting", () => {
    const gone = setDismissed(note(), "a", "W2", "irrelevant");
    expect(waitingByTier(parseInbox(gone).papers).strong).toBe(2);
    expect(waitingByFeed(parseInbox(gone).papers).a.strong).toBe(2);
  });
});

describe("status, counts and bar", () => {
  const papers = (): ParsedPaper[] => {
    let text = note(5);
    text = setTick(text, "a", "W1", true);
    text = markSynced(setTick(text, "a", "W2", true), [{ feedId: "a", openalexId: "W2", key: "ABCD2345" }]);
    text = setDismissed(text, "a", "W3", "irrelevant");
    text = setDismissed(markSynced(setTick(text, "a", "W4", true), [{ feedId: "a", openalexId: "W4", key: "EFGH6789" }]), "a", "W4", "no-access");
    return parseInbox(text).papers;
  };

  it("is Dismissed above every other status, also for a paper that was sent or read", () => {
    const all = papers();
    const [w1, w2, w3, w4, w5] = ["W1", "W2", "W3", "W4", "W5"].map((id) => all.find((p) => p.openalexId === id) as ParsedPaper);
    expect([w1, w2, w3, w4, w5].map((p) => paperStatus(p, false))).toEqual(["ticked", "in-zotero", "dismissed", "dismissed", "new"]);
    expect(paperStatus({ ...w4, read: true }, true)).toBe("dismissed");
  });

  it("sorts last, filters and counts", () => {
    const rows = makeRows(papers(), new Set());
    expect(orderRows(rows).map((r) => r.paper.openalexId)).toEqual(["W2", "W1", "W5", "W3", "W4"]);
    expect(filterRows(rows, "dismissed").map((r) => r.paper.openalexId)).toEqual(["W3", "W4"]);
    expect(countsByStatus(rows).dismissed).toBe(2);
    expect(countsByStatus(rows).all).toBe(5);
  });

  it("is a count of its own: the line says so only when there are some, and the bar sums to 100 with it", () => {
    const counts = summariseRows(makeRows(papers(), new Set()));
    expect(counts).toEqual({ toRead: 1, ticked: 1, new: 1, read: 0, dismissed: 2 });
    expect(countsLine(counts)).toBe("1 to read · 1 new · 1 ticked · 0 read · 2 dismissed");
    expect(countsLine({ ...counts, dismissed: 0 })).toBe("1 to read · 1 new · 1 ticked · 0 read");
    const bar = barWidths(counts);
    expect(bar.toRead + bar.ticked + bar.new + bar.read + bar.dismissed).toBe(100);
    expect(bar.dismissed).toBe(40);
  });
});

describe("the archive rule and Sync", () => {
  const name = "2026-W42 Reading inbox.md";

  it("counts a dismissed paper as done at once, so a note with only read and dismissed papers is finished", () => {
    let text = note(2);
    text = markRead(text, [{ feedId: "a", openalexId: "W1", link: "Lit/p1" }]);
    text = setDismissed(text, "a", "W2", "irrelevant");
    expect(isFinished(parseInbox(text).papers, name, "2026-10-13", 4)).toBe(true);
    expect(isFinished(parseInbox(note(2)).papers, name, "2026-10-13", 4)).toBe(false);
  });

  it("does not finish a note while a dismissed paper's neighbour is waiting", () => {
    expect(isFinished(parseInbox(setDismissed(note(2), "a", "W2", "no-access")).papers, name, "2026-10-13", 4)).toBe(false);
  });

  it("never sends a dismissed paper, ticked before or sent before (a resend request)", () => {
    const ticked = setDismissed(setTick(note(2), "a", "W1", true), "a", "W1", "irrelevant");
    expect(findPending([{ path: "n.md", text: ticked }])).toEqual([]);
    const sent = markSynced(setTick(note(2), "a", "W1", true), [{ feedId: "a", openalexId: "W1", key: "ABCD2345" }]);
    expect(findPending([{ path: "n.md", text: setDismissed(sent, "a", "W1", "irrelevant") }])).toEqual([]);
  });
});

describe("the ledger", () => {
  const NOTE = "2026-W42 Reading inbox.md";
  const entry = (overrides: Partial<LedgerPaper> = {}): LedgerPaper => ({ title: "t", tier: "strong", start: "2026-10-12", topics: [], terms: [], def: 0, ...overrides });

  it("stamps a dismissal and its reason, follows a change of reason, and clears it on undo", () => {
    const ledger = emptyLedger();
    const text = note(1);
    updateFromNotes(ledger, [{ name: NOTE, papers: parseInbox(text).papers }], "2026-10-13");
    expect(ledger.papers["a/W1"].dismissed).toBeUndefined();
    updateFromNotes(ledger, [{ name: NOTE, papers: parseInbox(setDismissed(text, "a", "W1", "irrelevant")).papers }], "2026-10-14");
    expect(ledger.papers["a/W1"]).toMatchObject({ dismissed: "2026-10-14", dismissReason: "irrelevant" });
    updateFromNotes(ledger, [{ name: NOTE, papers: parseInbox(setDismissed(text, "a", "W1", "no-access")).papers }], "2026-10-15");
    expect(ledger.papers["a/W1"]).toMatchObject({ dismissed: "2026-10-14", dismissReason: "no-access" });
    expect(updateFromNotes(ledger, [{ name: NOTE, papers: parseInbox(text).papers }], "2026-10-16")).toBe(true);
    expect(ledger.papers["a/W1"].dismissed).toBeUndefined();
    expect(ledger.papers["a/W1"].dismissReason).toBeUndefined();
  });

  it("lets 'not relevant' override an earlier tick, send or read, and counts 'no access' as wanted", () => {
    expect(verdictOf(entry({ ticked: "2026-10-13", synced: "2026-10-13", read: "2026-10-14", dismissed: "2026-10-15", dismissReason: "irrelevant" }), "2026-10-16", 4)).toBe("dismissed");
    expect(verdictOf(entry({ dismissed: "2026-10-15", dismissReason: "no-access" }), "2026-10-16", 4)).toBe("interested");
    expect(verdictOf(entry({ dismissed: "2026-10-15", dismissReason: "irrelevant" }), "2026-10-16", 4)).toBe("dismissed");
  });

  it("survives a round trip through the stored file", () => {
    const ledger = emptyLedger();
    ledger.papers["a/W1"] = entry({ dismissed: "2026-10-15", dismissReason: "no-access" });
    ledger.papers["a/W2"] = entry({ dismissReason: "nonsense" as never });
    const back = normaliseLedger(JSON.parse(JSON.stringify(ledger)));
    expect(back.papers["a/W1"]).toMatchObject({ dismissed: "2026-10-15", dismissReason: "no-access" });
    expect(back.papers["a/W2"].dismissReason).toBeUndefined();
  });

  it("shows no-access papers in their own column of the report and counts a read-then-dismissed one as dismissed", () => {
    const ledger = emptyLedger();
    ledger.papers["a/W1"] = entry({ dismissed: "2026-10-15", dismissReason: "no-access" });
    ledger.papers["a/W2"] = entry({ read: "2026-10-14", dismissed: "2026-10-15", dismissReason: "irrelevant" });
    ledger.papers["a/W3"] = entry({ ticked: "2026-10-13" });
    const feed: FeedConfig = { id: "a", name: "A", enabled: true, topics: ["t"], groups: [], drop: [], lower: [], yearsFrom: null, zoteroCollection: "", project: "" };
    const [f] = buildReport(ledger, [feed], "2026-10-20", 4).feeds;
    expect(f.totals).toEqual({ listed: 3, interested: 2, dismissed: 1, undecided: 0, read: 1, noAccess: 1 });
    expect(reportMarkdown(buildReport(ledger, [feed], "2026-10-20", 4))).toContain("| Listed | Wanted | Dismissed | Undecided | Read | No access | Wanted rate |");
  });
});
