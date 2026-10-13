// The `literature-feed` code block: in the inbox note it shows a status line with buttons and the table of papers (status
// chips, order, filter); with `show: home` it is a small card for another note. Built with createEl only. It redraws when
// the note it reads, or a literature note, is modified, so ticking a box updates it. The checkbox lines in the note are
// the stored data: the table reads them, and ticking in the table edits the matching line.
import { MarkdownRenderChild, TFile, type App, type MarkdownPostProcessorContext, type Plugin } from "obsidian";
import type { Settings } from "../settings/data";
import { describeCounts, describeFeedRow, localDay } from "./scan";
import {
  DEFAULT_SORT, STATUS_LABEL, TIER_LABEL, agesOutSoon, countsByStatus, filterRows, makeRows, orderRows, takeawayFilled,
  type FilterKey, type SortKey, type SortSetting,
} from "./table";
import { NOTE_NAME_PATTERN, doiUrl, parseInbox, waitingByFeed, waitingByTier, type ListedTier, type ParsedPaper } from "./write";

export interface BlockHost {
  app: App;
  settings: Settings;
  scanNow(): Promise<void>;
  syncNow(): Promise<void>;
  /** Sets the tick of one paper's line in the note (the table's checkbox). */
  toggleTick(path: string, feedId: string, openalexId: string, ticked: boolean): Promise<void>;
  /** Called after every scan, so open blocks redraw even when the note itself did not change. */
  scanListeners: Set<() => void>;
}

const VIEW_KEY = "literature-feed-view";
const FILTERS: FilterKey[] = ["all", "in-zotero", "ticked", "new", "read", "processed"];
const SORTABLE: { key: SortKey; label: string }[] = [
  { key: "status", label: "Status" }, { key: "paper", label: "Paper" }, { key: "tier", label: "Tier" }, { key: "year", label: "Year" },
];

class StatusBlock extends MarkdownRenderChild {
  private filter: FilterKey = "all";
  private sort: SortSetting = DEFAULT_SORT;

  constructor(el: HTMLElement, private readonly host: BlockHost, private readonly sourcePath: string, private readonly home: boolean) {
    super(el);
    this.loadView();
  }

  onload(): void {
    void this.render();
    const redraw = (): void => { void this.render(); };
    this.host.scanListeners.add(redraw);
    this.register(() => this.host.scanListeners.delete(redraw));
    this.registerEvent(this.host.app.vault.on("modify", (file) => {
      if (!(file instanceof TFile)) return;
      const folder = this.host.settings.literatureFolder;
      if (NOTE_NAME_PATTERN.test(file.name) || (folder !== "" && file.path.startsWith(`${folder}/`))) void this.render();
    }));
  }

  /** Sort and filter are kept per vault in Obsidian's local storage (a convenience, not part of the plugin's settings). */
  private loadView(): void {
    try {
      const saved: unknown = this.host.app.loadLocalStorage(VIEW_KEY);
      if (typeof saved !== "object" || saved === null) return;
      const { filter, sort } = saved as { filter?: unknown; sort?: { by?: unknown; desc?: unknown } };
      if (typeof filter === "string" && (FILTERS as string[]).includes(filter)) this.filter = filter as FilterKey;
      if (sort && typeof sort.by === "string" && SORTABLE.some((s) => s.key === sort.by)) this.sort = { by: sort.by as SortKey, desc: sort.desc === true };
    } catch {
      // No saved view: the default order is used.
    }
  }

