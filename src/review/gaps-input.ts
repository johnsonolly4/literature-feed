// What the citation-gaps tool is asked about, and what that costs: a DOI or OpenAlex id, a Zotero item, or a pasted list of
// references. Pure: parsing text, searching the local Zotero index, and the arithmetic of the estimate.
import { titleKey } from "../zotero/client";
import type { ZoteroIndex } from "../zotero/library-index";
import { bareDoi } from "../zotero/map";
import { COST_FILTER, COST_SEARCH } from "./budget";
import { MAX_DEEPER, MAX_GAPS, MAX_GAP_REFERENCES, MAX_HUBS } from "./network-fetch";

/** At most this many references without a DOI are searched for (each search costs ten credits). */
export const MAX_TITLE_SEARCHES = 25;

export type GapInput =
  | { kind: "work"; doi: string | null; id: string | null }
  | { kind: "title"; title: string }
  | { kind: "references"; dois: string[]; lines: string[] };

const DOI_PATTERN = "10\\.\\d{4,9}/[^\\s\"<>]+";

/** A DOI as found in text: the trailing punctuation of a sentence or a reference is not part of it. */
function cleanDoi(raw: string): string {
  return bareDoi(raw.replace(/[.,;:)\]}>'"]+$/, ""));
}

/** One paper from what the user typed: a DOI (bare or as a link) or an OpenAlex id (bare or as a link). Null when there is none. */
export function parseWorkInput(text: string): { doi: string | null; id: string | null } | null {
  const id = /\bW\d{4,}\b/.exec(text)?.[0] ?? null;
  const doiMatch = new RegExp(DOI_PATTERN, "i").exec(text);
  const doi = doiMatch ? cleanDoi(doiMatch[0]) : null;
  if (id === null && doi === null) return null;
  return { doi, id: /openalex\.org\//i.test(text) || doi === null ? id : null };
}

const NUMBERING = /^\s*(?:\[\d+\]|\(\d+\)|\d+[.)])\s*/;

/** One reference as a line of text: the list number is dropped and white space tidied. */
export function cleanReferenceLine(line: string): string {
  return line.replace(NUMBERING, "").replace(/\s+/g, " ").trim();
}

/** DOIs and reference lines from pasted text, one reference to a line. A line with a DOI is looked up by the DOI, the others by search. */
export function parseReferenceList(text: string): { dois: string[]; lines: string[] } {
  const dois: string[] = [];
  const lines: string[] = [];
  const seen = new Set<string>();
  for (const raw of text.split(/\r?\n/)) {
    const trimmed = raw.trim();
    if (trimmed === "") continue;
    const found = trimmed.match(new RegExp(DOI_PATTERN, "gi"));
    if (found) {
      for (const f of found) {
        const doi = cleanDoi(f);
        if (!dois.includes(doi)) dois.push(doi);
      }
      continue;
    }
    const line = cleanReferenceLine(trimmed);
    const key = titleKey(line);
    if (line.length >= 20 && !seen.has(key)) {
      seen.add(key);
      lines.push(line);
    }
  }
  return { dois, lines };
}

const words = (text: string): string[] => text.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w !== "");

/** The share of a work's title words that occur in a reference line (0 for a title of fewer than three words). */
export function titleOverlap(title: string, reference: string): number {
  const t = words(title);
  if (t.length < 3) return 0;
  const inLine = new Set(words(reference));
  return t.filter((w) => inLine.has(w)).length / t.length;
}

/** Whether a work's title is the title inside a reference line: at least three words, and nearly all of them occur in the line. */
export function titleInReference(title: string, reference: string): boolean {
  return titleOverlap(title, reference) >= 0.85;
}

export interface ZoteroHit {
  key: string;
  title: string;
  doi: string;
}

/** Items of the local Zotero index whose title has every word of the query (or whose DOI is the query), at most `limit`. */
export function searchZoteroIndex(index: ZoteroIndex, query: string, limit = 15): ZoteroHit[] {
  const q = query.trim().toLowerCase();
  if (q === "") return [];
  const asDoi = parseWorkInput(q)?.doi ?? null;
  const words = q.split(/\s+/).filter((w) => w !== "");
  const hits: ZoteroHit[] = [];
  for (const [key, item] of Object.entries(index.items)) {
    const title = item.title.toLowerCase();
    if ((asDoi !== null && item.doi === asDoi) || (words.length > 0 && words.every((w) => title.includes(w)))) hits.push({ key, title: item.title, doi: item.doi });
  }
  return hits.sort((a, b) => a.title.localeCompare(b.title)).slice(0, limit);
}

