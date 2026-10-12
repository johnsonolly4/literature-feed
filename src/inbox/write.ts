// The weekly reading-inbox note: scored papers in, note text out, and the way back (ticks, ids). Pure: no Obsidian.
//
// Shape of a paper line (inside a callout, so every line starts with "> "):
//   > - [ ] ⭐ **Title** — A. Author, B. Writer et al. · *Venue* · 2026 · [DOI](https://doi.org/…) · Priority · lipoic acid %%oa:W123:p%%
// The hidden marker %%oa:<id>:<tier>%% is how a rescan and the Zotero sync find a paper again without reading its title.
import { scorePaper } from "../match/score";
import type { Candidate } from "../openalex/client";
import type { FeedConfig } from "../settings/data";

export type ListedTier = "priority" | "strong" | "possible" | "unchecked";

const RANK: ListedTier[] = ["priority", "strong", "possible", "unchecked"];
const TIER_CODE: Record<ListedTier, string> = { priority: "p", strong: "s", possible: "o", unchecked: "u" };
const TIER_LABEL: Record<ListedTier, string> = { priority: "Priority", strong: "Strong", possible: "Possible", unchecked: "No abstract" };

export interface InboxPaper {
  /** The short OpenAlex id, e.g. "W123". */
  openalexId: string;
  title: string;
  authors: string[];
  venue: string | null;
  year: number | null;
  publicationDate: string | null;
  doi: string | null;
  isPreprint: boolean;
  /** The record came without an abstract, so the paper was judged on its title alone. */
  noAbstract: boolean;
  tier: ListedTier;
  /** The terms of the feed that matched, for the line. */
  matched: string[];
}

export interface FeedSection {
  feedId: string;
  feedName: string;
  papers: InboxPaper[];
}

export interface NoteInput {
  /** `2026-W42`. */
  week: string;
  /** `YYYY-MM-DD` of the scan. */
  scanned: string;
  sections: FeedSection[];
}

// ---- week and file name -------------------------------------------------------------------------------------------

/** ISO 8601 week of a (local) calendar day. */
export function isoWeek(date: Date): { year: number; week: number } {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = Date.UTC(d.getUTCFullYear(), 0, 1);
  return { year: d.getUTCFullYear(), week: Math.ceil(((d.getTime() - yearStart) / 86_400_000 + 1) / 7) };
}

export function weekLabel(date: Date): string {
  const { year, week } = isoWeek(date);
  return `${year}-W${String(week).padStart(2, "0")}`;
}

export function noteName(date: Date): string {
  return `${weekLabel(date)} Reading inbox`;
}

/** Matches the file names this plugin writes; used to find the latest note. */
export const NOTE_NAME_PATTERN = /^\d{4}-W\d{2} Reading inbox\.md$/;

// ---- untrusted text -----------------------------------------------------------------------------------------------

// Control, zero-width and bidirectional-override characters: invisible, and useful for spoofing a title.
const INVISIBLE = /[\p{Cc}\p{Cf}]/gu;
const HAS_INVISIBLE = new RegExp(INVISIBLE.source, "u"); // no g flag: a global regex keeps state between .test() calls

/**
 * Titles, authors and venues come from OpenAlex and are untrusted. Result: one line, no markdown, no tag, no math, no
 * link, no way to write the hidden markers. Backslash-escapes are rendered as the plain character.
 */
