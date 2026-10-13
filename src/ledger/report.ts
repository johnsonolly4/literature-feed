// The "search effectiveness" report: numbers per search from the ledger, and candidate terms to boost, lower or drop.
// Pure: no Obsidian here. Rates leave out undecided papers (see `verdictOf`) so recent papers do not drag a search down.
import type { FeedConfig } from "../settings/data";
import type { ListedTier } from "../inbox/write";
import { verdictOf, type Ledger, type LedgerPaper } from "./ledger";
import { buildOverlap, overlapMarkdown, type Overlap } from "./overlap";

/** A term or title word needs at least this many decided papers before it is ranked. */
export const MIN_DECIDED = 4;
/** Below this many decided papers a search's rates are weak evidence, and the report says so. */
export const WEAK_BELOW = 20;
/** How many candidate terms are listed each way. */
export const TOP_TERMS = 5;

export interface Counts {
  listed: number;
  interested: number;
  dismissed: number;
  undecided: number;
  read: number;
  /** Papers dismissed as "no access": counted as wanted, shown apart so the access problem is visible. */
  noAccess: number;
}

export interface TermRow {
  term: string;
  decided: number;
  interested: number;
  /** interested / decided, 0 to 1. */
  rate: number;
}

export interface TopicRow {
  /** 1-based, as in the settings. */
  topic: number;
  text: string;
  counts: Counts;
  /** From the scan log: papers the topic returned, and new ones the rules removed (summed over the logged scans). */
  returned: number;
  dropped: number;
  scans: number;
}

export interface DefRow {
  n: number;
  at: string;
  change: string;
  counts: Counts;
}

export interface FeedReport {
  feedId: string;
  name: string;
  /** False for a search that is no longer in the settings. */
  known: boolean;
  totals: Counts;
  /** Share of decided papers that were interesting, or null when none is decided yet. */
  rate: number | null;
  byTier: { tier: ListedTier; counts: Counts }[];
  byTopic: TopicRow[];
  byMonth: { month: string; counts: Counts }[];
  /** Feed terms and title words doing better or worse than the search's own average. */
  termsHigh: TermRow[];
  termsLow: TermRow[];
  wordsHigh: TermRow[];
  wordsLow: TermRow[];
  versions: DefRow[];
}

export interface Report {
  today: string;
  dismissAfterWeeks: number;
  feeds: FeedReport[];
  /** Overlap between the searches and between each search's topics. */
  overlap: Overlap;
}

const TIER_ORDER: ListedTier[] = ["priority", "strong", "possible", "unchecked"];

const STOP_WORDS = new Set((
  "about above after also among and are based been between both but can could does each for from has have into its more most not "
  + "of on one only other our over than that the their then there these they this those through under use used using via was were "
  + "what when which while with within without new novel study studies paper review toward towards via"
).split(" "));

export function emptyCounts(): Counts {
  return { listed: 0, interested: 0, dismissed: 0, undecided: 0, read: 0, noAccess: 0 };
}

function add(c: Counts, verdict: ReturnType<typeof verdictOf>, p: LedgerPaper): void {
  c.listed++;
  c[verdict]++;
  if (p.read) c.read++;
  if (p.dismissReason === "no-access") c.noAccess++;
}

/** Interested share of decided papers, or null when none is decided. */
export function rateOf(c: Pick<Counts, "interested" | "dismissed">): number | null {
  const decided = c.interested + c.dismissed;
  return decided === 0 ? null : c.interested / decided;
}

/** Lower-case words of at least four letters, once each, without the common words. */
export function titleWords(title: string): string[] {
  const words = title.toLowerCase().normalize("NFKD").replace(/\p{M}/gu, "").split(/[^\p{L}]+/u)
    .filter((w) => w.length >= 4 && !STOP_WORDS.has(w));
  return [...new Set(words)];
}

function rankTerms(tally: Map<string, { decided: number; interested: number }>, average: number): { high: TermRow[]; low: TermRow[] } {
  const rows: TermRow[] = [];
  for (const [term, t] of tally) {
    if (t.decided < MIN_DECIDED) continue;
    rows.push({ term, decided: t.decided, interested: t.interested, rate: t.interested / t.decided });
  }
  const byRate = (a: TermRow, b: TermRow): number => b.rate - a.rate || b.decided - a.decided || a.term.localeCompare(b.term);
  const high = rows.filter((r) => r.rate > average).sort(byRate).slice(0, TOP_TERMS);
  const low = rows.filter((r) => r.rate < average).sort((a, b) => a.rate - b.rate || b.decided - a.decided || a.term.localeCompare(b.term)).slice(0, TOP_TERMS);
  return { high, low };
}

