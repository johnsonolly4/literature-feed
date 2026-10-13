// The long-term record of how each search does: one small entry per listed paper (what found it, what the user did with it)
// plus a log of scans and of changes to a feed's rules. Pure: no Obsidian here; `main.ts` reads and writes `ledger.json`.
// The entries are filled from the inbox notes' lines at every refresh, so the history can be rebuilt from the notes.
import type { ConceptGroup } from "../match/feed";
import type { FeedConfig } from "../settings/data";
import { addDays, type TopicStat } from "../inbox/scan";
import { noteWeekStart } from "../inbox/state";
import type { ListedTier, ParsedPaper } from "../inbox/write";

/** Scan records kept (the oldest are dropped beyond this). */
export const SCAN_CAP = 300;

export interface LedgerPaper {
  title: string;
  tier: ListedTier;
  /** Monday (`YYYY-MM-DD`) of the note's week; "" when the note's name has none. */
  start: string;
  /** Search topics (1-based) that found it; empty for lines made before topics were recorded. */
  topics: number[];
  /** Feed terms the line showed. */
  terms: string[];
  /** The number of the feed's rules (see `defs`) that were current when the paper was first recorded; 0 = unknown. */
  def: number;
  /** The first day a refresh saw each outcome. */
  ticked?: string;
  synced?: string;
  read?: string;
}

export interface ScanRecord {
  at: string;
  feedId: string;
  topics: TopicStat[];
}

/** The parts of a feed that decide what it lists. */
export interface DefSnapshot {
  topics: string[];
  groups: ConceptGroup[];
  drop: string[];
  lower: string[];
  yearsFrom: number | null;
}

export interface DefRecord {
  /** 1, 2, 3 … per feed. */
  n: number;
  /** The day of the scan that first used these rules. */
  at: string;
  snap: DefSnapshot;
  /** One line: what changed from the version before. */
  change: string;
}

export interface Ledger {
  version: 1;
  /** Keyed `<feedId>/<OpenAlexId>`. */
  papers: Record<string, LedgerPaper>;
  scans: ScanRecord[];
  defs: Record<string, DefRecord[]>;
  /** Feed names as of the last scan, for the report. */
  names: Record<string, string>;
}

export function emptyLedger(): Ledger {
  return { version: 1, papers: {}, scans: [], defs: {}, names: {} };
}

export function ledgerKey(feedId: string, openalexId: string): string {
  return `${feedId}/${openalexId}`;
}

// ---- reading a stored file tolerantly ---------------------------------------------------------------------------------

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function strings(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((s): s is string => typeof s === "string") : [];
}

function day(v: unknown): string | undefined {
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined;
}

const TIERS: readonly string[] = ["priority", "strong", "possible", "unchecked"];

/** A ledger from whatever `ledger.json` held; anything unusable is left out, never thrown. */
export function normaliseLedger(raw: unknown): Ledger {
  const out = emptyLedger();
  if (!isRecord(raw)) return out;
  if (isRecord(raw.papers)) {
    for (const [key, value] of Object.entries(raw.papers)) {
      if (!isRecord(value) || typeof value.title !== "string" || typeof value.tier !== "string" || !TIERS.includes(value.tier)) continue;
      out.papers[key] = {
        title: value.title,
        tier: value.tier as ListedTier,
        start: day(value.start) ?? "",
        topics: Array.isArray(value.topics) ? value.topics.filter((n): n is number => Number.isInteger(n)) : [],
        terms: strings(value.terms),
        def: Number.isInteger(value.def) ? (value.def as number) : 0,
        ticked: day(value.ticked), synced: day(value.synced), read: day(value.read),
      };
    }
  }
  if (Array.isArray(raw.scans)) {
    for (const s of raw.scans) {
      if (!isRecord(s) || typeof s.feedId !== "string" || !Array.isArray(s.topics)) continue;
      const at = day(s.at);
      if (!at) continue;
      const topics = s.topics.filter(isRecord).map((t) => ({
        returned: Number(t.returned) || 0, listed: Number(t.listed) || 0, dropped: Number(t.dropped) || 0,
      }));
      out.scans.push({ at, feedId: s.feedId, topics });
    }
    out.scans = out.scans.slice(-SCAN_CAP);
  }
  if (isRecord(raw.defs)) {
    for (const [feedId, list] of Object.entries(raw.defs)) {
      if (!Array.isArray(list)) continue;
      const records: DefRecord[] = [];
      for (const d of list) {
        if (!isRecord(d) || !Number.isInteger(d.n) || !isRecord(d.snap)) continue;
        const at = day(d.at);
        if (!at) continue;
        const groups = Array.isArray(d.snap.groups)
          ? d.snap.groups.filter(isRecord).map((g) => ({ name: typeof g.name === "string" ? g.name : "", role: g.role as ConceptGroup["role"], terms: strings(g.terms) }))
          : [];
        records.push({
          n: d.n as number, at, change: typeof d.change === "string" ? d.change : "",
          snap: { topics: strings(d.snap.topics), groups, drop: strings(d.snap.drop), lower: strings(d.snap.lower), yearsFrom: typeof d.snap.yearsFrom === "number" ? d.snap.yearsFrom : null },
        });
      }
      if (records.length > 0) out.defs[feedId] = records;
    }
  }
  if (isRecord(raw.names)) {
    for (const [id, name] of Object.entries(raw.names)) if (typeof name === "string") out.names[id] = name;
  }
  return out;
}

