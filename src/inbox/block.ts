// The `literature-feed` code block: a status line with buttons, in the inbox note itself or (show: home) as a small card
// for another note. Built with createEl only. It redraws when the note it reads is modified, so ticking a box updates it.
import { MarkdownRenderChild, TFile, type App, type MarkdownPostProcessorContext, type Plugin } from "obsidian";
import type { Settings } from "../settings/data";
import { describeCounts, describeFeedRow } from "./scan";
import { NOTE_NAME_PATTERN, parseInbox, waitingByFeed, waitingByTier, type ListedTier } from "./write";

export interface BlockHost {
  app: App;
  settings: Settings;
  scanNow(): Promise<void>;
  /** Called after every scan, so open blocks redraw even when the note itself did not change. */
  scanListeners: Set<() => void>;
}

class StatusBlock extends MarkdownRenderChild {
  constructor(el: HTMLElement, private readonly host: BlockHost, private readonly sourcePath: string, private readonly home: boolean) {
    super(el);
  }

  onload(): void {
    void this.render();
    const redraw = (): void => { void this.render(); };
    this.host.scanListeners.add(redraw);
    this.register(() => this.host.scanListeners.delete(redraw));
    this.registerEvent(this.host.app.vault.on("modify", (file) => {
      if (file instanceof TFile && NOTE_NAME_PATTERN.test(file.name)) void this.render();
    }));
  }

  /** The note to read: this note, or for a home card the latest inbox note in the inbox folder. */
  private findNote(): TFile | null {
    const { vault } = this.host.app;
    if (!this.home) return vault.getFileByPath(this.sourcePath);
    const folder = this.host.settings.inboxFolder === "" ? vault.getRoot() : vault.getFolderByPath(this.host.settings.inboxFolder);
    const notes = (folder?.children ?? []).filter((f): f is TFile => f instanceof TFile && NOTE_NAME_PATTERN.test(f.name));
    notes.sort((a, b) => b.name.localeCompare(a.name));
    return notes[0] ?? null;
  }

  private async render(): Promise<void> {
    const note = this.findNote();
    const parsed = note ? parseInbox(await this.host.app.vault.cachedRead(note)) : null;
    const waiting = waitingByTier(parsed?.papers ?? []);
    const total = waiting.priority + waiting.strong + waiting.possible + waiting.unchecked;

    const el = this.containerEl;
    el.empty();
    const box = el.createDiv({ cls: this.home ? "literature-feed-card" : "literature-feed-status" });
    const last = this.host.settings.lastScan || "never";
    if (this.home) box.createDiv({ cls: "literature-feed-card-title", text: "Reading inbox" });
    box.createDiv({
      cls: "literature-feed-status-line",
      text: parsed
        ? `${total} waiting: ${waiting.priority} priority, ${waiting.strong} strong, ${waiting.possible} possible, ${waiting.unchecked} without abstract. Last scan: ${last}.`
        : `No inbox note yet. Last scan: ${last}.`,
    });

    const result = this.host.settings.lastScanResult;
    if (result) box.createDiv({ cls: "literature-feed-status-line", text: describeCounts(result) });

    // With more than one feed, a row per feed. Feeds that are switched on, plus any feed the note still lists.
    const enabled = this.host.settings.feeds.filter((f) => f.enabled);
    if (parsed && enabled.length > 1) {
      const perFeed = waitingByFeed(parsed.papers);
      const names = new Map(this.host.settings.feeds.map((f) => [f.id, f.name]));
      const ids = [...new Set([...enabled.map((f) => f.id), ...Object.keys(perFeed)])];
      const empty: Record<ListedTier, number> = { priority: 0, strong: 0, possible: 0, unchecked: 0 };
      const list = box.createEl("ul", { cls: "literature-feed-feed-rows" });
      for (const id of ids) {
        const last = result?.feeds.find((f) => f.id === id);
        list.createEl("li", { text: describeFeedRow(names.get(id) ?? last?.name ?? id, perFeed[id] ?? empty, last) });
      }
    }

    const buttons = box.createDiv({ cls: "literature-feed-buttons" });
    const scan = buttons.createEl("button", { text: "Scan now" });
    scan.addEventListener("click", () => {
      scan.disabled = true;
      void this.host.scanNow().finally(() => { scan.disabled = false; });
    });
    const sync = buttons.createEl("button", { text: "Sync", attr: { title: "The Zotero sync is not built yet." } });
    sync.disabled = true;
    if (this.home && note) {
      const open = buttons.createEl("button", { text: "Open inbox" });
      open.addEventListener("click", () => { void this.host.app.workspace.openLinkText(note.path, "", false); });
    }
  }
}

export function registerInboxBlock(plugin: Plugin & BlockHost): void {
  plugin.registerMarkdownCodeBlockProcessor("literature-feed", (source: string, el: HTMLElement, ctx: MarkdownPostProcessorContext) => {
    const home = /^\s*show:\s*home\s*$/m.test(source);
    ctx.addChild(new StatusBlock(el, plugin, ctx.sourcePath, home));
  });
}
