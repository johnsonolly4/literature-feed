// Sync: every ticked paper that is not in Zotero yet goes into the library. No Obsidian here: the two clients and the "may I
// create these collections?" question are passed in, and the result says what to write back into the notes.
import type { OpenAlexClient } from "../openalex/client";
import type { FeedConfig } from "../settings/data";
import { planCollection, type ZoteroClient, type ZoteroCollection, type ZoteroFound } from "../zotero/client";
import { bareDoi, feedTag, toZoteroItem } from "../zotero/map";
import { parseInbox, type SyncedMark } from "./write";

export interface PendingPaper {
  path: string;
  feedId: string;
  openalexId: string;
}

/** Ticked papers whose line has no "in Zotero" link yet, from the text of the inbox notes. */
export function findPending(notes: readonly { path: string; text: string }[]): PendingPaper[] {
  const out: PendingPaper[] = [];
  for (const note of notes) {
    for (const p of parseInbox(note.text).papers) {
      if (p.ticked && !p.synced) out.push({ path: note.path, feedId: p.feedId, openalexId: p.openalexId });
    }
  }
  return out;
}

export interface SyncDeps {
  zotero: Pick<ZoteroClient, "listCollections" | "createCollection" | "findByDoi" | "findByTitle" | "createItem" | "addToCollectionsAndTag">;
  openalex: Pick<OpenAlexClient, "getWork">;
  /** Asked once, before anything is written, when collections have to be created. `lines` describe them; false stops the sync. */
  confirmCreate(lines: string[]): Promise<boolean>;
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
  /** The user said no to creating collections: nothing was written. */
  declined: boolean;
}

function describePlan(path: string, toCreate: string[]): string {
  return `${path} (new: ${toCreate.join(" / ")})`;
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : "unknown error";
}

/**
 * Sends the pending papers to Zotero, feed by feed. One paper that fails does not stop the others and stays ticked, so
 * pressing Sync again retries it. The same paper under two feeds is created once and the second feed's collections and tag
 * are added to that item.
 */
export async function runSync(feeds: readonly FeedConfig[], pending: readonly PendingPaper[], deps: SyncDeps): Promise<SyncResult> {
  const result: SyncResult = { synced: [], failed: [], skipped: [], created: [], declined: false };
  const byId = new Map(feeds.map((f) => [f.id, f]));
  const todo: PendingPaper[] = [];
  for (const p of pending) {
    if (byId.has(p.feedId)) todo.push(p);
    else result.skipped.push({ ...p, reason: "its feed no longer exists" });
  }
  if (todo.length === 0) return result;

  // 1. Collections: which paths do the feeds need, which exist, which must be created (asked first).
  const collections: ZoteroCollection[] = await deps.zotero.listCollections();
  const used = [...new Set(todo.map((p) => p.feedId))].map((id) => byId.get(id) as FeedConfig);
  const paths = [...new Set(used.flatMap((f) => [f.zoteroCollection, f.project]).filter((p) => p.trim() !== ""))];
  const missing = paths.map((path) => ({ path, plan: planCollection(collections, path) })).filter((x) => x.plan.toCreate.length > 0);
  if (missing.length > 0) {
    const yes = await deps.confirmCreate(missing.map((m) => describePlan(m.path, m.plan.toCreate)));
    if (!yes) return { ...result, declined: true };
  }
  const keyOf = new Map<string, string>();
  for (const path of paths) {
    let plan = planCollection(collections, path);
    let parent = plan.parentKey;
    for (const name of plan.toCreate) {
      const key = await deps.zotero.createCollection(name, parent);
      collections.push({ key, name, parent });
      parent = key;
    }
    if (plan.toCreate.length > 0) result.created.push(path);
    plan = planCollection(collections, path);
    if (plan.key) keyOf.set(path, plan.key);
  }

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
      if (found) {
        const { item } = await deps.zotero.addToCollectionsAndTag(found, keys, [feedTag(feed.id)]);
        if (doi !== "") made.set(doi, item);
        result.synced.push({ path: p.path, feedId: p.feedId, openalexId: p.openalexId, key: item.key, outcome: "existing" });
      } else {
        const item = await deps.zotero.createItem(toZoteroItem(work, feed.id, keys));
        if (doi !== "") made.set(doi, item);
        result.synced.push({ path: p.path, feedId: p.feedId, openalexId: p.openalexId, key: item.key, outcome: "added" });
      }
    } catch (e) {
      result.failed.push({ path: p.path, feedId: p.feedId, openalexId: p.openalexId, message: errorMessage(e) });
    }
  }
  return result;
}

/** One sentence for the Notice. */
export function describeSync(r: SyncResult): string {
  if (r.declined) return "Sync stopped: the new collections were not created, so nothing was sent.";
  const added = r.synced.filter((s) => s.outcome === "added").length;
  const existing = r.synced.length - added;
  const parts = [`${added} added to Zotero`, `${existing} already in your library (collections and tag added)`, `${r.failed.length} failed`];
  let text = `${parts.join(", ")}.`;
  if (r.created.length > 0) text += ` Created collections: ${r.created.join(", ")}.`;
  if (r.skipped.length > 0) text += ` ${r.skipped.length} skipped (${r.skipped[0].reason}).`;
  if (r.failed.length > 0) text += ` First failure: ${r.failed[0].message}`;
  return text;
}
