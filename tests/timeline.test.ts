// The timeline layout: year on the vertical axis, linked papers close together sideways, nothing on top of anything else.
import { describe, expect, it } from "vitest";
import { timelineLayout } from "../src/review/timeline";

const BOX = { width: 1000, height: 700 };

describe("timelineLayout", () => {
  it("puts older papers above newer ones and papers of one year at about one height", () => {
    const nodes = [{ id: "a", year: 2010 }, { id: "b", year: 2015 }, { id: "c", year: 2024 }, { id: "d", year: 2024 }];
    const { at } = timelineLayout(nodes, [], BOX);
    const y = (id: string): number => (at.get(id) as { y: number }).y;
    expect(y("a")).toBeLessThan(y("b"));
    expect(y("b")).toBeLessThan(y("c"));
    expect(Math.abs(y("c") - y("d"))).toBeLessThan(40);
  });

  it("places papers without a year in a row at the bottom, labelled", () => {
    const { at, guides } = timelineLayout([{ id: "a", year: 2020 }, { id: "z", year: null }], [], BOX);
    expect((at.get("z") as { y: number }).y).toBeGreaterThan((at.get("a") as { y: number }).y);
    expect(guides.map((g) => g.label)).toEqual(["2020", "no year"]);
  });

  it("keeps everything inside the box and no two papers on top of each other", () => {
    const nodes = Array.from({ length: 60 }, (_, i) => ({ id: `n${String(i).padStart(2, "0")}`, year: 2020 + (i % 3) }));
    const edges = nodes.slice(1).map((p) => ({ from: p.id, to: "n00" }));
    const { at } = timelineLayout(nodes, edges, BOX);
    const pts = [...at.values()];
    for (const p of pts) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(BOX.width);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThanOrEqual(BOX.height);
    }
    let closest = Infinity;
    for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) closest = Math.min(closest, Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y));
    expect(closest).toBeGreaterThan(5);
  });

  it("puts linked papers nearer sideways than a paper with no link", () => {
    const nodes = [{ id: "a", year: 2010 }, { id: "b", year: 2022 }, { id: "c", year: 2022 }, { id: "d", year: 2022 }, { id: "e", year: 2022 }];
    const { at } = timelineLayout(nodes, [{ from: "e", to: "a" }], BOX);
    const dx = (p: string, q: string): number => Math.abs((at.get(p) as { x: number }).x - (at.get(q) as { x: number }).x);
    expect(dx("e", "a")).toBeLessThan(dx("b", "a") + dx("c", "a") + dx("d", "a"));
  });

  it("is the same every time, whatever order the papers come in, and copes with none, one and a single year", () => {
    const nodes = Array.from({ length: 20 }, (_, i) => ({ id: `n${String(i).padStart(2, "0")}`, year: 2000 + (i % 7) }));
    const edges = nodes.slice(1).map((p, i) => ({ from: p.id, to: nodes[i].id }));
    const a = timelineLayout(nodes, edges, BOX);
    const b = timelineLayout([...nodes].reverse(), [...edges].reverse(), BOX);
    expect([...a.at].sort(([p], [q]) => p.localeCompare(q))).toEqual([...b.at].sort(([p], [q]) => p.localeCompare(q)));
    expect(timelineLayout([], [], BOX).at.size).toBe(0);
    expect(timelineLayout([{ id: "a", year: 2020 }], [], BOX).guides).toEqual([{ y: expect.any(Number), label: "2020" }]);
    expect(timelineLayout([{ id: "a", year: 2020 }, { id: "b", year: 2020 }], [], BOX).at.size).toBe(2);
  });

  it("labels at most about a dozen years when the range is long", () => {
    const nodes = Array.from({ length: 40 }, (_, i) => ({ id: `n${i}`, year: 1990 + i }));
    expect(timelineLayout(nodes, [], BOX).guides.length).toBeLessThanOrEqual(14);
  });
});
