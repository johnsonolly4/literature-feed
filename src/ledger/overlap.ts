// Overlap between searches and between the topics of one search, from the ledger: do searches list the same papers (duplicating),
// does one search's rules drop papers another lists (excluding), does a topic add nothing beyond another. Pure: no Obsidian.
// Only papers listed since the ledger began count, and only what the rules dropped since ids were recorded.
import type { FeedConfig } from "../settings/data";
import { verdictOf, type Ledger, type LedgerPaper } from "./ledger";

/** A comparison with fewer papers than this on either side is reported as too thin to say much. */
export const THIN = 5;
/** A topic needs at least this many listed papers before it can be called redundant. */
export const MIN_TOPIC = 3;

export interface PairRow {
  a: string;
  b: string;
  aName: string;
  bName: string;
  aListed: number;
  bListed: number;
  /** Papers listed under both searches. */
  both: number;
  /** Wanted rate of the shared papers and of the papers listed under only one of the two (null when none is decided). */
  bothRate: number | null;
  restRate: number | null;
  /** Papers A's rules dropped that B listed, how many of them were wanted (under B), and the reverse. */
  aDropsOfB: { count: number; wanted: number };
  bDropsOfA: { count: number; wanted: number };
  lines: string[];
}

export interface TopicOverlapRow {
  topic: number;
  text: string;
  listed: number;
  /** Papers only this topic found. */
  only: number;
  /** For each topic number, papers both found (the same topic gives `listed`). */
  with: Record<number, number>;
}

export interface TopicOverlap {
  feedId: string;
  name: string;
  topics: TopicOverlapRow[];
  lines: string[];
}

export interface Overlap {
  pairs: PairRow[];
  topics: TopicOverlap[];
}

const idOf = (key: string): string => key.slice(key.indexOf("/") + 1);
const feedOf = (key: string): string => key.slice(0, key.indexOf("/"));

function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/** Wanted share of the decided papers in a list, or null when none is decided. */
function rate(papers: readonly LedgerPaper[], today: string, weeks: number): number | null {
  let interested = 0;
  let decided = 0;
  for (const p of papers) {
    const v = verdictOf(p, today, weeks);
    if (v === "undecided") continue;
    decided++;
    if (v === "interested") interested++;
  }
  return decided === 0 ? null : interested / decided;
}

/** A paper listed under two searches is wanted if either line is, dismissed if either is and none is wanted. */
function merged(x: LedgerPaper, y: LedgerPaper, today: string, weeks: number): LedgerPaper {
  const vx = verdictOf(x, today, weeks);
  const vy = verdictOf(y, today, weeks);
  if (vx === "interested") return x;
  if (vy === "interested") return y;
  if (vx === "dismissed") return x;
  return y;
}

export function buildOverlap(ledger: Ledger, feeds: readonly FeedConfig[], today: string, dismissAfterWeeks: number): Overlap {
  const known = new Map(feeds.map((f) => [f.id, f]));
  const listed = new Map<string, Map<string, LedgerPaper>>();
  for (const [key, paper] of Object.entries(ledger.papers)) {
    const id = feedOf(key);
    const own = listed.get(id) ?? new Map<string, LedgerPaper>();
    own.set(idOf(key), paper);
    listed.set(id, own);
  }
  const order = [
    ...feeds.filter((f) => listed.has(f.id) || ledger.droppedIds[f.id]).map((f) => f.id),
    ...[...new Set([...listed.keys(), ...Object.keys(ledger.droppedIds)])].filter((id) => !known.has(id)).sort(),
  ];
  const nameOf = (id: string): string => known.get(id)?.name ?? ledger.names[id] ?? id;

  const pairs: PairRow[] = [];
  for (let i = 0; i < order.length; i++) {
    for (let j = i + 1; j < order.length; j++) {
      pairs.push(pairRow(order[i], order[j], nameOf(order[i]), nameOf(order[j]), listed, ledger, today, dismissAfterWeeks));
    }
  }

  const topics: TopicOverlap[] = [];
  for (const id of order) {
    const t = topicOverlap(id, nameOf(id), known.get(id), listed.get(id) ?? new Map<string, LedgerPaper>());
    if (t) topics.push(t);
  }
  return { pairs, topics };
}

function pairRow(a: string, b: string, aName: string, bName: string, listed: Map<string, Map<string, LedgerPaper>>, ledger: Ledger, today: string, weeks: number): PairRow {
  const la = listed.get(a) ?? new Map<string, LedgerPaper>();
  const lb = listed.get(b) ?? new Map<string, LedgerPaper>();
  const shared: LedgerPaper[] = [];
  const rest: LedgerPaper[] = [];
  for (const [id, p] of la) {
    const q = lb.get(id);
    if (q) shared.push(merged(p, q, today, weeks));
    else rest.push(p);
  }
  for (const [id, q] of lb) if (!la.has(id)) rest.push(q);

  const drops = (dropper: string, other: Map<string, LedgerPaper>): { count: number; wanted: number } => {
    let count = 0;
    let wanted = 0;
    for (const id of ledger.droppedIds[dropper] ?? []) {
      const p = other.get(id);
      if (!p) continue;
      count++;
      if (verdictOf(p, today, weeks) === "interested") wanted++;
    }
    return { count, wanted };
  };
  const aDropsOfB = drops(a, lb);
  const bDropsOfA = drops(b, la);

  const row: PairRow = {
    a, b, aName, bName, aListed: la.size, bListed: lb.size, both: shared.length,
    bothRate: rate(shared, today, weeks), restRate: rate(rest, today, weeks), aDropsOfB, bDropsOfA, lines: [],
  };
  row.lines = pairLines(row);
  return row;
}

