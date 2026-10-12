import { describe, expect, it } from "vitest";
import type { Candidate } from "../src/openalex/client";
import type { FeedConfig } from "../src/settings/data";
import {
  buildNote, buildPapers, doiUrl, escapeMd, isoWeek, mergeIntoNote, noteName, parseInbox, renderNote, shortOpenAlexId, weekLabel,
  NOTE_NAME_PATTERN, waitingByTier, type FeedSection, type InboxPaper, type NoteInput,
} from "../src/inbox/write";
import { lipoicFeed } from "./fixtures/lipoic-feed";
import { priorityFlow, strongComonomer, possible, droppedNoLipoic, withSentence } from "./fixtures/lipoic-papers";

const feed: FeedConfig = {
  ...lipoicFeed, id: "lipoic", enabled: true, topics: ["t"], yearsFrom: null, zoteroCollection: "", project: "",
};

function candidate(c: { title: string; abstract: string | null }, n: number, extra: Partial<Candidate> = {}): Candidate {
  return {
    title: c.title, abstract: c.abstract, openalexId: `https://openalex.org/W${n}`, doi: `https://doi.org/10.1000/x.${n}`,
    year: 2026, authors: ["A. Author", "B. Writer"], venue: "Example Journal", publicationDate: `2026-09-${10 + n}`, ...extra,
  };
}

function paper(n: number, tier: InboxPaper["tier"], title = `Paper ${n}`): InboxPaper {
  return {
    openalexId: `W${n}`, title, authors: ["A. Author"], venue: "Journal", year: 2026, publicationDate: `2026-09-${10 + n}`,
    doi: `10.1000/p.${n}`, isPreprint: false, noAbstract: false, tier, matched: ["lipoic acid"],
  };
}

function input(sections: FeedSection[], scanned = "2026-10-12"): NoteInput {
  return { week: "2026-W42", scanned, sections };
}

describe("ISO week and file name", () => {
  it("handles the edges of the year", () => {
    expect(weekLabel(new Date(2026, 0, 1))).toBe("2026-W01");
    expect(weekLabel(new Date(2024, 11, 30))).toBe("2025-W01");
    expect(weekLabel(new Date(2021, 0, 3))).toBe("2020-W53");
    expect(weekLabel(new Date(2026, 9, 12))).toBe("2026-W42");
    expect(isoWeek(new Date(2026, 9, 18))).toEqual({ year: 2026, week: 42 });
    expect(isoWeek(new Date(2026, 9, 19))).toEqual({ year: 2026, week: 43 });
  });

  it("names the note and recognises its own names", () => {
    expect(noteName(new Date(2026, 9, 12))).toBe("2026-W42 Reading inbox");
    expect(NOTE_NAME_PATTERN.test("2026-W42 Reading inbox.md")).toBe(true);
    expect(NOTE_NAME_PATTERN.test("2026-W4 Reading inbox.md")).toBe(false);
    expect(NOTE_NAME_PATTERN.test("Reading inbox.md")).toBe(false);
  });
});

