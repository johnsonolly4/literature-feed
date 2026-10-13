// Read state and archive rules for the reading-inbox notes. Pure: no Obsidian.
import { bareDoi } from "../zotero/map";
import { addDays } from "./scan";
import type { ParsedPaper } from "./write";

/** A literature note as far as the match needs it: its path and its frontmatter (as Obsidian's cache gives it). */
export interface LiteratureNote {
  path: string;
  frontmatter: Record<string, unknown> | null | undefined;
}

export interface LiteratureIndex {
  /** Bare lower-case DOI to the path of the note that holds it. */
  byDoi: Map<string, string>;
  /** Zotero item key to the path of the note that holds it. */
  byKey: Map<string, string>;
}

const DOI_IN_TEXT = /10\.\d{4,9}\/[^\s"'<>\])}]+/gi;
const KEY_IN_LINK = /zotero:\/\/(?:select|open-pdf)\/(?:library|groups\/\d+)\/items\/([A-Z0-9]{8})/g;
const BARE_KEY = /^[A-Z0-9]{8}$/;

/** Every string in a frontmatter value, however nested (a few levels deep at most). */
function collectStrings(value: unknown, out: string[], depth = 0): void {
  if (typeof value === "string") out.push(value);
  else if (depth < 4 && Array.isArray(value)) for (const v of value) collectStrings(v, out, depth + 1);
  else if (depth < 4 && typeof value === "object" && value !== null) for (const v of Object.values(value)) collectStrings(v, out, depth + 1);
}

function cleanDoi(found: string): string {
  return bareDoi(found).replace(/[.,;:]+$/, "");
}

/**
 * Which DOIs and Zotero keys the literature notes hold. The property names do not matter (ZotLit's templates are the user's
 * own): a DOI anywhere in a frontmatter value counts, and so does a Zotero key inside a `zotero://` link or, alone, in a
 * property whose name mentions "key" or "zotero". If two notes hold the same one, the first path in alphabetical order wins.
 */
export function buildLiteratureIndex(notes: readonly LiteratureNote[]): LiteratureIndex {
  const index: LiteratureIndex = { byDoi: new Map(), byKey: new Map() };
  const sorted = [...notes].sort((a, b) => a.path.localeCompare(b.path));
  for (const note of sorted) {
    if (!note.frontmatter) continue;
    for (const [name, value] of Object.entries(note.frontmatter)) {
      const strings: string[] = [];
      collectStrings(value, strings);
      for (const text of strings) {
        for (const m of text.matchAll(DOI_IN_TEXT)) {
          const doi = cleanDoi(m[0]);
          if (!index.byDoi.has(doi)) index.byDoi.set(doi, note.path);
        }
        for (const m of text.matchAll(KEY_IN_LINK)) {
          if (!index.byKey.has(m[1])) index.byKey.set(m[1], note.path);
        }
        if (BARE_KEY.test(text.trim()) && /key|zotero/i.test(name) && !index.byKey.has(text.trim())) index.byKey.set(text.trim(), note.path);
      }
    }
  }
  return index;
}

/** The literature note for a paper: by its Zotero key first (exact), then by its DOI. Null when there is none. */
export function findLiteratureNote(index: LiteratureIndex, doi: string | null, key: string | null): string | null {
  if (key && index.byKey.has(key)) return index.byKey.get(key) ?? null;
  const bare = doi ? cleanDoi(doi) : "";
  return bare !== "" ? index.byDoi.get(bare) ?? null : null;
}

/** The Monday (`YYYY-MM-DD`) of the ISO week in a note's file name ("2026-W42 Reading inbox.md"); null if the name has none. */
export function noteWeekStart(fileName: string): string | null {
  const m = /^(\d{4})-W(\d{2})\b/.exec(fileName);
  if (!m) return null;
  const year = Number(m[1]);
  const week = Number(m[2]);
  if (week < 1 || week > 53) return null;
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const monday1 = addDays(jan4.toISOString().slice(0, 10), 1 - (jan4.getUTCDay() || 7));
  return addDays(monday1, (week - 1) * 7);
}

/** Papers that still keep the note open (see `isFinished`). */
export function unfinishedPapers(papers: readonly ParsedPaper[], noteName: string, today: string, dismissAfterWeeks: number): ParsedPaper[] {
  const start = noteWeekStart(noteName);
  const dismissFrom = start === null ? null : addDays(start, 7 + dismissAfterWeeks * 7);
  return papers.filter((p) => {
    if (p.list === "synced" && !p.ticked) return true; // unticked in the In Zotero list: a request to send it again
    if (p.synced || p.read) return false;
    if (!p.ticked && dismissFrom !== null && today >= dismissFrom) return false; // dismissed
    return true;
  });
}

/**
 * A weekly note is finished when every paper in it is synced (linked to Zotero), read (linked to a literature note) or
 * dismissed (unticked, and the note's week ended `dismissAfterWeeks` weeks ago or more). A ticked paper that is not synced
 * yet, an unticked one from a younger week, and one unticked in the "In Zotero" list (to be sent again) keep it open. A note with no papers is finished.
 */
export function isFinished(papers: readonly ParsedPaper[], noteName: string, today: string, dismissAfterWeeks: number): boolean {
  return unfinishedPapers(papers, noteName, today, dismissAfterWeeks).length === 0;
}
