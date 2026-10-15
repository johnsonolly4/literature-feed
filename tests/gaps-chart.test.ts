// The data behind the 2b diagonal chart, on invented rows.
import { describe, expect, it } from "vitest";
import { diagonalPoints, shortLabel } from "../src/review/gaps-chart";
import type { WorkRow } from "../src/review/gaps-rows";

const none = { zotero: null, vault: null, listedBefore: [] };
function row(key: string, o: Partial<WorkRow>): WorkRow {
  return {
    key, title: `Work ${key}`, doi: null, authors: ["Ann Lee"], year: 2019, citedBy: 50, level: 1, count: 0, of: 50, share: 0, flags: none, timing: "unknown",
    review: { level: "", reason: "" }, niche: null, nichePct: null, route: "similar", similarCount: 9, similarOf: 30, gap: 30, ...o,
  };
}

describe("diagonalPoints", () => {
  it("places a work by the share of references (x) and of neighbours (y), on one scale of at least 10", () => {
    const d = diagonalPoints([row("a", { count: 5, share: 0.1, similarCount: 3, similarOf: 30, gap: 0 })]);
    expect(d.points[0]).toMatchObject({ key: "a", x: 10, y: 10 });
    expect(d.max).toBe(10);
    expect(diagonalPoints([row("b", { similarCount: 14, similarOf: 30, gap: 47 })]).max).toBe(50); // 46.7 rounds up to the next multiple of 5
  });

  it("counts points above, on and below the line, and the both-route ones above", () => {
    const rows = [
      row("up", { share: 0.1, similarCount: 15, similarOf: 30, route: "both" }),
      row("up2", { share: 0, similarCount: 6, similarOf: 30 }),
      row("on", { share: 0.2, similarCount: 6, similarOf: 30, gap: 0 }),
      row("down", { share: 0.4, similarCount: 3, similarOf: 30, gap: -30, route: "both" }),
    ];
    const d = diagonalPoints(rows);
    expect([d.above, d.on, d.below, d.aboveBoth]).toEqual([2, 1, 1, 1]);
    expect(d.points.find((p) => p.key === "down")?.both).toBe(true);
  });

  it("labels at most five points, the largest gaps above the line, with family name and year", () => {
    const rows = Array.from({ length: 8 }, (_, i) => row(`r${i}`, { share: 0, similarCount: 3 + i, similarOf: 30, gap: 10 + i, authors: [`Ann Fam${i}`], year: 2020 }));
    const d = diagonalPoints(rows);
    expect(d.points.filter((p) => p.label !== "").map((p) => p.label).sort()).toEqual(["Fam3 2020", "Fam4 2020", "Fam5 2020", "Fam6 2020", "Fam7 2020"]);
    expect(shortLabel(["Lee, Ann"], null)).toBe("Lee");
    expect(shortLabel([], 2019)).toBe("2019");
  });

  it("labels the works found on both routes first, and skips a label that would cover another", () => {
    const rows = [
      // Five neighbours-only works on one spot with big gaps, and one both-route work with a smaller gap.
      ...Array.from({ length: 5 }, (_, i) => row(`s${i}`, { share: 0.02, similarCount: 9, similarOf: 30, gap: 28, authors: [`Ann Same${i}`], year: 2020 })),
      row("b", { share: 0.2, similarCount: 14, similarOf: 30, gap: 27, route: "both", authors: ["Bo Both"], year: 2018 }),
    ];
    const labelled = diagonalPoints(rows).points.filter((p) => p.label !== "").map((p) => p.label);
    expect(labelled).toContain("Both 2018");
    expect(labelled.filter((l) => l.startsWith("Same"))).toHaveLength(1); // the five on one spot would cover each other
  });

  it("puts a label to the left of a dot near the right edge", () => {
    const d = diagonalPoints([row("edge", { share: 0.46, similarCount: 15, similarOf: 30, gap: 4, route: "both", authors: ["Ann Verylongfamilyname"], year: 2019 })]);
    expect(d.points[0].labelLeft).toBe(true);
    const mid = diagonalPoints([row("mid", { share: 0.05, similarCount: 15, similarOf: 30, gap: 45, route: "both" })]);
    expect(mid.points[0].labelLeft).toBeUndefined();
  });

  it("leaves out rows from a run that did not save the reference count, and says how many", () => {
    const d = diagonalPoints([row("old", { gap: null }), row("new", { share: 0.1 }), row("noscan", { similarCount: null, similarOf: null, gap: null })]);
    expect(d.points.map((p) => p.key)).toEqual(["new"]);
    expect(d.left).toBe(1);
  });
});