// ---- the feed's rules, as numbered versions ---------------------------------------------------------------------------

export function snapshotOf(feed: Pick<FeedConfig, "topics" | "groups" | "drop" | "lower" | "yearsFrom">): DefSnapshot {
  return {
    topics: [...feed.topics], groups: feed.groups.map((g) => ({ name: g.name, role: g.role, terms: [...g.terms] })),
    drop: [...feed.drop], lower: [...feed.lower], yearsFrom: feed.yearsFrom,
  };
}

function sameSnapshot(a: DefSnapshot, b: DefSnapshot): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function listChange(label: string, before: readonly string[], after: readonly string[]): string[] {
  const added = after.filter((t) => !before.includes(t));
  const removed = before.filter((t) => !after.includes(t));
  const out: string[] = [];
  if (added.length > 0) out.push(`${label} added: ${added.join(", ")}`);
  if (removed.length > 0) out.push(`${label} removed: ${removed.join(", ")}`);
  return out;
}

/** One line saying what differs between two versions of a feed's rules ("topic 2 changed; drop added: x"). */
export function describeChange(before: DefSnapshot | null, after: DefSnapshot): string {
  if (before === null) return "first scan with these rules";
  const parts: string[] = [];
  const topicCount = Math.max(before.topics.length, after.topics.length);
  const added: number[] = [];
  const changed: number[] = [];
  const removed: number[] = [];
  for (let i = 0; i < topicCount; i++) {
    if (i >= before.topics.length) added.push(i + 1);
    else if (i >= after.topics.length) removed.push(i + 1);
    else if (before.topics[i] !== after.topics[i]) changed.push(i + 1);
  }
  if (changed.length > 0) parts.push(`topic ${changed.join(", ")} changed`);
  if (added.length > 0) parts.push(`topic ${added.join(", ")} added`);
  if (removed.length > 0) parts.push(`topic ${removed.join(", ")} removed`);
  const names = new Set([...before.groups.map((g) => g.name), ...after.groups.map((g) => g.name)]);
  for (const name of names) {
    const b = before.groups.find((g) => g.name === name);
    const a = after.groups.find((g) => g.name === name);
    if (!b) parts.push(`group "${name}" added`);
    else if (!a) parts.push(`group "${name}" removed`);
    else {
      if (b.role !== a.role) parts.push(`group "${name}" now ${a.role}`);
      parts.push(...listChange(`group "${name}" terms`, b.terms, a.terms));
    }
  }
  parts.push(...listChange("drop", before.drop, after.drop), ...listChange("lower", before.lower, after.lower));
  if (before.yearsFrom !== after.yearsFrom) parts.push(`years from ${before.yearsFrom ?? "none"} to ${after.yearsFrom ?? "none"}`);
  return parts.length > 0 ? parts.join("; ") : "changed";
}

/** The number of a feed's current rules in the ledger; 0 when it has none yet. */
export function currentDef(ledger: Ledger, feedId: string): number {
  const list = ledger.defs[feedId];
  return list && list.length > 0 ? list[list.length - 1].n : 0;
}

