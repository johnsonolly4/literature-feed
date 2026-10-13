// The review's charts as data: papers per year, authors with the most papers, the most cited papers, the most networked papers.
// A chart is a small JSON spec that sits in a ```literature-feed-chart code block of the review note and is drawn by the plugin
// (see chart-view.ts); no chart library is used. Pure.
import type { ChartData } from "./network";

export interface ChartSpec {
  title: string;
  /** `bars` stand upright (a value per label along a time-like axis); `hbars` lie down (a ranking). */
  kind: "bars" | "hbars";
  items: { label: string; value: number }[];
  /** What the value counts, for the caption. */
  unit: string;
}

function shorten(text: string, max = 44): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

/** The four charts that have something to show. `labelOf` and `titleOf` name a paper by its id. */
export function chartSpecs(data: ChartData, labelOf: (id: string) => string, titleOf: (id: string) => string): ChartSpec[] {
  const out: ChartSpec[] = [];
  if (data.perYear.length > 0) out.push({ title: "Papers per year", kind: "bars", unit: "papers", items: data.perYear.map((y) => ({ label: String(y.year), value: y.count })) });
  if (data.topAuthors.length > 0) out.push({ title: "Authors with the most papers", kind: "hbars", unit: "papers", items: data.topAuthors.map((a) => ({ label: a.name, value: a.count })) });
  if (data.mostCited.length > 0) out.push({ title: "Most cited (all citations)", kind: "hbars", unit: "citations", items: data.mostCited.map((c) => ({ label: `${labelOf(c.id)} ${shorten(titleOf(c.id))}`, value: c.value })) });
  if (data.mostNetworked.length > 0) out.push({ title: "Most connected inside this set", kind: "hbars", unit: "links to other papers here", items: data.mostNetworked.map((c) => ({ label: `${labelOf(c.id)} ${shorten(titleOf(c.id))}`, value: c.value })) });
  return out;
}

export const CHART_BLOCK = "literature-feed-chart";

/** The spec as a code block for a note. */
export function chartBlock(spec: ChartSpec): string[] {
  return ["```" + CHART_BLOCK, JSON.stringify(spec), "```"];
}

/** A spec from the text of a code block; null when it is not one. */
export function parseChartSpec(source: string): ChartSpec | null {
  let raw: unknown;
  try {
    raw = JSON.parse(source);
  } catch {
    return null;
  }
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.title !== "string" || (r.kind !== "bars" && r.kind !== "hbars") || !Array.isArray(r.items)) return null;
  const items = r.items.flatMap((i) => {
    if (typeof i !== "object" || i === null) return [];
    const { label, value } = i as { label?: unknown; value?: unknown };
    return typeof label === "string" && typeof value === "number" && Number.isFinite(value) && value >= 0 ? [{ label, value }] : [];
  });
  return { title: r.title, kind: r.kind, items, unit: typeof r.unit === "string" ? r.unit : "" };
}
