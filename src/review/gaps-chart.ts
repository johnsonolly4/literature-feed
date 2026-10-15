// The data behind the signal-2b diagonal chart (from the owner's refcheck dashboard): each work the similar papers cite, placed by the share
// of the paper's references that cite it (x) and the share of the neighbours that cite it (y), both in percent on the same scale, so a point
// above the y = x line is cited more by the neighbours than by the references. Pure: `src/ui/scatter.ts` draws it.
import type { WorkRow } from "./gaps-rows";

export interface DiagonalPoint {
  key: string;
  /** Share of the references (x) and of the neighbours (y) that cite it, in percent. */
  x: number;
  y: number;
  /** Found on both routes (signal 1 and signal 2b). */
  both: boolean;
  /** First author's family name and year, for the few labelled points; empty otherwise. */
  label: string;
  /** Draw the label to the left of the dot (the dot is near the right edge). */
  labelLeft?: boolean;
  tip: string;
}

export interface Diagonal {
  points: DiagonalPoint[];
  /** The scale of both axes: at least 10, rounded up to a multiple of 5. */
  max: number;
  above: number;
  on: number;
  below: number;
  aboveBoth: number;
  /** Rows left out because this run did not save how many references cite them (a run from before the chart). */
  left: number;
}

/** The family name and year of a work's first author, e.g. "Roe 2019". */
export function shortLabel(authors: readonly string[], year: number | null): string {
  const first = authors[0]?.trim() ?? "";
  const family = first === "" ? "" : first.includes(",") ? first.split(",")[0].trim() : (first.split(/\s+/).pop() ?? "");
  return [family, year === null ? "" : String(year)].filter((t) => t !== "").join(" ");
}

// The size of the plot in the drawing (src/ui/scatter.ts) and of a label, to keep labels from covering each other. Approximate on purpose.
const PLOT_W = 570;
const PLOT_H = 398;
const CHAR_W = 6.2;
const LABEL_H = 14;
const DOT_GAP = 11;

/**
 * Points for the rows the scan listed. At most `labels` points above the line carry a label: the works found on both routes first, then the
 * others, each by largest gap. A label that would cover one already placed (or that sits on the same spot) is skipped, and one that would run
 * past the right edge goes to the left of its dot.
 */
export function diagonalPoints(rows: readonly WorkRow[], labels = 5): Diagonal {
  const usable = rows.filter((r) => r.similarCount !== null && r.similarOf !== null && r.similarOf > 0 && r.gap !== null);
  const left = rows.filter((r) => r.similarCount !== null && r.gap === null).length;
  const points: DiagonalPoint[] = usable.map((r) => ({
    key: r.key, x: r.share * 100, y: ((r.similarCount ?? 0) / (r.similarOf ?? 1)) * 100, both: r.route === "both", label: "",
    tip: `${r.title}\n${r.similarCount} of ${r.similarOf} similar papers cite it; ${r.count} of ${r.of} of your references (${(r.gap ?? 0) >= 0 ? "+" : "−"}${Math.abs(r.gap ?? 0).toFixed(0)} points)`,
  }));
  const biggest = Math.max(10, ...points.map((p) => Math.max(p.x, p.y)));
  const max = Math.ceil(biggest / 5) * 5;
  const byKey = new Map(points.map((p) => [p.key, p]));
  const ranked = [...usable].filter((r) => (r.gap ?? 0) > 0)
    .sort((a, b) => Number(b.route === "both") - Number(a.route === "both") || (b.gap ?? 0) - (a.gap ?? 0) || a.key.localeCompare(b.key));
  // Boxes in pixels of the plot (x to the right, y downwards), one per placed label.
  const placed: { l: number; r: number; t: number; b: number }[] = [];
  let count = 0;
  for (const r of ranked) {
    if (count >= labels) break;
    const p = byKey.get(r.key);
    const text = shortLabel(r.authors, r.year);
    if (!p || text === "") continue;
    const width = text.length * CHAR_W;
    const cx = (p.x / max) * PLOT_W;
    const cy = PLOT_H - (p.y / max) * PLOT_H;
    const left = cx + DOT_GAP + width > PLOT_W;
    const box = left ? { l: cx - DOT_GAP - width, r: cx - DOT_GAP, t: cy - LABEL_H / 2, b: cy + LABEL_H / 2 } : { l: cx + DOT_GAP, r: cx + DOT_GAP + width, t: cy - LABEL_H / 2, b: cy + LABEL_H / 2 };
    if (placed.some((o) => box.l < o.r && o.l < box.r && box.t < o.b && o.t < box.b)) continue;
    // Not over another labelled dot either.
    if (points.some((q) => q.label !== "" && Math.abs((q.x / max) * PLOT_W - cx) < width && Math.abs(PLOT_H - (q.y / max) * PLOT_H - cy) < LABEL_H)) continue;
    placed.push(box);
    p.label = text;
    if (left) p.labelLeft = true;
    count++;
  }
  const eps = 1e-9;
  return {
    points, max, left,
    above: points.filter((p) => p.y > p.x + eps).length,
    on: points.filter((p) => Math.abs(p.y - p.x) <= eps).length,
    below: points.filter((p) => p.y < p.x - eps).length,
    aboveBoth: points.filter((p) => p.both && p.y > p.x + eps).length,
  };
}