  private saveView(): void {
    try {
      this.host.app.saveLocalStorage(VIEW_KEY, { filter: this.filter, sort: this.sort });
    } catch {
      // The view just is not remembered.
    }
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
    const processed = !this.home && note && parsed ? await this.processedPapers(parsed.papers, note.path) : new Set<string>();
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
        const lastFeed = result?.feeds.find((f) => f.id === id);
        list.createEl("li", { text: describeFeedRow(names.get(id) ?? lastFeed?.name ?? id, perFeed[id] ?? empty, lastFeed) });
      }
    }

    const buttons = box.createDiv({ cls: "literature-feed-buttons" });
    const scan = buttons.createEl("button", { text: "Scan now" });
    scan.addEventListener("click", () => {
      scan.disabled = true;
      void this.host.scanNow().finally(() => { scan.disabled = false; });
    });
    const sync = buttons.createEl("button", { text: "Sync", attr: { title: "Send the ticked papers to Zotero" } });
    sync.addEventListener("click", () => {
      sync.disabled = true;
      void this.host.syncNow().finally(() => { sync.disabled = false; });
    });
    if (this.home && note) {
      const open = buttons.createEl("button", { text: "Open inbox" });
      open.addEventListener("click", () => { void this.host.app.workspace.openLinkText(note.path, "", false); });
    }

    if (!this.home && note && parsed && parsed.papers.length > 0) this.renderTable(el, parsed.papers, processed, note);
  }

  /** Papers whose literature note has its takeaway filled in ("feedId|openalexId"). */
  private async processedPapers(papers: readonly ParsedPaper[], sourcePath: string): Promise<Set<string>> {
    const out = new Set<string>();
    for (const p of papers) {
      if (!p.read || !p.readLink) continue;
      const file = this.host.app.metadataCache.getFirstLinkpathDest(p.readLink, sourcePath);
      if (file && takeawayFilled(await this.host.app.vault.cachedRead(file))) out.add(`${p.feedId}|${p.openalexId}`);
    }
    return out;
  }

  private renderTable(el: HTMLElement, papers: readonly ParsedPaper[], processed: ReadonlySet<string>, note: TFile): void {
    const rows = makeRows(papers, processed);
    const counts = countsByStatus(rows);
    const names = new Map(this.host.settings.feeds.map((f) => [f.id, f.name]));
    const today = localDay(new Date());
    const wrap = el.createDiv({ cls: "literature-feed-list" });

    const chips = wrap.createDiv({ cls: "literature-feed-filters" });
    for (const key of FILTERS) {
      const label = key === "all" ? "All" : key === "in-zotero" ? "To read" : STATUS_LABEL[key];
      const chip = chips.createEl("button", { cls: `literature-feed-filter${key === "all" ? "" : ` is-${key}`}${this.filter === key ? " is-active" : ""}`, text: `${label} ${counts[key]}` });
      chip.addEventListener("click", () => {
        this.filter = key;
        this.saveView();
        void this.render();
      });
    }

    const table = wrap.createEl("table", { cls: "literature-feed-papers" });
    const head = table.createEl("thead").createEl("tr");
    head.createEl("th");
    for (const { key, label } of SORTABLE) {
      const active = this.sort.by === key;
      const th = head.createEl("th", { cls: active ? "is-sorted" : "" });
      const button = th.createEl("button", { cls: "literature-feed-sort", text: `${label}${active ? (this.sort.desc ? " ▼" : " ▲") : ""}` });
      button.addEventListener("click", () => {
        this.sort = { by: key, desc: active ? !this.sort.desc : false };
        this.saveView();
        void this.render();
      });
    }
    head.createEl("th", { text: "Links" });

    const body = table.createEl("tbody");
    const shown = orderRows(filterRows(rows, this.filter), this.sort);
    if (shown.length === 0) body.createEl("tr").createEl("td", { attr: { colspan: "6" }, cls: "literature-feed-empty", text: "No papers in this view." });
    for (const { paper, status } of shown) {
      const tr = body.createEl("tr");
      const tick = tr.createEl("td").createEl("input", { type: "checkbox" });
      tick.checked = paper.ticked;
      tick.addEventListener("change", () => { void this.host.toggleTick(note.path, paper.feedId, paper.openalexId, tick.checked); });

      const chip = tr.createEl("td").createSpan({ cls: `literature-feed-chip is-${status}`, text: STATUS_LABEL[status] });
      if (agesOutSoon(status, note.name, today, this.host.settings.dismissAfterWeeks)) {
        chip.addClass("is-soon");
        chip.setAttribute("title", "Counts as done by age within a week");
      }

      const cell = tr.createEl("td");
      cell.createDiv({ cls: "literature-feed-title", text: paper.title });
      const meta = [paper.authors, paper.venue, paper.year === null ? "" : String(paper.year), paper.preprint ? "preprint" : "", paper.titleOnly ? "title only" : ""].filter((m) => m !== "");
      if (meta.length > 0) cell.createDiv({ cls: "literature-feed-meta", text: meta.join(" · ") });

      tr.createEl("td", { text: TIER_LABEL[paper.tier] });

      const links = tr.createEl("td", { cls: "literature-feed-links" });
      const doi = doiUrl(paper.doi);
      if (doi) this.externalLink(links, "DOI", doi);
      if (paper.key) this.externalLink(links, "Zotero", `zotero://select/library/items/${paper.key}`);
      if (paper.readLink) {
        const read = links.createEl("a", { text: "Read", href: "#" });
        const target = paper.readLink;
        read.addEventListener("click", (e) => {
          e.preventDefault();
          void this.host.app.workspace.openLinkText(target, note.path, false);
        });
      }
      const found = [names.get(paper.feedId) ?? paper.feedId, paper.topics.length > 0 ? `topic${paper.topics.length === 1 ? "" : "s"} ${paper.topics.join(", ")}` : ""].filter((m) => m !== "");
      links.createDiv({ cls: "literature-feed-meta", text: found.join(" · ") });
    }
  }

  private externalLink(parent: HTMLElement, text: string, href: string): void {
    const a = parent.createEl("a", { text, href, cls: "external-link" });
    a.addEventListener("click", (e) => {
      e.preventDefault();
      window.open(href);
    });
  }
}

export function registerInboxBlock(plugin: Plugin & BlockHost): void {
  plugin.registerMarkdownCodeBlockProcessor("literature-feed", (source: string, el: HTMLElement, ctx: MarkdownPostProcessorContext) => {
    const home = /^\s*show:\s*home\s*$/m.test(source);
    ctx.addChild(new StatusBlock(el, plugin, ctx.sourcePath, home));
  });
}
