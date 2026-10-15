// A scatter chart as SVG, following the owner's refcheck dashboard (its `scatter` helper): square plot, gridlines and tick labels, axis arrows with
// plain-language notes, an optional dashed y = x line, round dots (the highlighted kind ringed), labels tried in four places so they do not
// cover each other, a floating tooltip, and a legend row. No library and no inline styles: colours and type come from classes in styles.css.
// Every `cls` below holds one class (SVG elements do not take several).
const FALLBACK_WIDTH = 640;
const CHAR_W = 6.2;

export interface ScatterPoint {
  key: string;
  x: number;
  y: number;
  /** The highlighted kind: drawn solid and ringed, on top. */
  ring?: boolean;
  /** Tried on the right, the left, then below, until it fits without covering another label. */
  label?: string;
  /** The hover lines; the first is bold. */
  tip: string[];
}

export interface ScatterSpec {
  points: readonly ScatterPoint[];
  /** Both axes run from 0 to this. */
  max: number;
  xNote: string;
  yNote: string;
  aria: string;
  diagonal?: boolean;
  /** One legend row: a ringed dot, a plain dot or the dashed line, each with its text. */
  legend: { mark: "ring" | "dot" | "line"; text: string }[];
  onPick?: (key: string) => void;
}

// d3's tick rule (ticks of a linear scale from 0): a step of 1, 2, 5 or 10 times a power of ten, about `count` ticks.
const E10 = Math.sqrt(50);
const E5 = Math.sqrt(10);
const E2 = Math.sqrt(2);
export function niceTicks(max: number, count = 6): number[] {
  const step = max / count;
  const power = Math.floor(Math.log10(step));
  const error = step / 10 ** power;
  const unit = (error >= E10 ? 10 : error >= E5 ? 5 : error >= E2 ? 2 : 1) * 10 ** power;
  const out: number[] = [];
  for (let v = 0; v <= max + 1e-9; v += unit) out.push(Math.round(v * 1e6) / 1e6);
  return out;
}

let arrowCount = 0;

function text(parent: SVGElement, cls: string, value: string, attr: Record<string, string>): SVGElement {
  const t = parent.createSvg("text", { cls, attr });
  t.setText(value);
  return t;
}

/** A small mark for the legend. */
function legendMark(parent: HTMLElement, mark: "ring" | "dot" | "line"): void {
  const svg = parent.createSvg("svg", { attr: { width: mark === "line" ? "22" : "16", height: "16", viewBox: mark === "line" ? "0 0 22 16" : "0 0 16 16", "aria-hidden": "true" } });
  if (mark === "line") svg.createSvg("line", { cls: "literature-feed-scatter-legendline", attr: { x1: "1", y1: "14", x2: "21", y2: "2" } });
  else svg.createSvg("circle", { cls: mark === "ring" ? "literature-feed-scatter-dot-both" : "literature-feed-scatter-dot", attr: { cx: "8", cy: "8", r: "5" } });
}