function pairLines(r: PairRow): string[] {
  const lines: string[] = [];
  const thin = Math.min(r.aListed, r.bListed) < THIN;
  if (r.aListed === 0 || r.bListed === 0) {
    lines.push(`${r.aListed === 0 ? r.aName : r.bName} has no listed papers yet, so there is nothing to compare.`);
  } else if (r.both === 0) {
    lines.push(`${r.aName} and ${r.bName} list no paper in common.${thin ? " (Too few papers to say much.)" : ""}`);
  } else {
    let text = `${r.aName} and ${r.bName} both list ${plural(r.both, "paper")} (${pct(r.both / r.aListed)} of ${r.aName}, ${pct(r.both / r.bListed)} of ${r.bName}).`;
    if (r.bothRate !== null && r.restRate !== null) text += ` Shared papers were wanted ${pct(r.bothRate)} of the time, against ${pct(r.restRate)} for the rest.`;
    if (thin) text += " (Too few papers to say much.)";
    lines.push(text);
  }
  const drop = (who: string, other: string, d: { count: number; wanted: number }): void => {
    if (d.count === 0) return;
    lines.push(`${who}'s rules dropped ${plural(d.count, "paper")} that ${other} listed (${d.wanted} wanted): its rules may be too strict, or the searches overlap on purpose.`);
  };
  drop(r.aName, r.bName, r.aDropsOfB);
  drop(r.bName, r.aName, r.bDropsOfA);
  return lines;
}

function topicOverlap(feedId: string, name: string, feed: FeedConfig | undefined, papers: Map<string, LedgerPaper>): TopicOverlap | null {
  const withTopics = [...papers.values()].filter((p) => p.topics.length > 0);
  if (withTopics.length === 0) return null;
  const count = Math.max(feed?.topics.length ?? 0, ...withTopics.flatMap((p) => p.topics));
  const rows: TopicOverlapRow[] = [];
  for (let t = 1; t <= count; t++) {
    const own = withTopics.filter((p) => p.topics.includes(t));
    const withMap: Record<number, number> = {};
    for (let u = 1; u <= count; u++) withMap[u] = own.filter((p) => p.topics.includes(u)).length;
    rows.push({ topic: t, text: feed?.topics[t - 1] ?? "", listed: own.length, only: own.filter((p) => p.topics.length === 1).length, with: withMap });
  }
  const lines: string[] = [];
  const said = new Set<string>();
  for (const r of rows) {
    if (r.listed < MIN_TOPIC) continue;
    const covering = rows.filter((o) => o.topic !== r.topic && r.with[o.topic] === r.listed);
    if (covering.length === 0) continue;
    const twin = covering.find((o) => o.listed === r.listed);
    if (twin) {
      const key = [r.topic, twin.topic].sort().join("-");
      if (!said.has(key)) {
        said.add(key);
        lines.push(`Topics ${Math.min(r.topic, twin.topic)} and ${Math.max(r.topic, twin.topic)} found exactly the same ${plural(r.listed, "paper")}: one of them is enough.`);
      }
    } else {
      lines.push(`Topic ${r.topic} adds nothing: every paper it listed (${r.listed}) was also found by topic ${covering.map((c) => c.topic).join(" and ")}.`);
    }
  }
  return { feedId, name, topics: rows, lines };
}

// ---- Markdown ---------------------------------------------------------------------------------------------------------

function cell(text: string): string {
  return text.replace(/\|/g, "\\|").replace(/\s+/g, " ").trim();
}

function short(text: string, max = 50): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** The overlap as lines of Markdown (a heading and tables), or none when there is nothing to show. */
export function overlapMarkdown(o: Overlap): string[] {
  const out: string[] = [];
  if (o.pairs.length === 0 && o.topics.length === 0) return out;
  out.push("## Overlap", "", "Based on the papers listed since the history began, and on what each search's rules dropped since their ids were recorded.", "");
  if (o.pairs.length > 0) {
    out.push("### Between searches", "");
    out.push("| Search A | Search B | Listed A | Listed B | In both | Shared wanted | Rest wanted | A dropped, B listed | B dropped, A listed |", "| --- | --- | --- | --- | --- | --- | --- | --- | --- |");
    const r = (n: number | null): string => (n === null ? "–" : pct(n));
    for (const p of o.pairs) {
      out.push(`| ${[cell(p.aName), cell(p.bName), p.aListed, p.bListed, p.both, r(p.bothRate), r(p.restRate), p.aDropsOfB.count, p.bDropsOfA.count].join(" | ")} |`);
    }
    out.push("");
    for (const p of o.pairs) for (const line of p.lines) out.push(`- ${line}`);
    out.push("");
  }
  for (const t of o.topics) {
    out.push(`### Between the topics of ${cell(t.name)}`, "");
    const heads = t.topics.map((x) => `With topic ${x.topic}`);
    out.push(`| Topic | Query | Listed | Only this topic | ${heads.join(" | ")} |`, `| --- | --- | --- | --- | ${heads.map(() => "---").join(" | ")} |`);
    for (const x of t.topics) out.push(`| ${[x.topic, cell(short(x.text)), x.listed, x.only, ...t.topics.map((y) => x.with[y.topic])].join(" | ")} |`);
    out.push("");
    for (const line of t.lines) out.push(`- ${line}`);
    if (t.lines.length > 0) out.push("");
  }
  return out;
}
