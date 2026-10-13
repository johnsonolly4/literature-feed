// The review graph: a view (a tab) that draws the citation network as SVG, without a library. Papers in the set, possibly missing papers
// and citing papers are circles sized by citations, coloured by group, group of papers that cite each other, year or the LLM's reading
// level; a ring means the paper is in Zotero and a dot that you have a literature note. Pan by dragging, zoom with the wheel or two
// fingers, click a paper for its details. Colours come from CSS classes in styles.css. The layout is worked out beforehand (graph-data.ts).
import { ItemView, type WorkspaceLeaf, type App } from "obsidian";
import { doiUrl } from "../inbox/write";
import { parseGraphBlock, type GraphData, type GraphNode } from "./graph-data";

export const GRAPH_VIEW = "literature-feed-graph";

export type ColourMode = "group" | "cluster" | "year" | "level";

const MODES: Record<ColourMode, string> = { group: "In the set, missing, citing", cluster: "Papers that cite each other", year: "Year", level: "Reading level" };
const LEGEND: Record<ColourMode, string> = {
  group: "Blue: in the set. Amber: cited by several of them but not in it. Purple: cites several of them.",
  cluster: "One colour per group of papers that cite each other; grey: no link to another paper.",
  year: "Light to dark: older to newer.",
  level: "Green: must read. Blue: should read. Grey: skim. Faint: skip. Outlined: not rated.",
};

/**
 * An SVG element with a class. The class is set as an attribute afterwards: the `cls` option of `createSvg` does not take several
 * classes at once on an SVG element, which is how the first version drew the lines and no papers.
 */
function svgEl<K extends keyof SVGElementTagNameMap>(parent: Element, tag: K, cls: string, attr: Record<string, string> = {}): SVGElementTagNameMap[K] {
  const el = parent.createSvg(tag, { attr });
  if (cls !== "") el.setAttribute("class", cls);
  return el;
}

export interface DrawOptions {
  mode: ColourMode;
  showExtras: boolean;
  filter: string;
  selected: string | null;
  onSelect?: (n: GraphNode) => void;
}

/** Draws the edges and papers into `viewport` (emptied first) and returns the papers drawn. Shared by the tab and the note's block. */
export function drawGraph(viewport: SVGGElement, graph: GraphData, o: DrawOptions): GraphNode[] {
  viewport.empty();
  const nodes = graph.nodes.filter((n) => o.showExtras || n.kind === "set");
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const edges = svgEl(viewport, "g", "");
  for (const e of graph.edges) {
    const a = byId.get(e.from);
    const b = byId.get(e.to);
    if (!a || !b) continue;
    const touching = o.selected !== null && (e.from === o.selected || e.to === o.selected);
    svgEl(edges, "line", `literature-feed-edge${touching ? " is-touching" : ""}`, { x1: String(a.x), y1: String(a.y), x2: String(b.x), y2: String(b.y) });
  }
  for (const n of nodes) {
    const r = 4 + Math.min(14, Math.sqrt(n.citedBy) * 0.5);
    const dim = o.filter !== "" && !n.title.toLowerCase().includes(o.filter);
    const g = svgEl(viewport, "g", `literature-feed-node mode-${o.mode} k-${n.kind} c-${n.cluster < 0 ? "none" : n.cluster % 8} y-${n.yearBucket} l-${n.level ?? "none"}${dim ? " is-dim" : ""}${n.id === o.selected ? " is-selected" : ""}`);
    svgEl(g, "title", "").textContent = `${n.label}: ${n.title}${n.year === null ? "" : ` (${n.year})`}`;
    if (n.zotero) svgEl(g, "circle", "literature-feed-ring", { cx: String(n.x), cy: String(n.y), r: String(r + 3) });
    svgEl(g, "circle", "literature-feed-dotnode", { cx: String(n.x), cy: String(n.y), r: String(r) });
    if (n.vault) svgEl(g, "circle", "literature-feed-vaultdot", { cx: String(n.x + r * 0.7), cy: String(n.y - r * 0.7), r: "3" });
    svgEl(g, "text", "literature-feed-nodelabel", { x: String(n.x), y: String(n.y + r + 11), "text-anchor": "middle" }).textContent = n.label;
    if (o.onSelect) g.addEventListener("click", (ev) => { ev.stopPropagation(); o.onSelect?.(n); });
  }
  return nodes;
}

