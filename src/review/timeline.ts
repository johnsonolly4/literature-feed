// The graph laid out as a timeline: the vertical axis is the publication year (oldest at the top), and papers are spread sideways so
// that papers that cite each other sit near each other and no two overlap. Pure and deterministic (nothing random): the same papers
// always give the same picture. Papers with no year go in a row at the bottom.

export interface TimelineNode {
  id: string;
  year: number | null;
}

export interface TimelineEdge {
  from: string;
  to: string;
}

export interface TimelineResult {
  at: Map<string, { x: number; y: number }>;
  /** A guide line and its label for the years that have papers (not every year when the range is long). */
  guides: { y: number; label: string }[];
}

const MARGIN = 50;
/** Papers closer than this are pushed apart. */
const MIN_GAP = 30;
const UNKNOWN_ROW = 60;

export function timelineLayout(nodes: readonly TimelineNode[], edges: readonly TimelineEdge[], opts: { width: number; height: number }): TimelineResult {
  const { width, height } = opts;
  const at = new Map<string, { x: number; y: number }>();
  const ids = [...nodes].sort((a, b) => a.id.localeCompare(b.id));
  const n = ids.length;
  if (n === 0) return { at, guides: [] };
  const known = ids.map((p) => p.year).filter((y): y is number => y !== null);
  const min = known.length > 0 ? Math.min(...known) : 0;
  const max = known.length > 0 ? Math.max(...known) : 0;
  const hasUnknown = known.length < n;
  const span = height - 2 * MARGIN - (hasUnknown ? UNKNOWN_ROW : 0);
  const yearY = (year: number): number => MARGIN + (max === min ? span / 2 : ((year - min) / (max - min)) * span);
  const unknownY = height - MARGIN;

  const index = new Map(ids.map((p, i) => [p.id, i]));
  const x = new Float64Array(n);
  const y = new Float64Array(n);
  const rowOf = new Map<string, number[]>();
  ids.forEach((p, i) => {
    const key = p.year === null ? "?" : String(p.year);
    rowOf.set(key, [...(rowOf.get(key) ?? []), i]);
  });
  for (const members of rowOf.values()) {
    members.forEach((i, rank) => {
      const year = ids[i].year;
      x[i] = MARGIN + ((rank + 0.5) * (width - 2 * MARGIN)) / members.length;
      // Neighbours in a crowded year sit a little above and below one another, so a row holds more papers.
      y[i] = (year === null ? unknownY : yearY(year)) + ((rank % 3) - 1) * 16;
    });
  }

  const neighbours: number[][] = Array.from({ length: n }, () => []);
  for (const e of edges) {
    const a = index.get(e.from);
    const b = index.get(e.to);
    if (a !== undefined && b !== undefined && a !== b) {
      neighbours[a].push(b);
      neighbours[b].push(a);
    }
  }
  for (let round = 0; round < 150; round++) {
    // Move towards the middle of the linked papers' positions.
    for (let i = 0; i < n; i++) {
      if (neighbours[i].length === 0) continue;
      const target = neighbours[i].reduce((s, j) => s + x[j], 0) / neighbours[i].length;
      x[i] += (target - x[i]) * 0.25;
    }
    // Keep papers apart.
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        if (Math.abs(y[i] - y[j]) >= MIN_GAP) continue;
        const dx = x[i] - x[j];
        if (Math.abs(dx) >= MIN_GAP) continue;
        const push = (MIN_GAP - Math.abs(dx)) / 2;
        const dir = dx === 0 ? (i % 2 === 0 ? 1 : -1) : Math.sign(dx);
        x[i] += dir * push;
        x[j] -= dir * push;
      }
    }
    for (let i = 0; i < n; i++) x[i] = Math.min(width - MARGIN, Math.max(MARGIN, x[i]));
  }
  // A last pass along each year's row: papers at least half a gap apart, even where the sides squeezed them together.
  for (const members of rowOf.values()) {
    const order = [...members].sort((p, q) => x[p] - x[q] || p - q);
    const gap = Math.min(MIN_GAP / 2, (width - 2 * MARGIN) / Math.max(1, order.length - 1));
    for (let k = 1; k < order.length; k++) if (x[order[k]] < x[order[k - 1]] + gap) x[order[k]] = x[order[k - 1]] + gap;
    for (let k = order.length - 1; k >= 0; k--) x[order[k]] = Math.min(x[order[k]], width - MARGIN - (order.length - 1 - k) * gap);
  }
  ids.forEach((p, i) => at.set(p.id, { x: Math.round(x[i] * 10) / 10, y: Math.round(y[i] * 10) / 10 }));

  const years = [...new Set(known)].sort((a, b) => a - b);
  const every = Math.max(1, Math.ceil(years.length / 12));
  const guides = years.filter((_, k) => k % every === 0).map((year) => ({ y: Math.round(yearY(year) * 10) / 10, label: String(year) }));
  if (hasUnknown) guides.push({ y: unknownY, label: "no year" });
  return { at, guides };
}