/** Draws the chart, and under it the legend, into `parent`. `parent` must be visible: the chart is as wide as it is. */
export function drawScatter(parent: HTMLElement, spec: ScatterSpec): void {
  const box = parent.createDiv({ cls: "literature-feed-scatter" });
  const w = Math.max(260, box.clientWidth || FALLBACK_WIDTH);
  const h = Math.round(Math.min(w * 0.8, 460));
  const svg = box.createSvg("svg", { attr: { viewBox: `0 0 ${w} ${h}`, role: "img", "aria-label": spec.aria } });
  const ticks = niceTicks(spec.max);
  const tickWidth = Math.ceil(Math.max(...ticks.map((v) => `${v}%`.length)) * CHAR_W);
  const labelled = spec.points.some((p) => (p.label ?? "") !== "");
  const m = { t: labelled ? 24 : 12, r: 16, b: 30 + 34, l: tickWidth + 14 + 38 };
  const x = (v: number): number => m.l + (v / spec.max) * (w - m.r - m.l);
  const y = (v: number): number => h - m.b - (v / spec.max) * (h - m.b - m.t);

  const arrow = `literature-feed-arrow-${++arrowCount}`;
  const marker = svg.createSvg("defs").createSvg("marker", { attr: { id: arrow, viewBox: "0 0 8 8", refX: "7", refY: "4", markerWidth: "7", markerHeight: "7", orient: "auto" } });
  marker.createSvg("path", { cls: "literature-feed-scatter-arrowhead", attr: { d: "M0,0 L8,4 L0,8 z" } });

  for (const v of ticks) {
    svg.createSvg("line", { cls: "literature-feed-scatter-grid", attr: { x1: String(m.l), x2: String(w - m.r), y1: String(y(v)), y2: String(y(v)) } });
    text(svg, "literature-feed-scatter-tick", `${v}%`, { x: String(m.l - 6), y: String(y(v)), "text-anchor": "end", "dominant-baseline": "middle" });
    text(svg, "literature-feed-scatter-tick", `${v}%`, { x: String(x(v)), y: String(h - m.b + 16), "text-anchor": "middle" });
  }
  svg.createSvg("line", { cls: "literature-feed-scatter-baseline", attr: { x1: String(m.l), x2: String(w - m.r), y1: String(h - m.b), y2: String(h - m.b) } });
  // The axis arrows, each with its plain-language note.
  svg.createSvg("line", { cls: "literature-feed-scatter-arrow", attr: { x1: String(m.l), x2: String(w - m.r), y1: String(h - m.b + 29), y2: String(h - m.b + 29), "marker-end": `url(#${arrow})` } });
  text(svg, "literature-feed-scatter-note", spec.xNote, { x: String((m.l + w - m.r) / 2), y: String(h - 5), "text-anchor": "middle" });
  const ax = m.l - tickWidth - 20;
  svg.createSvg("line", { cls: "literature-feed-scatter-arrow", attr: { x1: String(ax), x2: String(ax), y1: String(h - m.b), y2: String(m.t), "marker-end": `url(#${arrow})` } });
  text(svg, "literature-feed-scatter-note", spec.yNote, { transform: `translate(${ax - 9},${(m.t + h - m.b) / 2}) rotate(-90)`, "text-anchor": "middle" });
  if (spec.diagonal) svg.createSvg("line", { cls: "literature-feed-scatter-diagonal", attr: { x1: String(x(0)), y1: String(y(0)), x2: String(x(spec.max)), y2: String(y(spec.max)) } });

  // The tooltip: one floating element, kept inside the box.
  const tip = box.createDiv({ cls: "literature-feed-scatter-tip" });
  tip.hide();
  const showTip = (ev: PointerEvent, p: ScatterPoint): void => {
    tip.empty();
    p.tip.forEach((line, i) => tip.createDiv({ cls: i === 0 ? "literature-feed-scatter-tip-head" : "literature-feed-scatter-tip-line", text: line }));
    tip.show();
    const b = box.getBoundingClientRect();
    let tx = ev.clientX - b.left + 12;
    if (tx + tip.offsetWidth > b.width) tx = Math.max(0, ev.clientX - b.left - tip.offsetWidth - 12);
    tip.setCssProps({ left: `${tx}px`, top: `${ev.clientY - b.top + 12}px` });
  };

  // The highlighted kind is drawn last, so it is on top.
  for (const p of [...spec.points].sort((a, b) => Number(a.ring === true) - Number(b.ring === true))) {
    const dot = svg.createSvg("circle", { cls: p.ring ? "literature-feed-scatter-dot-both" : "literature-feed-scatter-dot", attr: { cx: String(x(p.x)), cy: String(y(p.y)), r: "5.5" } });
    dot.addEventListener("pointerenter", (ev) => showTip(ev, p));
    dot.addEventListener("pointermove", (ev) => showTip(ev, p));
    dot.addEventListener("pointerleave", () => tip.hide());
    if (spec.onPick) {
      const pick = spec.onPick;
      dot.addEventListener("click", () => pick(p.key));
    }
  }

  // Labels: on the right above the dot, on the left above it, then below on each side; the first place that fits is used, else none.
  const placed: DOMRect[] = [];
  for (const p of spec.points.filter((q) => (q.label ?? "") !== "")) {
    const cx = x(p.x);
    const cy = y(p.y);
    for (const [side, below] of [[1, 0], [-1, 0], [1, 1], [-1, 1]] as const) {
      const t = text(svg, "literature-feed-scatter-label", p.label ?? "", { x: String(cx + side * 9), y: String(below ? cy + 15 : cy - 7), "text-anchor": side > 0 ? "start" : "end" });
      const bb = (t as unknown as SVGGraphicsElement).getBBox();
      const clash = bb.x < 2 || bb.x + bb.width > w - 2 || bb.y < 2 || bb.y + bb.height > h - m.b + 2
        || placed.some((o) => bb.x < o.x + o.width && bb.x + bb.width > o.x && bb.y < o.y + o.height && bb.y + bb.height > o.y);
      if (!clash) {
        placed.push(bb);
        break;
      }
      t.remove();
    }
  }

  const legend = parent.createDiv({ cls: "literature-feed-scatter-legend" });
  for (const item of spec.legend) {
    const span = legend.createSpan();
    legendMark(span, item.mark);
    span.appendText(item.text);
  }
}
