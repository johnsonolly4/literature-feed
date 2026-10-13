import { describe, expect, it } from "vitest";
import type { Candidate } from "../src/openalex/client";
import type { FeedConfig } from "../src/settings/data";
import {
  buildNote, buildPapers, doiUrl, escapeMd, isoWeek, mergeIntoNote, noteName, parseInbox, renderNote, shortOpenAlexId, weekLabel,
  NOTE_NAME_PATTERN, ensureNoteClasses, markRead, markSynced, setTick, tidySynced, waitingByFeed, waitingByTier, type FeedSection, type InboxPaper, type NoteInput,
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
    doi: `10.1000/p.${n}`, isPreprint: false, noAbstract: false, tier, matched: ["lipoic acid"], topics: [],
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
    expect(lines.slice(0, 9)).toEqual(["---", "kind: reading-inbox", "cssclasses:", "  - vt", "  - literature-feed", "  - literature-feed-table", "week: 2026-W42", "scanned: 2026-10-12", "---"]);
    expect(lines.slice(9, 13)).toEqual(["", "```literature-feed", "```", ""]);
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
        { openalexId: "W1", feedId: "lipoic", tier: "priority", ticked: true, synced: false, list: "ranked", key: null, doi: "10.1000/p.1", read: false, title: "Paper 1", topics: [], authors: "A. Author", venue: "Journal", year: 2026, preprint: false, titleOnly: false, readLink: null },
        { openalexId: "W2", feedId: "lipoic", tier: "unchecked", ticked: false, synced: false, list: "unchecked", key: null, doi: "10.1000/p.2", read: false, title: "Paper 2", topics: [], authors: "A. Author", venue: "Journal", year: 2026, preprint: false, titleOnly: false, readLink: null },
      ],
    });
  });

  it("ignores lines that are not ours, and accepts an upper-case X", () => {
    const text = "random\n- [ ] a task %%oa:W1:p%%\n> [!literature-feed]+ F %%feed:f%%\n> - [X] **t** %%oa:W7:s%%\n> - [ ] no marker";
    expect(parseInbox(text).papers).toEqual([{ openalexId: "W7", feedId: "f", tier: "strong", ticked: true, synced: false, list: "ranked", key: null, doi: null, read: false, title: "t", topics: [], authors: "", venue: "", year: null, preprint: false, titleOnly: false, readLink: null }]);
  });
});

