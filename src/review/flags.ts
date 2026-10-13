// What the user already has of a paper: in the Zotero library, in the vault (a literature note), or listed by a search before.
// Pure: the three sources are passed in (any of them may be missing, and then that flag is simply not set).
import type { LiteratureIndex } from "../inbox/state";
import { findLiteratureNote } from "../inbox/state";
import type { Ledger } from "../ledger/ledger";
import { findInZotero, type ZoteroLookup } from "../zotero/library-index";

export interface Flags {
  /** The Zotero key, or null (also when the library was not checked). */
  zotero: string | null;
  /** The path of the literature note, or null. */
  vault: string | null;
  /** The searches that listed this paper before (from the history and the seen list). */
  listedBefore: string[];
}

export interface FlagSources {
  zotero: ZoteroLookup | null;
  literature: LiteratureIndex | null;
  ledger: Ledger | null;
  /** `<search id>/<OpenAlex id>` of papers listed before. */
  seen: readonly string[];
}

export interface FlaggedPaper {
  /** The short OpenAlex id. */
  id: string;
  doi: string | null;
  title: string;
}

export function flagsFor(paper: FlaggedPaper, sources: FlagSources): Flags {
  const zotero = sources.zotero ? findInZotero(sources.zotero, paper.doi, paper.title) : null;
  const vault = sources.literature ? findLiteratureNote(sources.literature, paper.doi, null, paper.title) : null;
  const listed = new Set<string>();
  const suffix = `/${paper.id}`;
  for (const key of sources.seen) if (key.endsWith(suffix)) listed.add(key.slice(0, key.length - suffix.length));
  if (sources.ledger) for (const key of Object.keys(sources.ledger.papers)) if (key.endsWith(suffix)) listed.add(key.slice(0, key.length - suffix.length));
  return { zotero, vault, listedBefore: [...listed].sort() };
}

/** Counts of how many papers carry each flag, for the summary line. */
export function countFlags(flags: readonly Flags[]): { zotero: number; vault: number; listedBefore: number } {
  return {
    zotero: flags.filter((f) => f.zotero !== null).length,
    vault: flags.filter((f) => f.vault !== null).length,
    listedBefore: flags.filter((f) => f.listedBefore.length > 0).length,
  };
}
