// The review's graph as data: a node per paper (in the set, possibly missing, or citing several of them) with where it sits, how it
// is coloured and what the user already has of it, and an edge per citation. Pure; the view only draws it.
import type { ReviewPaper } from "./collect";
import type { Flags } from "./flags";
import { forceLayout } from "./layout";
import type { Network } from "./network";
import type { ExtraRow } from "./network-text";
import type { ReadLevel } from "./prompt";

export interface GraphNode {
  id: string;
  /** P1, M1 or C1. */
  label: string;
  title: string;
  year: number | null;
  citedBy: number;
  kind: "set" | "missing" | "citing";
  /** Index of the group of papers that cite each other, or -1 for a paper with no link. */
  cluster: number;
  /** 0 (oldest) to 5 (newest), or -1 when the year is unknown. */
  yearBucket: number;
  zotero: string | null;
  vault: string | null;
  doi: string | null;
  /** The LLM's reading level, when an answer has been checked. */
  level: ReadLevel | null;
  x: number;
  y: number;
}

export interface GraphData {
  nodes: GraphNode[];
  edges: { from: string; to: string }[];
  width: number;
  height: number;
}

export const GRAPH_WIDTH = 1000;
export const GRAPH_HEIGHT = 700;

/** Oldest to newest in six buckets, by the years that occur. */
function yearBuckets(years: readonly (number | null)[]): (year: number | null) => number {
  const known = years.filter((y): y is number => y !== null);
  if (known.length === 0) return () => -1;
  const min = Math.min(...known);
  const max = Math.max(...known);
  return (year) => (year === null ? -1 : max === min ? 5 : Math.min(5, Math.floor(((year - min) / (max - min)) * 6)));
}

export function buildGraphData(
  papers: readonly ReviewPaper[], flags: readonly Flags[], network: Network, rows: { missing: ExtraRow[]; alsoCite: ExtraRow[] },
  labelOf: (id: string) => string, links: { missingCiters: ReadonlyMap<string, readonly string[]>; citingCites: ReadonlyMap<string, readonly string[]> },
  levels: ReadonlyMap<string, ReadLevel> = new Map(),
): GraphData {
  const bucket = yearBuckets([...papers.map((p) => p.year), ...rows.missing.map((r) => r.year), ...rows.alsoCite.map((r) => r.year)]);
  const clusterOf = new Map<string, number>();
  network.clusters.forEach((c, i) => c.forEach((id) => clusterOf.set(id, i)));
  const nodes: GraphNode[] = [];
  papers.forEach((p, i) => {
    nodes.push({
      id: p.id, label: labelOf(p.id), title: p.title, year: p.year, citedBy: p.citedByCount, kind: "set", cluster: clusterOf.get(p.id) ?? -1, yearBucket: bucket(p.year),
      zotero: flags[i]?.zotero ?? null, vault: flags[i]?.vault ?? null, doi: p.doi, level: levels.get(labelOf(p.id)) ?? null, x: 0, y: 0,
    });
  });
  const add = (r: ExtraRow, kind: "missing" | "citing"): void => {
    nodes.push({ id: r.id, label: r.label, title: r.title, year: r.year, citedBy: r.citedBy, kind, cluster: -1, yearBucket: bucket(r.year), zotero: r.flags.zotero, vault: r.flags.vault, doi: r.doi, level: levels.get(r.label) ?? null, x: 0, y: 0 });
  };
  for (const r of rows.missing) add(r, "missing");
  for (const r of rows.alsoCite) add(r, "citing");

  const ids = new Set(nodes.map((n) => n.id));
  const edges: GraphData["edges"] = network.edges.map((e) => ({ from: e.from, to: e.to }));
  for (const [missing, citers] of links.missingCiters) for (const c of citers) if (ids.has(missing) && ids.has(c)) edges.push({ from: c, to: missing });
  for (const [citing, cites] of links.citingCites) for (const c of cites) if (ids.has(citing) && ids.has(c)) edges.push({ from: citing, to: c });

  const at = forceLayout(nodes, edges, { width: GRAPH_WIDTH, height: GRAPH_HEIGHT });
  for (const n of nodes) {
    const p = at.get(n.id);
    if (p) {
      n.x = p.x;
      n.y = p.y;
    }
  }
  return { nodes, edges, width: GRAPH_WIDTH, height: GRAPH_HEIGHT };
}

/** The graph data from whatever the file held; null when it is not usable. */
export function normaliseGraph(raw: unknown): GraphData | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const r = raw as { nodes?: unknown; edges?: unknown; width?: unknown; height?: unknown };
  if (!Array.isArray(r.nodes) || !Array.isArray(r.edges) || typeof r.width !== "number" || typeof r.height !== "number") return null;
  const nodes = r.nodes.filter((n): n is GraphNode => {
    if (typeof n !== "object" || n === null) return false;
    const x = n as Partial<GraphNode>;
    return typeof x.id === "string" && typeof x.label === "string" && typeof x.title === "string" && typeof x.x === "number" && typeof x.y === "number"
      && (x.kind === "set" || x.kind === "missing" || x.kind === "citing") && typeof x.citedBy === "number";
  });
  const ids = new Set(nodes.map((n) => n.id));
  const edges = r.edges.filter((e): e is { from: string; to: string } => {
    if (typeof e !== "object" || e === null) return false;
    const x = e as { from?: unknown; to?: unknown };
    return typeof x.from === "string" && typeof x.to === "string" && ids.has(x.from) && ids.has(x.to);
  });
  return nodes.length === 0 ? null : { nodes, edges, width: r.width, height: r.height };
}

/** The code block language of a graph in a note. */
export const GRAPH_BLOCK = "literature-feed-graph";

/** The graph as a code block for a review note (positions rounded to keep it small). */
export function graphBlock(graph: GraphData): string[] {
  const small: GraphData = { ...graph, nodes: graph.nodes.map((n) => ({ ...n, x: Math.round(n.x), y: Math.round(n.y) })) };
  return ["```" + GRAPH_BLOCK, JSON.stringify(small), "```"];
}

/** A graph from the text of a code block; null when it is not one. */
export function parseGraphBlock(source: string): GraphData | null {
  try {
    return normaliseGraph(JSON.parse(source));
  } catch {
    return null;
  }
}

/** The first graph block in a note's text, or null. */
export function graphFromNote(text: string): GraphData | null {
  const m = new RegExp("```" + GRAPH_BLOCK + "\\s*\\r?\\n([\\s\\S]*?)\\r?\\n```").exec(text);
  return m ? parseGraphBlock(m[1]) : null;
}
