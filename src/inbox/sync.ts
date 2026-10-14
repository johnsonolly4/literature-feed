// Sync: every ticked paper that is not in Zotero yet goes into the library. No Obsidian here: the two clients and the "may I
// create these collections?" question are passed in, and the result says what to write back into the notes.
import type { OpenAlexClient } from "../openalex/client";
import type { FeedConfig } from "../settings/data";
import { planCollection, type ZoteroClient, type ZoteroCollection, type ZoteroFound } from "../zotero/client";
import { bareDoi, feedTag, toZoteroItem } from "../zotero/map";
import { parseInbox, type PaperOrigin, type SyncedMark } from "./write";

export interface PendingPaper {
  path: string;
  feedId: string;
  openalexId: string;
  /** The search topics (1-based) that found the paper, read from its line; empty when unknown. */
  topics: number[];
  /** Where the line was added from (the review), or null for a scanned paper. */
  origin: PaperOrigin | null;
}

/**
 * Ticked papers whose line has no "in Zotero" link yet, and papers in the "In Zotero" list that were unticked (a request to
 * send them again), from the text of the inbox notes.
 */
export function findPending(notes: readonly { path: string; text: string }[]): PendingPaper[] {
  const out: PendingPaper[] = [];
  for (const note of notes) {
    for (const p of parseInbox(note.text).papers) {
      const wanted = !p.dismissed && (p.list === "synced" ? !p.ticked : p.ticked && !p.synced);
      if (wanted) out.push({ path: note.path, feedId: p.feedId, openalexId: p.openalexId, topics: p.topics, origin: p.origin });
    }
  }
  return out;
}

export interface SyncDeps {
  zotero: Pick<ZoteroClient, "listCollections" | "createCollection" | "getItem" | "findByDoi" | "findByTitle" | "createItem" | "addToCollectionsAndTag">;
  openalex: Pick<OpenAlexClient, "getWork">;
}

/** Whether Sync may create a missing collection (the plugin settings): the feed's inbox collection and its project collection are separate. */
export interface SyncOptions {
  createInboxCollections: boolean;
  createProjectCollections: boolean;
}

export interface SyncedPaper extends SyncedMark {
  path: string;
  /** "added": a new item. "existing": the library already had it; collections and tag were added. */
  outcome: "added" | "existing";
}

export interface SyncResult {
  synced: SyncedPaper[];
  failed: { path: string; feedId: string; openalexId: string; message: string }[];
  /** Papers not tried, with the reason (for example the feed was deleted). */
  skipped: { path: string; feedId: string; openalexId: string; reason: string }[];
  /** Collection paths created in this run. */
  created: string[];
  /** Every collection the papers of this run were filed into, with whether this run made it. */
  collections: { path: string; created: boolean }[];
  /** Collection paths that are missing and may not be created: when there are any, nothing was sent. */
  blocked: { path: string; reason: string }[];
}

/** Why a missing collection may not be created, or null when it may (only its last name is missing and the setting is on). */
function whyBlocked(path: string, toCreate: string[], kinds: Set<"inbox" | "project">, options: SyncOptions): string | null {
  const allowed = (kinds.has("inbox") && options.createInboxCollections) || (kinds.has("project") && options.createProjectCollections);
  if (toCreate.length > 1) return `"${toCreate[0]}" is missing in Zotero; create it there first (the plugin creates only the last name of a path)`;
  if (!allowed) {
    const setting = kinds.has("inbox") ? "Create missing inbox collections" : "Create missing project collections";
    return `"${toCreate[0]}" is missing in Zotero; create it there, or switch on "${setting}" in the settings`;
  }
  return null;
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : "unknown error";
}

/**
 * Sends the pending papers to Zotero, feed by feed. One paper that fails does not stop the others and stays ticked, so
 * pressing Sync again retries it. The same paper under two feeds is created once and the second feed's collections and tag
 * are added to that item.
 */
