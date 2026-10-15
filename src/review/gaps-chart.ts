// The data behind the signal-2b chart, as the owner's refcheck dashboard draws it (replication spec 11.4, `tab === 'signal2b'` in its
// script): the top 40 works the similar papers cite, placed by the share of the paper's references that cite each (x) and the share of the
// neighbours that cite it (y), both in percent on one scale from 0, so a point above the y = x line is cited more by the neighbours than by
// the references (the gap). Pure: `src/ui/scatter.ts` draws it.
import type { WorkRow } from "./gaps-rows";

/** The dashboard lists and plots the top 40 works of signal 2b. */
export const CHART_ROWS = 40;
/** The dashboard labels the 5 largest gaps. */
export const CHART_LABELS = 5;

export interface DiagonalPoint {
  key: string;
  /** Share of the references (x) and of the neighbours (y) that cite it, in percent. */
  x: number;
  y: number;
  /** Found on both routes (signal 1 and signal 2b). */
  both: boolean;
  /** Surname of the first author and the year, for the five largest gaps; empty otherwise. */
  label: string;
  /** Hover lines, the first in bold: title, authors and year, the two shares, the gap. */
  tip: string[];
}

export interface Diagonal {
  points: DiagonalPoint[];
  /** Both axes run from 0 to this: at least 10, otherwise the largest value plus a tenth, rounded up. */
  max: number;
  /** Points above the line, of all `points`. */
  above: number;
  /** The three biggest gaps with the title cut to 55 characters, for the "In this run" text. */
  big: { title: string; gap: number }[];
  /** The median share of references and of neighbours, rounded. */
  medianX: number;
  medianY: number;
  /** Rows left out because this run did not save how many references cite them (a run from before the chart). */
  left: number;
}

/** The surname as the dashboard takes it: the last word of the first author's name. */
export function surname(authors: readonly string[]): string {
  return (authors[0]?.split(",")[0] ?? "").trim().split(" ").pop() ?? "";
}

/** The label of a work in the chart: surname and year. */
export function shortLabel(authors: readonly string[], year: number | null): string {
  return [surname(authors), year === null ? "" : String(year)].filter((t) => t !== "").join(" ");
}

function median(values: readonly number[]): number {
  const v = [...values].sort((a, b) => a - b);
  if (v.length === 0) return 0;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 === 1 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

const sign = (n: number): string => (n > 0 ? "+" : "");

/** The chart's points for the rows the scan listed (the first `CHART_ROWS`, most cited by the neighbours first). */
export function diagonalPoints(rows: readonly WorkRow[]): Diagonal {
  const listed = rows.filter((r) => r.similarCount !== null && r.similarOf !== null && r.similarOf > 0);
  const left = listed.filter((r) => r.gap === null).length;
  const usable = listed.filter((r) => r.gap !== null).slice(0, CHART_ROWS);
  const gapOf = (r: WorkRow): number => Math.round(r.gap ?? 0);
  const points: DiagonalPoint[] = usable.map((r) => {
    const x = r.share * 100;
    const y = ((r.similarCount ?? 0) / (r.similarOf ?? 1)) * 100;
    return {
      key: r.key, x, y, both: r.route === "both", label: "",
      tip: [r.title, `${r.authors.join(", ")}${r.year === null ? "" : ` · ${r.year}`}`, `Cited by ${Math.round(x)}% of your references and ${Math.round(y)}% of similar papers`, `Gap ${sign(gapOf(r))}${gapOf(r)} points`],
    };
  });
  const byGap = [...usable].sort((a, b) => gapOf(b) - gapOf(a));
  const byKey = new Map(points.map((p) => [p.key, p]));
  for (const r of byGap.slice(0, CHART_LABELS)) {
    const p = byKey.get(r.key);
    if (p) p.label = shortLabel(r.authors, r.year);
  }
  const biggest = points.length === 0 ? 10 : Math.max(...points.map((p) => Math.max(p.x, p.y)));
  return {
    points, left,
    max: Math.max(10, Math.ceil(biggest * 1.1)),
    above: points.filter((p) => p.y > p.x).length,
    big: byGap.slice(0, 3).map((r) => ({ title: r.title.slice(0, 55), gap: gapOf(r) })),
    medianX: Math.round(median(points.map((p) => p.x))),
    medianY: Math.round(median(points.map((p) => p.y))),
  };
}
