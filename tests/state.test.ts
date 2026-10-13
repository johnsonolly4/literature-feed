import { describe, expect, it } from "vitest";
import { buildLiteratureIndex, findLiteratureNote, isFinished, noteWeekStart, unfinishedPapers } from "../src/inbox/state";
import type { ParsedPaper } from "../src/inbox/write";

describe("buildLiteratureIndex", () => {
  it("finds a DOI in any property, in any case and with or without the address", () => {
    const index = buildLiteratureIndex([
      { path: "Lit/a.md", frontmatter: { DOI: "10.1021/JACS.6C02848" } },
      { path: "Lit/b.md", frontmatter: { doi: "https://doi.org/10.1000/Abc.1", title: "Something" } },
      { path: "Lit/c.md", frontmatter: { url: "see https://dx.doi.org/10.5555/xyz.9." } },
    ]);
    expect(index.byDoi.get("10.1021/jacs.6c02848")).toBe("Lit/a.md");
    expect(index.byDoi.get("10.1000/abc.1")).toBe("Lit/b.md");
    expect(index.byDoi.get("10.5555/xyz.9")).toBe("Lit/c.md");
  });

  it("finds a Zotero key in a zotero:// link, or alone in a property that mentions a key or Zotero", () => {
    const index = buildLiteratureIndex([
      { path: "Lit/a.md", frontmatter: { link: "zotero://select/library/items/ABCD2345" } },
      { path: "Lit/b.md", frontmatter: { "zotero-key": "EFGH6789" } },
      { path: "Lit/c.md", frontmatter: { citekey: "SMIT2024" } },
      { path: "Lit/d.md", frontmatter: { shout: "ABCDEFGH" } }, // eight capitals, but not a key property
      { path: "Lit/e.md", frontmatter: { open: "zotero://open-pdf/library/items/JKLM1234?page=3" } },
    ]);
    expect([...index.byKey.keys()].sort()).toEqual(["ABCD2345", "EFGH6789", "JKLM1234", "SMIT2024"]);
    expect(index.byKey.get("ABCD2345")).toBe("Lit/a.md");
  });

  it("looks inside lists and nested values, and skips notes without frontmatter", () => {
    const index = buildLiteratureIndex([
      { path: "Lit/a.md", frontmatter: { ids: ["x", { doi: "10.1000/nested.1" }] } },
      { path: "Lit/b.md", frontmatter: null },
      { path: "Lit/c.md", frontmatter: undefined },
    ]);
    expect([...index.byDoi.keys()]).toEqual(["10.1000/nested.1"]);
  });

  it("gives the first path in alphabetical order when two notes hold the same DOI", () => {
    const index = buildLiteratureIndex([
      { path: "Lit/z.md", frontmatter: { doi: "10.1000/same" } },
      { path: "Lit/a.md", frontmatter: { doi: "10.1000/same" } },
    ]);
    expect(index.byDoi.get("10.1000/same")).toBe("Lit/a.md");
  });
});

describe("findLiteratureNote", () => {
  const index = buildLiteratureIndex([
    { path: "Lit/key.md", frontmatter: { "zotero-key": "ABCD2345" } },
    { path: "Lit/doi.md", frontmatter: { doi: "10.1000/x.1" } },
  ]);

  it("matches by key first, then by DOI, and finds nothing for neither", () => {
    expect(findLiteratureNote(index, "10.1000/x.1", "ABCD2345")).toBe("Lit/key.md");
    expect(findLiteratureNote(index, "10.1000/X.1", null)).toBe("Lit/doi.md");
    expect(findLiteratureNote(index, "10.1000/x.1", "ZZZZ9999")).toBe("Lit/doi.md");
    expect(findLiteratureNote(index, "10.1000/other", null)).toBeNull();
    expect(findLiteratureNote(index, null, null)).toBeNull();
  });
});

describe("noteWeekStart", () => {
  it("gives the Monday of the ISO week in the file name", () => {
    expect(noteWeekStart("2026-W42 Reading inbox.md")).toBe("2026-10-12");
    expect(noteWeekStart("2026-W01 Reading inbox.md")).toBe("2025-12-29");
    expect(noteWeekStart("2021-W01 Reading inbox.md")).toBe("2021-01-04");
    expect(noteWeekStart("2020-W53 Reading inbox.md")).toBe("2020-12-28");
  });

  it("gives null for a name without a week", () => {
    expect(noteWeekStart("Reading inbox.md")).toBeNull();
    expect(noteWeekStart("2026-W00 Reading inbox.md")).toBeNull();
    expect(noteWeekStart("2026-W54 Reading inbox.md")).toBeNull();
  });
});

function paper(id: string, overrides: Partial<ParsedPaper> = {}): ParsedPaper {
  return { openalexId: id, feedId: "a", tier: "strong", ticked: false, synced: false, list: "ranked", key: null, doi: null, read: false, ...overrides };
}

describe("isFinished", () => {
  const name = "2026-W42 Reading inbox.md"; // the week ends on Monday 2026-10-19
  const today = "2026-10-20";

  it("is finished when every paper is synced or read", () => {
    expect(isFinished([paper("W1", { ticked: true, synced: true, list: "synced" }), paper("W2", { read: true })], name, today, 4)).toBe(true);
  });

  it("is open while a ticked paper is not synced yet", () => {
    expect(isFinished([paper("W1", { ticked: true })], name, "2030-01-01", 4)).toBe(false);
  });

  it("is open while an unticked paper is from a young week, and finished once N weeks have passed", () => {
    const papers = [paper("W1", { ticked: true, synced: true, list: "synced" }), paper("W2")];
    expect(isFinished(papers, name, today, 4)).toBe(false);
    expect(isFinished(papers, name, "2026-11-15", 4)).toBe(false);
    expect(isFinished(papers, name, "2026-11-16", 4)).toBe(true); // 2026-10-19 plus 4 weeks
    expect(isFinished(papers, name, "2026-10-26", 1)).toBe(true); // N = 1: the week after
    expect(isFinished(papers, name, "2026-10-25", 1)).toBe(false);
  });

  it("is open when an unticked paper in the In Zotero list is waiting to be sent again", () => {
    const papers = [paper("W1", { ticked: false, synced: true, list: "synced" })];
    expect(isFinished(papers, name, "2030-01-01", 4)).toBe(false);
    expect(unfinishedPapers(papers, name, "2030-01-01", 4)).toHaveLength(1);
  });

  it("a note with no papers is finished, and a name without a week never dismisses", () => {
    expect(isFinished([], name, today, 4)).toBe(true);
    expect(isFinished([paper("W1")], "Notes.md", "2030-01-01", 4)).toBe(false);
  });
});
