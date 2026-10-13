// Draws a chart spec (see chart.ts) as SVG in a note or a window. No library, no inline styles: colours and type come from CSS
// classes in styles.css. Used by the code block `literature-feed-chart` and by the review window.
import { parseChartSpec, type ChartSpec } from "./chart";

const WIDTH = 640;

function short(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

/** An SVG element holding text (the SVG element options have no `text`, so it is set after). */
function svgText(parent: SVGElement, cls: string, text: string, attr: Record<string, string>): void {
  parent.createSvg("text", { cls, attr }).setText(text);
}

/** Draws one chart into `parent`. */
export function drawChart(parent: HTMLElement, spec: ChartSpec): void {
  const box = parent.createDiv({ cls: "literature-feed-chart" });
  box.createDiv({ cls: "literature-feed-chart-title", text: spec.title });
  if (spec.items.length === 0) {
    box.createDiv({ cls: "literature-feed-meta", text: "Nothing to show." });
    return;
  }
  const max = Math.max(...spec.items.map((i) => i.value), 1);
  if (spec.kind === "bars") {
    const height = 200;
    const top = 20;
    const bottom = 26;
    const svg = box.createSvg("svg", { attr: { viewBox: `0 0 ${WIDTH} ${height}`, width: "100%", role: "img", "aria-label": spec.title } });
    const slot = WIDTH / spec.items.length;
    const barWidth = Math.max(2, Math.min(48, slot * 0.7));
    const every = Math.ceil(spec.items.length / 14);
    spec.items.forEach((item, i) => {
      const h = Math.round(((height - top - bottom) * item.value) / max);
      const x = i * slot + (slot - barWidth) / 2;
      const y = height - bottom - h;
      const rect = svg.createSvg("rect", { cls: "literature-feed-chart-bar", attr: { x: String(x), y: String(y), width: String(barWidth), height: String(h) } });
      rect.createSvg("title").setText(`${item.label}: ${item.value} ${spec.unit}`);
      if (item.value > 0) svgText(svg, "literature-feed-chart-value", String(item.value), { x: String(x + barWidth / 2), y: String(y - 4), "text-anchor": "middle" });
      if (i % every === 0) svgText(svg, "literature-feed-chart-label", item.label, { x: String(x + barWidth / 2), y: String(height - 8), "text-anchor": "middle" });
    });
    return;
  }
  const rowHeight = 22;
  const labelWidth = 300;
  const height = spec.items.length * rowHeight + 6;
  const svg = box.createSvg("svg", { attr: { viewBox: `0 0 ${WIDTH} ${height}`, width: "100%", role: "img", "aria-label": spec.title } });
  spec.items.forEach((item, i) => {
    const y = i * rowHeight + 3;
    const w = Math.max(2, Math.round(((WIDTH - labelWidth - 60) * item.value) / max));
    svgText(svg, "literature-feed-chart-label", short(item.label, 48), { x: "0", y: String(y + 14) });
    const rect = svg.createSvg("rect", { cls: "literature-feed-chart-bar", attr: { x: String(labelWidth), y: String(y + 2), width: String(w), height: String(rowHeight - 7) } });
    rect.createSvg("title").setText(`${item.label}: ${item.value} ${spec.unit}`);
    svgText(svg, "literature-feed-chart-value", String(item.value), { x: String(labelWidth + w + 6), y: String(y + 14) });
  });
  box.createDiv({ cls: "literature-feed-meta", text: spec.unit });
}

/** The code block processor: the block's text is a chart spec. */
export function chartBlockProcessor(source: string, el: HTMLElement): void {
  const spec = parseChartSpec(source);
  if (spec === null) {
    el.createEl("p", { cls: "literature-feed-warning", text: "This chart block is not valid." });
    return;
  }
  drawChart(el, spec);
}
