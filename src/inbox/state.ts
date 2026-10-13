// Read state and archive rules for the reading-inbox notes. Pure: no Obsidian.
import { titleKey } from "../zotero/client";
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
  /** The note's `title` property, as lower-case letters and digits only, to the path of the note. */
  byTitle: Map<string, string>;
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
  const index: LiteratureIndex = { byDoi: new Map(), byKey: new Map(), byTitle: new Map() };
  const sorted = [...notes].sort((a, b) => a.path.localeCompare(b.path));
  for (const note of sorted) {
    if (!note.frontmatter) continue;
    for (const [name, value] of Object.entries(note.frontmatter)) {
      if (/^title$/i.test(name) && typeof value === "string") {
        const key = titleKey(value);
        if (key !== "" && !index.byTitle.has(key)) index.byTitle.set(key, note.path);
      }
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

/**
 * The literature note for a paper: by its Zotero key first (exact), then by its DOI, then by its title (letters and digits,
 * any case). The title rule is for notes made from an item that was later re-created under a new key, and for notes whose
 * frontmatter has no DOI. Null when there is none.
 */
export function findLiteratureNote(index: LiteratureIndex, doi: string | null, key: string | null, title: string | null = null): string | null {
  if (key && index.byKey.has(key)) return index.byKey.get(key) ?? null;
  const bare = doi ? cleanDoi(doi) : "";
  if (bare !== "" && index.byDoi.has(bare)) return index.byDoi.get(bare) ?? null;
  const wanted = title ? titleKey(title) : "";
  return wanted !== "" ? index.byTitle.get(wanted) ?? null : null;
}

export interface RefreshReport {
  inboxFolder: string;
  inboxNotes: number;
  literatureFolder: string;
  literatureNotes: number;
  papers: number;
  read: number;
  archived: number;
}

/** What "Update read state and archive" tells the user when they run it by hand. */
export function describeRefresh(r: RefreshReport): string {
  const where = r.inboxFolder === "" ? "the vault root" : `"${r.inboxFolder}"`;
  if (r.inboxNotes === 0) {
    return `No inbox notes in ${where}. If your reading inbox note is somewhere else, move it there (or change the inbox folder in the settings).`;
  }
  const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? "" : "s"}`;
  const lit = r.literatureFolder === ""
    ? "no literature folder is set, so no Read links"
    : `${plural(r.literatureNotes, "literature note")} in "${r.literatureFolder}"`;
  return `Checked ${plural(r.inboxNotes, "inbox note")} in ${where} (${plural(r.papers, "paper")}) against ${lit}: ${plural(r.read, "paper")} newly marked read, ${plural(r.archived, "note")} archived.`;
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

/**
 * Papers that still keep the note open. A paper is done when it is read or dismissed, or when its note's week ended `dismissAfterWeeks`
 * weeks ago or more and it is unticked (dismissed) or in Zotero but unread (done by age). A ticked paper that is not in Zotero
 * yet, and a paper unticked in the "In Zotero" list (a request to send it again), stay open however old the note is.
 */
export function unfinishedPapers(papers: readonly ParsedPaper[], noteName: string, today: string, dismissAfterWeeks: number): ParsedPaper[] {
  const start = noteWeekStart(noteName);
  const agedFrom = start === null ? null : addDays(start, 7 + dismissAfterWeeks * 7);
  return papers.filter((p) => {
    if (p.read || p.dismissed) return false;
    if (p.list === "synced" && !p.ticked) return true; // a request to send it again
    const aged = agedFrom !== null && today >= agedFrom;
    if (aged && (p.synced || !p.ticked)) return false;
    return true;
  });
}

/**
 * A weekly note is finished when every paper in it is read, or has aged out (see `unfinishedPapers`). Papers that are in
 * Zotero but not read yet keep the note in the inbox as the reading queue. A note with no papers is finished.
 */
export function isFinished(papers: readonly ParsedPaper[], noteName: string, today: string, dismissAfterWeeks: number): boolean {
  return unfinishedPapers(papers, noteName, today, dismissAfterWeeks).length === 0;
}