function tallyInto(map: Map<string, { decided: number; interested: number }>, term: string, interested: boolean): void {
  const t = map.get(term) ?? { decided: 0, interested: 0 };
  t.decided++;
  if (interested) t.interested++;
  map.set(term, t);
}

function feedReport(ledger: Ledger, feedId: string, feed: FeedConfig | undefined, today: string, weeks: number): FeedReport {
  const prefix = `${feedId}/`;
  const entries = Object.entries(ledger.papers).filter(([key]) => key.startsWith(prefix)).map(([, p]) => p);
  const totals = emptyCounts();
  const tiers = new Map<ListedTier, Counts>();
  const topics = new Map<number, Counts>();
  const months = new Map<string, Counts>();
  const versions = new Map<number, Counts>();
  const termTally = new Map<string, { decided: number; interested: number }>();
  const wordTally = new Map<string, { decided: number; interested: number }>();
  const bucket = <K>(map: Map<K, Counts>, key: K): Counts => {
    let c = map.get(key);
    if (!c) {
      c = emptyCounts();
      map.set(key, c);
    }
    return c;
  };
  for (const p of entries) {
    const verdict = verdictOf(p, today, weeks);
    add(totals, verdict, p);
    add(bucket(tiers, p.tier), verdict, p);
    for (const t of p.topics) add(bucket(topics, t), verdict, p);
    if (p.start !== "") add(bucket(months, p.start.slice(0, 7)), verdict, p);
    if (p.def > 0) add(bucket(versions, p.def), verdict, p);
    if (verdict !== "undecided") {
      const interested = verdict === "interested";
      for (const term of new Set(p.terms.map((t) => t.toLowerCase()))) tallyInto(termTally, term, interested);
      for (const word of titleWords(p.title)) tallyInto(wordTally, word, interested);
    }
  }
  const rate = rateOf(totals);
  const average = rate ?? 0;
  const terms = rankTerms(termTally, average);
  const words = rankTerms(wordTally, average);

  const scans = ledger.scans.filter((s) => s.feedId === feedId);
  const topicNumbers = new Set<number>([...topics.keys(), ...scans.flatMap((s) => s.topics.map((_, i) => i + 1))]);
  const byTopic: TopicRow[] = [...topicNumbers].sort((a, b) => a - b).map((topic) => ({
    topic,
    text: feed?.topics[topic - 1] ?? "",
    counts: topics.get(topic) ?? emptyCounts(),
    returned: scans.reduce((n, s) => n + (s.topics[topic - 1]?.returned ?? 0), 0),
    dropped: scans.reduce((n, s) => n + (s.topics[topic - 1]?.dropped ?? 0), 0),
    scans: scans.filter((s) => s.topics[topic - 1] !== undefined).length,
  }));

  const defs = ledger.defs[feedId] ?? [];
  return {
    feedId,
    name: feed?.name ?? ledger.names[feedId] ?? feedId,
    known: feed !== undefined,
    totals,
    rate,
    byTier: TIER_ORDER.filter((t) => tiers.has(t)).map((tier) => ({ tier, counts: tiers.get(tier) ?? emptyCounts() })),
    byTopic,
    byMonth: [...months.keys()].sort().map((month) => ({ month, counts: months.get(month) ?? emptyCounts() })),
    termsHigh: terms.high, termsLow: terms.low, wordsHigh: words.high, wordsLow: words.low,
    versions: defs.map((d) => ({ n: d.n, at: d.at, change: d.change, counts: versions.get(d.n) ?? emptyCounts() })),
  };
}

/** The report for every search in the settings, then any search the ledger still holds. */
export function buildReport(ledger: Ledger, feeds: readonly FeedConfig[], today: string, dismissAfterWeeks: number): Report {
  const inLedger = new Set([
    ...Object.keys(ledger.papers).map((k) => k.slice(0, k.indexOf("/"))),
    ...Object.keys(ledger.defs), ...ledger.scans.map((s) => s.feedId),
  ]);
  const known = new Map(feeds.map((f) => [f.id, f]));
  const ids = [...feeds.filter((f) => inLedger.has(f.id)).map((f) => f.id), ...[...inLedger].filter((id) => !known.has(id)).sort()];
  return {
    today, dismissAfterWeeks, feeds: ids.map((id) => feedReport(ledger, id, known.get(id), today, dismissAfterWeeks)),
    overlap: buildOverlap(ledger, feeds, today, dismissAfterWeeks),
  };
}

// ---- Markdown ---------------------------------------------------------------------------------------------------------

function pct(rate: number | null): string {
  return rate === null ? "–" : `${Math.round(rate * 100)}%`;
}

function cell(text: string): string {
  return text.replace(/\|/g, "\\|").replace(/\s+/g, " ").trim();
}

