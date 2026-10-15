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

/** Points for the rows the scan listed. At most `labels` of the points above the line, the largest gaps, carry a label. */
export function diagonalPoints(rows: readonly WorkRow[], labels = 5): Diagonal {
  const usable = rows.filter((r) => r.similarCount !== null && r.similarOf !== null && r.similarOf > 0 && r.gap !== null);
  const left = rows.filter((r) => r.similarCount !== null && r.gap === null).length;
  const points: DiagonalPoint[] = usable.map((r) => ({
    key: r.key, x: r.share * 100, y: ((r.similarCount ?? 0) / (r.similarOf ?? 1)) * 100, both: r.route === "both", label: "",
    tip: `${r.title}\n${r.similarCount} of ${r.similarOf} similar papers cite it; ${r.count} of ${r.of} of your references (${(r.gap ?? 0) >= 0 ? "+" : "−"}${Math.abs(r.gap ?? 0).toFixed(0)} points)`,
  }));
  const top = [...usable].filter((r) => (r.gap ?? 0) > 0).sort((a, b) => (b.gap ?? 0) - (a.gap ?? 0) || a.key.localeCompare(b.key)).slice(0, labels);
  const byKey = new Map(points.map((p) => [p.key, p]));
  for (const r of top) {
    const p = byKey.get(r.key);
    if (p) p.label = shortLabel(r.authors, r.year);
  }
  const biggest = Math.max(10, ...points.map((p) => Math.max(p.x, p.y)));
  const eps = 1e-9;
  return {
    points, max: Math.ceil(biggest / 5) * 5, left,
    above: points.filter((p) => p.y > p.x + eps).length,
    on: points.filter((p) => Math.abs(p.y - p.x) <= eps).length,
    below: points.filter((p) => p.y < p.x - eps).length,
    aboveBoth: points.filter((p) => p.both && p.y > p.x + eps).length,
  };
}