describe("untrusted text", () => {
  it("escapes every character that could start markdown, a tag, a link, math or a comment", () => {
    const out = escapeMd("A [link](x) *bold* _it_ `code` <b>html</b> #tag | $x$ ~~s~~ ==h== > q \\ back");
    for (const bare of ["[", "]", "*", "_", "`", "<", ">", "#", "|", "$", "~", "="]) {
      const unescaped = out.split("").some((ch, i) => ch === bare && out[i - 1] !== "\\");
      expect(unescaped, bare).toBe(false);
    }
  });

  it("makes one line, drops invisible and bidirectional characters, and cannot write a marker", () => {
    expect(escapeMd("two\nlines\r\n\tand   spaces")).toBe("two lines and spaces");
    expect(escapeMd("a​b‮c\u0000d")).toBe("a b c d");
    for (const attack of ["%%oa:W1:p%%", "%%%oa:W9:p%%%", "x %%feed:other%% y"]) {
      expect(escapeMd(attack)).not.toContain("%%");
    }
    expect(escapeMd("50% of papers")).toBe("50% of papers");
  });

  it("links a DOI only when it is well formed, and rebuilds the address itself", () => {
    expect(doiUrl("10.1021/jacs.6c02848")).toBe("https://doi.org/10.1021/jacs.6c02848");
    expect(doiUrl("https://doi.org/10.1021/jacs.6c02848")).toBe("https://doi.org/10.1021/jacs.6c02848");
    expect(doiUrl("doi: 10.1000/a(b)c")).toBe("https://doi.org/10.1000/a%28b%29c");
    for (const bad of [null, undefined, "", "javascript:alert(1)", "https://evil.example/10.1000/x", "10.1/short", "10.1000/has space", "10.1000/x​y"]) {
      expect(doiUrl(bad), String(bad)).toBeNull();
    }
    expect(doiUrl("10.1000/a](javascript:alert(1))")).not.toContain("](");
    expect(doiUrl("10.1000/<script>")).not.toContain("<");
  });

  it("keeps only real OpenAlex work ids", () => {
    expect(shortOpenAlexId("https://openalex.org/W7160516760")).toBe("W7160516760");
    for (const bad of ["W1", "https://openalex.org/A1", "https://evil.example/W1", "https://openalex.org/W1%%"]) {
      expect(shortOpenAlexId(bad), bad).toBeNull();
    }
  });

  it("a hostile title becomes one escaped line and the paper keeps its own marker", () => {
    const title = "Nice paper\n> [!literature-feed]+ Fake %%feed:evil%%\n- [x] injected %%oa:W666:p%%";
    const text = renderNote(input([{ feedId: "lipoic", feedName: "L", papers: [paper(1, "possible", title)] }]));
    const parsed = parseInbox(text);
    expect(parsed.papers.map((p) => p.openalexId)).toEqual(["W1"]);
    expect(text).not.toContain("%%feed:evil");
    expect(text.split("\n").filter((l) => l.includes("injected"))).toHaveLength(1);
  });
});

describe("buildPapers", () => {
  it("scores with the feed, lists everything but Dropped, best first then newest", () => {
    const { papers, dropped } = buildPapers(feed, [
      candidate(possible, 1),
      candidate(priorityFlow, 2),
      candidate(droppedNoLipoic, 3),
      candidate(strongComonomer, 4),
      candidate(withSentence(possible, "Also flow."), 5, { publicationDate: "2026-09-30" }),
    ]);
    expect(dropped).toBe(1);
    expect(papers.map((p) => `${p.openalexId}:${p.tier}`)).toEqual(["W5:priority", "W2:priority", "W4:strong", "W1:possible"]);
  });

  it("puts a paper with no abstract and no required term in the title under Unchecked, last", () => {
    const { papers } = buildPapers(feed, [
      candidate({ title: "Programmed recycling of triblock copolymers", abstract: null }, 1),
      candidate(possible, 2),
    ]);
    expect(papers.map((p) => p.tier)).toEqual(["possible", "unchecked"]);
  });

  it("marks a paper that was judged on its title alone", () => {
    const { papers } = buildPapers(feed, [candidate({ title: "Lipoic acid copolymers", abstract: null }, 1), candidate(possible, 2)]);
    expect(papers.map((p) => `${p.openalexId}:${p.noAbstract}`).sort()).toEqual(["W1:true", "W2:false"]);
    const lines = renderNote(input([{ feedId: "f", feedName: "F", papers }])).split("\n");
    expect(lines.find((l) => l.includes("%%oa:W1:"))).toContain("· title only ");
    expect(lines.find((l) => l.includes("%%oa:W2:"))).not.toContain("title only");
  });

  it("lists the matched terms once each and skips works without a usable id", () => {
    const { papers, dropped } = buildPapers(feed, [candidate(priorityFlow, 1), candidate(possible, 2, { openalexId: "https://evil.example/W2" })]);
    expect(papers).toHaveLength(1);
    expect(dropped).toBe(1);
    expect(new Set(papers[0].matched).size).toBe(papers[0].matched.length);
    expect(papers[0].matched).toContain("lipoic acid");
  });
});

