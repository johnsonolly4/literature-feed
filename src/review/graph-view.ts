// The review graph: a view (a tab) that draws the citation network as SVG, without a library. Papers in the set, possibly missing papers
// and citing papers are circles sized by citations, coloured by group, group of papers that cite each other, year or the LLM's reading
// level; a ring means the paper is in Zotero and a dot that you have a literature note. Pan by dragging, zoom with the wheel or two
// fingers, click a paper for its details. Colours come from CSS classes in styles.css. The layout is worked out beforehand (graph-data.ts).
import { ItemView, type WorkspaceLeaf, type App } from "obsidian";
import { doiUrl } from "../inbox/write";
import { graphBounds, parseGraphBlock, type GraphData, type GraphNode } from "./graph-data";
import { timelineLayout } from "./timeline";

export const GRAPH_VIEW = "literature-feed-graph";

export type ColourMode = "group" | "cluster" | "theme" | "year" | "level";

/** `network`: papers that cite each other are pulled together. `timeline`: the vertical axis is the publication year. */
export type LayoutMode = "network" | "timeline";

const LAYOUT_INFO: Record<LayoutMode, { label: string; hint: string; text: string }> = {
  network: {
    label: "Network",
    hint: "Papers that cite each other sit together",
    text: "Papers that cite each other are pulled together, so the busy middle is the heart of the topic and loose papers drift to the edge.",
  },
  timeline: {
    label: "Timeline",
    hint: "Vertical axis: publication year",
    text: "The vertical axis is the publication year, oldest at the top. A line runs from a paper down to the older ones it cites, so heavily cited foundations sit near the top with the papers that built on them below. Sideways, linked papers stay close.",
  },
};

interface ModeInfo {
  label: string;
  /** The tooltip. */
  hint: string;
  /** What the colours mean, shown under the chips. */
  text: string;
  /** Why the chip is not available yet. */
  needs: string;
}

const MODE_INFO: Record<ColourMode, ModeInfo> = {
  group: {
    label: "Kind",
    hint: "Where each paper comes from",
    text: "Blue papers are in your review. Amber papers are cited by several of them but are not in your set: papers you may have missed. Purple papers cite several of yours: newer follow-ups and reviews.",
    needs: "",
  },
  cluster: {
    label: "Groups",
    hint: "Papers that cite each other",
    text: "Papers joined by citations form a group. Each group has its own colour and a name tag (its most cited paper). Papers in one group usually deal with the same thing, so these are your sub-topics. Grey papers have no citation to or from another paper here.",
    needs: "",
  },
  theme: {
    label: "Themes",
    hint: "The LLM's themes",
    text: "Colours follow the themes the LLM gave in its answer. A theme is a topic it grouped papers under, such as a method or an application. Grey papers are in no theme.",
    needs: "Themes come from the LLM's answer. Paste the answer in the review tab and press Check answer, then open the graph again.",
  },
  level: {
    label: "Reading level",
    hint: "The LLM's reading advice",
    text: "Colours follow the LLM's reading advice: green must read, blue should read, grey skim, faint skip. An outline means the LLM did not rate the paper.",
    needs: "Reading levels come from the LLM's answer. Paste the answer in the review tab and press Check answer, then open the graph again.",
  },
  year: {
    label: "Year",
    hint: "Older to newer",
    text: "Darker is newer. Old, heavily cited papers near the middle are the foundations of the topic; recent ones are usually at the edge.",
    needs: "",
  },
};

/** The swatches under the chips: a class (see styles.css) and what it means. */
function legendItems(mode: ColourMode, graph: GraphData): { cls: string; label: string }[] {
  if (mode === "group") return [{ cls: "sw-kind-set", label: "In your set" }, { cls: "sw-kind-missing", label: "Missing: cited by several of your set" }, { cls: "sw-kind-citing", label: "Cites several of your set" }];
  if (mode === "cluster") return [{ cls: "sw-0", label: "One colour per group (named on the picture)" }, { cls: "sw-none", label: "No link to another paper" }];
  if (mode === "theme") return [...(graph.themes ?? []).slice(0, 8).map((name, i) => ({ cls: `sw-${i}`, label: name })), { cls: "sw-none", label: "No theme" }];
  if (mode === "level") return [{ cls: "sw-lvl-must", label: "Must read" }, { cls: "sw-lvl-should", label: "Should read" }, { cls: "sw-lvl-skim", label: "Skim" }, { cls: "sw-lvl-skip", label: "Skip" }, { cls: "sw-lvl-none", label: "Not rated" }];
  return [{ cls: "sw-y0", label: "Older" }, { cls: "sw-y2", label: "" }, { cls: "sw-y4", label: "" }, { cls: "sw-y5", label: "Newer" }];
}

