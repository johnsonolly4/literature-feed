// The citation network as an Obsidian Canvas file (JSON Canvas): one card per paper, laid out by year from left to right and by group
// from top to bottom, in-set papers, possibly missing papers and citing papers in different colours, an edge for every citation.
// Pure: the plugin writes the `.canvas` file.
import type { ReviewPaper } from "./collect";
import type { Flags } from "./flags";
import type { Network } from "./network";
import type { ExtraRow } from "./network-text";

export interface CanvasNode {
  id: string;
  type: "text";
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  color?: string;
}

export interface CanvasEdge {
  id: string;
  fromNode: string;
  toNode: string;
  fromSide: "left" | "right";
  toSide: "left" | "right";
  color?: string;
}

export interface CanvasFile {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
}

const WIDTH = 340;
const HEIGHT = 120;
const COLUMN = 420;
const ROW = 160;
/** Obsidian's preset colours: 1 red, 2 orange, 3 yellow, 4 green, 5 cyan, 6 purple. */
const COLOUR = { inSet: "5", missing: "1", citing: "6" } as const;

function cardText(label: string, title: string, year: number | null, citedBy: number, flags: Flags | undefined, detail?: string): string {
  const have = flags ? [flags.zotero ? "in Zotero" : "", flags.vault ? "in vault" : ""].filter((x) => x !== "").join(", ") : "";
  return [`**${label}** ${title.replace(/\s+/g, " ").trim()}`, `${year ?? "year unknown"} · cited ${citedBy}${have === "" ? "" : ` · ${have}`}`, ...(detail ? [detail] : [])].join("\n");
}

/**
 * The canvas. `labelOf` gives each paper's P-label. Columns are years (papers of unknown year go in the first column), rows follow
 * the groups of papers that cite each other, then the rest; missing and citing works sit in the column of their year as well.
 */
export function buildCanvas(
  papers: readonly ReviewPaper[], flags: readonly Flags[], network: Network, rows: { missing: ExtraRow[]; alsoCite: ExtraRow[] },
  labelOf: (id: string) => string, extras: { missingCiters: ReadonlyMap<string, readonly string[]>; citingCites: ReadonlyMap<string, readonly string[]> },
): CanvasFile {
  const years = [...papers.map((p) => p.year), ...rows.missing.map((r) => r.year), ...rows.alsoCite.map((r) => r.year)].filter((y): y is number => y !== null);
  const minYear = years.length > 0 ? Math.min(...years) : 0;
  const clusterIndex = new Map<string, number>();
  network.clusters.forEach((c, i) => c.forEach((id) => clusterIndex.set(id, i)));
  const order = (id: string): number => clusterIndex.get(id) ?? network.clusters.length;

  const placed = new Map<string, number>(); // per column, how many cards are already in it
  const place = (year: number | null): { x: number; y: number } => {
    const col = year === null ? 0 : year - minYear;
    const n = placed.get(String(col)) ?? 0;
    placed.set(String(col), n + 1);
    return { x: col * COLUMN, y: n * ROW };
  };

  const nodes: CanvasNode[] = [];
  const idOf = new Map<string, string>();
  const sorted = papers.map((p, i) => ({ p, i })).sort((a, b) => order(a.p.id) - order(b.p.id) || b.p.citedByCount - a.p.citedByCount || a.p.id.localeCompare(b.p.id));
  for (const { p, i } of sorted) {
    const node = `p-${p.id}`;
    idOf.set(p.id, node);
    nodes.push({ id: node, type: "text", text: cardText(labelOf(p.id), p.title, p.year, p.citedByCount, flags[i]), ...place(p.year), width: WIDTH, height: HEIGHT, color: COLOUR.inSet });
  }
  for (const r of rows.missing) {
    const node = `m-${r.id}`;
    idOf.set(r.id, node);
    nodes.push({ id: node, type: "text", text: cardText(r.label, r.title, r.year, r.citedBy, r.flags, r.detail), ...place(r.year), width: WIDTH, height: HEIGHT, color: COLOUR.missing });
  }
  for (const r of rows.alsoCite) {
    const node = `c-${r.id}`;
    idOf.set(r.id, node);
    nodes.push({ id: node, type: "text", text: cardText(r.label, r.title, r.year, r.citedBy, r.flags, r.detail), ...place(r.year), width: WIDTH, height: HEIGHT, color: COLOUR.citing });
  }

  const edges: CanvasEdge[] = [];
  const add = (from: string, to: string): void => {
    const a = idOf.get(from);
    const b = idOf.get(to);
    if (a === undefined || b === undefined) return;
    edges.push({ id: `e${edges.length + 1}`, fromNode: a, toNode: b, fromSide: "left", toSide: "right" });
  };
  for (const e of network.edges) add(e.from, e.to);
  for (const [missing, citers] of extras.missingCiters) for (const c of citers) add(c, missing);
  for (const [citing, cites] of extras.citingCites) for (const c of cites) add(citing, c);
  return { nodes, edges };
}
