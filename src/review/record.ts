// The record of a literature review: exactly what was searched, how it was filtered and ranked, what the LLM was given and
// answered, and which paper was P1, P2 … so that the review can be repeated and compared later. Pure. It goes into the review note
// twice: as a readable section ("How this review was made") and as a code block the plugin reads back to repeat the review.
import type { ListedTier } from "../inbox/write";
import type { ConceptGroup } from "../match/feed";
import { PAGE_SIZE } from "./budget";
import { buildSearchUrl } from "../openalex/client";
import type { FeedConfig } from "../settings/data";
import { REVIEW_SORT, type ReviewOptions, type ReviewPaper, type ReviewResult } from "./collect";
import { paperLabel } from "./prompt";

export const RECORD_BLOCK = "literature-feed-record";

/** A search as it was when the review ran, so editing it later does not change what the record says was run. */
export interface FeedSnapshot {
  id: string;
  name: string;
  topics: string[];
  yearsFrom: number | null;
  groups: ConceptGroup[];
  drop: string[];
  lower: string[];
}

/** What is fixed when the search starts. */
export interface RunInfo {
  /** ISO time. */
  ranAt: string;
  fromDate: string;
  capPerTopic: number;
  minTier: ReviewOptions["minTier"];
  maxPapers: number;
  abstracts: boolean;
  feeds: FeedSnapshot[];
}

export interface RecordTopic {
  feedId: string;
  topic: string;
  /** The first request of the topic, without any key. */
  url: string;
  count: number;
  fetched: number;
  fromCache: boolean;
}

export interface RecordPaper {
  label: string;
  id: string;
  doi: string | null;
  title: string;
  year: number | null;
  tier: ListedTier;
  matched: string[];
  finds: { feedId: string; topics: number[] }[];
  citedBy: number;
}

export interface RecordLink {
  label: string;
  id: string;
  count: number;
}

export interface RecordLlm {
  /** What the user said they used ("" = not said). */
  name: string;
  promptChars: number;
  /** SHA-256 of the prompt text, in hex. */
  promptHash: string;
  /** Path of the note that holds the exact prompt, or null. */
  promptNote: string | null;
  /** The answer exactly as pasted. */
  answer: string;
}

export interface ReviewRecord {
  version: 1;
  ranAt: string;
  fromDate: string;
  sort: string;
  capPerTopic: number;
  pageSize: number;
  minTier: ReviewOptions["minTier"];
  maxPapers: number;
  abstracts: boolean;
  feeds: FeedSnapshot[];
  topics: RecordTopic[];
  papers: RecordPaper[];
  total: number;
  spentUsd: number;
  stopped: string | null;
  /** Papers with a reference list in OpenAlex, of those kept. */
  coverage: { withList: number; total: number };
  missing: RecordLink[];
  citing: RecordLink[];
  llm: RecordLlm | null;
}

export function snapshotFeed(f: FeedConfig): FeedSnapshot {
  return JSON.parse(JSON.stringify({ id: f.id, name: f.name, topics: f.topics, yearsFrom: f.yearsFrom, groups: f.groups, drop: f.drop, lower: f.lower })) as FeedSnapshot;
}

/** A search from its snapshot, to run again. It is not saved anywhere, so the Zotero fields are empty. */
export function feedFromSnapshot(s: FeedSnapshot): FeedConfig {
  return { ...JSON.parse(JSON.stringify(s)) as FeedSnapshot, enabled: true, zoteroCollection: "", project: "" };
}

export function runInfo(now: Date, feeds: readonly FeedConfig[], opts: ReviewOptions, abstracts: boolean): RunInfo {
  return { ranAt: now.toISOString(), fromDate: opts.fromDate, capPerTopic: opts.capPerTopic, minTier: opts.minTier, maxPapers: opts.maxPapers, abstracts, feeds: feeds.map(snapshotFeed) };
}

export interface RecordInput {
  run: RunInfo;
  result: ReviewResult;
  missing: readonly RecordLink[];
  citing: readonly RecordLink[];
  coverage: { withList: number; total: number };
  llm: RecordLlm | null;
}

export function buildRecord(input: RecordInput): ReviewRecord {
  const { run, result } = input;
  const paper = (p: ReviewPaper, i: number): RecordPaper => ({
    label: paperLabel(i), id: p.id, doi: p.doi, title: p.title, year: p.year, tier: p.tier,
    matched: [...new Set(p.finds.flatMap((f) => f.matched))], finds: p.finds.map((f) => ({ feedId: f.feedId, topics: f.topics })), citedBy: p.citedByCount,
  });
  return {
    version: 1, ranAt: run.ranAt, fromDate: run.fromDate, sort: REVIEW_SORT, capPerTopic: run.capPerTopic, pageSize: PAGE_SIZE, minTier: run.minTier,
    maxPapers: run.maxPapers, abstracts: run.abstracts, feeds: run.feeds,
    topics: result.topics.map((t) => ({
      feedId: t.feedId, topic: t.topic, count: t.count, fetched: t.fetched, fromCache: t.fromCache,
      url: buildSearchUrl(t.topic, { fromDate: run.fromDate, page: 1, perPage: PAGE_SIZE, extra: true, sort: REVIEW_SORT }),
    })),
    papers: result.papers.map(paper), total: result.total, spentUsd: result.spentUsd, stopped: result.stopped,
    coverage: input.coverage, missing: [...input.missing], citing: [...input.citing], llm: input.llm,
  };
}