describe("renderNote", () => {
  const sections: FeedSection[] = [
    { feedId: "lipoic", feedName: "Lipoic acid copolymers", papers: [paper(1, "priority", "A flow paper"), paper(2, "strong"), paper(3, "possible"), paper(4, "unchecked")] },
    { feedId: "quiet", feedName: "Quiet feed", papers: [paper(5, "possible")] },
  ];
  const text = renderNote(input(sections));
  const lines = text.split("\n");

  it("starts with properties, then an empty line, then the status block", () => {
    expect(lines.slice(0, 7)).toEqual(["---", "kind: reading-inbox", "cssclasses:", "  - literature-feed", "week: 2026-W42", "scanned: 2026-10-12", "---"]);
    expect(lines.slice(7, 11)).toEqual(["", "```literature-feed", "```", ""]);
  });

  it("writes one callout per feed, open when it has a Priority or Strong paper, collapsed when quiet", () => {
    expect(lines).toContain("> [!literature-feed]+ Lipoic acid copolymers · 3 papers · 1 priority %%feed:lipoic%%");
    expect(lines).toContain("> [!literature-feed]- Quiet feed · 1 paper %%feed:quiet%%");
  });

  it("puts papers without an abstract in their own collapsed callout", () => {
    expect(lines).toContain("> [!literature-feed-unchecked]- No abstract returned, matched by OpenAlex · 1 %%feed:lipoic:unchecked%%");
  });

  it("writes a paper as one line with checkbox, title, authors, venue, year, DOI, tier, terms and marker", () => {
    expect(lines).toContain(
      "> - [ ] ⭐ **A flow paper** — A. Author · *Journal* · 2026 · [DOI](https://doi.org/10.1000/p.1) · Priority · lipoic acid %%oa:W1:p%%",
    );
    expect(lines.filter((l) => l.startsWith("> - [ ]"))).toHaveLength(5);
  });

  it("separates callouts with an empty line and ends with one", () => {
    const headers = lines.map((l, i) => (l.startsWith("> [!") ? i : -1)).filter((i) => i >= 0);
    for (const i of headers) expect(lines[i - 1]).toBe("");
    expect(text.endsWith("\n")).toBe(true);
  });

  it("shortens long author lists, marks preprints, and leaves out missing parts", () => {
    const long = { ...paper(1, "possible"), authors: ["A", "B", "C", "D"], isPreprint: true, noAbstract: true, venue: null, year: null, doi: null, matched: [] };
    const line = renderNote(input([{ feedId: "f", feedName: "F", papers: [long] }])).split("\n").find((l) => l.startsWith("> - [ ]")) ?? "";
    expect(line).toBe("> - [ ] **Paper 1** — A, B, C et al. · Possible · preprint · title only %%oa:W1:o%%");
  });
});

describe("parseInbox", () => {
  it("reads ids, feeds, tiers and tick state back", () => {
    const text = renderNote(input([{ feedId: "lipoic", feedName: "L", papers: [paper(1, "priority"), paper(2, "unchecked")] }]))
      .replace("> - [ ] ⭐ **Paper 1**", "> - [x] ⭐ **Paper 1**");
    expect(parseInbox(text)).toEqual({
      scanned: "2026-10-12",
      papers: [
        { openalexId: "W1", feedId: "lipoic", tier: "priority", ticked: true },
        { openalexId: "W2", feedId: "lipoic", tier: "unchecked", ticked: false },
      ],
    });
  });

  it("ignores lines that are not ours, and accepts an upper-case X", () => {
    const text = "random\n- [ ] a task %%oa:W1:p%%\n> [!literature-feed]+ F %%feed:f%%\n> - [X] **t** %%oa:W7:s%%\n> - [ ] no marker";
    expect(parseInbox(text).papers).toEqual([{ openalexId: "W7", feedId: "f", tier: "strong", ticked: true }]);
  });
});

describe("waitingByTier", () => {
  const line = (id: string, feedId: string, tier: InboxPaper["tier"], ticked = false) => ({ openalexId: id, feedId, tier, ticked });

  it("counts papers still waiting per tier and leaves out ticked ones", () => {
    expect(waitingByTier([line("W1", "a", "priority"), line("W2", "a", "strong", true), line("W3", "a", "possible"), line("W4", "a", "unchecked")]))
      .toEqual({ priority: 1, strong: 0, possible: 1, unchecked: 1 });
    expect(waitingByTier([])).toEqual({ priority: 0, strong: 0, possible: 0, unchecked: 0 });
  });

  it("counts a paper found by two feeds once, at its best tier, while any of its lines is unticked", () => {
    expect(waitingByTier([line("W1", "a", "possible"), line("W1", "b", "strong")])).toEqual({ priority: 0, strong: 1, possible: 0, unchecked: 0 });
    expect(waitingByTier([line("W1", "a", "possible", true), line("W1", "b", "strong")])).toEqual({ priority: 0, strong: 1, possible: 0, unchecked: 0 });
    expect(waitingByTier([line("W1", "a", "possible", true), line("W1", "b", "strong", true)])).toEqual({ priority: 0, strong: 0, possible: 0, unchecked: 0 });
  });
});