/** The code block `literature-feed-graph` in a review note: the graph drawn in place, with a button for the full view. */
export function graphBlockProcessor(source: string, el: HTMLElement, open: (graph: GraphData) => void): void {
  const graph = parseGraphBlock(source);
  if (graph === null) {
    el.createEl("p", { cls: "literature-feed-warning", text: "This graph block is not valid." });
    return;
  }
  const box = el.createDiv({ cls: "literature-feed-graph-inline" });
  const svg = svgEl(box, "svg", "literature-feed-graph-svg is-inline", { viewBox: `0 0 ${graph.width} ${graph.height}`, role: "img", "aria-label": "Citation network" });
  const nodes = drawGraph(svgEl(svg, "g", ""), graph, { mode: "group", showExtras: true, filter: "", selected: null });
  svg.toggleClass("show-labels", nodes.length <= 30);
  box.createDiv({ cls: "literature-feed-meta", text: LEGEND.group });
  const buttons = box.createDiv({ cls: "literature-feed-buttons" });
  buttons.createEl("button", { text: "Open full graph", cls: "mod-cta" }).addEventListener("click", () => open(graph));
}

/** What the view needs from the plugin. */
export interface GraphHost {
  app: App;
  graph: GraphData | null;
}

export class GraphView extends ItemView {
  private mode: ColourMode = "group";
  private showExtras = true;
  private filter = "";
  private selected: string | null = null;
  private scale = 1;
  private tx = 0;
  private ty = 0;
  private svg: SVGSVGElement | null = null;
  private viewport: SVGGElement | null = null;
  private panel: HTMLElement | null = null;
  private readonly pointers = new Map<number, { x: number; y: number }>();

  constructor(leaf: WorkspaceLeaf, private readonly host: GraphHost) {
    super(leaf);
  }

  getViewType(): string {
    return GRAPH_VIEW;
  }

  getDisplayText(): string {
    return "Review graph";
  }

  getIcon(): string {
    return "network";
  }

  onOpen(): Promise<void> {
    this.render();
    return Promise.resolve();
  }

  /** Draws the graph again from the plugin's current data (after a new review). */
  render(): void {
    const root = this.contentEl;
    root.empty();
    root.addClass("literature-feed-graph");
    const graph = this.host.graph;
    if (!graph) {
      root.createEl("p", { text: "No review graph yet. Make a literature review first, then open its graph from the review window." });
      return;
    }
    const bar = root.createDiv({ cls: "literature-feed-graph-bar" });
    const colour = bar.createEl("select");
    for (const [k, label] of Object.entries(MODES)) colour.createEl("option", { value: k, text: label });
    colour.value = this.mode;
    const legend = root.createDiv({ cls: "literature-feed-meta", text: LEGEND[this.mode] });
    colour.addEventListener("change", () => { this.mode = colour.value as ColourMode; legend.setText(LEGEND[this.mode]); this.draw(); });
    const extras = bar.createEl("label");
    const box = extras.createEl("input", { type: "checkbox" });
    box.checked = this.showExtras;
    extras.appendText(" Missing and citing papers");
    box.addEventListener("change", () => { this.showExtras = box.checked; this.draw(); });
    const search = bar.createEl("input", { type: "text", placeholder: "Filter by title" });
    search.value = this.filter;
    search.addEventListener("input", () => { this.filter = search.value.trim().toLowerCase(); this.draw(); });
    bar.createEl("button", { text: "Reset view" }).addEventListener("click", () => { this.scale = 1; this.tx = 0; this.ty = 0; this.applyTransform(); });

    this.svg = svgEl(root, "svg", "literature-feed-graph-svg", { viewBox: `0 0 ${graph.width} ${graph.height}`, role: "img", "aria-label": "Citation network" });
    this.viewport = svgEl(this.svg, "g", "");
    this.panel = root.createDiv({ cls: "literature-feed-graph-panel" });
    this.bindPointers(this.svg, graph);
    this.draw();
  }