describe("waitingByTier", () => {
  const line = (id: string, feedId: string, tier: InboxPaper["tier"], ticked = false) => ({ openalexId: id, feedId, tier, ticked, synced: false, list: "ranked" as const, key: null });

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

describe("waitingByFeed", () => {
  const line = (id: string, feedId: string, tier: InboxPaper["tier"], ticked = false) => ({ openalexId: id, feedId, tier, ticked, synced: false, list: "ranked" as const, key: null });

  it("counts each feed's unticked papers on their own, a paper found by two feeds in both", () => {
    expect(waitingByFeed([line("W1", "a", "strong"), line("W1", "b", "possible"), line("W2", "a", "unchecked"), line("W3", "b", "priority", true)])).toEqual({
      a: { priority: 0, strong: 1, possible: 0, unchecked: 1 },
      b: { priority: 0, strong: 0, possible: 1, unchecked: 0 },
    });
    expect(waitingByFeed([])).toEqual({});
  });
});

describe("markSynced", () => {
  const nl = String.fromCharCode(10);
  const base = renderNote(input([
    { feedId: "a", feedName: "A", papers: [paper(1, "strong"), paper(2, "possible")] },
    { feedId: "b", feedName: "B", papers: [paper(1, "possible")] },
  ]));
  const paperLines = (text: string) => text.split(nl).filter((l) => l.startsWith("> - ["));

  it("ticks the paper, links it, and moves it into the feed's In Zotero list at the bottom", () => {
    const out = markSynced(base, [{ feedId: "a", openalexId: "W1", key: "ABCD2345" }]);
    const parsed = parseInbox(out).papers.map((p) => `${p.feedId}:${p.openalexId}:${p.list}:${p.ticked}:${p.synced}:${p.key}`);
    expect(parsed).toEqual(["a:W2:ranked:false:false:null", "b:W1:ranked:false:false:null", "a:W1:synced:true:true:ABCD2345"]);
    expect(out).toContain("> [!literature-feed-synced]- In Zotero · 1 %%feed:a:synced%%");
    const line = paperLines(out).find((l) => l.includes("%%oa:W1:s%%")) ?? "";
    expect(line.startsWith("> - [x] **Paper 1**")).toBe(true);
    expect(line).toContain(" · [in Zotero](zotero://select/library/items/ABCD2345) %%oa:W1:s%%");
    // the other callout is recounted
    expect(out).toContain("· 1 paper %%feed:a%%");
  });

  it("changes nothing else: the other papers' lines and the other feed are as they were", () => {
    const out = markSynced(base, [{ feedId: "a", openalexId: "W1", key: "ABCD2345" }]);
    const untouched = paperLines(base).filter((l) => !l.includes("%%oa:W1:s%%"));
    for (const l of untouched) expect(paperLines(out)).toContain(l);
    expect(out.split(nl).filter((l) => l.includes("%%feed:b%%"))).toEqual(base.split(nl).filter((l) => l.includes("%%feed:b%%")));
  });

  it("removes a callout that is left empty, and adds to one that already exists", () => {
    const one = markSynced(base, [{ feedId: "a", openalexId: "W1", key: "AAAAAAAA" }]);
    const two = markSynced(one, [{ feedId: "a", openalexId: "W2", key: "BBBBBBBB" }]);
    expect(two).not.toContain("%%feed:a%%");
    expect(two).toContain("> [!literature-feed-synced]- In Zotero · 2 %%feed:a:synced%%");
    expect(parseInbox(two).papers.filter((p) => p.feedId === "a").map((p) => `${p.openalexId}:${p.list}`)).toEqual(["W1:synced", "W2:synced"]);
    expect(two).toContain("%%feed:b%%");
  });

  it("a paper from the Unchecked list moves too, and that list is recounted", () => {
    const note = renderNote(input([{ feedId: "a", feedName: "A", papers: [paper(1, "strong"), paper(2, "unchecked"), paper(3, "unchecked")] }]));
    const out = markSynced(note, [{ feedId: "a", openalexId: "W2", key: "CCCCCCCC" }]);
    expect(out).toContain("matched by OpenAlex · 1 %%feed:a:unchecked%%");
    expect(parseInbox(out).papers.find((p) => p.openalexId === "W2")?.list).toBe("synced");
  });

  it("a resync ticks the line again where it is in the In Zotero list, and keeps the new key", () => {
    const synced = markSynced(base, [{ feedId: "a", openalexId: "W1", key: "ABCD2345" }]);
    const unticked = synced.replace("> - [x] **Paper 1**", "> - [ ] **Paper 1**");
    const again = markSynced(unticked, [{ feedId: "a", openalexId: "W1", key: "ZZZZ9999" }]);
    const p = parseInbox(again).papers.find((x) => x.openalexId === "W1" && x.feedId === "a");
    expect(p).toMatchObject({ list: "synced", ticked: true, key: "ZZZZ9999" });
    expect(again.match(/%%oa:W1:s%%/g)).toHaveLength(1);
    expect(again.match(/zotero:\/\/select/g)).toHaveLength(1);
  });

  it("ignores keys that are not Zotero keys, papers that are not there, and an empty list", () => {
    expect(markSynced(base, [{ feedId: "a", openalexId: "W1", key: "bad key" }, { feedId: "a", openalexId: "W1", key: "abcd2345" }])).toBe(base);
    expect(markSynced(base, [{ feedId: "a", openalexId: "W99", key: "ABCD2345" }])).toBe(base);
    expect(markSynced(base, [])).toBe(base);
  });

  it("marks the same paper under two feeds separately", () => {
    const out = markSynced(base, [{ feedId: "a", openalexId: "W1", key: "AAAAAAAA" }, { feedId: "b", openalexId: "W1", key: "AAAAAAAA" }]);
    expect(parseInbox(out).papers.filter((p) => p.list === "synced").map((p) => p.feedId)).toEqual(["a", "b"]);
  });

  it("keeps a feed name with a dot and brackets in its header when the callout is recounted", () => {
    const note = renderNote(input([{ feedId: "a", feedName: "Lipoic [acid] · copolymers", papers: [paper(1, "strong"), paper(2, "possible")] }]));
    const out = markSynced(note, [{ feedId: "a", openalexId: "W1", key: "ABCD2345" }]);
    expect(out).toContain("> [!literature-feed]- Lipoic \\[acid\\] · copolymers · 1 paper %%feed:a%%");
  });
});

describe("what the table reads from a line", () => {
  const nl = String.fromCharCode(10);

  it("reads authors, venue, year and the marks, with escapes removed", () => {
    const rich = { ...paper(1, "strong", "T"), authors: ["Ada [Lovelace]", "B. Writer", "C", "D"], venue: "J. *of* Tests", year: 2024, isPreprint: true, noAbstract: true, doi: null, topics: [2] };
    const text = renderNote(input([{ feedId: "a", feedName: "A", papers: [rich as unknown as InboxPaper] }]));
    expect(parseInbox(text).papers[0]).toMatchObject({
      authors: "Ada [Lovelace], B. Writer, C et al.", venue: "J. *of* Tests", year: 2024, preprint: true, titleOnly: true, topics: [2],
    });
  });

  it("copes with a line that has no authors, venue or year, and with links added by Sync and Read", () => {
    const bare = { ...paper(1, "possible"), authors: [], venue: null, year: null, doi: null };
    const text = markRead(markSynced(renderNote(input([{ feedId: "a", feedName: "A", papers: [bare] }])), [{ feedId: "a", openalexId: "W1", key: "ABCD2345" }]), [{ feedId: "a", openalexId: "W1", link: "Lit/x" }]);
    expect(parseInbox(text).papers[0]).toMatchObject({ authors: "", venue: "", year: null, preprint: false, titleOnly: false, readLink: "Lit/x", read: true, synced: true });
  });

  it("reads the Read link's path, and null when there is none", () => {
    const text = renderNote(input([{ feedId: "a", feedName: "A", papers: [paper(1, "strong"), paper(2, "possible")] }]));
    const linked = markRead(text, [{ feedId: "a", openalexId: "W1", link: "04 Literature/Smith 2026.md" }]);
    expect(parseInbox(linked).papers.map((p) => p.readLink)).toEqual(["04 Literature/Smith 2026", null]);
    expect(linked.split(nl).filter((l) => l.includes("Read]]"))).toHaveLength(1);
  });
});

describe("setTick", () => {
  const nl = String.fromCharCode(10);
  const base = renderNote(input([
    { feedId: "a", feedName: "A", papers: [paper(1, "strong"), paper(2, "possible")] },
    { feedId: "b", feedName: "B", papers: [paper(1, "possible")] },
  ]));

  it("ticks and unticks only the named paper in the named feed", () => {
    const ticked = setTick(base, "a", "W1", true);
    expect(parseInbox(ticked).papers.map((p) => `${p.feedId}:${p.openalexId}:${p.ticked}`)).toEqual(["a:W1:true", "a:W2:false", "b:W1:false"]);
    const back = setTick(ticked, "a", "W1", false);
    expect(back).toBe(base);
    const changed = ticked.split(nl).filter((l, i) => l !== base.split(nl)[i]);
    expect(changed).toHaveLength(1);
  });

  it("changes nothing for an unknown paper or feed, and keeps an upper-case X ticked state consistent", () => {
    expect(setTick(base, "a", "W99", true)).toBe(base);
    expect(setTick(base, "zzz", "W1", true)).toBe(base);
    const upper = base.replace("> - [ ] **Paper 2**", "> - [X] **Paper 2**");
    expect(parseInbox(upper).papers[1].ticked).toBe(true);
    expect(parseInbox(setTick(upper, "a", "W2", false)).papers[1].ticked).toBe(false);
  });

  it("works on a paper in the In Zotero list (unticking it is the request to send it again)", () => {
    const synced = markSynced(base, [{ feedId: "a", openalexId: "W1", key: "ABCD2345" }]);
    const resend = setTick(synced, "a", "W1", false);
    expect(parseInbox(resend).papers.find((p) => p.openalexId === "W1" && p.feedId === "a")).toMatchObject({ list: "synced", ticked: false, synced: true });
  });
});

describe("ensureNoteClasses", () => {
  const nl = String.fromCharCode(10);
  const modern = renderNote(input([{ feedId: "a", feedName: "A", papers: [paper(1, "strong")] }]));
  const old = ["---", "kind: reading-inbox", "cssclasses:", "  - literature-feed", "week: 2026-W42", "scanned: 2026-10-12", "---", "", "body"].join(nl);

  it("does not touch a note that already has the classes, and new notes have them", () => {
    expect(ensureNoteClasses(modern)).toBe(modern);
    expect(modern).toContain("  - vt" + nl + "  - literature-feed" + nl + "  - literature-feed-table");
  });

  it("adds the missing classes to an old note, keeping its other properties and its body", () => {
    const out = ensureNoteClasses(old);
    expect(out).toBe(["---", "kind: reading-inbox", "cssclasses:", "  - vt", "  - literature-feed", "  - literature-feed-table", "week: 2026-W42", "scanned: 2026-10-12", "---", "", "body"].join(nl));
    expect(ensureNoteClasses(out)).toBe(out);
  });

  it("keeps classes the user added, and handles an inline list and a note with no cssclasses at all", () => {
    const user = old.replace("  - literature-feed", "  - literature-feed" + nl + "  - my-class");
    expect(ensureNoteClasses(user)).toContain("  - my-class");
    expect(ensureNoteClasses(old.replace("cssclasses:" + nl + "  - literature-feed", "cssclasses: [literature-feed, mine]"))).toContain("  - mine");
    const none = ["---", "kind: reading-inbox", "week: 2026-W42", "---", "", "body"].join(nl);
    expect(ensureNoteClasses(none)).toContain("cssclasses:" + nl + "  - vt");
  });

  it("leaves any other note alone", () => {
    expect(ensureNoteClasses("no properties here")).toBe("no properties here");
    const other = ["---", "kind: literature", "cssclasses:", "  - vt", "---", "x"].join(nl);
    expect(ensureNoteClasses(other)).toBe(other);
    expect(ensureNoteClasses(["---", "kind: reading-inbox", "no closing line"].join(nl))).toBe(["---", "kind: reading-inbox", "no closing line"].join(nl));
  });
});

describe("which topics found a paper", () => {
  it("is written as a hidden marker before the paper's id, and read back", () => {
    const withTopics = { ...paper(1, "strong"), topics: [1, 3] };
    const text = renderNote(input([{ feedId: "a", feedName: "A", papers: [withTopics, paper(2, "possible")] }]));
    const lines = text.split(String.fromCharCode(10)).filter((l) => l.startsWith("> - ["));
    expect(lines[0]).toContain(" %%tp:1,3%% %%oa:W1:s%%");
    expect(lines[1]).not.toContain("%%tp:");
    expect(parseInbox(text).papers.map((p) => p.topics)).toEqual([[1, 3], []]);
  });

  it("does not disturb the other markers: linking to Zotero and Read still work and the topics survive", () => {
    const text = renderNote(input([{ feedId: "a", feedName: "A", papers: [{ ...paper(1, "strong"), topics: [2] }] }]));
    const out = markRead(markSynced(text, [{ feedId: "a", openalexId: "W1", key: "ABCD2345" }]), [{ feedId: "a", openalexId: "W1", link: "Lit/x" }]);
    expect(parseInbox(out).papers[0]).toMatchObject({ topics: [2], synced: true, read: true, key: "ABCD2345", list: "synced" });
  });

  it("cannot be forged from a title: %% in text is neutralised", () => {
    const text = renderNote(input([{ feedId: "a", feedName: "A", papers: [paper(1, "strong", "x %%tp:9%% y")] }]));
    expect(parseInbox(text).papers[0].topics).toEqual([]);
  });
});

describe("the title of a line", () => {
  it("is read back from the bold text, with the escapes removed, whatever the title holds", () => {
    const title = "Lipoic [acid] *and* _more_ # 5 | a=b ~c $d <e> back\\slash";
    const text = renderNote(input([{ feedId: "a", feedName: "A", papers: [paper(1, "priority", title), paper(2, "possible", "Plain one")] }]));
    expect(parseInbox(text).papers.map((p) => p.title)).toEqual([title, "Plain one"]);
  });

  it("is empty for a line that has no bold title", () => {
    const text = "> [!literature-feed]+ F %%feed:f%%\n> - [ ] no bold text here %%oa:W1:s%%";
    expect(parseInbox(text).papers[0].title).toBe("");
  });
});

describe("markRead", () => {
  const nl = String.fromCharCode(10);
  const base = renderNote(input([
    { feedId: "a", feedName: "A", papers: [paper(1, "strong"), paper(2, "possible")] },
    { feedId: "b", feedName: "B", papers: [paper(1, "possible")] },
  ]));

  it("adds a Read link to the named paper in the named feed, and changes nothing else", () => {
    const out = markRead(base, [{ feedId: "a", openalexId: "W1", link: "Lit/Smith 2026.md" }]);
    const before = base.split(nl);
    const after = out.split(nl);
    expect(after).toHaveLength(before.length);
    const changed = after.filter((l, i) => l !== before[i]);
    expect(changed).toHaveLength(1);
    expect(changed[0]).toContain(" · [[Lit/Smith 2026|Read]] %%oa:W1:s%%");
    const p = parseInbox(out).papers.find((x) => x.feedId === "a" && x.openalexId === "W1");
    expect(p).toMatchObject({ read: true, ticked: false, list: "ranked" });
    expect(parseInbox(out).papers.filter((x) => x.read)).toHaveLength(1);
  });

  it("points an existing Read link at a different note, once, and does nothing when it is the same", () => {
    const once = markRead(base, [{ feedId: "a", openalexId: "W1", link: "Lit/old" }]);
    const moved = markRead(once, [{ feedId: "a", openalexId: "W1", link: "Lit/new.md" }]);
    expect(moved).toContain("[[Lit/new|Read]]");
    expect(moved).not.toContain("Lit/old");
    expect(moved.match(/\|Read\]\]/g)).toHaveLength(1);
    expect(markRead(moved, [{ feedId: "a", openalexId: "W1", link: "Lit/new" }])).toBe(moved);
  });

  it("works together with the Zotero link and keeps the paper's list and tick", () => {
    const synced = markSynced(base, [{ feedId: "a", openalexId: "W1", key: "ABCD2345" }]);
    const out = markRead(synced, [{ feedId: "a", openalexId: "W1", link: "Lit/x" }]);
    const p = parseInbox(out).papers.find((x) => x.feedId === "a" && x.openalexId === "W1");
    expect(p).toMatchObject({ read: true, synced: true, list: "synced", ticked: true, key: "ABCD2345" });
  });

  it("ignores a path that could break the link, papers that are not there, and an empty list", () => {
    for (const bad of ["a]b", "a|b", "a#b", "a^b", "a" + nl + "b", "", ".md"]) {
      expect(markRead(base, [{ feedId: "a", openalexId: "W1", link: bad }]), JSON.stringify(bad)).toBe(base);
    }
    expect(markRead(base, [{ feedId: "a", openalexId: "W99", link: "Lit/x" }])).toBe(base);
    expect(markRead(base, [])).toBe(base);
  });

  it("is read back with the DOI of the line", () => {
    const doi = parseInbox(base).papers.find((p) => p.openalexId === "W2")?.doi;
    expect(doi).toBe("10.1000/p.2");
  });
});