export interface GapEstimate {
  /** Single records (free). */
  free: number;
  /** Lookups by id or DOI (one credit each). */
  filtered: number;
  /** Title searches (ten credits each). */
  searches: number;
  usd: number;
  /** References without a DOI that will not be searched, because of the cap. */
  skippedLines: number;
}

function round(usd: number): number {
  return Math.round(usd * 1e6) / 1e6;
}

/**
 * What a gaps run costs at most. A work's own references are read in lists of 50 (at most 100), then the details of the gaps (up to 100) in
 * lists of 50. The second level adds the shared works (up to 300, six lists) and the details of what they cite (up to 50, one list).
 */
export function estimateGaps(input: GapInput, deeper = false): GapEstimate {
  const refLists = Math.ceil(MAX_GAP_REFERENCES / 50);
  const detailLists = Math.ceil(MAX_GAPS / 50);
  const deeperLists = deeper ? Math.ceil(MAX_HUBS / 50) + Math.ceil(MAX_DEEPER / 50) : 0;
  let free = 0;
  let filtered = 0;
  let searches = 0;
  let skippedLines = 0;
  if (input.kind === "work") {
    free = 1;
    filtered = refLists + detailLists + deeperLists;
  } else if (input.kind === "title") {
    searches = 1;
    filtered = refLists + detailLists + deeperLists;
  } else {
    filtered = Math.ceil(input.dois.length / 50) + (input.dois.length + input.lines.length > 0 ? detailLists + deeperLists : 0);
    searches = Math.min(input.lines.length, MAX_TITLE_SEARCHES);
    skippedLines = Math.max(0, input.lines.length - MAX_TITLE_SEARCHES);
  }
  return { free, filtered, searches, usd: round(filtered * COST_FILTER + searches * COST_SEARCH), skippedLines };
}

// ---- the saved state of the tool -------------------------------------------------------------------------------------------

export type GapsMode = "paper" | "zotero" | "paste";

/** What the citation-gaps tab holds, kept in the plugin folder so closing the tab loses nothing. */
export interface GapsSession {
  version: 1;
  mode: GapsMode;
  paperText: string;
  zoteroQuery: string;
  /** Zotero key of the picked item, or null. */
  zoteroPick: string | null;
  pasted: string;
  /** The reference tidy-up inside the paste mode (its own saved state; read by `normaliseRefsSession`). */
  refs: Record<string, unknown> | null;
  /** Also search, in OpenAlex ($0.001 each), the references no DOI was found for. */
  searchUnfound: boolean;
  minCount: number;
  /** Go a second level: what the works that several references cite rest on. */
  deeper: boolean;
  /** A deeper gap is cited by at least this many of those shared works (2 to 20). */
  deeperMin: number;
  /** The last run and the input it was made from, with when. */
  last: { input: GapInput; run: import("./gaps-fetch").GapsRun; ranAt: string } | null;
}

export function emptyGapsSession(): GapsSession {
  return { version: 1, mode: "paper", paperText: "", zoteroQuery: "", zoteroPick: null, pasted: "", refs: null, searchUnfound: false, minCount: 3, deeper: false, deeperMin: 5, last: null };
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** The session from whatever the file held; null when it holds nothing usable. */
export function normaliseGapsSession(raw: unknown): GapsSession | null {
  if (!isObj(raw) || raw.version !== 1) return null;
  const out = emptyGapsSession();
  if (raw.mode === "paper" || raw.mode === "zotero" || raw.mode === "paste") out.mode = raw.mode;
  if (typeof raw.paperText === "string") out.paperText = raw.paperText;
  if (typeof raw.zoteroQuery === "string") out.zoteroQuery = raw.zoteroQuery;
  if (typeof raw.zoteroPick === "string") out.zoteroPick = raw.zoteroPick;
  if (typeof raw.pasted === "string") out.pasted = raw.pasted;
  if (isObj(raw.refs)) out.refs = raw.refs;
  out.searchUnfound = raw.searchUnfound === true;
  if (typeof raw.minCount === "number" && Number.isFinite(raw.minCount)) out.minCount = Math.min(10, Math.max(2, Math.floor(raw.minCount)));
  out.deeper = raw.deeper === true;
  if (typeof raw.deeperMin === "number" && Number.isFinite(raw.deeperMin)) out.deeperMin = Math.min(20, Math.max(2, Math.floor(raw.deeperMin)));
  const last = raw.last;
  if (isObj(last) && typeof last.ranAt === "string" && isObj(last.input) && isObj(last.run) && Array.isArray(last.run.gaps) && typeof last.input.kind === "string") {
    out.last = { input: last.input as unknown as GapInput, run: last.run as unknown as NonNullable<GapsSession["last"]>["run"], ranAt: last.ranAt };
  }
  return out;
}
