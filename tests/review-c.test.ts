// Phase C of the literature review: the force-directed layout and the graph data the view draws. The view itself is checked by hand.
import { describe, expect, it } from "vitest";
import type { ReviewPaper } from "../src/review/collect";
import { GRAPH_HEIGHT, GRAPH_WIDTH, buildGraphData, normaliseGraph } from "../src/review/graph-data";
import { forceLayout } from "../src/review/layout";
import { buildNetwork } from "../src/review/network";
import { buildExtraRows } from "../src/review/network-text";

const BOX = { width: 1000, height: 700 };

function ring(n: number): { nodes: { id: string }[]; edges: { from: string; to: string }[] } {
  const nodes = Array.from({ length: n }, (_, i) => ({ id: `n${String(i).padStart(3, "0")}` }));
  return { nodes, edges: nodes.map((x, i) => ({ from: x.id, to: nodes[(i + 1) % n].id })) };
}

describe("forceLayout", () => {
  it("handles no nodes, one node and two nodes", () => {
    expect(forceLayout([], [], BOX).size).toBe(0);
    expect(forceLayout([{ id: "a" }], [], BOX).get("a")).toEqual({ x: 500, y: 350 });
    const two = forceLayout([{ id: "a" }, { id: "b" }], [{ from: "a", to: "b" }], BOX);
    const a = two.get("a") as { x: number; y: number };
    const b = two.get("b") as { x: number; y: number };
    expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(10);
  });

  it("gives the same picture every time, whatever order the nodes come in", () => {
    const { nodes, edges } = ring(40);
    const a = forceLayout(nodes, edges, BOX);
    const b = forceLayout([...nodes].reverse(), [...edges].reverse(), BOX);
    expect([...a]).toEqual([...b].sort(([x], [y]) => x.localeCompare(y)).map(([k, v]) => [k, v]).sort(([x], [y]) => x.localeCompare(y)));
    expect(JSON.stringify([...forceLayout(nodes, edges, BOX)])).toBe(JSON.stringify([...a]));
  });

  it("keeps every node inside the box and apart from the others", () => {
    const { nodes, edges } = ring(120);
    const at = forceLayout(nodes, edges, BOX);
    const points = [...at.values()];
    for (const p of points) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(BOX.width);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThanOrEqual(BOX.height);
    }
    let closest = Infinity;
    for (let i = 0; i < points.length; i++) for (let j = i + 1; j < points.length; j++) closest = Math.min(closest, Math.hypot(points[i].x - points[j].x, points[i].y - points[j].y));
    expect(closest).toBeGreaterThan(3);
  });

  it("puts linked nodes nearer than unlinked ones, and separates two groups", () => {
    const group = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => `${prefix}${i}`);
    const a = group("a", 8);
    const b = group("b", 8);
    const edges = [...a.flatMap((x) => a.filter((y) => y > x).map((y) => ({ from: x, to: y }))), ...b.flatMap((x) => b.filter((y) => y > x).map((y) => ({ from: x, to: y })))];
    const at = forceLayout([...a, ...b].map((id) => ({ id })), edges, BOX);
    const dist = (p: string, q: string): number => { const u = at.get(p) as { x: number; y: number }; const v = at.get(q) as { x: number; y: number }; return Math.hypot(u.x - v.x, u.y - v.y); };
    const within = a.slice(1).reduce((s, id) => s + dist("a0", id), 0) / 7;
    const between = b.reduce((s, id) => s + dist("a0", id), 0) / 8;
    expect(within).toBeLessThan(between);
  });

  it("ignores edges that name nodes that are not there", () => {
    const at = forceLayout([{ id: "a" }, { id: "b" }], [{ from: "a", to: "zzz" }], BOX);
    expect(at.size).toBe(2);
  });
});

// ---- the graph data ---------------------------------------------------------------------------------------------------

function paper(id: number, refs: number[], year: number | null): ReviewPaper {
  return {
    id: `W${id}`, title: `Paper ${id}`, authors: [], venue: null, year, publicationDate: null, doi: `10.1000/${id}`, abstract: null, isPreprint: false, citedByCount: id * 10,
    referencedWorks: refs.map((r) => `W${r}`), finds: [], tier: "strong",
  };
}

