// A force-directed layout (Fruchterman-Reingold) for the review's graph. Pure and deterministic: nodes start on a spiral in id
// order and nothing is random, so the same papers always give the same picture. Linked nodes pull together, all nodes push apart,
// a weak pull to the centre keeps separate groups on the page, and every node stays inside the box.
export interface LayoutNode {
  id: string;
}

export interface LayoutEdge {
  from: string;
  to: string;
}

export interface LayoutOptions {
  width: number;
  height: number;
  /** Rounds of movement. */
  iterations?: number;
}

export function forceLayout(nodes: readonly LayoutNode[], edges: readonly LayoutEdge[], opts: LayoutOptions): Map<string, { x: number; y: number }> {
  const { width, height } = opts;
  const iterations = opts.iterations ?? 250;
  const out = new Map<string, { x: number; y: number }>();
  const ids = [...new Set(nodes.map((n) => n.id))].sort();
  const n = ids.length;
  if (n === 0) return out;
  const margin = Math.min(width, height) * 0.05;
  if (n === 1) {
    out.set(ids[0], { x: width / 2, y: height / 2 });
    return out;
  }
  const index = new Map(ids.map((id, i) => [id, i]));
  const x = new Float64Array(n);
  const y = new Float64Array(n);
  // A spiral from the centre outwards (the golden angle), in id order.
  const golden = Math.PI * (3 - Math.sqrt(5));
  const spread = Math.min(width, height) * 0.4;
  for (let i = 0; i < n; i++) {
    const r = spread * Math.sqrt((i + 0.5) / n);
    x[i] = width / 2 + r * Math.cos(i * golden);
    y[i] = height / 2 + r * Math.sin(i * golden);
  }
  const links: [number, number][] = [];
  for (const e of edges) {
    const a = index.get(e.from);
    const b = index.get(e.to);
    if (a !== undefined && b !== undefined && a !== b) links.push([a, b]);
  }
  const area = (width - 2 * margin) * (height - 2 * margin);
  const k = Math.sqrt(area / n);
  let temperature = Math.min(width, height) / 8;
  const cooling = temperature / (iterations + 1);
  const dx = new Float64Array(n);
  const dy = new Float64Array(n);

  for (let round = 0; round < iterations; round++) {
    dx.fill(0);
    dy.fill(0);
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        let ex = x[i] - x[j];
        let ey = y[i] - y[j];
        let d = Math.hypot(ex, ey);
        if (d < 0.01) {
          // On top of each other: separate along a fixed direction that depends on the pair, not on chance.
          ex = Math.cos(i + j);
          ey = Math.sin(i + j);
          d = 0.01;
        }
        const force = (k * k) / d;
        dx[i] += (ex / d) * force;
        dy[i] += (ey / d) * force;
        dx[j] -= (ex / d) * force;
        dy[j] -= (ey / d) * force;
      }
    }
    for (const [a, b] of links) {
      const ex = x[a] - x[b];
      const ey = y[a] - y[b];
      const d = Math.max(Math.hypot(ex, ey), 0.01);
      const force = (d * d) / k;
      dx[a] -= (ex / d) * force;
      dy[a] -= (ey / d) * force;
      dx[b] += (ex / d) * force;
      dy[b] += (ey / d) * force;
    }
    for (let i = 0; i < n; i++) {
      // A weak pull to the centre.
      dx[i] += (width / 2 - x[i]) * 0.02;
      dy[i] += (height / 2 - y[i]) * 0.02;
      const d = Math.max(Math.hypot(dx[i], dy[i]), 0.01);
      const step = Math.min(d, temperature);
      x[i] = Math.min(width - margin, Math.max(margin, x[i] + (dx[i] / d) * step));
      y[i] = Math.min(height - margin, Math.max(margin, y[i] + (dy[i] / d) * step));
    }
    temperature -= cooling;
  }
  for (let i = 0; i < n; i++) out.set(ids[i], { x: Math.round(x[i] * 10) / 10, y: Math.round(y[i] * 10) / 10 });
  return out;
}
