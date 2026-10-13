// The authors table: matching names, shares of the cited and uncited works, labels, and the text outputs.
import { describe, expect, it } from "vitest";
import { authorKey, authorShares, authorTableCsv, authorTableMarkdown } from "../src/review/gaps-authors";

describe("authorKey", () => {
  it("matches spellings of one author by family name and first initial", () => {
    expect(authorKey("Craig J. Hawker")).toBe("hawker|c");
    expect(authorKey("C. J. Hawker")).toBe("hawker|c");
    expect(authorKey("Hawker, Craig")).toBe("hawker|c");
    expect(authorKey("Hawker, C. J.")).toBe("hawker|c");
  });

  it("drops accents and punctuation, takes the last word as the family name, and gives nothing for no name", () => {
    expect(authorKey("José Álvarez-Peña")).toBe("alvarezpena|j");
    expect(authorKey("Javier Read de Alaniz")).toBe("alaniz|j");
    expect(authorKey("Madonna")).toBe("madonna|");
    expect(authorKey("  ")).toBe("");
    expect(authorKey("")).toBe("");
  });
});

describe("authorShares", () => {
  // Cited: 4 works. Uncited: 2 works. Smith is on 1 of 4 cited and 2 of 2 uncited; Jones on 3 of 4 cited and 0 uncited.
  const cited = [["Anna Smith", "Bob Jones"], ["Bob Jones", "Cy Lee"], ["Bob Jones"], ["Dee Wu"]];
  const uncited = [["A. Smith", "Cy Lee"], ["Anna Smith"]];

  it("counts works per author, as percents of each side, and the difference in points", () => {
    const t = authorShares(cited, uncited, { min: 1 });
    expect([t.citedWorks, t.uncitedWorks]).toEqual([4, 2]);
    expect(t.rows.find((r) => r.key === "smith|a")).toMatchObject({ cited: 1, uncited: 2, citedPct: 25, uncitedPct: 100, diff: 75, label: "Under-cited" });
    expect(t.rows.find((r) => r.key === "jones|b")).toMatchObject({ cited: 3, uncited: 0, citedPct: 75, uncitedPct: 0, diff: -75, label: "Over-cited" });
    expect(t.rows.find((r) => r.key === "lee|c")).toMatchObject({ cited: 1, uncited: 1, citedPct: 25, uncitedPct: 50, diff: 25, label: "" });
  });

  it("sorts by the size of the difference, then by how many works", () => {
    const t = authorShares(cited, uncited, { min: 1 });
    // Smith and Jones both differ by 75 points; Jones is on more works (3) than Smith (3 as well: 1 + 2), so the name decides.
    expect(t.rows.slice(0, 2).map((r) => r.key).sort()).toEqual(["jones|b", "smith|a"]);
    expect(Math.abs(t.rows[0].diff)).toBeGreaterThanOrEqual(Math.abs(t.rows[1].diff));
    expect(Math.abs(t.rows[1].diff)).toBeGreaterThanOrEqual(Math.abs(t.rows[2].diff));
  });

  it("leaves out authors on fewer works than the minimum, and gives no label under three works", () => {
    const t = authorShares(cited, uncited, { min: 2 });
    expect(t.rows.map((r) => r.key).sort()).toEqual(["jones|b", "lee|c", "smith|a"]);
    expect(t.rows.find((r) => r.key === "lee|c")?.label).toBe("");
    expect(authorShares(cited, uncited, { min: 3 }).rows.map((r) => r.key).sort()).toEqual(["jones|b", "smith|a"]);
  });

  it("marks the paper's own authors and counts an author once per work", () => {
    const t = authorShares([["Anna Smith", "A. Smith"], ["Bob Jones"]], [["Cy Lee"]], { min: 1, own: ["Smith, Anna"] });
    expect(t.rows.find((r) => r.key === "smith|a")).toMatchObject({ cited: 1, own: true });
    expect(t.rows.find((r) => r.key === "jones|b")?.own).toBe(false);
  });

  it("leaves works with no author list out of the totals, and copes with nothing", () => {
    const t = authorShares([["Anna Smith"], [], [""]], [[]], { min: 1 });
    expect([t.citedWorks, t.uncitedWorks]).toEqual([1, 0]);
    expect(t.rows[0]).toMatchObject({ cited: 1, uncited: 0, uncitedPct: 0 });
    expect(authorShares([], [])).toEqual({ rows: [], citedWorks: 0, uncitedWorks: 0 });
  });

  it("shows the most common spelling of a name", () => {
    const t = authorShares([["Craig J. Hawker"], ["Craig J. Hawker"], ["C. Hawker"]], [], { min: 1 });
    expect(t.rows[0].name).toBe("Craig J. Hawker");
  });
});

describe("the table as text", () => {
  const t = authorShares([["Anna Smith"], ["Anna Smith"], ["Bob Jones"]], [["Anna Smith"], ["Cy Lee"], ["Cy Lee"]], { min: 1, own: ["Anna Smith"] });

  it("writes a Markdown table with the totals, percents, points and labels, and marks own authors", () => {
    const md = authorTableMarkdown(t).join("\n");
    expect(md).toContain("3 cited works and the 3 uncited works");
    expect(md).toContain("| Author | Cited works | % of cited | Uncited works | % of uncited | Difference | |");
    expect(md).toContain("| Cy Lee | 0 | 0% | 2 | 67% | +67 points |");
    expect(md).toContain("★ Anna Smith");
    expect(authorTableMarkdown({ rows: [], citedWorks: 0, uncitedWorks: 0 }).join("\n")).toContain("No author appears");
  });

  it("limits the rows and writes a CSV that quotes names with commas", () => {
    const rowsOf = (lines: string[]): string[] => lines.filter((l) => l.startsWith("| ") && !l.startsWith("| Author") && !l.startsWith("| ---"));
    expect(rowsOf(authorTableMarkdown(t, 1))).toHaveLength(1);
    const csv = authorTableCsv(authorShares([["Smith, Anna"]], [["Cy Lee"]], { min: 1 })).split("\n");
    expect(csv[0]).toBe("author,own_author,cited_works,cited_percent,uncited_works,uncited_percent,difference_points,label");
    expect(csv.some((l) => l.startsWith('"Smith, Anna",'))).toBe(true);
  });
});
