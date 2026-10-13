// The review as an Obsidian Canvas file (JSON Canvas), laid out as a reading board rather than a copy of the network: one labelled group
// per theme (when the LLM's answer is there) or per group of papers that cite each other, a readable card per paper (title as a link,
// year, citations, what you already have, and the LLM's advice), cards coloured by reading level, and only one line per paper: to
// the most cited paper in the set that it cites, so the lines show what builds on what instead of a tangle. Pure: the plugin writes
// the `.canvas` file.
import { doiUrl, escapeMd } from "../inbox/write";
import type { ReviewPaper } from "./collect";
import type { Flags } from "./flags";
import type { Network } from "./network";
import type { ExtraRow } from "./network-text";
import type { ReadLevel } from "./prompt";

export interface CanvasNode {
  id: string;
  type: "text" | "group";
  text?: string;
  label?: string;
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
  fromSide: "left" | "right" | "top" | "bottom";
  toSide: "left" | "right" | "top" | "bottom";
  color?: string;
}

export interface CanvasFile {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
}

/** The LLM's answer, as far as the board uses it. */
export interface BoardAnswer {
  themes: readonly { name: string; papers: readonly string[] }[];
  priorities: readonly { paper: string; level: ReadLevel; reason: string }[];
}

const CARD_W = 320;
const GAP = 24;
const PAD = 28;
const HEAD = 56;
const MAX_ROW_WIDTH = 4200;
/** Obsidian's preset colours: 1 red, 2 orange, 3 yellow, 4 green, 5 cyan, 6 purple. */
const LEVEL_COLOUR: Record<ReadLevel, string> = { must: "4", should: "5", skim: "3", skip: "1" };
const LEVEL_LABEL: Record<ReadLevel, string> = { must: "Must read", should: "Should read", skim: "Skim", skip: "Skip" };

interface Card {
  node: CanvasNode;
  /** The paper id, for the lines. */
  paperId: string;
}

function titleLink(title: string, doi: string | null): string {
  const t = escapeMd(title.replace(/\s+/g, " ").trim()) || "(no title)";
  const url = doiUrl(doi);
  return url ? `[${t}](${url})` : t;
}

function cardText(label: string, title: string, doi: string | null, year: number | null, citedBy: number, flags: Flags | undefined, advice?: { level: ReadLevel; reason: string }, detail?: string): string {
  const have = flags ? [flags.zotero ? "in Zotero" : "", flags.vault ? "in vault" : ""].filter((x) => x !== "").join(", ") : "";
  return [
    `**${label}** ${titleLink(title, doi)}`,
    `${year ?? "year unknown"} · cited ${citedBy}${have === "" ? "" : ` · ${have}`}`,
    ...(detail ? [detail] : []),
    ...(advice ? [`**${LEVEL_LABEL[advice.level]}.** ${advice.reason.replace(/\s+/g, " ").trim()}`] : []),
  ].join("\n\n");
}

/** Taller cards for longer text (about 44 characters to a line at this width, 26 pixels a line). */
function heightFor(text: string): number {
  const lines = text.split("\n\n").reduce((n, part) => n + Math.max(1, Math.ceil(part.length / 40)), 0);
  return Math.max(120, 30 + lines * 26 + (text.split("\n\n").length - 1) * 8);
}

/**
 * The canvas. `labelOf` gives each paper's P-label. Groups are the themes of `answer` (papers in none go to "Other"), or the groups of
 * papers that cite each other; missing and citing works have groups of their own.
 */