function table(head: string[], rows: string[][]): string[] {
  return [`| ${head.join(" | ")} |`, `| ${head.map(() => "---").join(" | ")} |`, ...rows.map((r) => `| ${r.map(cell).join(" | ")} |`), ""];
}

const COUNT_HEAD = ["Listed", "Wanted", "Dismissed", "Undecided", "Read", "No access", "Wanted rate"];

function countCells(c: Counts): string[] {
  return [String(c.listed), String(c.interested), String(c.dismissed), String(c.undecided), String(c.read), String(c.noAccess), pct(rateOf(c))];
}

function short(text: string, max = 70): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function termTable(label: string, rows: readonly TermRow[], average: number | null): string[] {
  if (rows.length === 0) return [];
  return table([label, "Decided", "Wanted", "Wanted rate", "vs search"], rows.map((r) => [
    r.term, String(r.decided), String(r.interested), pct(r.rate),
    average === null ? "–" : `${r.rate - average >= 0 ? "+" : ""}${Math.round((r.rate - average) * 100)} points`,
  ]));
}

/** The report as Markdown (for the report window and for copying; also the base of a later prompt for an LLM). */
export function reportMarkdown(report: Report): string {
  const out: string[] = ["# Search effectiveness", ""];
  out.push(
    `As of ${report.today}. **Wanted** = ticked, sent to Zotero or read, or dismissed as no access. **Dismissed** = marked not relevant (even after reading), or not wanted and its week ended ${report.dismissAfterWeeks} weeks ago or more. `
    + "**Undecided** = still waiting or too recent; undecided papers are left out of the rates. **No access** = wanted but not obtainable (counted as wanted).", "",
  );
  if (report.feeds.length === 0) {
    out.push("Nothing recorded yet. The ledger fills when a scan or **Update read state and archive** has run.", "");
    return out.join("\n");
  }
  for (const f of report.feeds) {
    out.push(`## ${cell(f.name)}${f.known ? "" : " (no longer in the settings)"}`, "");
    const decided = f.totals.interested + f.totals.dismissed;
    out.push(
      `${f.totals.listed} listed, ${decided} decided (${pct(f.rate)} wanted), ${f.totals.undecided} undecided.`
      + (decided < WEAK_BELOW ? ` Fewer than ${WEAK_BELOW} decided papers: treat these rates as weak evidence.` : ""), "",
    );
    out.push(...table(["Tier", ...COUNT_HEAD], f.byTier.map((t) => [t.tier, ...countCells(t.counts)])));
    if (f.byTopic.length > 0) {
      out.push("### By search topic", "");
      out.push(...table(["Topic", "Query", ...COUNT_HEAD, "Returned", "Dropped"], f.byTopic.map((t) => [
        String(t.topic), short(t.text), ...countCells(t.counts), t.scans > 0 ? String(t.returned) : "–", t.scans > 0 ? String(t.dropped) : "–",
      ])));
      out.push("Returned and dropped are summed over the scans in the log; a paper several topics return counts under each.", "");
    }
    if (f.byMonth.length > 0) {
      out.push("### By month listed", "");
      out.push(...table(["Month", ...COUNT_HEAD], f.byMonth.map((m) => [m.month, ...countCells(m.counts)])));
    }
    const suggestions = [...f.termsHigh, ...f.termsLow, ...f.wordsHigh, ...f.wordsLow];
    if (suggestions.length > 0) {
      out.push("### Candidate changes to the rules", "", `Terms with at least ${MIN_DECIDED} decided papers, against this search's average of ${pct(f.rate)}. Suggestions only: nothing is changed.`, "");
      if (f.termsHigh.length > 0) out.push("**Feed terms that do well** (candidates for a boost or priority group)", "", ...termTable("Term", f.termsHigh, f.rate));
      if (f.termsLow.length > 0) out.push("**Feed terms that do badly** (candidates for the lower list)", "", ...termTable("Term", f.termsLow, f.rate));
      if (f.wordsHigh.length > 0) out.push("**Title words that do well** (candidates to add)", "", ...termTable("Word", f.wordsHigh, f.rate));
      if (f.wordsLow.length > 0) out.push("**Title words that do badly** (candidates for the drop or lower list)", "", ...termTable("Word", f.wordsLow, f.rate));
    }
    if (f.versions.length > 0) {
      out.push("### Rule versions", "");
      out.push(...table(["Version", "From", "Change", ...COUNT_HEAD], f.versions.map((v) => [String(v.n), v.at, v.change, ...countCells(v.counts)])));
    }
  }
  out.push(...overlapMarkdown(report.overlap));
  return out.join("\n");
}
