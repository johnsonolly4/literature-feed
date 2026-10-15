// The Library map tab: reads the library's papers from OpenAlex (the price is shown first), proposes groups, and lets the user
// rename, merge, split and move papers and say which search each group is for. Read-only: nothing is written to Zotero here
// (making seed collections from the groups is a separate step). The groups are kept while the tab is open.
import { ItemView, Notice, type WorkspaceLeaf } from "obsidian";
import { COST_FILTER } from "../review/budget";
import { readCostUsd } from "../review/known";
import { createReportBar } from "../ui/report-bar";
import { createSection } from "../ui/section";
import { assignGroup, libraryPapers, mapLibrary, mergeGroups, movePaper, renameGroup, splitGroup, type LibraryMap, type MapGroup } from "./library-map";
import type { ImproveHost } from "./view";

export const LIBRARY_MAP_VIEW = "literature-feed-library-map";
// Capitalised words (DOI, Zotero) sit in a constant because the sentence-case lint rule reads literals only.
const EMPTY_INDEX = "No papers with a DOI in the Zotero index. Press Read Zotero library first.";

/** What the tab needs from the plugin (the Improve tab's host is enough). */
export type LibraryMapHost = Pick<ImproveHost, "app" | "settings" | "zoteroIndex" | "refreshZoteroIndex" | "newReviewClient" | "saveReviewCache" | "recordSpend">;

export class LibraryMapView extends ItemView {
  private map: LibraryMap | null = null;

  constructor(leaf: WorkspaceLeaf, private readonly host: LibraryMapHost) {
    super(leaf);
  }

  getViewType(): string {
    return LIBRARY_MAP_VIEW;
  }

  getDisplayText(): string {
    return "Library map";
  }

  getIcon(): string {
    return "map";
  }

  onOpen(): Promise<void> {
    this.contentEl.addClass("literature-feed-review");
    this.draw();
    return Promise.resolve();
  }

  private title(key: string): string {
    return this.host.zoteroIndex.items[key]?.title || key;
  }

  private set(next: LibraryMap): void {
    this.map = next;
    this.draw();
  }

  private draw(): void {
    const el = this.contentEl;
    el.empty();
    const lib = libraryPapers(this.host.zoteroIndex);
    createReportBar(el, ["Library map", `${lib.withDoi.length} papers with a DOI`], [
      { text: "Read Zotero library", onClick: () => this.refreshIndex() },
    ]);

    const read = createSection(el, { title: "Read the library", desc: "Reads each paper's references and authors from OpenAlex, then groups the papers that cite the same work or share authors.", app: this.host.app, storageKey: "map-read" });
    if (lib.withDoi.length === 0) {
      read.body.createEl("p", { cls: "literature-feed-meta", text: EMPTY_INDEX });
    }
    if (lib.withoutDoi.length > 0) read.body.createEl("p", { cls: "literature-feed-meta", text: `${lib.withoutDoi.length} papers have no DOI and are left out.` });
    const cost = readCostUsd(lib.withDoi.length);
    const button = read.body.createDiv({ cls: "literature-feed-buttons" }).createEl("button", { text: `Read ${lib.withDoi.length} papers (about $${cost.toFixed(4)})`, cls: "mod-cta" });
    button.disabled = lib.withDoi.length === 0;
    button.addEventListener("click", () => void this.readLibrary(button));

    const m = this.map;
    if (!m) return;
    if (m.status !== "ok") {
      read.body.createEl("p", { cls: "literature-feed-warning", text: m.status === "too-few" ? "Too few papers were found in OpenAlex to group." : "OpenAlex returned no references to group by." });
      return;
    }
    if (m.notFound.length > 0) {
      const d = read.body.createEl("details");
      d.createEl("summary", { text: `${m.notFound.length} papers OpenAlex had no record of` });
      for (const k of m.notFound) d.createDiv({ cls: "literature-feed-meta", text: this.title(k) });
    }

    const groups = createSection(el, { title: `Groups (${m.groups.length})`, desc: "Proposed from the links between the papers and named from the phrases they share. Nothing is written to Zotero from here.", app: this.host.app, storageKey: "map-groups" });
    if (m.groups.length === 0) groups.body.createEl("p", { cls: "literature-feed-meta", text: "No group of two or more linked papers was found." });
    m.groups.forEach((g) => this.drawGroup(groups.body, m, g));

    const out = createSection(el, { title: `Outliers (${m.outliers.length})`, desc: "Linked to almost none of the other papers, or alone in their group. Move one into a group if it belongs.", app: this.host.app, storageKey: "map-outliers" });
    if (m.outliers.length === 0) out.body.createEl("p", { cls: "literature-feed-meta", text: "None." });
    for (const k of m.outliers) this.drawPaper(out.body, m, k);
  }