export function buildCanvas(
  papers: readonly ReviewPaper[], flags: readonly Flags[], network: Network, rows: { missing: ExtraRow[]; alsoCite: ExtraRow[] },
  labelOf: (id: string) => string, answer: BoardAnswer | null = null,
): CanvasFile {
  const advice = new Map((answer?.priorities ?? []).map((p) => [p.paper, { level: p.level, reason: p.reason }] as const));
  const flagOf = new Map(papers.map((p, i) => [p.id, flags[i]] as const));
  const byLabel = new Map(papers.map((p) => [labelOf(p.id), p] as const));

  // Which group each paper belongs to, in display order.
  const groups: { name: string; papers: ReviewPaper[] }[] = [];
  if (answer && answer.themes.length > 0) {
    const used = new Set<string>();
    for (const t of answer.themes) {
      const members = t.papers.map((l) => byLabel.get(l)).filter((p): p is ReviewPaper => p !== undefined && !used.has(p.id));
      members.forEach((p) => used.add(p.id));
      if (members.length > 0) groups.push({ name: t.name, papers: members });
    }
    const rest = papers.filter((p) => !used.has(p.id));
    if (rest.length > 0) groups.push({ name: "Other", papers: rest });
  } else {
    const byId = new Map(papers.map((p) => [p.id, p] as const));
    for (const [i, cluster] of network.clusters.entries()) {
      const members = cluster.map((id) => byId.get(id)).filter((p): p is ReviewPaper => p !== undefined);
      if (members.length === 0) continue;
      const best = [...members].sort((a, b) => b.citedByCount - a.citedByCount)[0];
      groups.push({ name: `Group ${i + 1}: cited together, led by ${labelOf(best.id)}`, papers: members });
    }
    const linked = new Set(network.clusters.flat());
    const loose = papers.filter((p) => !linked.has(p.id));
    if (loose.length > 0) groups.push({ name: "No citation to or from another paper here", papers: loose });
  }

  const nodes: CanvasNode[] = [];
  const cards: Card[] = [];
  let cursorX = 0;
  let cursorY = 0;
  let rowHeight = 0;
  let boards = 0;

  /** One group: a grid of cards inside a labelled box, packed left to right and wrapped. */
  const addGroup = (name: string, items: { id: string; text: string; color?: string; paperId: string }[]): void => {
    if (items.length === 0) return;
    const columns = Math.max(1, Math.min(4, Math.ceil(Math.sqrt(items.length))));
    const heights = items.map((it) => heightFor(it.text));
    const rowsOfCards: number[] = [];
    for (let i = 0; i < items.length; i += columns) rowsOfCards.push(Math.max(...heights.slice(i, i + columns)));
    const innerW = columns * CARD_W + (columns - 1) * GAP;
    const innerH = rowsOfCards.reduce((s, h) => s + h, 0) + (rowsOfCards.length - 1) * GAP;
    const w = innerW + 2 * PAD;
    const h = innerH + HEAD + PAD;
    if (cursorX > 0 && cursorX + w > MAX_ROW_WIDTH) {
      cursorX = 0;
      cursorY += rowHeight + 80;
      rowHeight = 0;
    }
    nodes.push({ id: `group-${++boards}`, type: "group", label: name, x: cursorX, y: cursorY, width: w, height: h });
    let y = cursorY + HEAD;
    items.forEach((it, i) => {
      const col = i % columns;
      const rowIndex = Math.floor(i / columns);
      if (col === 0 && rowIndex > 0) y += rowsOfCards[rowIndex - 1] + GAP;
      const node: CanvasNode = { id: it.id, type: "text", text: it.text, x: cursorX + PAD + col * (CARD_W + GAP), y, width: CARD_W, height: rowsOfCards[rowIndex], ...(it.color ? { color: it.color } : {}) };
      nodes.push(node);
      cards.push({ node, paperId: it.paperId });
    });
    cursorX += w + 60;
    rowHeight = Math.max(rowHeight, h);
  };

  for (const g of groups) {
    const members = [...g.papers].sort((a, b) => b.citedByCount - a.citedByCount || a.id.localeCompare(b.id));
    addGroup(g.name, members.map((p) => {
      const a = advice.get(labelOf(p.id));
      return { id: `p-${p.id}`, paperId: p.id, text: cardText(labelOf(p.id), p.title, p.doi, p.year, p.citedByCount, flagOf.get(p.id), a), ...(a ? { color: LEVEL_COLOUR[a.level] } : {}) };
    }));
  }
  const extraItems = (list: ExtraRow[], prefix: string, color: string) => list.map((r) => {
    const a = advice.get(r.label);
    return { id: `${prefix}-${r.id}`, paperId: r.id, text: cardText(r.label, r.title, r.doi, r.year, r.citedBy, r.flags, a, r.detail), color: a ? LEVEL_COLOUR[a.level] : color };
  });
  addGroup("Possibly missing: cited by several of these papers", extraItems(rows.missing, "m", "2"));
  addGroup("Cite several of these papers", extraItems(rows.alsoCite, "c", "6"));

  // One line per paper: to the most cited paper in the set that it cites.
  const setIds = new Set(papers.map((p) => p.id));
  const citedBy = new Map(papers.map((p) => [p.id, p.citedByCount] as const));
  const cardOf = new Map(cards.map((c) => [c.paperId, c.node] as const));
  const edges: CanvasEdge[] = [];
  for (const p of papers) {
    const refs = [...new Set(p.referencedWorks)].filter((r) => setIds.has(r) && r !== p.id);
    if (refs.length === 0) continue;
    const parent = refs.sort((a, b) => (citedBy.get(b) ?? 0) - (citedBy.get(a) ?? 0) || a.localeCompare(b))[0];
    const from = cardOf.get(p.id);
    const to = cardOf.get(parent);
    if (!from || !to) continue;
    const dx = to.x + to.width / 2 - (from.x + from.width / 2);
    const dy = to.y + to.height / 2 - (from.y + from.height / 2);
    const horizontal = Math.abs(dx) > Math.abs(dy);
    edges.push({
      id: `e${edges.length + 1}`, fromNode: from.id, toNode: to.id,
      fromSide: horizontal ? (dx > 0 ? "right" : "left") : dy > 0 ? "bottom" : "top",
      toSide: horizontal ? (dx > 0 ? "left" : "right") : dy > 0 ? "top" : "bottom",
    });
  }
  return { nodes, edges };
}
