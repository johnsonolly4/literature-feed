// Check setup: what the plugin needs and whether it is there. Pure: no Obsidian; the facts about the vault are passed in as a
// snapshot, and a row's fix is data (what to do), which the window carries out after the user presses its button.
import { resolveSeedCollection, seedCollectionPath } from "../review/known";
import type { FeedConfig, Settings } from "../settings/data";
import { pathParts, planCollection } from "../zotero/client";
import type { IndexedCollection } from "../zotero/library-index";

/** The folder Lab Kit's ZotLit setup uses for literature notes. */
export const LAB_KIT_LITERATURE_FOLDER = "04 Literature/ZotLit Imports";

export interface SetupSnapshot {
  settings: Settings;
  /** The key's secret is chosen and has a value. */
  keyReadable: { openAlex: boolean; zotero: boolean };
  folderExists(path: string): boolean;
  /** A note with this name (no folder, no extension) exists somewhere in the vault. */
  noteExists(name: string): boolean;
  pluginInstalled(id: string): boolean;
  pluginEnabled(id: string): boolean;
  /** Zotero's collections as just read, or why they could not be read. Absent without a Zotero key and user ID: no seed rows then. */
  zotero?: { collections: IndexedCollection[] } | { error: string };
}

export type FixAction =
  | { kind: "create-folder"; path: string }
  | { kind: "set-literature-folder"; path: string }
  | { kind: "create-zotero-collection"; path: string };

/** What carrying out a fix does, one function per kind. */
export interface FixHandlers {
  createFolder(path: string): Promise<void>;
  setLiteratureFolder(path: string): Promise<void>;
  createZoteroCollection(path: string): Promise<void>;
}

/** Carries out a fix by its kind. A kind that is not known does nothing (it must never fall through to another fix). */
export async function runFix(fix: FixAction, handlers: FixHandlers): Promise<void> {
  switch (fix.kind) {
    case "create-folder": return handlers.createFolder(fix.path);
    case "set-literature-folder": return handlers.setLiteratureFolder(fix.path);
    case "create-zotero-collection": return handlers.createZoteroCollection(fix.path);
    default: return;
  }
}

export interface SetupRow {
  id: string;
  /** ok = fine; todo = something to do; info = good to know, nothing is wrong. */
  state: "ok" | "todo" | "info";
  title: string;
  detail: string;
  fix?: { label: string; action: FixAction };
}

export function checkSetup(snap: SetupSnapshot): SetupRow[] {
  const s = snap.settings;
  const rows: SetupRow[] = [];

  rows.push(snap.keyReadable.openAlex
    ? { id: "openalex-key", state: "ok", title: "OpenAlex key", detail: "A secret is chosen and has a value." }
    : { id: "openalex-key", state: "todo", title: "OpenAlex key", detail: "Choose or create a secret for it in Settings → OpenAlex API key. Scanning needs it." });

  const zoteroMissing = [!snap.keyReadable.zotero ? "the Zotero key" : "", s.zoteroUserId === "" ? "the Zotero user ID" : ""].filter((m) => m !== "");
  rows.push(zoteroMissing.length === 0
    ? { id: "zotero", state: "ok", title: "Zotero key and user ID", detail: "Both are set." }
    : { id: "zotero", state: "todo", title: "Zotero key and user ID", detail: `Missing: ${zoteroMissing.join(" and ")}. Only Sync needs them.` });

  rows.push(folderRow("inbox-folder", "Inbox folder", s.inboxFolder, snap,
    "Weekly notes are made in the vault root; set a folder to keep them together.",
    "The folder does not exist yet; the first scan makes it."));
  rows.push(folderRow("archive-folder", "Archive folder", s.archiveFolder, snap,
    "Not set: finished weekly notes stay in the inbox folder.",
    "The folder does not exist yet; the first archive makes it."));

  // Literature folder: the read state (Read links, Processed) needs it.
  if (s.literatureFolder === "") {
    const labKit = snap.folderExists(LAB_KIT_LITERATURE_FOLDER);
    rows.push({
      id: "literature-folder", state: "todo", title: "Literature notes folder",
      detail: labKit
        ? `Not set, so papers never show Read or Processed. Lab Kit's ZotLit folder "${LAB_KIT_LITERATURE_FOLDER}" exists.`
        : "Not set, so papers never show Read or Processed. Set it to the folder your literature notes are in (the one ZotLit writes to).",
      fix: labKit ? { label: "Use it", action: { kind: "set-literature-folder", path: LAB_KIT_LITERATURE_FOLDER } } : undefined,
    });
  } else if (!snap.folderExists(s.literatureFolder)) {
    rows.push({ id: "literature-folder", state: "todo", title: "Literature notes folder", detail: `"${s.literatureFolder}" does not exist in this vault, so no paper can show Read.` });
  } else {
    rows.push({ id: "literature-folder", state: "ok", title: "Literature notes folder", detail: `"${s.literatureFolder}" exists.` });
  }

  const active = s.feeds.filter((f) => f.enabled && f.topics.length > 0);
  rows.push(active.length === 0
    ? { id: "feeds", state: "todo", title: "A search switched on", detail: "No search with topics is switched on, so nothing is scanned. Add or import one, and switch it on." }
    : { id: "feeds", state: "ok", title: "A search switched on", detail: `${active.length} search${active.length === 1 ? " is" : "es are"} switched on.` });

  for (const feed of active) {
    if (feed.zoteroCollection.trim() === "") {
      rows.push({ id: `collection-${feed.id}`, state: "info", title: `${feed.name}: Zotero collection`, detail: "Not set: synced papers are not put in a collection (they stay in the library root)." });
    }
    const project = feed.project.trim();
    if (project === "") {
      rows.push({ id: `project-${feed.id}`, state: "info", title: `${feed.name}: project`, detail: "Not set: synced papers are not filed under a project collection, so no project page lists them." });
    } else {
      const hub = project.startsWith("Projects/") ? project.slice("Projects/".length) : project;
      rows.push(snap.noteExists(hub)
        ? { id: `project-${feed.id}`, state: "ok", title: `${feed.name}: project`, detail: `A note named "${hub}" exists, so its project page can list the papers.` }
        : { id: `project-${feed.id}`, state: "todo", title: `${feed.name}: project`, detail: `No note named "${hub}". A Lab Kit project page lists a paper only when the collection is "Projects/" plus the page's exact name.` });
    }
  }

  rows.push(...seedRows(s.feeds, snap.zotero));

  if (!snap.pluginInstalled("zotlit")) {
    rows.push({ id: "zotlit", state: "info", title: "ZotLit", detail: "Not installed. It makes the literature notes that give papers their Read link; this plugin works without it." });
  } else if (!snap.pluginEnabled("zotlit")) {
    rows.push({ id: "zotlit", state: "todo", title: "ZotLit", detail: "Installed but switched off. Switch it on under Community plugins to make literature notes." });
  } else {
    rows.push({ id: "zotlit", state: "ok", title: "ZotLit", detail: "Installed and on. Its frontmatter fields (kind, Title, Year, DOI, Zotero Tags, Collections) are checked by Lab Kit → Check setup → ZotLit, not here." });
  }

  rows.push(snap.pluginEnabled("lab-kit")
    ? { id: "lab-kit", state: "ok", title: "Lab Kit", detail: "Found and on: the integration step below is available." }
    : { id: "lab-kit", state: "info", title: "Lab Kit", detail: "Not found, so the integration step is not offered. This plugin works without it." });

  rows.push({
    id: "zotero-addons", state: "info", title: "Zotero add-ons for PDFs",
    detail: "Cannot be checked from here. Fetching PDFs needs the Zotero Connector and the Better Find Full Text add-on in Zotero (see the README).",
  });
  return rows;
}