/**
 * An SVG element with a class. The class is set as an attribute afterwards: the `cls` option of `createSvg` does not take several
 * classes at once on an SVG element, which is how the first version drew the lines and no papers.
 */
function svgEl<K extends keyof SVGElementTagNameMap>(parent: Element, tag: K, cls: string, attr: Record<string, string> = {}): SVGElementTagNameMap[K] {
  const el = parent.createSvg(tag, { attr });
  if (cls !== "") el.setAttribute("class", cls);
  return el;
}

/** Papers that always carry their label. */
const TOP_LABELS = 12;

interface DrawnLine {
  from: string;
  to: string;
  el: SVGLineElement;
}

export interface DrawOptions {
  mode: ColourMode;
  showExtras: boolean;
  /** False hides the papers that no other paper cites or is cited by (default: shown). */
  showUnlinked?: boolean;
  filter: string;
  selected: string | null;
  onSelect?: (n: GraphNode) => void;
  /** Horizontal guide lines with a label (the years of a timeline). */
  guides?: { y: number; label: string }[];
}

/** Draws the edges and papers into `viewport` (emptied first) and returns the papers drawn. Shared by the tab and the note's block. */
export function drawGraph(viewport: SVGGElement, graph: GraphData, o: DrawOptions): GraphNode[] {
  viewport.empty();
  viewport.removeAttribute("class");
  const linked = new Set(graph.edges.flatMap((e) => [e.from, e.to]));
  const nodes = graph.nodes.filter((n) => (o.showExtras || n.kind === "set") && (o.showUnlinked !== false || linked.has(n.id)));
  const byId = new Map(nodes.map((n) => [n.id, n]));
  if (o.guides && o.guides.length > 0 && nodes.length > 0) {
    const left = Math.min(...nodes.map((n) => n.x)) - 40;
    const right = Math.max(...nodes.map((n) => n.x)) + 40;
    for (const gd of o.guides) {
      svgEl(viewport, "line", "literature-feed-guide", { x1: String(left), y1: String(gd.y), x2: String(right), y2: String(gd.y) });
      svgEl(viewport, "text", "literature-feed-guidelabel", { x: String(left), y: String(gd.y - 5) }).textContent = gd.label;
    }
  }
  const edges = svgEl(viewport, "g", "");
  const lines: DrawnLine[] = [];
  for (const e of graph.edges) {
    const a = byId.get(e.from);
    const b = byId.get(e.to);
    if (!a || !b) continue;
    const touching = o.selected !== null && (e.from === o.selected || e.to === o.selected);
    lines.push({ from: e.from, to: e.to, el: svgEl(edges, "line", `literature-feed-edge${touching ? " is-touching" : ""}`, { x1: String(a.x), y1: String(a.y), x2: String(b.x), y2: String(b.y) }) });
  }
  // The most cited papers are always labelled; the rest when there are few papers, when zoomed in, or when pointed at.
  const top = new Set([...nodes].sort((p, q) => q.citedBy - p.citedBy || p.id.localeCompare(q.id)).slice(0, TOP_LABELS).map((n) => n.id));
  const els = new Map<string, SVGGElement>();
  const neighbours = new Map<string, Set<string>>();
  const link = (from: string, to: string): void => {
    const set = neighbours.get(from) ?? new Set<string>();
    set.add(to);
    neighbours.set(from, set);
  };
  for (const e of lines) {
    link(e.from, e.to);
    link(e.to, e.from);
  }
  for (const n of nodes) {
    const r = 5 + Math.min(16, Math.sqrt(n.citedBy) * 0.7);
    const dim = o.filter !== "" && !n.title.toLowerCase().includes(o.filter);
    const g = svgEl(viewport, "g", `literature-feed-node mode-${o.mode} k-${n.kind} c-${n.cluster < 0 ? "none" : n.cluster % 8} t-${(n.theme ?? -1) < 0 ? "none" : (n.theme as number) % 8} y-${n.yearBucket} l-${n.level ?? "none"}${top.has(n.id) ? " is-top" : ""}${dim ? " is-dim" : ""}${n.id === o.selected ? " is-selected" : ""}`);
    els.set(n.id, g);
    svgEl(g, "title", "").textContent = `${n.label}: ${n.title}${n.year === null ? "" : ` (${n.year})`}`;
    if (n.zotero) svgEl(g, "circle", "literature-feed-ring", { cx: String(n.x), cy: String(n.y), r: String(r + 3) });
    svgEl(g, "circle", "literature-feed-dotnode", { cx: String(n.x), cy: String(n.y), r: String(r) });
    if (n.vault) svgEl(g, "circle", "literature-feed-vaultdot", { cx: String(n.x + r * 0.7), cy: String(n.y - r * 0.7), r: "3" });
    svgEl(g, "text", "literature-feed-nodelabel", { x: String(n.x), y: String(n.y + r + 11), "text-anchor": "middle" }).textContent = n.label;
    if (o.onSelect) g.addEventListener("click", (ev) => { ev.stopPropagation(); o.onSelect?.(n); });
  }
  // Pointing at a paper lights it, its neighbours and the lines between them, and dims the rest.
  for (const n of nodes) {
    const el = els.get(n.id);
    if (!el) continue;
    const near = neighbours.get(n.id) ?? new Set<string>();
    el.addEventListener("pointerenter", () => {
      viewport.classList.add("is-hovering");
      el.classList.add("is-hovered");
      for (const id of near) els.get(id)?.classList.add("is-neighbour");
      for (const e of lines) if (e.from === n.id || e.to === n.id) e.el.classList.add("is-lit");
    });
    el.addEventListener("pointerleave", () => {
      viewport.classList.remove("is-hovering");
      el.classList.remove("is-hovered");
      for (const id of near) els.get(id)?.classList.remove("is-neighbour");
      for (const e of lines) e.el.classList.remove("is-lit");
    });
  }
  drawGroupNames(viewport, graph, nodes, o.mode);
  return nodes;
}

