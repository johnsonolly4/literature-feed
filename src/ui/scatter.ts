// A small scatter chart as SVG (no library, no inline styles: colours and type come from classes in styles.css). Shape carries meaning as well
// as colour: a ring marks the highlighted points, and an optional dashed y = x line shows which side a point is on. Used by the citation-gaps
// chart; the other scatters of the report can use it too.
const WIDTH = 640;
const MARGIN = { left: 52, right: 18, top: 22, bottom: 40 };

export interface ScatterPoint {
  key: string;
  x: number;
  y: number;
  /** Ringed: the highlighted kind (for example found on both routes). */
  ring?: boolean;
  label?: string;
  /** The label goes to the left of the dot (near the right edge). */
  labelLeft?: boolean;
  /** Shown on hover (the SVG title). */
  tip: string;
}

export interface ScatterSpec {
  title: string;
  points: readonly ScatterPoint[];
  /** Both axes run from 0 to this. */
  max: number;
  /** Plain-language notes on the axes, for example "more of your references cite it". */
  xNote: string;
  yNote: string;
  /** Draw the dashed y = x line. */
  diagonal?: boolean;
  /** One legend row: ringed and plain dots. */
  legend: { ring: boolean; text: string }[];
  /** Click on a point. */
  onPick?: (key: string) => void;
}

function svgText(parent: SVGElement, cls: string, text: string, attr: Record<string, string>): void {
  parent.createSvg("text", { cls, attr }).setText(text);
}

/** Draws the chart into `parent`. */
export function drawScatter(parent: HTMLElement, spec: ScatterSpec): void {
  const box = parent.createDiv({ cls: "literature-feed-scatter" });
  box.createDiv({ cls: "literature-feed-chart-title", text: spec.title });
  const height = Math.min(Math.round(WIDTH * 0.8), 460);
  const svg = box.createSvg("svg", { attr: { viewBox: `0 0 ${WIDTH} ${height}`, width: "100%", role: "img", "aria-label": spec.title } });
  const plotW = WIDTH - MARGIN.left - MARGIN.right;
  const plotH = height - MARGIN.top - MARGIN.bottom;
  const px = (v: number): number => MARGIN.left + (v / spec.max) * plotW;
  const py = (v: number): number => MARGIN.top + plotH - (v / spec.max) * plotH;

  const steps = 5;
  for (let i = 0; i <= steps; i++) {
    const v = (spec.max / steps) * i;
    const label = String(Math.round(v * 10) / 10);
    svg.createSvg("line", { cls: "literature-feed-scatter-grid", attr: { x1: String(MARGIN.left), x2: String(WIDTH - MARGIN.right), y1: String(py(v)), y2: String(py(v)) } });
    svgText(svg, "literature-feed-scatter-tick", `${label}%`, { x: String(MARGIN.left - 6), y: String(py(v) + 4), "text-anchor": "end" });
    svgText(svg, "literature-feed-scatter-tick", `${label}%`, { x: String(px(v)), y: String(height - MARGIN.bottom + 16), "text-anchor": "middle" });
  }
  svg.createSvg("line", { cls: "literature-feed-scatter-axis", attr: { x1: String(MARGIN.left), x2: String(WIDTH - MARGIN.right), y1: String(py(0)), y2: String(py(0)) } });
  svg.createSvg("line", { cls: "literature-feed-scatter-axis", attr: { x1: String(MARGIN.left), x2: String(MARGIN.left), y1: String(py(0)), y2: String(MARGIN.top) } });
  svgText(svg, "literature-feed-scatter-note", `${spec.xNote} →`, { x: String(WIDTH - MARGIN.right), y: String(height - 6), "text-anchor": "end" });
  svgText(svg, "literature-feed-scatter-note", `↑ ${spec.yNote}`, { x: String(MARGIN.left), y: "12", "text-anchor": "start" });
  if (spec.diagonal) svg.createSvg("line", { cls: "literature-feed-scatter-diagonal", attr: { x1: String(px(0)), y1: String(py(0)), x2: String(px(spec.max)), y2: String(py(spec.max)) } });

  // Plain dots first so the ringed ones are on top.
  for (const p of [...spec.points].sort((a, b) => Number(a.ring === true) - Number(b.ring === true))) {
    // One class in `cls` everywhere: createSvg does not take several (see graph-view.ts), so a ringed dot has a class of its own.
    const g = svg.createSvg("g", { cls: "literature-feed-scatter-point", attr: { tabindex: spec.onPick ? "0" : "-1" } });
    g.createSvg("title").setText(p.tip);
    if (p.ring) g.createSvg("circle", { cls: "literature-feed-scatter-ring", attr: { cx: String(px(p.x)), cy: String(py(p.y)), r: "9" } });
    g.createSvg("circle", { cls: p.ring ? "literature-feed-scatter-dot-ring" : "literature-feed-scatter-dot", attr: { cx: String(px(p.x)), cy: String(py(p.y)), r: "5.5" } });
    if (p.label) svgText(g, "literature-feed-scatter-label", p.label, p.labelLeft ? { x: String(px(p.x) - 11), y: String(py(p.y) + 4), "text-anchor": "end" } : { x: String(px(p.x) + 11), y: String(py(p.y) + 4) });
    if (spec.onPick) {
      const pick = spec.onPick;
      g.addEventListener("click", () => pick(p.key));
      g.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pick(p.key); } });
    }
  }
  const legend = box.createDiv({ cls: "literature-feed-scatter-legend" });
  for (const item of spec.legend) {
    const li = legend.createSpan({ cls: "literature-feed-scatter-legenditem" });
    li.createSpan({ cls: `literature-feed-scatter-swatch${item.ring ? " is-ring" : ""}` });
    li.createSpan({ text: item.text });
  }
  if (spec.diagonal) {
    const li = legend.createSpan({ cls: "literature-feed-scatter-legenditem" });
    li.createSpan({ cls: "literature-feed-scatter-swatch is-line" });
    li.createSpan({ text: "equal share" });
  }
}