/** One row per search with topics (switched on or not) about its seed collection in Zotero. */
function seedRows(feeds: readonly FeedConfig[], zotero: SetupSnapshot["zotero"]): SetupRow[] {
  const withTopics = feeds.filter((f) => f.topics.length > 0);
  if (!zotero || withTopics.length === 0) return [];
  if ("error" in zotero) {
    return [{ id: "zotero-collections", state: "todo", title: "Zotero collections", detail: `Could not read Zotero: ${zotero.error} The seed collections were not checked.` }];
  }
  const live = zotero.collections.filter((c) => !c.trashed);
  const same = (a: string, b: string): boolean => pathParts(a).join("/") === pathParts(b).join("/") && pathParts(a).length > 0;
  return withTopics.map((feed): SetupRow => {
    const id = `seeds-${feed.id}`;
    const title = `${feed.name}: seed collection`;
    const path = seedCollectionPath(feed);
    if (path === null) return { id, state: "info", title, detail: "Not set: the search has no Zotero collection, so it has no seed collection (the papers you know are right for it). Set the Zotero collection, or a seed collection path, in the search." };
    if (same(path, feed.zoteroCollection) || same(path, feed.project)) {
      return { id, state: "todo", title, detail: `"${path}" is the same as the search's ${same(path, feed.zoteroCollection) ? "inbox" : "project"} collection, so every synced paper would count as a known paper. Give the search its own seed collection (by default its Zotero collection followed by /seeds).` };
    }
    const found = resolveSeedCollection(zotero.collections, path);
    if (found.key !== null) return { id, state: "ok", title, detail: `"${path}" exists in Zotero.` };
    const near = found.nearMisses.length > 0 ? ` Did you mean: ${found.nearMisses.join("; ")}?` : "";
    const plan = planCollection(live, path);
    if (plan.toCreate.length === 1) {
      return { id, state: "todo", title, detail: `"${path}" was not found in Zotero (names are matched exactly, capitals included).${near} Create it, then put the papers you know are right in it.`, fix: { label: "Create it", action: { kind: "create-zotero-collection", path } } };
    }
    return { id, state: "todo", title, detail: `"${path}" was not found in Zotero, and "${plan.toCreate[0]}", which it goes in, is missing too.${near} Sync once first, or create the inbox collection in Zotero.` };
  });
}

function folderRow(id: string, title: string, path: string, snap: SetupSnapshot, unsetDetail: string, missingDetail: string): SetupRow {
  if (path === "") return { id, state: "info", title, detail: unsetDetail };
  if (snap.folderExists(path)) return { id, state: "ok", title, detail: `"${path}" exists.` };
  return { id, state: "info", title, detail: missingDetail, fix: { label: "Create it now", action: { kind: "create-folder", path } } };
}