/** The run information from already-parsed JSON; null when it is not usable. */
export function normaliseRun(raw: unknown): RunInfo | null {
  if (!isObj(raw) || typeof raw.ranAt !== "string" || typeof raw.fromDate !== "string" || !Array.isArray(raw.feeds)) return null;
  const feedsOk = raw.feeds.every((f) => isObj(f) && typeof f.id === "string" && typeof f.name === "string" && isStrings(f.topics) && Array.isArray(f.groups) && isStrings(f.drop) && isStrings(f.lower));
  return feedsOk && typeof raw.capPerTopic === "number" && typeof raw.maxPapers === "number" ? (raw as unknown as RunInfo) : null;
}

/** The record as a code block for a note. */
export function recordBlock(record: ReviewRecord): string[] {
  return ["```" + RECORD_BLOCK, JSON.stringify(record), "```"];
}

const isStrings = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === "string");
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** A record from the text of a code block; null when it is not one (or too damaged to repeat the review from). */
export function parseRecord(source: string): ReviewRecord | null {
  try {
    return normaliseRecord(JSON.parse(source));
  } catch {
    return null;
  }
}

/** A record from already-parsed JSON; null when it is not one. */
export function normaliseRecord(raw: unknown): ReviewRecord | null {
  if (!isObj(raw) || raw.version !== 1 || typeof raw.fromDate !== "string" || !Array.isArray(raw.feeds) || !Array.isArray(raw.topics) || !Array.isArray(raw.papers)) return null;
  const feedsOk = raw.feeds.every((f) => isObj(f) && typeof f.id === "string" && typeof f.name === "string" && isStrings(f.topics) && Array.isArray(f.groups) && isStrings(f.drop) && isStrings(f.lower));
  const papersOk = raw.papers.every((p) => isObj(p) && typeof p.id === "string" && typeof p.title === "string" && typeof p.tier === "string");
  return feedsOk && papersOk && raw.feeds.length > 0 ? (raw as unknown as ReviewRecord) : null;
}

/** The first record block in a note's text, or null. */
export function recordFromNote(text: string): ReviewRecord | null {
  const m = new RegExp("```" + RECORD_BLOCK + "\\s*\\r?\\n([\\s\\S]*?)\\r?\\n```").exec(text);
  return m ? parseRecord(m[1]) : null;
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const code = (text: string): string => `\`${text.replace(/`/g, "'")}\``;

/** The record as a readable section, enough for a person to repeat the searches by hand. */
export function renderRecordSection(r: ReviewRecord): string[] {
  const out: string[] = [
    "## How this review was made", "",
    `- **Run:** ${r.ranAt}. Source: OpenAlex, works whose title or abstract match each topic (\`search.title_and_abstract\`), published on or after ${r.fromDate}, sorted by relevance, at most ${r.capPerTopic} works per topic (${r.pageSize} per request).`,
    `- **Kept:** papers ranked ${r.minTier} or better by the search rules (see below), sorted by rank, then citations, then year; ${r.papers.length} of ${r.total} go into the review.`,
    `- **Cost:** about $${r.spentUsd.toFixed(3)}.${r.stopped ? ` The search ${r.stopped}.` : ""} OpenAlex lists references for ${r.coverage.withList} of ${r.coverage.total} papers.`,
  ];
  if (r.llm) {
    out.push(`- **LLM:** ${r.llm.name === "" ? "not named" : r.llm.name}. Prompt of ${r.llm.promptChars} characters (${r.papers.length} papers, abstracts ${r.abstracts ? "included" : "left out"}), SHA-256 \`${r.llm.promptHash}\`${r.llm.promptNote ? `, saved as [[${r.llm.promptNote.replace(/\.md$/i, "")}]]` : ""}. The answer as pasted is in the record below.`);
  } else {
    out.push("- **LLM:** no answer was added when this note was made.");
  }
  for (const f of r.feeds) {
    out.push("", `### Search: ${f.name}`, "");
    out.push(`Topics (one OpenAlex search each):`);
    f.topics.forEach((t, i) => {
      const run = r.topics.find((x) => x.feedId === f.id && x.topic === t);
      out.push(`${i + 1}. ${code(t)}${run ? ` — ${run.count} matches, ${run.fetched} fetched${run.fromCache ? " (from saved results)" : ""}` : ""}`);
    });
    out.push("", "Ranking rules, applied to each paper's title and abstract:");
    for (const g of f.groups) out.push(`- ${g.name} (${g.role}): ${g.terms.map(code).join(", ")}`);
    if (f.drop.length > 0) out.push(`- Drop the paper if it matches: ${f.drop.map(code).join(", ")}`);
    if (f.lower.length > 0) out.push(`- Move it down one rank if it matches: ${f.lower.map(code).join(", ")}`);
  }
  out.push("", "The first request of each topic, to repeat a search by hand (add your key and `page=2` … for more):", "");
  for (const t of r.topics) out.push(`- ${code(t.url)}`);
  out.push("", ...recordBlock(r));
  return out;
}

/** What changed between a recorded review and a new run of the same searches. */
export interface Changes {
  added: { id: string; title: string }[];
  removed: { id: string; title: string }[];
  tierChanged: { title: string; from: ListedTier; to: ListedTier }[];
}

export function diffPapers(before: readonly { id: string; title: string; tier: ListedTier }[], after: readonly ReviewPaper[]): Changes {
  const was = new Map(before.map((p) => [p.id, p]));
  const now = new Map(after.map((p) => [p.id, p]));
  return {
    added: after.filter((p) => !was.has(p.id)).map((p) => ({ id: p.id, title: p.title })),
    removed: before.filter((p) => !now.has(p.id)).map((p) => ({ id: p.id, title: p.title })),
    tierChanged: after.flatMap((p) => { const old = was.get(p.id); return old && old.tier !== p.tier ? [{ title: p.title, from: old.tier, to: p.tier }] : []; }),
  };
}
