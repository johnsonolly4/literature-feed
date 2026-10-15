// The data behind the 2b chart, as the owner's refcheck dashboard draws it (replication spec 11.4), on invented rows.
import { describe, expect, it } from "vitest";
import { CHART_ROWS, diagonalPoints, shortLabel, surname } from "../src/review/gaps-chart";
import type { WorkRow } from "../src/review/gaps-rows";
import { niceTicks } from "../src/ui/scatter";

const none = { zotero: null, vault: null, listedBefore: [] };
function row(key: string, o: Partial<WorkRow>): WorkRow {
  return {
    key, title: `Work ${key}`, doi: null, authors: ["Ann Lee"], year: 2019, citedBy: 50, level: 1, count: 0, of: 50, share: 0, flags: none, timing: "unknown",
    review: { level: "", reason: "" }, niche: null, nichePct: null, route: "similar", similarCount: 9, similarOf: 30, gap: 30, ...o,
  };
}

describe("diagonalPoints", () => {
  it("places a work by the share of references (x) and of neighbours (y), on one scale from 0", () => {
    const d = diagonalPoints([row("a", { share: 0.1, similarCount: 3, similarOf: 30, gap: 0 })]);
    expect(d.points[0]).toMatchObject({ key: "a", x: 10, y: 10 });
    expect(d.points[0].tip).toEqual(["Work a", "Ann Lee · 2019", "Cited by 10% of your references and 10% of similar papers", "Gap 0 points"]);
  });

  it("sets the axis maximum as the dashboard does: at least 10, else the largest value plus a tenth, rounded up", () => {
    expect(diagonalPoints([row("s", { share: 0.02, similarCount: 1, similarOf: 30, gap: 0 })]).max).toBe(10);
    expect(diagonalPoints([row("b", { share: 0.26, similarCount: 14, similarOf: 30, gap: 21 })]).max).toBe(52); // 46.67 x 1.1 = 51.3, rounded up
  });

  it("plots only the first 40 works, most cited by the neighbours first", () => {
    const rows = Array.from({ length: 45 }, (_, i) => row(`r${i}`, { share: 0.05, similarCount: 20 - Math.floor(i / 3), similarOf: 30, gap: 30 - i }));
    const d = diagonalPoints(rows);
    expect(d.points).toHaveLength(CHART_ROWS);
    expect(d.points[39].key).toBe("r39");
  });

  it("counts the points above the line and gives the median shares and the three biggest gaps", () => {
    const rows = [
      row("up", { share: 0.1, similarCount: 15, similarOf: 30, gap: 40, title: "A".repeat(70) }), // x 10, y 50
      row("up2", { share: 0, similarCount: 6, similarOf: 30, gap: 20 }), // x 0, y 20
      row("on", { share: 0.2, similarCount: 6, similarOf: 30, gap: 0 }), // x 20, y 20
      row("down", { share: 0.4, similarCount: 3, similarOf: 30, gap: -30 }), // x 40, y 10
    ];
    const d = diagonalPoints(rows);
    expect(d.above).toBe(2);
    expect(d.medianX).toBe(15); // median of 10, 0, 20, 40
    expect(d.medianY).toBe(20); // median of 50, 20, 20, 10
    expect(d.big.map((b) => b.gap)).toEqual([40, 20, 0]);
    expect(d.big[0].title).toHaveLength(55);
  });

  it("labels the five largest gaps with surname and year, as the dashboard does (both routes or not)", () => {
    const rows = Array.from({ length: 8 }, (_, i) => row(`r${i}`, { share: 0, similarCount: 3 + i, similarOf: 30, gap: 10 + i, authors: [`Ann Fam${i}`], year: 2020, route: i === 0 ? "both" : "similar" }));
    const labelled = diagonalPoints(rows).points.filter((p) => p.label !== "").map((p) => p.label).sort();
    expect(labelled).toEqual(["Fam3 2020", "Fam4 2020", "Fam5 2020", "Fam6 2020", "Fam7 2020"]);
    expect(surname(["Ann Lee, Bo Roe"])).toBe("Lee");
    expect(surname(["Lee"])).toBe("Lee");
    expect(shortLabel([], 2019)).toBe("2019");
  });

  it("marks the works found on both routes", () => {
    const d = diagonalPoints([row("b", { route: "both" }), row("s", { route: "similar" })]);
    expect(d.points.map((p) => p.both)).toEqual([true, false]);
  });

  it("leaves out rows from a run that did not save the reference count, and says how many", () => {
    const d = diagonalPoints([row("old", { gap: null }), row("new", { share: 0.1 }), row("noscan", { similarCount: null, similarOf: null, gap: null })]);
    expect(d.points.map((p) => p.key)).toEqual(["new"]);
    expect(d.left).toBe(1);
  });
});

describe("niceTicks", () => {
  it("gives about six round ticks from 0, as d3 does", () => {
    expect(niceTicks(10)).toEqual([0, 2, 4, 6, 8, 10]);
    expect(niceTicks(12)).toEqual([0, 2, 4, 6, 8, 10, 12]);
    expect(niceTicks(25)).toEqual([0, 5, 10, 15, 20, 25]);
    expect(niceTicks(52)).toEqual([0, 10, 20, 30, 40, 50]);
  });
});
