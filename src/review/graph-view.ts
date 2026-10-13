// The review graph: a view (a tab) that draws the citation network as SVG, without a library. Papers in the set, possibly missing papers
// and citing papers are circles sized by citations, coloured by group, group of papers that cite each other, year or the LLM's reading
// level; a ring means the paper is in Zotero and a dot that you have a literature note. Pan by dragging, zoom with the wheel or two
// fingers, click a paper for its details. Colours come from CSS classes in styles.css. The layout is worked out beforehand (graph-data.ts).
import { ItemView, type WorkspaceLeaf, type App } from "obsidian";
import { doiUrl } from "../inbox/write";
import type { GraphData, GraphNode } from "./graph-data";

export const GRAPH_VIEW = "literature-feed-graph";

export type ColourMode = "group" | "cluster" | "year" | "level";

const MODES: Record<ColourMode, string> = { group: "In the set, missing, citing", cluster: "Papers that cite each other", year: "Year", level: "Reading level" };
const LEGEND: Record<ColourMode, string> = {
  group: "Blue: in the set. Amber: cited by several of them but not in it. Purple: cites several of them.",
  cluster: "One colour per group of papers that cite each other; grey: no link to another paper.",
  year: "Light to dark: older to newer.",
  level: "Green: must read. Blue: should read. Grey: skim. Faint: skip. Outlined: not rated.",
};

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

    this.svg = root.createSvg("svg", { cls: "literature-feed-graph-svg", attr: { viewBox: `0 0 ${graph.width} ${graph.height}`, role: "img", "aria-label": "Citation network" } });
    this.viewport = this.svg.createSvg("g");
    this.panel = root.createDiv({ cls: "literature-feed-graph-panel" });
    this.bindPointers(this.svg, graph);
    this.draw();
  }

  private visible(n: GraphNode): boolean {
    return this.showExtras || n.kind === "set";
  }

  private draw(): void {
    const graph = this.host.graph;
    const viewport = this.viewport;
    if (!graph || !viewport || !this.svg) return;
    viewport.empty();
    const nodes = graph.nodes.filter((n) => this.visible(n));
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const edges = viewport.createSvg("g");
    for (const e of graph.edges) {
      const a = byId.get(e.from);
      const b = byId.get(e.to);
      if (!a || !b) continue;
      const touching = this.selected !== null && (e.from === this.selected || e.to === this.selected);
      edges.createSvg("line", { cls: `literature-feed-edge${touching ? " is-touching" : ""}`, attr: { x1: String(a.x), y1: String(a.y), x2: String(b.x), y2: String(b.y) } });
    }
    const showLabels = nodes.length <= 60;
    this.svg.toggleClass("show-labels", showLabels);
    for (const n of nodes) {
      const r = 4 + Math.min(14, Math.sqrt(n.citedBy) * 0.5);
      const dim = this.filter !== "" && !n.title.toLowerCase().includes(this.filter);
      const g = viewport.createSvg("g", { cls: `literature-feed-node mode-${this.mode} k-${n.kind} c-${n.cluster < 0 ? "none" : n.cluster % 8} y-${n.yearBucket} l-${n.level ?? "none"}${dim ? " is-dim" : ""}${n.id === this.selected ? " is-selected" : ""}` });
      g.createSvg("title").setText(`${n.label}: ${n.title}${n.year === null ? "" : ` (${n.year})`}`);
      if (n.zotero) g.createSvg("circle", { cls: "literature-feed-ring", attr: { cx: String(n.x), cy: String(n.y), r: String(r + 3) } });
      g.createSvg("circle", { cls: "literature-feed-dotnode", attr: { cx: String(n.x), cy: String(n.y), r: String(r) } });
      if (n.vault) g.createSvg("circle", { cls: "literature-feed-vaultdot", attr: { cx: String(n.x + r * 0.7), cy: String(n.y - r * 0.7), r: "3" } });
      g.createSvg("text", { cls: "literature-feed-nodelabel", attr: { x: String(n.x), y: String(n.y + r + 11), "text-anchor": "middle" } }).setText(n.label);
      g.addEventListener("click", (ev) => { ev.stopPropagation(); this.selected = n.id; this.draw(); this.showPanel(n); });
    }
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
