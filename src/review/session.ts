// The state of a literature review in progress, kept in the plugin folder (`review-session.json`) so that closing the tab, clicking
// elsewhere or restarting Obsidian does not lose it. Pure: the plugin reads and writes the file; flags and the network are worked
// out again when a session is restored. The review note is the permanent copy; this file is replaced by the next review.
import { CAP_PER_TOPIC, MAX_CAP_PER_TOPIC, PAGE_SIZE } from "./budget";
import type { ReviewOptions, ReviewOrder, ReviewPaper, ReviewResult } from "./collect";
import type { SeedProfile } from "./seeds";
import type { NetworkExtras } from "./network-fetch";
import { normaliseRecord, normaliseRun, type FeedSnapshot, type ReviewRecord, type RunInfo } from "./record";

export interface ReviewSession {
  version: 1;
  /** Milliseconds since 1970 when it was last saved. */
  savedAt: number;
  /** Ids of the searches that were ticked. */
  selected: string[];
  fromYear: string;
  maxPapers: number;
  /** Works fetched per topic. */
  capPerTopic: number;
  minTier: ReviewOptions["minTier"];
  /** How papers of one rank are ordered (absent in older sessions). */
  order?: ReviewOrder;
  /** The papers the user already knows (the text they pasted, and what was read from it). */
  seedText?: string;
  seeds?: SeedProfile;
  abstracts: boolean;
  result: ReviewResult;
  extras: NetworkExtras | null;
  answerText: string;
  /** What was fixed when the search started (for the record), or null for a session saved before it existed. */
  run: RunInfo | null;
  /** The LLM the user said they used. */
  llm: string;
  /** Path of the note that holds the exact prompt, if one was saved. */
  promptNote: string | null;
  /** The earlier review this one repeats, to compare with. */
  baseline: ReviewRecord | null;
  /** The search definitions in use when they are not the current settings (a repeat "as recorded"), else null. */
  snapshot: FeedSnapshot[] | null;
}

const TIERS: readonly string[] = ["priority", "strong", "possible", "unchecked"];
const MIN_TIERS: readonly string[] = ["priority", "strong", "possible"];

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

const isStrings = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === "string");

function validPaper(p: unknown): p is ReviewPaper {
  if (!isRecord(p)) return false;
  return typeof p.id === "string" && typeof p.title === "string" && isStrings(p.authors) && isStrings(p.referencedWorks) && typeof p.citedByCount === "number"
    && typeof p.tier === "string" && TIERS.includes(p.tier) && Array.isArray(p.finds) && typeof p.isPreprint === "boolean";
}

function validExtras(raw: unknown): NetworkExtras | null {
  if (!isRecord(raw) || !Array.isArray(raw.missing) || !Array.isArray(raw.alsoCite)) return null;
  const okPaper = (x: unknown): boolean => isRecord(x) && isRecord(x.paper) && typeof x.paper.title === "string" && typeof x.paper.openalexId === "string" && typeof x.count === "number";
  const missing = raw.missing.filter((x) => okPaper(x) && isStrings((x as { citers?: unknown }).citers));
  const alsoCite = raw.alsoCite.filter((x) => okPaper(x) && isStrings((x as { cites?: unknown }).cites));
  return { missing: missing as NetworkExtras["missing"], alsoCite: alsoCite as NetworkExtras["alsoCite"], stopped: typeof raw.stopped === "string" ? raw.stopped : null };
}

/** The session from whatever the file held; null when it holds no usable review. Damaged papers are left out; nothing throws. */
export function normaliseSession(raw: unknown): ReviewSession | null {
  if (!isRecord(raw) || raw.version !== 1 || !isRecord(raw.result) || !Array.isArray(raw.result.papers)) return null;
  const r = raw.result;
  const papers = (r.papers as unknown[]).filter(validPaper);
  if (papers.length === 0) return null;
  const topics = Array.isArray(r.topics) ? r.topics.filter((t): t is ReviewResult["topics"][number] => isRecord(t) && typeof t.topic === "string" && typeof t.feedId === "string" && typeof t.count === "number") : [];
  const num = (v: unknown, fallback: number): number => (typeof v === "number" && Number.isFinite(v) ? v : fallback);
  return {
    version: 1,
    savedAt: num(raw.savedAt, 0),
    selected: isStrings(raw.selected) ? raw.selected : [],
    fromYear: typeof raw.fromYear === "string" ? raw.fromYear : "",
    maxPapers: Math.max(1, Math.floor(num(raw.maxPapers, 60))),
    capPerTopic: Math.min(MAX_CAP_PER_TOPIC, Math.max(PAGE_SIZE, Math.floor(num(raw.capPerTopic, CAP_PER_TOPIC)))),
    minTier: typeof raw.minTier === "string" && MIN_TIERS.includes(raw.minTier) ? (raw.minTier as ReviewOptions["minTier"]) : "possible",
    ...(isRecord(raw.seeds) ? { seeds: raw.seeds as unknown as SeedProfile } : {}),
    ...(typeof raw.seedText === "string" ? { seedText: raw.seedText } : {}),
    ...(raw.order === "seeds" || raw.order === "fit" || raw.order === "newest" || raw.order === "cited" ? { order: raw.order } : {}),
    abstracts: raw.abstracts !== false,
    result: { papers, total: num(r.total, papers.length), topics, spentUsd: Math.max(0, num(r.spentUsd, 0)), stopped: typeof r.stopped === "string" ? r.stopped : null },
    extras: validExtras(raw.extras),
    answerText: typeof raw.answerText === "string" ? raw.answerText : "",
    run: normaliseRun(raw.run),
    llm: typeof raw.llm === "string" ? raw.llm : "",
    promptNote: typeof raw.promptNote === "string" ? raw.promptNote : null,
    baseline: normaliseRecord(raw.baseline),
    snapshot: Array.isArray(raw.snapshot) && raw.snapshot.length > 0 ? (normaliseRun({ ranAt: "", fromDate: "", capPerTopic: 0, maxPapers: 0, feeds: raw.snapshot })?.feeds ?? null) : null,
  };
}

/** One line for the "Resume" prompt: the searches, the day, the papers and the cost. */
export function describeSession(s: ReviewSession, names: ReadonlyMap<string, string>): string {
  const searches = s.selected.map((id) => names.get(id)).filter((n): n is string => n !== undefined);
  const day = s.savedAt > 0 ? new Date(s.savedAt).toISOString().slice(0, 10) : "date unknown";
  const cost = s.result.spentUsd < 0.01 && s.result.spentUsd !== 0 ? s.result.spentUsd.toFixed(4) : s.result.spentUsd.toFixed(3);
  return `${searches.length > 0 ? searches.join(", ") : "Earlier review"}, ${day}, ${s.result.papers.length} papers, $${cost}`;
}
