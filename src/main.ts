import { Notice, Plugin, TFile, normalizePath } from "obsidian";
import { registerInboxBlock } from "./inbox/block";
import { localDay, runScan, scanCounts, updatedSeen, type ScanOutcome } from "./inbox/scan";
import { describeSync, findPending, runSync } from "./inbox/sync";
import { NOTE_NAME_PATTERN, markSynced, mergeIntoNote, renderNote } from "./inbox/write";
import { OpenAlexClient } from "./openalex/client";
import { obsidianRequester } from "./openalex/request";
import { defaultSettings, migrateLegacyKeys, normaliseSettings, type SecretName, type Settings } from "./settings/data";
import type { SettingsHost } from "./settings/feed-modal";
import { LiteratureFeedSettingTab } from "./settings/tab";
import { ZoteroClient } from "./zotero/client";
import { zoteroRequester } from "./zotero/request";

export default class LiteratureFeedPlugin extends Plugin implements SettingsHost {
  settings: Settings = defaultSettings();
  private tab: LiteratureFeedSettingTab | null = null;
  private scanning = false;
  private syncing = false;
  /** Open status blocks and cards; they redraw after a scan. */
  readonly scanListeners = new Set<() => void>();

  async onload(): Promise<void> {
    await this.loadSettings();
    this.tab = new LiteratureFeedSettingTab(this, this);
    this.addSettingTab(this.tab);
    registerInboxBlock(this);
    this.addCommand({ id: "scan-now", name: "Scan now", callback: () => void this.scanNow() });
    this.addCommand({ id: "sync-ticked", name: "Sync ticked papers", callback: () => void this.syncNow() });
    // The weekly schedule, the ribbon icon and the Zotero sync come in later phases (see docs/plans/literature-feed.md).
  }