describe("tidySynced", () => {
  it("moves papers that are ticked and linked but still in a normal list, and leaves the rest", () => {
    const note = renderNote(input([{ feedId: "a", feedName: "A", papers: [paper(1, "strong"), paper(2, "possible")] }]));
    const old = note
      .replace("> - [ ] **Paper 1**", "> - [x] **Paper 1**")
      .replace(" %%oa:W1:s%%", " · [in Zotero](zotero://select/library/items/ABCD2345) %%oa:W1:s%%");
    const out = tidySynced(old);
    expect(parseInbox(out).papers.map((p) => `${p.openalexId}:${p.list}`)).toEqual(["W2:ranked", "W1:synced"]);
    expect(tidySynced(out)).toBe(out);
    expect(tidySynced(note)).toBe(note);
  });
});

describe("a rescan after papers were synced", () => {
  it("does not list a synced paper again, and keeps the In Zotero list", () => {
    const first = input([{ feedId: "a", feedName: "A", papers: [paper(1, "strong"), paper(2, "possible")] }]);
    const synced = markSynced(renderNote(first), [{ feedId: "a", openalexId: "W1", key: "ABCD2345" }]);
    const merged = mergeIntoNote(synced, input([{ feedId: "a", feedName: "A", papers: [paper(1, "strong"), paper(3, "possible")] }], "2026-10-19"));
    expect(parseInbox(merged).papers.map((p) => `${p.openalexId}:${p.list}`)).toEqual(["W2:ranked", "W3:ranked", "W1:synced"]);
    expect(merged.match(/%%oa:W1:/g)).toHaveLength(1);
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