export async function runSync(feeds: readonly FeedConfig[], pending: readonly PendingPaper[], deps: SyncDeps, options: SyncOptions): Promise<SyncResult> {
  const result: SyncResult = { synced: [], failed: [], skipped: [], created: [], collections: [], blocked: [] };
  const byId = new Map(feeds.map((f) => [f.id, f]));
  const todo: PendingPaper[] = [];
  for (const p of pending) {
    if (byId.has(p.feedId)) todo.push(p);
    else result.skipped.push({ path: p.path, feedId: p.feedId, openalexId: p.openalexId, reason: "its feed no longer exists" });
  }
  if (todo.length === 0) return result;

  // 1. Collections: which paths do the feeds need, which exist, which are missing. Nothing is written unless every missing one
  //    may be created (the last name of a path, and the matching setting is on); otherwise nothing is sent at all.
  const collections: ZoteroCollection[] = await deps.zotero.listCollections();
  const used = [...new Set(todo.map((p) => p.feedId))].map((id) => byId.get(id) as FeedConfig);
  const kindsOf = new Map<string, Set<"inbox" | "project">>();
  for (const f of used) {
    for (const [path, kind] of [[f.zoteroCollection, "inbox"], [f.project, "project"]] as const) {
      if (path.trim() === "") continue;
      kindsOf.set(path, (kindsOf.get(path) ?? new Set()).add(kind));
    }
  }
  const paths = [...kindsOf.keys()];
  for (const path of paths) {
    const plan = planCollection(collections, path);
    if (plan.toCreate.length === 0) continue;
    const reason = whyBlocked(path, plan.toCreate, kindsOf.get(path) as Set<"inbox" | "project">, options);
    if (reason !== null) result.blocked.push({ path, reason });
  }
  if (result.blocked.length > 0) return result;
  const keyOf = new Map<string, string>();
  for (const path of paths) {
    const plan = planCollection(collections, path);
    if (plan.toCreate.length === 1) {
      const key = await deps.zotero.createCollection(plan.toCreate[0], plan.parentKey);
      collections.push({ key, name: plan.toCreate[0], parent: plan.parentKey });
      result.created.push(path);
    }
    const done = planCollection(collections, path);
    if (done.key) {
      keyOf.set(path, done.key);
      result.collections.push({ path, created: result.created.includes(path) });
    }
  }
  const pathOfKey = new Map([...keyOf].map(([path, key]) => [key, path]));

  // 2. Papers.
  const made = new Map<string, ZoteroFound>(); // items created in this run, by bare DOI, for a second feed that has the paper
  for (const p of todo) {
    const feed = byId.get(p.feedId) as FeedConfig;
    try {
      const keys = [feed.zoteroCollection, feed.project].map((path) => keyOf.get(path)).filter((k): k is string => k !== undefined);
      const work = await deps.openalex.getWork(p.openalexId);
      const doi = bareDoi(work.doi);
      let found: ZoteroFound | null = doi !== "" ? made.get(doi) ?? null : null;
      found ??= doi !== "" ? await deps.zotero.findByDoi(doi) : await deps.zotero.findByTitle(work.title ?? "");
      let item: ZoteroFound;
      let outcome: "added" | "existing";
      if (found) {
        item = (await deps.zotero.addToCollectionsAndTag(found, keys, [feedTag(feed.id)])).item;
        outcome = "existing";
      } else {
        item = await deps.zotero.createItem(toZoteroItem(work, feed.id, keys, { feedName: feed.name, topics: p.topics, ...(p.origin ? { origin: p.origin } : {}) }));
        outcome = "added";
      }
      // Read it back: a link in the note means the item is really in the library, in the collections it was meant for.
      const stored = await deps.zotero.getItem(item.key);
      if (!stored || stored.deleted) throw new Error("Zotero accepted the item but it is not in the library afterwards (it may be in the Trash)");
      const missing = keys.filter((k) => !stored.collections.includes(k)).map((k) => pathOfKey.get(k) ?? k);
      if (missing.length > 0) throw new Error(`Zotero accepted the item but it is not in the collection ${missing.join(", ")}`);
      if (doi !== "") made.set(doi, item);
      result.synced.push({ path: p.path, feedId: p.feedId, openalexId: p.openalexId, key: item.key, outcome });
    } catch (e) {
      result.failed.push({ path: p.path, feedId: p.feedId, openalexId: p.openalexId, message: errorMessage(e) });
    }
  }
  return result;
}

/** One sentence for the Notice. */
export function describeSync(r: SyncResult): string {
  if (r.blocked.length > 0) {
    return `Sync stopped, nothing was sent. ${r.blocked.map((b) => `${b.path}: ${b.reason}.`).join(" ")} Then press Sync again.`;
  }
  const added = r.synced.filter((s) => s.outcome === "added").length;
  const existing = r.synced.length - added;
  const parts = [`${added} added to Zotero`, `${existing} already in your library (collections and tag added)`, `${r.failed.length} failed`];
  let text = `${parts.join(", ")}.`;
  if (r.created.length > 0) text += ` Created collections: ${r.created.join(", ")}.`;
  if (r.synced.length > 0 && r.collections.length > 0) {
    text += ` Filed in: ${r.collections.map((c) => `${c.path} (${c.created ? "new" : "existing"})`).join(", ")}.`;
  }
  if (r.skipped.length > 0) text += ` ${r.skipped.length} skipped (${r.skipped[0].reason}).`;
  if (r.failed.length > 0) text += ` First failure: ${r.failed[0].message}`;
  return text;
}