export function escapeMd(text: string): string {
  return text
    .replace(INVISIBLE, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/%(?=%)/g, "% ")
    .replace(/[\\`*_[\]<>#|~=$]/g, "\\$&");
}

/** `https://doi.org/…` for a well-formed DOI (also accepts a doi.org URL or "doi:" prefix), else null. */
export function doiUrl(doi: string | null | undefined): string | null {
  if (!doi) return null;
  const bare = doi.trim().replace(/^(?:https?:\/\/(?:dx\.)?doi\.org\/|doi:\s*)/i, "");
  if (!/^10\.\d{4,9}\/\S+$/.test(bare) || HAS_INVISIBLE.test(bare)) return null;
  return `https://doi.org/${encodeURI(bare).replace(/\(/g, "%28").replace(/\)/g, "%29")}`;
}

export function shortOpenAlexId(id: string): string | null {
  const m = /^https:\/\/openalex\.org\/(W\d+)$/.exec(id.trim());
  return m ? m[1] : null;
}

function formatAuthors(authors: string[]): string {
  const names = authors.map(escapeMd).filter((n) => n !== "");
  if (names.length === 0) return "";
  return names.length > 3 ? `${names.slice(0, 3).join(", ")} et al.` : names.join(", ");
}

// ---- scoring into papers -----------------------------------------------------------------------------------------------

export interface BuiltPapers {
  papers: InboxPaper[];
  /** Papers the feed's rules removed (Dropped), or that have no usable id. */
  dropped: number;
}

/** Scores candidates with the feed's rules; Dropped papers are not listed. Best first, then newest. */
export function buildPapers(feed: FeedConfig, candidates: readonly Candidate[]): BuiltPapers {
  const papers: InboxPaper[] = [];
  let dropped = 0;
  for (const c of candidates) {
    const score = scorePaper(c, feed);
    const id = shortOpenAlexId(c.openalexId);
    if (score.tier === "dropped" || id === null) {
      dropped++;
      continue;
    }
    papers.push({
      openalexId: id,
      title: c.title,
      authors: c.authors,
      venue: c.venue,
      year: c.year ?? null,
      publicationDate: c.publicationDate,
      doi: c.doi ?? null,
      isPreprint: c.isPreprint === true,
      noAbstract: !c.abstract?.trim(),
      tier: score.tier,
      matched: [...new Set(score.groups.flatMap((g) => g.terms))],
    });
  }
  papers.sort((a, b) =>
    RANK.indexOf(a.tier) - RANK.indexOf(b.tier)
    || (b.publicationDate ?? "").localeCompare(a.publicationDate ?? "")
    || a.title.localeCompare(b.title));
  return { papers, dropped };
}

// ---- rendering --------------------------------------------------------------------------------------------------------

function paperLine(p: InboxPaper): string {
  const bits: string[] = [];
  const authors = formatAuthors(p.authors);
  const venue = p.venue ? escapeMd(p.venue) : "";
  const link = doiUrl(p.doi);
  if (venue) bits.push(`*${venue}*`);
  if (p.year !== null) bits.push(String(p.year));
  if (link) bits.push(`[DOI](${link})`);
  bits.push(TIER_LABEL[p.tier]);
  if (p.isPreprint) bits.push("preprint");
  if (p.noAbstract && p.tier !== "unchecked") bits.push("title only");
  const terms = p.matched.slice(0, 6).map(escapeMd).join(", ");
  if (terms) bits.push(terms + (p.matched.length > 6 ? ", …" : ""));
  const star = p.tier === "priority" ? "⭐ " : "";
  const title = escapeMd(p.title) || "(no title)";
  return `> - [ ] ${star}**${title}**${authors ? ` — ${authors}` : ""} · ${bits.join(" · ")} %%oa:${p.openalexId}:${TIER_CODE[p.tier]}%%`;
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

function rankedHeader(name: string, feedId: string, papers: readonly { tier: string }[]): string {
  const top = papers.filter((p) => p.tier === "priority").length;
  const open = papers.some((p) => p.tier === "priority" || p.tier === "strong");
  const count = `${plural(papers.length, "paper")}${top > 0 ? ` · ${top} priority` : ""}`;
  return `> [!literature-feed]${open ? "+" : "-"} ${escapeMd(name)} · ${count} %%feed:${feedId}%%`;
}

function uncheckedHeader(feedId: string, count: number): string {
  return `> [!literature-feed-unchecked]- No abstract returned, matched by OpenAlex · ${count} %%feed:${feedId}:unchecked%%`;
}

function sectionBlocks(section: FeedSection): string[][] {
  const ranked = section.papers.filter((p) => p.tier !== "unchecked");
  const unchecked = section.papers.filter((p) => p.tier === "unchecked");
  const blocks: string[][] = [];
  if (ranked.length > 0) blocks.push([rankedHeader(section.feedName, section.feedId, ranked), ...ranked.map(paperLine)]);
  if (unchecked.length > 0) blocks.push([uncheckedHeader(section.feedId, unchecked.length), ...unchecked.map(paperLine)]);
  return blocks;
}

function frontmatter(week: string, scanned: string): string[] {
  return ["---", "kind: reading-inbox", "cssclasses:", "  - literature-feed", `week: ${week}`, `scanned: ${scanned}`, "---"];
}

/** A new note. The line under the properties is empty (Lab Kit's rule), then the status block, then one callout per feed. */
export function renderNote(input: NoteInput): string {
  const lines = [...frontmatter(input.week, input.scanned), "", "```literature-feed", "```", ""];
  for (const section of input.sections) {
    for (const block of sectionBlocks(section)) lines.push(...block, "");
  }
  return lines.join("\n");
}

// ---- reading a note back ----------------------------------------------------------------------------------------------

export interface ParsedPaper {
  openalexId: string;
  feedId: string;
  tier: ListedTier;
  ticked: boolean;
}

export interface ParsedNote {
  scanned: string;
  papers: ParsedPaper[];
}

const HEADER = /^>\s*\[!literature-feed(?:-unchecked)?\][+-]?\s.*%%feed:([a-z0-9-]+)(?::unchecked)?%%\s*$/;
const PAPER = /^>\s*-\s\[( |x|X)\]\s.*%%oa:(W\d+):([psou])%%\s*$/;
const CODE_TO_TIER = Object.fromEntries(Object.entries(TIER_CODE).map(([tier, code]) => [code, tier])) as Record<string, ListedTier>;

/** The papers of a note with their tick state and feed, and the scan date. Lines that do not look like ours are ignored. */
export function parseInbox(text: string): ParsedNote {
  const papers: ParsedPaper[] = [];
  let feedId = "";
  let scanned = "";
  let inFront = false;
  const lines = text.split("\n");
  lines.forEach((line, i) => {
    if (i === 0 && line.trim() === "---") inFront = true;
    else if (inFront && line.trim() === "---") inFront = false;
    else if (inFront) {
      const m = /^scanned:\s*(\d{4}-\d{2}-\d{2})\s*$/.exec(line);
      if (m) scanned = m[1];
    }
    const header = HEADER.exec(line);
    if (header) {
      feedId = header[1];
      return;
    }
    const paper = PAPER.exec(line);
    if (paper) papers.push({ openalexId: paper[2], feedId, tier: CODE_TO_TIER[paper[3]], ticked: paper[1] !== " " });
  });
  return { scanned, papers };
}

/**
 * Papers still waiting per tier. A paper found by two feeds is on two lines but counts once, at its best tier, and
 * waits as long as one of its lines is unticked.
 */
export function waitingByTier(papers: readonly ParsedPaper[]): Record<ListedTier, number> {
  const best = new Map<string, ListedTier>();
  for (const p of papers) {
    if (p.ticked) continue;
    const current = best.get(p.openalexId);
    if (current === undefined || RANK.indexOf(p.tier) < RANK.indexOf(current)) best.set(p.openalexId, p.tier);
  }
  const counts: Record<ListedTier, number> = { priority: 0, strong: 0, possible: 0, unchecked: 0 };
  for (const tier of best.values()) counts[tier]++;
  return counts;
}

/** Papers still waiting in each feed's own lists, per tier (a paper found by two feeds is counted in both). */
export function waitingByFeed(papers: readonly ParsedPaper[]): Record<string, Record<ListedTier, number>> {
  const out: Record<string, Record<ListedTier, number>> = {};
  for (const p of papers) {
    if (p.ticked) continue;
    const row = (out[p.feedId] ??= { priority: 0, strong: 0, possible: 0, unchecked: 0 });
    row[p.tier]++;
  }
  return out;
}

// ---- adding to an existing note -----------------------------------------------------------------------------------------

/** Indexes [start, end) of the callout whose header carries `marker` (the "> " lines that follow the header). */
function findBlock(lines: string[], marker: string): [number, number] | null {
  const start = lines.findIndex((l) => HEADER.test(l) && l.includes(marker));
  if (start === -1) return null;
  let end = start + 1;
  while (end < lines.length && lines[end].startsWith(">") && !HEADER.test(lines[end])) end++;
  return [start, end];
}

function tiersOf(lines: string[]): string[] {
  return lines.map((l) => PAPER.exec(l)?.[3]).filter((c): c is string => c !== undefined).map((c) => CODE_TO_TIER[c]);
}

/**
 * Adds papers that are not in the note yet and leaves every existing line as it is, so ticks survive. New Priority
 * papers go to the top of their callout, the rest to the end; a feed without a callout gets one at the end of the note.
 * Callout headers of changed feeds get their counts again, and `scanned` is updated.
 */
export function mergeIntoNote(existing: string, input: NoteInput): string {
  let lines = existing.split("\n");
  const present = new Set(parseInbox(existing).papers.map((p) => `${p.feedId}|${p.openalexId}`));

  for (const section of input.sections) {
    const fresh = section.papers.filter((p) => !present.has(`${section.feedId}|${p.openalexId}`));
    for (const p of fresh) present.add(`${section.feedId}|${p.openalexId}`);
    const groups: [boolean, InboxPaper[]][] = [
      [false, fresh.filter((p) => p.tier !== "unchecked")],
      [true, fresh.filter((p) => p.tier === "unchecked")],
    ];
    for (const [unchecked, papers] of groups) {
      if (papers.length === 0) continue;
      const marker = unchecked ? `%%feed:${section.feedId}:unchecked%%` : `%%feed:${section.feedId}%%`;
      const block = findBlock(lines, marker);
      if (!block) {
        const [made] = sectionBlocks({ ...section, papers });
        while (lines.length > 0 && lines[lines.length - 1].trim() === "") lines.pop();
        lines = [...lines, "", ...made, ""];
        continue;
      }
      const [start, end] = block;
      const top = papers.filter((p) => p.tier === "priority").map(paperLine);
      const rest = papers.filter((p) => p.tier !== "priority").map(paperLine);
      const body = [...top, ...lines.slice(start + 1, end), ...rest];
      const header = unchecked
        ? uncheckedHeader(section.feedId, tiersOf(body).length)
        : rankedHeader(section.feedName, section.feedId, tiersOf(body).map((tier) => ({ tier })));
      lines = [...lines.slice(0, start), header, ...body, ...lines.slice(end)];
    }
  }

  return lines.map((l, i) => (i < 12 && /^scanned:\s/.test(l) ? `scanned: ${input.scanned}` : l)).join("\n");
}

/** A new note when there is none, otherwise the existing one with the new papers added. */
export function buildNote(existing: string | null, input: NoteInput): string {
  return existing === null ? renderNote(input) : mergeIntoNote(existing, input);
}