describe("buildGraphData", () => {
  const papers = [paper(1, [2, 99], 2019), paper(2, [], 2021), paper(3, [99], 2023), paper(4, [], null)];
  const net = buildNetwork(papers, { minMissing: 2, topMissing: 20, topHubs: 10 });
  const label = (id: string): string => `P${id.slice(1)}`;
  const noFlag = { zotero: null, vault: null, listedBefore: [] as string[] };
  const rows = buildExtraRows(
    { missing: [{ paper: { title: "Foundational", abstract: null, doi: "10.1000/99", year: 2010, openalexId: "https://openalex.org/W99", authors: [], venue: null, publicationDate: null, citedByCount: 500 }, count: 2, citers: ["W1", "W3"] }], alsoCite: [], stopped: null },
    (id) => label(id), () => ({ zotero: "KEY00001", vault: "Lit/note.md", listedBefore: [] }),
  );

  it("makes a node for each paper, missing and citing work, with kind, cluster, year bucket and flags", () => {
    const g = buildGraphData(papers, papers.map(() => noFlag), net, rows, label, { missingCiters: new Map([["W99", ["W1", "W3"]]]), citingCites: new Map() }, new Map([["P1", "must" as const], ["M1", "skip" as const]]));
    expect(g.width).toBe(GRAPH_WIDTH);
    expect(g.height).toBe(GRAPH_HEIGHT);
    expect(g.nodes.map((n) => [n.label, n.kind])).toEqual([["P1", "set"], ["P2", "set"], ["P3", "set"], ["P4", "set"], ["M1", "missing"]]);
    const byLabel = new Map(g.nodes.map((n) => [n.label, n]));
    expect(byLabel.get("P1")).toMatchObject({ cluster: 0, level: "must", zotero: null, citedBy: 10 });
    expect(byLabel.get("P4")).toMatchObject({ cluster: -1, yearBucket: -1 });
    expect(byLabel.get("M1")).toMatchObject({ zotero: "KEY00001", vault: "Lit/note.md", level: "skip", yearBucket: 0 });
    expect(byLabel.get("P3")?.yearBucket).toBe(5);
    expect(g.edges).toEqual([{ from: "W1", to: "W2" }, { from: "W1", to: "W99" }, { from: "W3", to: "W99" }]);
    for (const n of g.nodes) {
      expect(n.x).toBeGreaterThanOrEqual(0);
      expect(n.x).toBeLessThanOrEqual(GRAPH_WIDTH);
    }
    expect(JSON.stringify(buildGraphData(papers, papers.map(() => noFlag), net, rows, label, { missingCiters: new Map([["W99", ["W1", "W3"]]]), citingCites: new Map() }, new Map([["P1", "must" as const], ["M1", "skip" as const]])))).toBe(JSON.stringify(g));
  });

  it("copes with no papers", () => {
    const g = buildGraphData([], [], buildNetwork([]), { missing: [], alsoCite: [] }, label, { missingCiters: new Map(), citingCites: new Map() });
    expect(g.nodes).toEqual([]);
    expect(g.edges).toEqual([]);
  });

  it("reads a saved graph tolerantly", () => {
    const g = buildGraphData(papers, papers.map(() => noFlag), net, rows, label, { missingCiters: new Map(), citingCites: new Map() });
    expect(normaliseGraph(JSON.parse(JSON.stringify(g)))).toEqual(g);
    const odd = normaliseGraph({ width: 10, height: 10, nodes: [{ id: "a", label: "P1", title: "t", x: 1, y: 2, kind: "set", citedBy: 0 }, { id: 5 }, null], edges: [{ from: "a", to: "a" }, { from: "a", to: "zzz" }, 3] });
    expect(odd?.nodes).toHaveLength(1);
    expect(odd?.edges).toEqual([{ from: "a", to: "a" }]);
    for (const x of [null, 3, [], {}, { nodes: [], edges: [], width: 1, height: 1 }, { nodes: [{ id: 1 }], edges: [], width: 1, height: 1 }]) expect(normaliseGraph(x)).toBeNull();
  });
});