  private drawGroup(parent: HTMLElement, m: LibraryMap, g: MapGroup): void {
    const box = parent.createDiv({ cls: "literature-feed-detailwork" });
    const head = box.createDiv({ cls: "literature-feed-buttons" });
    const name = head.createEl("input", { type: "text", value: g.name, attr: { "aria-label": "Group name" } });
    name.addEventListener("change", () => this.set(renameGroup(m, g.id, name.value)));
    box.createDiv({ cls: "literature-feed-meta", text: `${g.keys.length} papers${g.phrases.length > 0 ? `; shared phrases: ${g.phrases.join(", ")}` : ""}` });

    const row = box.createDiv({ cls: "literature-feed-buttons" });
    row.createSpan({ cls: "literature-feed-meta", text: "For search:" });
    const search = row.createEl("select", { attr: { "aria-label": "Search this group is for" } });
    search.createEl("option", { value: "", text: "None yet" });
    for (const f of this.host.settings.feeds) search.createEl("option", { value: f.id, text: f.name });
    search.value = g.feedId ?? "";
    search.addEventListener("change", () => this.set(assignGroup(m, g.id, search.value === "" ? null : search.value)));

    const others = m.groups.filter((o) => o.id !== g.id);
    if (others.length > 0) {
      const merge = row.createEl("select", { attr: { "aria-label": "Merge with" } });
      merge.createEl("option", { value: "", text: "Merge with…" });
      for (const o of others) merge.createEl("option", { value: o.id, text: o.name });
      merge.addEventListener("change", () => { if (merge.value !== "") this.set(mergeGroups(m, [g.id, merge.value])); });
    }

    const d = box.createEl("details");
    d.createEl("summary", { text: "Papers" });
    const ticked = new Set<string>();
    for (const k of g.keys) {
      const line = d.createDiv({ cls: "literature-feed-buttons" });
      line.createEl("input", { type: "checkbox", attr: { "aria-label": `Select ${this.title(k)}` } }).addEventListener("change", (e) => {
        if ((e.currentTarget as HTMLInputElement).checked) ticked.add(k); else ticked.delete(k);
      });
      line.createSpan({ text: this.title(k) });
      this.moveSelect(line, m, k, g.id);
    }
    if (g.keys.length > 1) {
      d.createEl("button", { text: "Split the ticked papers into a new group" }).addEventListener("click", () => {
        const next = splitGroup(m, g.id, [...ticked], "");
        if (next === m) new Notice("Tick some of this group's papers, but not all of them.");
        else this.set(next);
      });
    }
  }

  private drawPaper(parent: HTMLElement, m: LibraryMap, key: string): void {
    const line = parent.createDiv({ cls: "literature-feed-buttons" });
    line.createSpan({ text: this.title(key) });
    this.moveSelect(line, m, key, null);
  }

  /** A "Move to" list: the other groups, and the outliers when the paper is in a group. */
  private moveSelect(parent: HTMLElement, m: LibraryMap, key: string, current: string | null): void {
    const select = parent.createEl("select", { attr: { "aria-label": `Move ${this.title(key)}` } });
    select.createEl("option", { value: "", text: "Move to…" });
    for (const o of m.groups) if (o.id !== current) select.createEl("option", { value: o.id, text: o.name });
    if (current !== null) select.createEl("option", { value: "outliers", text: "Outliers" });
    select.addEventListener("change", () => { if (select.value !== "") this.set(movePaper(m, key, select.value === "outliers" ? null : select.value)); });
  }

  private refreshIndex(): void {
    this.host.refreshZoteroIndex().then(
      (message) => { new Notice(message); this.draw(); },
      (err: unknown) => { new Notice(`Could not read Zotero: ${err instanceof Error ? err.message : "unknown error"}`, 8000); },
    );
  }

  /** Reads the library's papers from OpenAlex (about $0.0001 per 50) and proposes the groups. */
  private async readLibrary(button: HTMLButtonElement): Promise<void> {
    const papers = libraryPapers(this.host.zoteroIndex).withDoi;
    button.disabled = true;
    try {
      const res = await this.host.newReviewClient().getWorksByDoi(papers.map((p) => p.doi));
      this.host.recordSpend(res.costUsd > 0 ? res.costUsd : COST_FILTER * Math.ceil(papers.length / 50));
      await this.host.saveReviewCache();
      this.set(mapLibrary(papers, res.papers));
    } catch (e) {
      new Notice(`Could not read the papers: ${e instanceof Error ? e.message : "unknown error"}`, 8000);
      button.disabled = false;
    }
  }

  onClose(): Promise<void> {
    this.contentEl.empty();
    return Promise.resolve();
  }
}