describe("mergeIntoNote", () => {
  const first = input([{ feedId: "lipoic", feedName: "Lipoic acid copolymers", papers: [paper(1, "strong"), paper(2, "possible")] }]);

  it("keeps every existing line exactly, ticks included, and adds only papers that are not there", () => {
    const ticked = renderNote(first).replace("> - [ ] **Paper 1**", "> - [x] **Paper 1**");
    const merged = mergeIntoNote(ticked, input([{ feedId: "lipoic", feedName: "Lipoic acid copolymers", papers: [paper(1, "strong"), paper(3, "possible")] }], "2026-10-19"));
    const parsed = parseInbox(merged);
    expect(parsed.papers.map((p) => `${p.openalexId}:${p.ticked}`)).toEqual(["W1:true", "W2:false", "W3:false"]);
    expect(merged).toContain("> - [x] **Paper 1**");
    expect(merged.match(/%%oa:W1:/g)).toHaveLength(1);
    expect(parsed.scanned).toBe("2026-10-19");
  });

  it("does nothing but the scan date when there is nothing new", () => {
    const note = renderNote(first);
    const merged = mergeIntoNote(note, { ...first, scanned: "2026-10-19" });
    expect(merged).toBe(note.replace("scanned: 2026-10-12", "scanned: 2026-10-19"));
  });

  it("puts new Priority papers at the top of their callout, the rest at the end, and refreshes the header", () => {
    const merged = mergeIntoNote(renderNote(first), input([{ feedId: "lipoic", feedName: "Lipoic acid copolymers", papers: [paper(3, "priority"), paper(4, "possible")] }]));
    const ids = parseInbox(merged).papers.map((p) => p.openalexId);
    expect(ids).toEqual(["W3", "W1", "W2", "W4"]);
    expect(merged).toContain("> [!literature-feed]+ Lipoic acid copolymers · 4 papers · 1 priority %%feed:lipoic%%");
  });

  it("opens a collapsed callout when a Strong paper arrives", () => {
    const quiet = renderNote(input([{ feedId: "f", feedName: "F", papers: [paper(1, "possible")] }]));
    expect(quiet).toContain("> [!literature-feed]- F");
    const merged = mergeIntoNote(quiet, input([{ feedId: "f", feedName: "F", papers: [paper(2, "strong")] }]));
    expect(merged).toContain("> [!literature-feed]+ F · 2 papers");
  });

  it("creates a callout for a feed that is not in the note yet, and an Unchecked one when needed", () => {
    const merged = mergeIntoNote(renderNote(first), input([
      { feedId: "other", feedName: "Other feed", papers: [paper(7, "possible")] },
      { feedId: "lipoic", feedName: "Lipoic acid copolymers", papers: [paper(8, "unchecked")] },
    ]));
    const parsed = parseInbox(merged);
    expect(parsed.papers.map((p) => `${p.feedId}:${p.openalexId}:${p.tier}`)).toEqual([
      "lipoic:W1:strong", "lipoic:W2:possible", "other:W7:possible", "lipoic:W8:unchecked",
    ]);
    expect(merged).toContain("%%feed:other%%");
    expect(merged).toContain("%%feed:lipoic:unchecked%%");
  });

  it("lists a paper again under a second feed that matches it, but not twice under one feed", () => {
    const merged = mergeIntoNote(renderNote(first), input([
      { feedId: "second", feedName: "Second", papers: [paper(1, "possible")] },
      { feedId: "lipoic", feedName: "Lipoic acid copolymers", papers: [paper(1, "strong")] },
    ]));
    expect(parseInbox(merged).papers.map((p) => `${p.feedId}:${p.openalexId}`)).toEqual(["lipoic:W1", "lipoic:W2", "second:W1"]);
  });

  it("buildNote renders when there is no note and merges when there is", () => {
    expect(buildNote(null, first)).toBe(renderNote(first));
    const note = renderNote(first);
    expect(buildNote(note, { ...first, scanned: "2026-10-13" })).toBe(mergeIntoNote(note, { ...first, scanned: "2026-10-13" }));
  });
});