  async loadSettings(): Promise<void> {
    const raw: unknown = await this.loadData();
    const settings = normaliseSettings(raw);
    try {
      if (migrateLegacyKeys(raw, settings, this.app.secretStorage)) {
        this.settings = settings;
        await this.saveSettings(); // rewrites data.json without the plain-text keys
        new Notice("Literature feed: your API keys were moved to Obsidian's secret storage.");
        return;
      }
    } catch {
      // data.json was not rewritten, so nothing is lost yet; but the plain-text keys are not kept in memory.
      new Notice("Literature feed: could not move your API keys to Obsidian's secret storage. Choose them again in the settings.");
      this.settings = normaliseSettings(raw);
      return;
    }
    this.settings = settings;
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  /** The key's value, read from Obsidian's secret storage at the moment it is needed. "" when none is chosen. */
  getSecret(name: SecretName): string {
    const id = name === "openAlexKey" ? this.settings.openAlexKeySecret : this.settings.zoteroKeySecret;
    return id === "" ? "" : this.app.secretStorage.getSecret(id) ?? "";
  }

  /** `data.json` changed outside Obsidian (for example by a sync service): read it again and redraw the tab. */
  async onExternalSettingsChange(): Promise<void> {
    await this.loadSettings();
    this.tab?.update();
  }

  /** One scan of every enabled feed; writes or extends this week's inbox note and says what it found. */
  async scanNow(): Promise<void> {
    if (this.scanning) {
      new Notice("A scan is already running.");
      return;
    }
    this.scanning = true;
    try {
      if (!this.settings.feeds.some((f) => f.enabled && f.topics.length > 0)) {
        new Notice("No feed is switched on. Turn one on in the settings first.");
        return;
      }
      new Notice("Scanning for new papers…");
      const client = new OpenAlexClient({
        request: obsidianRequester,
        apiKey: this.getSecret("openAlexKey") || undefined,
        sleep: (ms) => new Promise((resolve) => window.setTimeout(resolve, ms)),
      });
      const now = new Date();
      const outcome = await runScan(this.settings, { client, now });
      const path = outcome.note ? await this.writeNote(outcome.note) : null;
      this.settings.lastScan = outcome.lastScan;
      this.settings.seen = updatedSeen(this.settings.seen, outcome.seenAdd);
      this.settings.lastScanResult = scanCounts(outcome, localDay(now));
      await this.saveSettings();
      for (const redraw of this.scanListeners) redraw();
      new Notice(describeOutcome(outcome), outcome.failures.length > 0 ? 10_000 : 6_000);
      if (path) await this.app.workspace.openLinkText(path, "", "tab");
    } catch (e) {
      new Notice(`The scan failed: ${e instanceof Error ? e.message : "unknown error"}`, 10_000);
    } finally {
      this.scanning = false;
    }
  }

  /** Sends every ticked paper in the inbox notes to Zotero and links the note lines to the new items. */
  async syncNow(): Promise<void> {
    if (this.syncing) {
      new Notice("A sync is already running.");
      return;
    }
    this.syncing = true;
    try {
      const apiKey = this.getSecret("zoteroKey");
      const userId = this.settings.zoteroUserId;
      if (apiKey === "" || userId === "") {
        new Notice("Add your Zotero API key and user ID in the settings first.");
        return;
      }
      const notes = await this.readInboxNotes();
      const pending = findPending(notes.map((n) => ({ path: n.file.path, text: n.text })));
      if (pending.length === 0) {
        new Notice("Nothing to sync: tick the papers you want first.");
        return;
      }
      new Notice(`Sending ${pending.length} paper${pending.length === 1 ? "" : "s"} to Zotero…`);
      const sleep = (ms: number): Promise<void> => new Promise((resolve) => window.setTimeout(resolve, ms));
      const result = await runSync(this.settings.feeds, pending, {
        zotero: new ZoteroClient({ request: zoteroRequester, userId, apiKey, sleep }),
        openalex: new OpenAlexClient({ request: obsidianRequester, apiKey: this.getSecret("openAlexKey") || undefined, sleep }),
      }, { createInboxCollections: this.settings.createInboxCollections, createProjectCollections: this.settings.createProjectCollections });
      for (const note of notes) {
        const marks = result.synced.filter((s) => s.path === note.file.path);
        if (marks.length > 0) await this.app.vault.process(note.file, (current) => markSynced(current, marks));
      }
      new Notice(describeSync(result), result.failed.length > 0 || result.blocked.length > 0 ? 15_000 : 8_000);
      for (const redraw of this.scanListeners) redraw();
    } catch (e) {
      new Notice(`The sync failed: ${e instanceof Error ? e.message : "unknown error"}`, 10_000);
    } finally {
      this.syncing = false;
    }
  }

  /** The inbox notes (by their file name) in the inbox folder, with their text. */
  private async readInboxNotes(): Promise<{ file: TFile; text: string }[]> {
    const { vault } = this.app;
    const folder = this.settings.inboxFolder === "" ? vault.getRoot() : vault.getFolderByPath(this.settings.inboxFolder);
    const files = (folder?.children ?? []).filter((f): f is TFile => f instanceof TFile && NOTE_NAME_PATTERN.test(f.name));
    return Promise.all(files.map(async (file) => ({ file, text: await vault.read(file) })));
  }

  /** Creates this week's note, or adds to it inside `vault.process`, so a tick made meanwhile is kept. Returns its path. */
  private async writeNote(note: NonNullable<ScanOutcome["note"]>): Promise<string> {
    const { vault } = this.app;
    const path = normalizePath(note.path);
    const existing = vault.getFileByPath(path);
    if (existing) {
      await vault.process(existing, (current) => mergeIntoNote(current, note.input));
      return path;
    }
    const folder = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
    if (folder !== "" && !vault.getFolderByPath(folder)) await vault.createFolder(folder);
    await vault.create(path, renderNote(note.input));
    return path;
  }
}

function describeOutcome(o: ScanOutcome): string {
  const total = o.perTier.priority + o.perTier.strong + o.perTier.possible + o.perTier.unchecked;
  const cost = `cost $${o.costUsd.toFixed(3)}`;
  const parts = [
    total === 0
      ? `No new papers (${cost}).`
      : `${total} new: ${o.perTier.priority} priority, ${o.perTier.strong} strong, ${o.perTier.possible} possible, ${o.perTier.unchecked} without abstract (${cost}).`,
  ];
  if (o.failures.length > 0) {
    parts.push(`${o.failures.length} of ${o.feedsScanned} feeds failed: ${o.failures.map((f) => `${f.feed} (${f.message})`).join("; ")}. Last scan date not moved.`);
  }
  return parts.join(" ");
}