/** A name over each big group of papers: "Group 1 · P14" (the most cited paper) by citing groups, the theme's name by theme. */
function drawGroupNames(viewport: SVGGElement, graph: GraphData, nodes: readonly GraphNode[], mode: ColourMode): void {
  if (mode !== "cluster" && mode !== "theme") return;
  const groups = new Map<number, GraphNode[]>();
  for (const n of nodes) {
    const k = mode === "cluster" ? n.cluster : (n.theme ?? -1);
    if (k >= 0) groups.set(k, [...(groups.get(k) ?? []), n]);
  }
  for (const [k, members] of groups) {
    if (members.length < 3) continue;
    const x = members.reduce((s, m) => s + m.x, 0) / members.length;
    const y = Math.min(...members.map((m) => m.y)) - 14;
    const best = [...members].sort((a, b) => b.citedBy - a.citedBy)[0];
    const name = mode === "theme" ? (graph.themes?.[k] ?? `Theme ${k + 1}`) : `Group ${k + 1} · ${best.label}`;
    svgEl(viewport, "text", "literature-feed-grouplabel", { x: String(x), y: String(y), "text-anchor": "middle" }).textContent = name.length > 34 ? `${name.slice(0, 33)}…` : name;
  }
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
  const nodes = drawGraph(svgEl(svg, "g", ""), graph, { mode: "group", showExtras: true, showUnlinked: false, filter: "", selected: null });
  const area = graphBounds(nodes, 30);
  if (area) {
    svg.setAttribute("viewBox", `${area.x} ${area.y} ${area.w} ${area.h}`);
  }
  svg.toggleClass("show-labels", nodes.length <= 20);
  const hidden = graph.nodes.length - nodes.length;
  box.createDiv({ cls: "literature-feed-meta", text: `Blue: in your set. Amber: cited by several of them, not in the set. Purple: cites several of them. Bigger: cited more.${hidden > 0 ? ` ${hidden} papers with no link to another are not shown.` : ""}` });
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
  private layout: LayoutMode = "network";
  private timeline: { graph: GraphData; guides: { y: number; label: string }[] } | null = null;
  private showExtras = true;
  private showUnlinked = false;
  private shown: GraphNode[] = [];
  private resizer: ResizeObserver | null = null;
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

  onClose(): Promise<void> {
    this.resizer?.disconnect();
    this.resizer = null;
    return Promise.resolve();
  }

  /** Draws the graph again from the plugin's current data (after a new review). */
  render(): void {
    const root = this.contentEl;
    root.empty();
    root.addClass("literature-feed-graph");
    this.resizer?.disconnect();
    const graph = this.host.graph;
    if (!graph) {
      root.createEl("p", { text: "No review graph yet. Make a literature review first, then open its graph from the review window." });
      return;
    }
    const available: Record<ColourMode, boolean> = { group: true, cluster: true, theme: (graph.themes?.length ?? 0) > 0, year: true, level: graph.nodes.some((n) => n.level !== null) };
    if (!available[this.mode]) this.mode = "group";
    const linked = new Set(graph.edges.flatMap((e) => [e.from, e.to]));
    const extraCount = graph.nodes.filter((n) => n.kind !== "set").length;
    const unlinkedCount = graph.nodes.filter((n) => !linked.has(n.id)).length;

    const controls = root.createDiv({ cls: "literature-feed-graph-controls" });
    controls.createDiv({ cls: "literature-feed-meta", text: "Each circle is a paper and each line a citation. Bigger circles are cited more often. Drag to move, scroll or pinch to zoom, point at a paper to light up its neighbours, click it for details." });
    this.timeline = null;
    const layoutRow = controls.createDiv({ cls: "literature-feed-chip-row" });
    layoutRow.createSpan({ cls: "literature-feed-chip-label", text: "Layout" });
    const layoutExplain = controls.createDiv({ cls: "literature-feed-explain" });
    const layoutChips = new Map<LayoutMode, HTMLElement>();
    const refreshLayout = (): void => {
      for (const [m, el] of layoutChips) el.toggleClass("is-active", m === this.layout);
      layoutExplain.setText(LAYOUT_INFO[this.layout].text);
    };
    for (const m of Object.keys(LAYOUT_INFO) as LayoutMode[]) {
      const chip = layoutRow.createEl("button", { cls: "literature-feed-chip", text: LAYOUT_INFO[m].label, attr: { title: LAYOUT_INFO[m].hint } });
      chip.addEventListener("click", () => {
        this.layout = m;
        refreshLayout();
        this.draw();
        this.fit();
      });
      layoutChips.set(m, chip);
    }
    const colourRow = controls.createDiv({ cls: "literature-feed-chip-row" });
    colourRow.createSpan({ cls: "literature-feed-chip-label", text: "Colour by" });
    const explain = controls.createDiv({ cls: "literature-feed-explain" });
    const legend = controls.createDiv({ cls: "literature-feed-legend" });
    const chips = new Map<ColourMode, HTMLElement>();
    const refresh = (): void => {
      for (const [m, el] of chips) el.toggleClass("is-active", m === this.mode);
      explain.setText(MODE_INFO[this.mode].text);
      legend.empty();
      for (const item of legendItems(this.mode, graph)) {
        const li = legend.createSpan({ cls: "literature-feed-legend-item" });
        li.createSpan({ cls: `literature-feed-swatch ${item.cls}` });
        if (item.label !== "") li.appendText(item.label);
      }
    };
    for (const m of Object.keys(MODE_INFO) as ColourMode[]) {
      const chip = colourRow.createEl("button", { cls: "literature-feed-chip", text: MODE_INFO[m].label, attr: { title: MODE_INFO[m].hint } });
      if (!available[m]) chip.addClass("is-disabled");
      chip.addEventListener("click", () => {
        if (!available[m]) {
          explain.setText(MODE_INFO[m].needs);
          return;
        }
        this.mode = m;
        refresh();
        this.draw();
      });
      chips.set(m, chip);
    }

    const showRow = controls.createDiv({ cls: "literature-feed-chip-row" });
    showRow.createSpan({ cls: "literature-feed-chip-label", text: "Show" });
    const toggle = (label: string, count: number, hint: string, get: () => boolean, set: (v: boolean) => void): void => {
      const chip = showRow.createEl("button", { cls: "literature-feed-chip", text: `${label} (${count})`, attr: { title: hint } });
      chip.toggleClass("is-active", get() && count > 0);
      if (count === 0) chip.addClass("is-disabled");
      chip.addEventListener("click", () => {
        if (count === 0) return;
        set(!get());
        chip.toggleClass("is-active", get());
        this.draw();
        this.fit();
      });
    };
    toggle("Missing and citing papers", extraCount, "Papers outside your set: cited by several of yours (missing) or citing several of yours. They appear after Find missing papers in the review tab.", () => this.showExtras, (v) => { this.showExtras = v; });
    toggle("Papers with no link", unlinkedCount, "Papers in your set that no other paper in the set cites or is cited by. Hidden at first so the connected core is easier to read.", () => this.showUnlinked, (v) => { this.showUnlinked = v; });
    const search = showRow.createEl("input", { type: "text", placeholder: "Filter by title" });
    search.value = this.filter;
    search.addEventListener("input", () => { this.filter = search.value.trim().toLowerCase(); this.draw(); });
    showRow.createEl("button", { cls: "literature-feed-chip", text: "+", attr: { title: "Zoom in" } }).addEventListener("click", () => this.zoomCentre(1.3, graph));
    showRow.createEl("button", { cls: "literature-feed-chip", text: "−", attr: { title: "Zoom out" } }).addEventListener("click", () => this.zoomCentre(1 / 1.3, graph));
    showRow.createEl("button", { cls: "literature-feed-chip", text: "Fit", attr: { title: "Fit all the papers on the screen" } }).addEventListener("click", () => this.fit());
    controls.createDiv({ cls: "literature-feed-meta", text: "Missing and citing papers are outside your set. Papers with no link neither cite nor are cited by another paper in the set; they are hidden at first." });

    this.svg = svgEl(root, "svg", "literature-feed-graph-svg", { viewBox: `0 0 ${graph.width} ${graph.height}`, role: "img", "aria-label": "Citation network" });
    this.viewport = svgEl(this.svg, "g", "");
    this.panel = root.createDiv({ cls: "literature-feed-graph-panel" });
    this.bindPointers(this.svg, graph);
    refresh();
    refreshLayout();
    this.draw();
    this.resizer = new ResizeObserver(() => this.syncViewBox());
    this.resizer.observe(this.svg);
    window.requestAnimationFrame(() => { this.syncViewBox(); this.fit(); });
  }

  /** The graph as it is drawn: the network layout as saved, or the same papers placed on a timeline. */
  private activeGraph(graph: GraphData): { graph: GraphData; guides?: { y: number; label: string }[] } {
    if (this.layout !== "timeline") return { graph };
    if (!this.timeline) {
      const t = timelineLayout(graph.nodes.map((n) => ({ id: n.id, year: n.year })), graph.edges, { width: graph.width, height: graph.height });
      this.timeline = { graph: { ...graph, nodes: graph.nodes.map((n) => ({ ...n, x: t.at.get(n.id)?.x ?? n.x, y: t.at.get(n.id)?.y ?? n.y })) }, guides: t.guides };
    }
    return this.timeline;
  }

  /** The picture's coordinates are screen pixels, so zooming and fitting work in the shape of the window. */
  private syncViewBox(): void {
    const svg = this.svg;
    if (!svg || svg.clientWidth === 0 || svg.clientHeight === 0) return;
    svg.setAttribute("viewBox", `0 0 ${svg.clientWidth} ${svg.clientHeight}`);
  }

  /** Zooms and moves so all the papers shown fill the picture. */
  private fit(): void {
    const svg = this.svg;
    const graph = this.host.graph;
    if (!svg || !graph) return;
    const area = graphBounds(this.shown, 50);
    if (!area) return;
    const w = svg.clientWidth || graph.width;
    const h = svg.clientHeight || graph.height;
    this.scale = Math.min(2.5, Math.max(0.3, Math.min(w / area.w, h / area.h)));
    this.tx = w / 2 - (area.x + area.w / 2) * this.scale;
    this.ty = h / 2 - (area.y + area.h / 2) * this.scale;
    this.applyTransform();
  }

  private draw(): void {
    const graph = this.host.graph;
    const viewport = this.viewport;
    if (!graph || !viewport || !this.svg) return;
    const active = this.activeGraph(graph);
    const nodes = drawGraph(viewport, active.graph, {
      guides: active.guides,
      mode: this.mode, showExtras: this.showExtras, showUnlinked: this.showUnlinked, filter: this.filter, selected: this.selected,
      onSelect: (n) => { this.selected = n.id; this.draw(); this.showPanel(n); },
    });
    this.shown = nodes;
    const byId = new Map(nodes.map((n) => [n.id, n]));
    this.svg.toggleClass("show-labels", nodes.length <= 30);
    this.applyTransform();
    const current = this.selected ? byId.get(this.selected) : undefined;
    if (current) this.showPanel(current);
    else this.panel?.empty();
  }

  private applyTransform(): void {
    this.viewport?.setAttribute("transform", `translate(${this.tx} ${this.ty}) scale(${this.scale})`);
    this.svg?.toggleClass("is-zoomed", this.scale >= 1.6);
  }

  /** How many picture units one screen pixel is (1 once the view box follows the window). */
  private unit(graph: GraphData): number {
    const rect = this.svg?.getBoundingClientRect();
    const box = this.svg?.viewBox.baseVal;
    const w = box && box.width > 0 ? box.width : graph.width;
    const h = box && box.height > 0 ? box.height : graph.height;
    return rect && rect.width > 0 && rect.height > 0 ? Math.max(w / rect.width, h / rect.height) : 1;
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

  /** Zooms by `factor` around the middle of the picture. */
  private zoomCentre(factor: number, graph: GraphData): void {
    const rect = this.svg?.getBoundingClientRect();
    if (!rect) return;
    this.zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, factor, graph);
    this.applyTransform();
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
