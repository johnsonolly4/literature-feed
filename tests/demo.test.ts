// The demo set made by scripts/make-demo.mjs must read back with the plugin's own code and show every status, so that the guide
// in it is true. Runs the script into a temporary folder (not into test-vault).
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { emptyLedger, recordDefinitions, updateFromNotes } from "../src/ledger/ledger";
import { buildReport } from "../src/ledger/report";
import { localDay } from "../src/inbox/scan";
import { buildLiteratureIndex, findLiteratureNote, isFinished } from "../src/inbox/state";
import { agesOutSoon, makeRows, takeawayFilled } from "../src/inbox/table";
import { markRead, parseInbox } from "../src/inbox/write";
import type { FeedConfig } from "../src/settings/data";

let dir = "";
const today = localDay(new Date());

function read(sub: string, name: string): string {
  return readFileSync(join(dir, sub, name), "utf8");
}

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "literature-feed-demo-test-"));
  execFileSync(process.execPath, ["scripts/make-demo.mjs", "--out", dir], { stdio: "pipe" });
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** The literature notes' title and zotero-key as the plugin's index wants them. */
function literature() {
  return readdirSync(join(dir, "Literature")).map((name) => {
    const text = read("Literature", name);
    const front: Record<string, string> = {};
    for (const m of text.matchAll(/^([a-z-]+): "?(.*?)"?$/gm)) front[m[1]] = m[2];
    return { path: `Demo/Literature/${name}`, frontmatter: front, text };
  });
}

function inboxNames(): string[] {
  return readdirSync(join(dir, "Inbox")).sort();
}

describe("the demo set", () => {
  it("makes four weekly notes, a guide and literature notes", () => {
    expect(inboxNames()).toHaveLength(4);
    expect(readdirSync(dir).sort()).toEqual(["Archive", "Demo guide.md", "Inbox", "Literature"]);
    expect(read(".", "Demo guide.md")).toContain("```literature-feed");
  });

  it("shows New, Ticked and In Zotero from the start, and Read and Processed once the read state is updated", () => {
    const index = buildLiteratureIndex(literature());
    const rows = inboxNames().flatMap((name) => {
      let text = read("Inbox", name);
      const marks = parseInbox(text).papers.flatMap((p) => {
        const link = findLiteratureNote(index, p.doi, p.key, p.title);
        return link === null ? [] : [{ feedId: p.feedId, openalexId: p.openalexId, link }];
      });
      text = markRead(text, marks);
      const processed = new Set(
        parseInbox(text).papers.filter((p) => p.readLink !== null && takeawayFilled(literature().find((l) => l.path.replace(/\.md$/, "") === p.readLink)?.text ?? ""))
          .map((p) => `${p.feedId}|${p.openalexId}`),
      );
      return makeRows(parseInbox(text).papers, processed);
    });
    const statuses = new Set(rows.map((r) => r.status));
    expect([...statuses].sort()).toEqual(["dismissed", "in-zotero", "new", "processed", "read", "ticked"]);
    expect(rows.filter((r) => r.status === "dismissed").map((r) => r.paper.dismissed).sort()).toEqual(["irrelevant", "no-access"]);
    expect(rows.filter((r) => r.status === "read")).toHaveLength(2);
    expect(rows.filter((r) => r.status === "processed")).toHaveLength(1);
  });

  it("has every tier, a preprint, a title-only line, an unchecked list, and one paper under two searches", () => {
    const papers = inboxNames().flatMap((name) => parseInbox(read("Inbox", name)).papers);
    expect(new Set(papers.map((p) => p.tier))).toEqual(new Set(["priority", "strong", "possible", "unchecked"]));
    expect(papers.some((p) => p.preprint)).toBe(true);
    expect(papers.some((p) => p.titleOnly)).toBe(true);
    expect(papers.some((p) => p.list === "unchecked")).toBe(true);
    expect(papers.some((p) => p.list === "synced" && !p.ticked)).toBe(true); // the resend request
    const shared = papers.filter((p) => p.openalexId === papers.find((q) => q.title.includes("Radical ring-opening"))?.openalexId);
    expect(new Set(shared.map((p) => p.feedId))).toEqual(new Set(["demo-polymers", "demo-catalysts"]));
  });

  it("has one note that is finished (archived by Update), one about to age out, and two that stay", () => {
    const [old, soon, last, now] = inboxNames().map((name) => ({ name, papers: parseInbox(read("Inbox", name)).papers }));
    expect(isFinished(old.papers, old.name, today, 4)).toBe(true);
    for (const n of [soon, last, now]) expect(isFinished(n.papers, n.name, today, 4)).toBe(false);
    const soonRows = makeRows(soon.papers, new Set());
    expect(soonRows.some((r) => agesOutSoon(r.status, soon.name, today, 4))).toBe(true);
    expect(makeRows(old.papers, new Set()).some((r) => agesOutSoon(r.status, old.name, today, 4))).toBe(false);
  });

  it("gives the search report something to say: a term that does well and one that does badly", () => {
    const ledger = emptyLedger();
    const feed = (id: string): FeedConfig => ({
      id, name: id, enabled: true, topics: ["t"], groups: [], drop: [], lower: [], yearsFrom: null, zoteroCollection: "", project: "", seedCollection: "", knownDois: [],
    });
    recordDefinitions(ledger, [feed("demo-polymers"), feed("demo-catalysts")], today);
    updateFromNotes(ledger, inboxNames().map((name) => ({ name, papers: parseInbox(read("Inbox", name)).papers })), today);
    const [polymers] = buildReport(ledger, [feed("demo-polymers"), feed("demo-catalysts")], today, 4).feeds;
    expect(polymers.termsHigh.map((t) => t.term)).toContain("bayesian");
    expect(polymers.termsLow.map((t) => t.term)).toContain("adhesive");
    expect(polymers.totals.dismissed).toBeGreaterThanOrEqual(4);
  });
});
