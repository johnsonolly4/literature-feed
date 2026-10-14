// Promote to seeds: a paper the user keeps joins its search's seed collection in Zotero, so it counts as a known paper. Before it does,
// the distortion check says how it fits the current seeds and how their search strings would change. Nothing is blocked; the user
// confirms. Only collection membership is written (never fields, tags or files), and the undo takes the paper out again.
import type { FeedConfig } from "../settings/data";
import type { ZoteroFound, ZoteroStored } from "../zotero/client";
import type { ZoteroIndex } from "../zotero/library-index";
import { coherence, fitOfNew, type Fit, type LinkNode } from "./coherence";
import { resolveSeedCollection, seedCollectionPath } from "./known";
import { suggestQueries, type SeedText } from "./seed-queries";
import type { SeedProfile } from "./seeds";

export interface Distortion {
  fit: Fit | null;
  /** The paper would be linked to almost none of the other papers once it is a seed (or be a strand on its own). */
  outlierAfter: boolean;
  /** Search strings the seeds would give with it that they do not give now, and the other way round. */
  stringsAdded: string[];
  stringsDropped: string[];
}

/** How a paper would change the seeds of a search. Null when the seeds were saved without their links and words (nothing to compare). */
export function distortionCheck(
  profile: SeedProfile, paper: LinkNode & SeedText, others: readonly { name: string; profile: SeedProfile }[] = [],
): Distortion | null {
  if (!profile.perPaper || !profile.papers) return null;
  const withPaper: SeedProfile = {
    ...profile,
    perPaper: [...profile.perPaper, { id: paper.id, refs: [...paper.refs], authors: [...paper.authors] }],
    papers: [...profile.papers, { id: paper.id, title: paper.title, abstract: paper.abstract }],
  };
  const before = new Set(suggestQueries(profile.papers).map((q) => q.text));
  const after = new Set(suggestQueries(withPaper.papers ?? []).map((q) => q.text));
  return {
    fit: fitOfNew(paper, profile, others),
    outlierAfter: coherence(withPaper).outliers.includes(paper.id),
    stringsAdded: [...after].filter((s) => !before.has(s)),
    stringsDropped: [...before].filter((s) => !after.has(s)),
  };
}

const quoted = (xs: readonly string[]): string => xs.map((x) => `"${x}"`).join(", ");

/** The text of the confirmation. A null check (the inbox, or old seeds) says the fit was not checked. */
export function confirmText(check: Distortion | null, title: string, searchName: string, seedPath: string): string {
  const lines = [`Add "${title}" to the seed collection ${seedPath} of ${searchName}? It then counts as a paper you know. Only its collection changes in Zotero.`];
  if (check === null) {
    lines.push("Fit not checked here: the review window checks it against the seeds.");
    return lines.join(" ");
  }
  if (check.fit === null) lines.push("Too few seeds to say whether it fits.");
  else if (check.fit.fits) lines.push("It fits your seeds.");
  else lines.push(`It does not fit ${searchName}'s seeds well.${check.fit.betterSearch ? ` It fits ${check.fit.betterSearch} better.` : ""}`);
  if (check.outlierAfter) lines.push("It would be linked to almost none of the seeds.");
  if (check.stringsAdded.length > 0) lines.push(`Strings the seeds would give: added ${quoted(check.stringsAdded)}.`);
  if (check.stringsDropped.length > 0) lines.push(`Dropped ${quoted(check.stringsDropped)}.`);
  if (check.stringsAdded.length === 0 && check.stringsDropped.length === 0) lines.push("Their search strings would not change.");
  return lines.join(" ");
}

/** The search's seed collection in the local index: its key and path, or why there is none. */
export function seedTarget(feed: FeedConfig, index: ZoteroIndex): { key: string; path: string } | { error: string } {
  const path = seedCollectionPath(feed);
  if (path === null) return { error: `${feed.name} has no seed collection: set its Zotero collection first.` };
  const { key } = resolveSeedCollection(index.collections, path);
  return key === null ? { error: `The seed collection ${path} is not in your Zotero library (or the copy is old). Create it from Check setup, then check against Zotero again.` } : { key, path };
}

/** What the client needs; `ZoteroClient` has all three. */
export interface PromoteClient {
  getItem(key: string): Promise<ZoteroStored | null>;
  addToCollectionsAndTag(found: ZoteroFound, collections: readonly string[], tags: readonly string[]): Promise<{ item: ZoteroFound; changed: boolean }>;
  removeFromCollections(found: ZoteroFound, collections: readonly string[]): Promise<{ item: ZoteroFound; changed: boolean }>;
}

export type PromoteResult =
  | { status: "added" | "already" | "removed" | "not-there" }
  | { status: "missing" };

/** Adds the item to the collection. "already": it was in it (nothing was written, so there is nothing to undo). */
export async function promoteItem(client: PromoteClient, itemKey: string, collectionKey: string): Promise<PromoteResult> {
  const found = await client.getItem(itemKey);
  if (!found || found.deleted) return { status: "missing" };
  const { changed } = await client.addToCollectionsAndTag(found, [collectionKey], []);
  return { status: changed ? "added" : "already" };
}

/** Takes the item out of the collection again. */
export async function undoPromote(client: PromoteClient, itemKey: string, collectionKey: string): Promise<PromoteResult> {
  const found = await client.getItem(itemKey);
  if (!found || found.deleted) return { status: "missing" };
  const { changed } = await client.removeFromCollections(found, [collectionKey]);
  return { status: changed ? "removed" : "not-there" };
}