  private draw(): void {
    const graph = this.host.graph;
    const viewport = this.viewport;
    if (!graph || !viewport || !this.svg) return;
    const nodes = drawGraph(viewport, graph, { mode: this.mode, showExtras: this.showExtras, filter: this.filter, selected: this.selected, onSelect: (n) => { this.selected = n.id; this.draw(); this.showPanel(n); } });
    const byId = new Map(nodes.map((n) => [n.id, n]));
    this.svg.toggleClass("show-labels", nodes.length <= 60);
    this.applyTransform();
    const current = this.selected ? byId.get(this.selected) : undefined;
    if (current) this.showPanel(current);
    else this.panel?.empty();
  }

  private applyTransform(): void {
    this.viewport?.setAttribute("transform", `translate(${this.tx} ${this.ty}) scale(${this.scale})`);
    this.svg?.toggleClass("is-zoomed", this.scale >= 1.6);
  }

  /** How many graph units one screen pixel is. */
  private unit(graph: GraphData): number {
    const rect = this.svg?.getBoundingClientRect();
    return rect && rect.width > 0 && rect.height > 0 ? Math.max(graph.width / rect.width, graph.height / rect.height) : 1;
  }

  private bindPointers(svg: SVGSVGElement, graph: GraphData): void {
    let lastPinch = 0;
    svg.addEventListener("pointerdown", (e) => {
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      svg.setPointerCapture(e.pointerId);
      lastPinch = 0;
    });
    svg.addEventListener("pointermove", (e) => {
      const last = this.pointers.get(e.pointerId);
      if (!last) return;
      const unit = this.unit(graph);
      if (this.pointers.size === 1) {
        this.tx += (e.clientX - last.x) * unit;
        this.ty += (e.clientY - last.y) * unit;
      } else if (this.pointers.size === 2) {
        this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        const [a, b] = [...this.pointers.values()];
        const distance = Math.hypot(a.x - b.x, a.y - b.y);
        if (lastPinch > 0 && distance > 0) this.zoomAt((a.x + b.x) / 2, (a.y + b.y) / 2, distance / lastPinch, graph);
        lastPinch = distance;
      }
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      this.applyTransform();
    });
    const end = (e: PointerEvent): void => { this.pointers.delete(e.pointerId); lastPinch = 0; };
    svg.addEventListener("pointerup", end);
    svg.addEventListener("pointercancel", end);
    svg.addEventListener("wheel", (e) => {
      e.preventDefault();
      this.zoomAt(e.clientX, e.clientY, e.deltaY < 0 ? 1.15 : 1 / 1.15, graph);
      this.applyTransform();
    }, { passive: false });
    svg.addEventListener("click", () => { if (this.selected !== null) { this.selected = null; this.draw(); } });
  }

  /** Zooms by `factor` keeping the graph point under the screen position (clientX, clientY) where it is. */
  private zoomAt(clientX: number, clientY: number, factor: number, graph: GraphData): void {
    const rect = this.svg?.getBoundingClientRect();
    if (!rect) return;
    const unit = this.unit(graph);
    const px = (clientX - rect.left) * unit;
    const py = (clientY - rect.top) * unit;
    const next = Math.min(8, Math.max(0.3, this.scale * factor));
    const k = next / this.scale;
    this.tx = px - (px - this.tx) * k;
    this.ty = py - (py - this.ty) * k;
    this.scale = next;
  }

  private showPanel(n: GraphNode): void {
    const panel = this.panel;
    if (!panel) return;
    panel.empty();
    panel.createDiv({ cls: "literature-feed-title", text: `${n.label}  ${n.title}` });
    panel.createDiv({ cls: "literature-feed-meta", text: [
      n.year === null ? "year unknown" : String(n.year), `${n.citedBy} citations`,
      n.kind === "set" ? "in the set" : n.kind === "missing" ? "cited by several of the set" : "cites several of the set",
      n.zotero ? "in Zotero" : "", n.vault ? "in the vault" : "", n.level ? `reading level: ${n.level}` : "",
    ].filter((x) => x !== "").join(" · ") });
    const buttons = panel.createDiv({ cls: "literature-feed-buttons" });
    const url = doiUrl(n.doi);
    if (url) buttons.createEl("button", { text: "Open paper" }).addEventListener("click", () => window.open(url));
    if (n.zotero) buttons.createEl("button", { text: "Show in Zotero" }).addEventListener("click", () => window.open(`zotero://select/library/items/${n.zotero}`));
    if (n.vault) buttons.createEl("button", { text: "Open note" }).addEventListener("click", () => { void this.host.app.workspace.openLinkText(n.vault as string, "", "tab"); });
  }
}
