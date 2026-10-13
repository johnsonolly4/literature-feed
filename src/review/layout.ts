// A force-directed layout (Fruchterman-Reingold) for the review's graph. Pure and deterministic: nodes start on a spiral in id
// order and nothing is random, so the same papers always give the same picture. Linked nodes pull together, all nodes push apart,
// a pull to the centre keeps separate groups on the page, and every node stays inside the box. Papers with no link to another are
// not part of the force simulation (they would be pushed to the walls): they sit in a tidy grid along the bottom.
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

/** Space between nodes of the grid of unlinked papers. */
const GRID_STEP = 46;

/** The force simulation for `n` nodes joined by `links`, inside `width` x `height`. */
function simulate(n: number, links: readonly [number, number][], width: number, height: number, iterations: number): { x: Float64Array; y: Float64Array } {
  const margin = Math.min(width, height) * 0.05;
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
  const area = (width - 2 * margin) * (height - 2 * margin);
  const k = 0.7 * Math.sqrt(area / n);
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
      // A pull to the centre that grows with distance, so no node is thrown against the wall.
      dx[i] += (width / 2 - x[i]) * 0.5;
      dy[i] += (height / 2 - y[i]) * 0.5;
      const d = Math.max(Math.hypot(dx[i], dy[i]), 0.01);
      const step = Math.min(d, temperature);
      x[i] = Math.min(width - margin, Math.max(margin, x[i] + (dx[i] / d) * step));
      y[i] = Math.min(height - margin, Math.max(margin, y[i] + (dy[i] / d) * step));
    }
    temperature -= cooling;
  }
  return { x, y };
}

export function forceLayout(nodes: readonly LayoutNode[], edges: readonly LayoutEdge[], opts: LayoutOptions): Map<string, { x: number; y: number }> {
  const { width, height } = opts;
  const iterations = opts.iterations ?? 300;
  const out = new Map<string, { x: number; y: number }>();
  const ids = [...new Set(nodes.map((n) => n.id))].sort();
  const n = ids.length;
  if (n === 0) return out;
  const round1 = (v: number): number => Math.round(v * 10) / 10;
  if (n === 1) {
    out.set(ids[0], { x: width / 2, y: height / 2 });
    return out;
  }
  const index = new Map(ids.map((id, i) => [id, i]));
  const links: [number, number][] = [];
  const linked = new Set<number>();
  for (const e of edges) {
    const a = index.get(e.from);
    const b = index.get(e.to);
    if (a !== undefined && b !== undefined && a !== b) {
      links.push([a, b]);
      linked.add(a);
      linked.add(b);
    }
  }
  // Summing forces in a fixed order keeps the picture the same whatever order the edges came in.
  links.sort((p, q) => p[0] - q[0] || p[1] - q[1]);
  const core = ids.map((_, i) => i).filter((i) => linked.has(i));
  const loose = ids.map((_, i) => i).filter((i) => !linked.has(i));

  if (core.length === 0) {
    // Nothing is linked: one simulation over the whole box (the papers push each other apart).
    const { x, y } = simulate(n, links, width, height, iterations);
    for (let i = 0; i < n; i++) out.set(ids[i], { x: round1(x[i]), y: round1(y[i]) });
    return out;
  }

  // Unlinked papers in a grid along the bottom (if there are any), the rest above it.
  const margin = Math.min(width, height) * 0.05;
  const perRow = Math.max(1, Math.floor((width - 2 * margin) / GRID_STEP) + 1);
  const rows = Math.ceil(loose.length / perRow);
  const strip = loose.length === 0 ? 0 : rows * GRID_STEP + margin;
  const top = loose.length === 0 ? height : Math.max(height - strip, height * 0.4);
  const at = new Map(core.map((id, c) => [id, c]));
  const coreLinks = links.map(([a, b]): [number, number] => [at.get(a) as number, at.get(b) as number]);

  // Each group of papers that cite each other is laid out on its own: the biggest in the main area, the small ones in boxes beside it,
  // so a few separate pairs do not spread over the whole picture.
  const groups = componentsOf(core.length, coreLinks).sort((p, q) => q.length - p.length || p[0] - q[0]);
  const place = (members: number[], w: number, h: number, ox: number, oy: number): void => {
    const local = new Map(members.map((m, k) => [m, k]));
    const sub = coreLinks.filter(([a, b]) => local.has(a) && local.has(b)).map(([a, b]): [number, number] => [local.get(a) as number, local.get(b) as number]);
    const { x, y } = simulate(members.length, sub, w, h, iterations);
    members.forEach((m, k) => out.set(ids[core[m]], { x: round1(ox + x[k]), y: round1(oy + y[k]) }));
  };
  const [main, ...rest] = groups;
  const mainWidth = rest.length === 0 ? width : width * 0.68;
  place(main, mainWidth, top, 0, 0);
  let colX = mainWidth + 20;
  let colY = 0;
  let colWidth = 0;
  for (const members of rest) {
    const side = Math.min(260, Math.max(90, Math.sqrt(members.length) * 85 + 50));
    if (colY + side > top && colY > 0) {
      colX += colWidth + 20;
      colY = 0;
      colWidth = 0;
    }
    place(members, side, side, colX, colY);
    colY += side + 16;
    colWidth = Math.max(colWidth, side);
  }

  const first = Math.min(perRow, loose.length);
  const left = (width - (first - 1) * GRID_STEP) / 2;
  loose.forEach((id, i) => {
    const r = Math.floor(i / perRow);
    const col = i % perRow;
    out.set(ids[id], { x: round1(left + col * GRID_STEP), y: round1(top + margin + r * GRID_STEP) });
  });
  return out;
}

/** The connected groups of `count` nodes joined by `links`: lists of node numbers, each in ascending order. */
function componentsOf(count: number, links: readonly [number, number][]): number[][] {
  const parent = Array.from({ length: count }, (_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };
  for (const [a, b] of links) {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[Math.max(ra, rb)] = Math.min(ra, rb);
  }
  const groups = new Map<number, number[]>();
  for (let i = 0; i < count; i++) {
    const r = find(i);
    groups.set(r, [...(groups.get(r) ?? []), i]);
  }
  return [...groups.values()];
}