/** Notes the rules of the feeds that were scanned: a new numbered version when they differ from the last. True if anything changed. */
export function recordDefinitions(ledger: Ledger, feeds: readonly FeedConfig[], today: string): boolean {
  let changed = false;
  for (const feed of feeds) {
    if (ledger.names[feed.id] !== feed.name) {
      ledger.names[feed.id] = feed.name;
      changed = true;
    }
    const snap = snapshotOf(feed);
    const list = ledger.defs[feed.id] ?? [];
    const last = list.length > 0 ? list[list.length - 1] : null;
    if (last && sameSnapshot(last.snap, snap)) continue;
    list.push({ n: (last?.n ?? 0) + 1, at: today, snap, change: describeChange(last?.snap ?? null, snap) });
    ledger.defs[feed.id] = list;
    changed = true;
  }
  return changed;
}

/** Adds the topics' numbers from a scan to the log. */
export function recordScan(ledger: Ledger, at: string, stats: readonly { feedId: string; topics: TopicStat[] }[]): boolean {
  if (stats.length === 0) return false;
  for (const s of stats) ledger.scans.push({ at, feedId: s.feedId, topics: s.topics.map((t) => ({ ...t })) });
  ledger.scans = ledger.scans.slice(-SCAN_CAP);
  return true;
}

// ---- filling the papers from the notes --------------------------------------------------------------------------------

/**
 * Makes an entry for every paper in the notes that has none, and stamps `today` on each outcome (ticked, sent, read) the first
 * time it is seen. An outcome is never taken back: unticking later does not change that the paper was once wanted. Returns
 * true if anything changed.
 */
export function updateFromNotes(ledger: Ledger, notes: readonly { name: string; papers: readonly ParsedPaper[] }[], today: string): boolean {
  let changed = false;
  for (const note of notes) {
    const start = noteWeekStart(note.name) ?? "";
    for (const p of note.papers) {
      if (p.feedId === "") continue;
      const key = ledgerKey(p.feedId, p.openalexId);
      let rec = ledger.papers[key];
      if (!rec) {
        rec = { title: p.title, tier: p.tier, start, topics: [...p.topics], terms: [...p.matched], def: currentDef(ledger, p.feedId) };
        ledger.papers[key] = rec;
        changed = true;
      } else {
        if (rec.topics.length === 0 && p.topics.length > 0) { rec.topics = [...p.topics]; changed = true; }
        if (rec.terms.length === 0 && p.matched.length > 0) { rec.terms = [...p.matched]; changed = true; }
        if (rec.title === "" && p.title !== "") { rec.title = p.title; changed = true; }
      }
      if (p.ticked && !rec.ticked) { rec.ticked = today; changed = true; }
      if (p.synced && !rec.synced) { rec.synced = today; changed = true; }
      if (p.read && !rec.read) { rec.read = today; changed = true; }
    }
  }
  return changed;
}

/** Removes everything about feeds that are not in `keep`. Returns how many paper entries went. */
export function forgetFeeds(ledger: Ledger, keep: ReadonlySet<string>): number {
  let removed = 0;
  for (const key of Object.keys(ledger.papers)) {
    if (!keep.has(key.slice(0, key.indexOf("/")))) {
      delete ledger.papers[key];
      removed++;
    }
  }
  ledger.scans = ledger.scans.filter((s) => keep.has(s.feedId));
  for (const id of Object.keys(ledger.defs)) if (!keep.has(id)) delete ledger.defs[id];
  for (const id of Object.keys(ledger.names)) if (!keep.has(id)) delete ledger.names[id];
  return removed;
}

// ---- what a paper turned out to be ------------------------------------------------------------------------------------

export type Verdict = "interested" | "dismissed" | "undecided";

/**
 * Interested: ticked, sent to Zotero or read. Dismissed: none of those, and its note's week ended `dismissAfterWeeks` weeks ago
 * or more. Otherwise undecided (still waiting, or too recent to say).
 */
export function verdictOf(p: LedgerPaper, today: string, dismissAfterWeeks: number): Verdict {
  if (p.ticked || p.synced || p.read) return "interested";
  if (p.start !== "" && today >= addDays(p.start, 7 + dismissAfterWeeks * 7)) return "dismissed";
  return "undecided";
}
