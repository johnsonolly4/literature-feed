// The citation-gaps tool: for one paper, what many of its references cite and it does not. The paper is given as a DOI or OpenAlex id,
// picked from the Zotero library (the local index), or replaced by a pasted reference list. The cost is shown before anything is
// requested, and the last run is kept so closing the tab loses nothing. Nothing is sent but the OpenAlex requests the user starts.
import { Notice, Setting, type App } from "obsidian";
import { doiUrl, shortOpenAlexId } from "../inbox/write";
import type { Settings } from "../settings/data";
import type { ZoteroIndex } from "../zotero/library-index";
import { Budget } from "./budget";
import type { ReviewCache } from "./cache";
import { flagsFor, type FlagSources, type Flags } from "./flags";
import { RefsPanel, normaliseRefsSession, type RefsSession } from "../refs/panel";
import type { ReferenceSearcher } from "../refs/resolve";
import { authorsShort } from "./authors-text";
import { authorIdFor, authorShares, authorTableCsv, couldHaveBeenCited, worksBy, type AuthorRow, type WorkRef } from "./gaps-authors";
import { googleUrl, scholarUrl, searchQuery } from "./search-links";
import { findAuthorWork, runGaps, toWorkRef, type AuthorWorkResult, type GapsClient, type GapsRun } from "./gaps-fetch";
import { renderGapsNote } from "./gaps-note";
import {
  MAX_TITLE_SEARCHES, emptyGapsSession, estimateGaps, parseDoiList, parseReferenceList, parseWorkInput, searchZoteroIndex, type GapInput, type GapsMode, type GapsSession,
} from "./gaps-input";

/** What the tool needs from the plugin. */
export interface GapsHost {
  app: App;
  settings: Settings;
  newReviewClient(): GapsClient;
  newCrossrefClient(): ReferenceSearcher;
  reviewCache: ReviewCache;
  saveReviewCache(): Promise<void>;
  zoteroIndex: ZoteroIndex;
  refreshZoteroIndex(): Promise<string>;
  flagSources(): FlagSources;
  reviewFolder(): string;
  createReviewNote(path: string, text: string, open?: boolean): Promise<string>;
  gapsSession: GapsSession | null;
  saveGapsSession(session: GapsSession): void;
}

/** Kept as constants: they hold capitalised words, which the sentence-case lint rule reads only in literals. */
const EXTRA_NAME = "Add references by DOI";
const COPIED_CSV = "Copied as CSV (opens in Excel).";
const SEARCH_UNFOUND_NAME = "Also search the ones not found in OpenAlex";
const PRESS_TIDY = "Press Tidy and find DOIs first: it finds DOIs for free. Searching lines without a DOI in OpenAlex costs $0.001 each (switch that on below).";

const MODES: Record<GapsMode, string> = { paper: "A paper (DOI or OpenAlex id)", zotero: "A paper from my Zotero library", paste: "A pasted reference list" };

function usd(n: number): string {
  return `$${n.toFixed(4)}`;
}

function today(): string {
  const d = new Date();
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export class GapsPanel {
  private s: GapsSession;
  private estimate: { input: GapInput; text: string; over: boolean } | null = null;
  private out!: HTMLElement;
  private saveTimer: number | null = null;
  private refsPanel: RefsPanel | null = null;
  /** What "find their other work" found, by author key (kept while the tab is open). */
  private authorFinds = new Map<string, AuthorWorkResult>();

  constructor(private readonly host: GapsHost, private readonly root: HTMLElement) {
    this.s = host.gapsSession ?? emptyGapsSession();
  }

  mount(): void {
    this.render();
    const last = this.s.last;
    if (last) this.renderRun(last.run, last.input, last.ranAt);
  }

  flush(): void {
    this.refsPanel?.flush();
    if (this.saveTimer !== null) window.clearTimeout(this.saveTimer);
    this.saveTimer = null;
    this.host.saveGapsSession(this.s);
  }

  private saveSoon(): void {
    if (this.saveTimer !== null) window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => { this.saveTimer = null; this.host.saveGapsSession(this.s); }, 1000);
  }

  private render(): void {
    const el = this.root;
    el.empty();
    el.createEl("p", {
      cls: "setting-item-description",
      text: "For one paper, finds the works that many of its own references cite but that it does not cite itself: papers it may have missed. Shows what it costs before it asks anything. A paper's own record is free; looking up its references costs about $0.0003.",
    });
    new Setting(el).setName("Start from").addDropdown((d) => {
      for (const [k, label] of Object.entries(MODES)) d.addOption(k, label);
      d.setValue(this.s.mode).onChange((v) => { this.s.mode = v as GapsMode; this.estimate = null; this.render(); this.saveSoon(); });
    });
    if (this.s.mode === "paper") {
      new Setting(el).setName("Paper identifier").setDesc("A DOI, a doi.org link, an OpenAlex id (W…) or an openalex.org link. A title also works, and costs one search ($0.001). You can also search your Zotero library by title or DOI (next option).")
        .addText((t) => t.setPlaceholder("10.1021/jacs.3c08248").setValue(this.s.paperText).onChange((v) => { this.s.paperText = v; this.estimate = null; this.saveSoon(); }));
    } else if (this.s.mode === "zotero") {
      this.renderZotero(el);
    } else {
      el.createEl("p", { cls: "setting-item-description", text: "Paste the references of a paper as they came out of the PDF. Press the button to split them and find their DOIs for free; then only the ticked ones are looked up in OpenAlex, about $0.0001 for 50." });
      this.refsPanel = new RefsPanel(
        this.host, el.createDiv(), normaliseRefsSession(this.s.refs),
        (s: RefsSession) => { this.s.refs = s as unknown as Record<string, unknown>; this.saveSoon(); },
        () => { this.estimate = null; },
      );
      this.refsPanel.mount();
      new Setting(el).setName(SEARCH_UNFOUND_NAME).setDesc(`References no DOI was found for are searched in OpenAlex by their text: about $0.001 each, at most ${MAX_TITLE_SEARCHES}. Off by default; most are better looked at by hand.`)
        .addToggle((t) => t.setValue(this.s.searchUnfound).onChange((v) => { this.s.searchUnfound = v; this.estimate = null; this.saveSoon(); }));
    }
    new Setting(el).setName(EXTRA_NAME).setDesc("DOIs of works this paper cites that OpenAlex or the pasted list left out. They count as cited, so they are not suggested as gaps, and their own references are read too. Paste any text: the DOIs are picked out. About $0.0001 for 50.")
      .addTextArea((t) => {
        t.inputEl.rows = 3;
        t.setPlaceholder("10.1021/…").setValue(this.s.extraDois).onChange((v) => { this.s.extraDois = v; this.estimate = null; this.saveSoon(); });
      });
    new Setting(el).setName("Count as a gap when cited by at least").setDesc("This many of the paper's references must cite the work (3 is a good start; 2 finds more, with more noise).")
      .addText((t) => {
        t.inputEl.type = "number";
        t.setValue(String(this.s.minCount)).onChange((v) => {
          const n = Math.floor(Number(v));
          this.s.minCount = Number.isFinite(n) ? Math.min(10, Math.max(2, n)) : 3;
          this.saveSoon();
        });
      });
    new Setting(el).setName("Go a second level").setDesc("Also reads the works that several of the references cite (up to 300) and lists what many of those cite: the foundations under the foundations. Adds about $0.0007.")
      .addToggle((t) => t.setValue(this.s.deeper).onChange((v) => { this.s.deeper = v; this.estimate = null; this.saveSoon(); }));
    new Setting(el).setName("Second level: cited by at least").setDesc("How many of those shared works must cite a work for it to be listed (5 is a good start; lower finds more, with more noise).")
      .addText((t) => {
        t.inputEl.type = "number";
        t.setValue(String(this.s.deeperMin)).onChange((v) => {
          const n = Math.floor(Number(v));
          this.s.deeperMin = Number.isFinite(n) ? Math.min(20, Math.max(2, n)) : 5;
          this.saveSoon();
        });
      });
    new Setting(el).addButton((b) => b.setButtonText("Estimate the cost").setCta().onClick(() => this.doEstimate()));
    this.out = el.createDiv();
  }

  private renderZotero(el: HTMLElement): void {
    const count = Object.keys(this.host.zoteroIndex.items).length;
    new Setting(el).setName("Your Zotero library")
      .setDesc(count === 0 ? "Not read yet. Read it once (read-only; it stays on this device)." : `${count} items in the local index.`)
      .addButton((b) => b.setButtonText(count === 0 ? "Read my library" : "Refresh").onClick(() => {
        b.setDisabled(true);
        this.host.refreshZoteroIndex().then(
          (m) => { new Notice(m); this.render(); },
          (e: unknown) => { new Notice(`Could not read Zotero: ${e instanceof Error ? e.message : "unknown error"}`, 8000); b.setDisabled(false); },
        );
      }));
    const list = el.createDiv({ cls: "literature-feed-gaps-picks" });
    const draw = (): void => {
      list.empty();
      const hits = searchZoteroIndex(this.host.zoteroIndex, this.s.zoteroQuery);
      if (this.s.zoteroQuery.trim() !== "" && hits.length === 0) list.createEl("p", { cls: "literature-feed-meta", text: "Nothing in your library matches." });
      for (const h of hits) {
        const row = list.createDiv({ cls: `literature-feed-suggestion${h.key === this.s.zoteroPick ? " is-picked" : ""}` });
        row.createDiv({ cls: "literature-feed-title", text: h.title });
        row.createDiv({ cls: "literature-feed-meta", text: h.doi === "" ? "no DOI: it will be found by its title (one search, $0.001)" : h.doi });
        row.addEventListener("click", () => { this.s.zoteroPick = h.key; this.estimate = null; this.saveSoon(); draw(); });
      }
      const picked = this.s.zoteroPick ? this.host.zoteroIndex.items[this.s.zoteroPick] : undefined;
      if (picked && !hits.some((h) => h.key === this.s.zoteroPick)) list.createEl("p", { cls: "literature-feed-meta", text: `Picked: ${picked.title}` });
    };
    new Setting(el).setName("Search your library").addText((t) => t.setValue(this.s.zoteroQuery).onChange((v) => { this.s.zoteroQuery = v; draw(); this.saveSoon(); }));
    draw();
  }

  /** The input the user has given, or null (with a message) when there is none. */
  private input(): GapInput | null {
    if (this.s.mode === "paper") {
      const text = this.s.paperText.trim();
      const w = parseWorkInput(text);
      if (w) return { kind: "work", doi: w.doi, id: w.id };
      if (text.length >= 15) return { kind: "title", title: text };
      new Notice("Enter a paper identifier or a title.");
      return null;
    }
    if (this.s.mode === "zotero") {
      const item = this.s.zoteroPick ? this.host.zoteroIndex.items[this.s.zoteroPick] : undefined;
      if (!item) {
        new Notice("Pick an item from your library first.");
        return null;
      }
      return item.doi !== "" ? { kind: "work", doi: item.doi, id: null } : { kind: "title", title: item.title };
    }
    const sel = this.refsPanel?.selection();
    if (sel?.looked) {
      const lines = this.s.searchUnfound ? sel.unfound.slice(0, MAX_TITLE_SEARCHES) : [];
      if (sel.dois.length + lines.length === 0) {
        new Notice("No reference is ticked. Tick the ones to use, or type the identifier of one that was not found.");
        return null;
      }
      return { kind: "references", dois: [...new Set([...sel.dois, ...parseDoiList(this.s.extraDois)])], lines };
    }
    // Not looked up yet: DOIs in the text are used; lines without one need the look-up first (it is free), or a paid search.
    const r = parseReferenceList(this.refsPanel?.currentText() ?? this.s.pasted);
    if (r.dois.length + r.lines.length === 0) {
      new Notice("Paste some references first.");
      return null;
    }
    if (r.lines.length > 0 && !this.s.searchUnfound) {
      new Notice(PRESS_TIDY);
      return null;
    }
    return { kind: "references", dois: [...new Set([...r.dois, ...parseDoiList(this.s.extraDois)])], lines: this.s.searchUnfound ? r.lines : [] };
  }

  private doEstimate(): void {
    const input = this.input();
    if (input === null) return;
    const e = estimateGaps(input, this.s.deeper, input.kind === "references" ? 0 : parseDoiList(this.s.extraDois).length);
    const limit = this.host.settings.reviewBudgetUsd;
    const over = e.usd > limit + 1e-9;
    const parts = [e.free > 0 ? `${e.free} free record` : "", e.filtered > 0 ? `up to ${e.filtered} lookups` : "", e.searches > 0 ? `${e.searches} search${e.searches === 1 ? "" : "es"}` : ""].filter((p) => p !== "");
    const text = `${parts.join(", ")}: about ${usd(e.usd)} at most (the limit is ${usd(limit)}, Settings → Literature review).${e.skippedLines > 0 ? ` ${e.skippedLines} references without a DOI are over the limit of ${MAX_TITLE_SEARCHES} searches and will be left out.` : ""}`;
    this.estimate = { input, text, over };
    this.out.empty();
    this.out.createEl("p", { text });
    if (over) this.out.createEl("p", { cls: "literature-feed-warning", text: "That is over your limit. Paste fewer references, or raise the limit in the settings." });
    new Setting(this.out).addButton((b) => { b.setButtonText(`Find the gaps (${usd(e.usd)})`).setCta().onClick(() => void this.run(input)); b.setDisabled(over); });
  }

  private async run(input: GapInput): Promise<void> {
    this.out.empty();
    this.out.createEl("p", { text: "Looking up…" });
    const budget = new Budget(this.host.settings.reviewBudgetUsd);
    let run: GapsRun;
    try {
      run = await runGaps(input, { client: this.host.newReviewClient(), cache: this.host.reviewCache, now: Date.now(), budget }, this.s.minCount, this.s.deeper ? this.s.deeperMin : null, input.kind === "references" ? [] : parseDoiList(this.s.extraDois));
    } catch (e) {
      this.out.empty();
      this.out.createEl("p", { cls: "literature-feed-warning", text: `The lookup failed: ${e instanceof Error ? e.message : "unknown error"}` });
      return;
    }
    await this.host.saveReviewCache();
    const ranAt = new Date().toISOString();
    this.s.last = { input, run, ranAt };
    this.flush();
    this.renderRun(run, input, ranAt);
  }

  private flagsOf(list: GapsRun["gaps"]): Flags[] {
    const sources = this.host.flagSources();
    return list.map((g) => flagsFor({ id: g.paper ? shortOpenAlexId(g.paper.openalexId) ?? g.gap.id : g.gap.id, doi: g.paper?.doi ?? null, title: g.paper?.title ?? "" }, sources));
  }

  /** One work as a row: the title (a link to its DOI, else a web search), the authors, and what is known. */
  private workRow(parent: HTMLElement, w: { title: string; doi: string | null; authors: string[]; year: number | null; citedBy: number | null }, info: string, f?: Flags): void {
    const row = parent.createDiv({ cls: "literature-feed-suggestion" });
    const query = searchQuery(w.title);
    const url = doiUrl(w.doi);
    row.createDiv({ cls: "literature-feed-title" }).createEl("a", { cls: "external-link", text: w.title, href: url ?? googleUrl(query), attr: { target: "_blank", rel: "noopener" } });
    const who = authorsShort(w.authors);
    if (who !== "") row.createDiv({ cls: "literature-feed-meta", text: who });
    row.createDiv({ cls: "literature-feed-meta", text: [w.year ? String(w.year) : "", info, w.citedBy !== null ? `${w.citedBy} citations` : "", f?.zotero ? "in Zotero" : "", f?.vault ? "in the vault" : ""].filter((t) => t !== "").join(" \u00b7 ") });
    const links = row.createDiv({ cls: "literature-feed-meta literature-feed-ref-links" });
    links.createEl("a", { cls: "external-link", text: "Google", href: googleUrl(query), attr: { target: "_blank", rel: "noopener" } });
    links.createEl("a", { cls: "external-link", text: "Scholar", href: scholarUrl(query), attr: { target: "_blank", rel: "noopener" } });
  }

  /** A list of gaps, the first `shown` of them, with how many there are and buttons for more. */
  private drawList(container: HTMLElement, items: GapsRun["gaps"], flags: Flags[], shown: number, line: (x: GapsRun["gaps"][number]) => string, more: (n: number) => void): void {
    container.empty();
    items.slice(0, shown).forEach((x, i) => {
      const p = x.paper;
      this.workRow(container, { title: p ? p.title : x.gap.id, doi: p?.doi ?? null, authors: p?.authors ?? [], year: p?.year ?? null, citedBy: p?.citedByCount ?? null }, line(x), flags[i]);
    });
    if (items.length > shown) {
      container.createEl("p", { cls: "literature-feed-meta", text: `Showing ${Math.min(shown, items.length)} of ${items.length}.` });
      new Setting(container)
        .addButton((b) => b.setButtonText("Show 15 more").onClick(() => more(shown + 15)))
        .addButton((b) => b.setButtonText("Show all").onClick(() => more(items.length)));
    } else if (items.length > 15) {
      container.createEl("p", { cls: "literature-feed-meta", text: `All ${items.length} shown.` });
    }
  }

  private renderRun(run: GapsRun, input: GapInput, ranAt: string): void {
    this.out.empty();
    const out = this.out;
    if (run.subject) out.createEl("h4", { text: `${run.subject.title}${run.subject.year ? ` (${run.subject.year})` : ""}` });
    out.createEl("p", { text: `Read ${run.referencesRead} references (${run.referencesWithLists} with a reference list of their own). Spent about ${usd(run.spentUsd)}.` });
    if (run.message) out.createEl("p", { cls: "literature-feed-warning", text: run.message });
    if (run.stopped) out.createEl("p", { cls: "literature-feed-warning", text: `The lookup ${run.stopped}.` });
    const flags = this.flagsOf(run.gaps);
    if (run.gaps.length === 0 && !run.message) out.createEl("p", { text: `No work is cited by ${this.s.minCount} or more of these references without also being cited by the paper.` });
    const list = out.createDiv();
    const draw = (shown: number): void => this.drawList(list, run.gaps, flags, shown, (x) => `cited by ${x.gap.count} of the references (${Math.round(x.gap.share * 100)}%)`, draw);
    draw(15);
    const deeper = run.deeper;
    const deeperFlags = deeper ? this.flagsOf(deeper.gaps) : [];
    if (deeper) {
      out.createEl("h4", { text: "Deeper: what the shared works rest on" });
      out.createEl("p", { cls: "literature-feed-meta", text: `Read ${deeper.hubsRead} works that several of the references cite (${deeper.hubsWithLists} with a reference list). These are cited by at least ${deeper.minCount} of them, and are neither the paper, its references nor those shared works.` });
      if (deeper.gaps.length === 0) out.createEl("p", { text: "Nothing is cited by that many of them. Try a lower number." });
      const deepList = out.createDiv();
      const drawDeep = (shown: number): void => this.drawList(deepList, deeper.gaps, deeperFlags, shown, (x) => `cited by ${x.gap.count} of ${deeper.hubsRead} shared works`, drawDeep);
      drawDeep(15);
    }
    this.renderAuthors(out, run);
    if (run.unresolved.length > 0) {
      const details = out.createEl("details");
      details.createEl("summary", { text: `${run.unresolved.length} reference${run.unresolved.length === 1 ? "" : "s"} not found in OpenAlex` });
      const ul = details.createEl("ul");
      for (const u of run.unresolved) ul.createEl("li", { text: u });
    }
    new Setting(out).addButton((b) => b.setButtonText("Create gaps note").onClick(() => void this.createNote(run, input, ranAt, flags, deeperFlags)));
  }

  /** Authors on the cited and on the uncited works, as shares of each, so over- and under-represented ones stand out. */
  private renderAuthors(out: HTMLElement, run: GapsRun): void {
    if (run.citedAuthors.length === 0 || run.gaps.length === 0) return;
    out.createEl("h4", { text: "Authors: cited and not cited" });
    out.createEl("p", { cls: "literature-feed-meta", text: "For each author, the share of the paper's references they appear on, and the share of the gaps (works its references cite that it does not). An author with a bigger share of the gaps than of the references may be under-cited by this paper; the reverse (starred: the paper's own authors) may be over-cited. Click an author to see their papers the paper cites and does not cite, and to look for their other work on the same ground. Authors are matched by family name and first initial, so two people who share both are counted as one." });
    const lists = (items: GapsRun["gaps"]): string[][] => items.flatMap((g) => (g.paper ? [g.paper.authors] : []));
    const works = (items: GapsRun["gaps"]): WorkRef[] => items.flatMap((g) => (g.paper ? [toWorkRef(g.paper)] : []));
    let which: "first" | "second" | "both" = "first";
    let min = 2;
    let shown = 25;
    let find = "";
    let selected: string | null = null;
    const bar = out.createDiv({ cls: "literature-feed-chip-row" });
    const holder = out.createDiv();
    const draw = (): void => {
      holder.empty();
      const secondGaps = run.deeper?.gaps ?? [];
      const uncitedGaps = which === "first" ? run.gaps : which === "second" ? secondGaps : [...run.gaps, ...secondGaps];
      const table = authorShares(run.citedAuthors, lists(uncitedGaps), { min, own: run.subject?.authors ?? [] });
      const rows = find.trim() === "" ? table.rows : table.rows.filter((r) => r.name.toLowerCase().includes(find.trim().toLowerCase()));
      holder.createEl("p", { text: `Shares are of the ${table.citedWorks} cited works and the ${table.uncitedWorks} uncited works that have an author list.` });
      if (rows.length === 0) {
        holder.createEl("p", { text: table.rows.length === 0 ? "No author is on enough works to compare. Try a lower minimum." : "No author matches that search." });
      } else {
        const t = holder.createEl("table", { cls: "literature-feed-papers literature-feed-authors" });
        const head = t.createEl("tr");
        for (const h of ["Author", "Cited", "% of cited", "Uncited", "% of uncited", "Difference", ""]) head.createEl("th", { text: h });
        for (const r of rows.slice(0, shown)) {
          const tr = t.createEl("tr", { cls: r.key === selected ? "is-selected" : "" });
          tr.createEl("td", { text: `${r.own ? "\u2605 " : ""}${r.name}` });
          tr.createEl("td", { text: String(r.cited) });
          tr.createEl("td", { text: `${r.citedPct.toFixed(r.citedPct > 0 && r.citedPct < 10 ? 1 : 0)}%` });
          tr.createEl("td", { text: String(r.uncited) });
          tr.createEl("td", { text: `${r.uncitedPct.toFixed(r.uncitedPct > 0 && r.uncitedPct < 10 ? 1 : 0)}%` });
          tr.createEl("td", { text: `${r.diff >= 0 ? "+" : "\u2212"}${Math.abs(r.diff).toFixed(0)} points` });
          const label = tr.createEl("td");
          if (r.label !== "") label.createSpan({ cls: `literature-feed-status ${r.label === "Under-cited" ? "status-check" : "status-over"}`, text: r.label });
          tr.addEventListener("click", () => { selected = r.key === selected ? null : r.key; draw(); });
        }
      }
      const buttons = new Setting(holder);
      if (rows.length > shown) buttons.addButton((b) => b.setButtonText(`Show all ${rows.length}`).onClick(() => { shown = rows.length; draw(); }));
      buttons.addButton((b) => b.setButtonText("Copy as CSV").onClick(() => { void navigator.clipboard.writeText(authorTableCsv(table)).then(() => new Notice(COPIED_CSV)); }));
      const picked = selected === null ? undefined : table.rows.find((r) => r.key === selected);
      if (picked) this.drawAuthorPanel(holder.createDiv({ cls: "literature-feed-suggestion" }), picked, run, works(uncitedGaps));
    };
    if (run.deeper) {
      const chips = new Map<"first" | "second" | "both", HTMLElement>();
      for (const [key, label] of [["first", "First-level gaps"], ["second", "Second-level gaps"], ["both", "Both"]] as const) {
        const chip = bar.createEl("button", { cls: "literature-feed-chip", text: label });
        chip.toggleClass("is-active", key === which);
        chips.set(key, chip);
        chip.addEventListener("click", () => { which = key; for (const [k, c] of chips) c.toggleClass("is-active", k === key); draw(); });
      }
    }
    new Setting(bar).setName("Search authors").addText((t) => { t.setPlaceholder("Name").onChange((v) => { find = v; draw(); }); });
    new Setting(bar).setName("Minimum works").addText((t) => {
      t.inputEl.type = "number";
      t.inputEl.addClass("literature-feed-narrow");
      t.setValue(String(min)).onChange((v) => { const n = Math.floor(Number(v)); min = Number.isFinite(n) && n >= 1 ? n : 2; draw(); });
    });
    draw();
  }

  /** One author: their papers the paper cites, their papers it does not (among the gaps), and a look for their other work on the same ground. */
  private drawAuthorPanel(box: HTMLElement, row: AuthorRow, run: GapsRun, uncitedWorks: WorkRef[]): void {
    box.createDiv({ cls: "literature-feed-title", text: `${row.own ? "\u2605 " : ""}${row.name}` });
    const paperYear = run.subject?.year ?? null;
    const cited = worksBy(row.key, run.citedWorks);
    const uncited = worksBy(row.key, uncitedWorks);
    box.createEl("h5", { text: `Cited by this paper (${cited.length})` });
    if (cited.length === 0) box.createEl("p", { cls: "literature-feed-meta", text: "None of the references read has this author." });
    for (const w of cited) this.workRow(box, w, "cited by this paper");
    box.createEl("h5", { text: `Not cited, among the gaps (${uncited.length})` });
    if (uncited.length === 0) box.createEl("p", { cls: "literature-feed-meta", text: "None of the gaps has this author." });
    for (const w of uncited) {
      const when = couldHaveBeenCited(w.year, paperYear);
      this.workRow(box, w, when === "before" ? "out before the paper: it could have been cited" : when === "after" ? "out after the paper: it could not have been cited" : "");
    }
    const id = authorIdFor(row.key, [...run.citedWorks, ...uncitedWorks]);
    const found = this.authorFinds.get(row.key);
    box.createEl("h5", { text: "Their other work on this ground" });
    box.createEl("p", { cls: "literature-feed-meta", text: "Works by this author that cite at least one of the same references as the paper and that the paper does not cite. One or two small requests (about $0.0002 at most)." });
    if (id === null) {
      box.createEl("p", { cls: "literature-feed-meta", text: "No identifier came back for this author in the works read, so this cannot be looked up." });
    } else if (found) {
      this.drawAuthorFinds(box, found, paperYear);
    } else {
      new Setting(box).addButton((b) => b.setButtonText("Find their other work on this ground").setCta().onClick(() => void this.runAuthorFind(row, id, run, box, uncitedWorks)));
    }
  }

  private async runAuthorFind(row: AuthorRow, id: string, run: GapsRun, box: HTMLElement, uncitedWorks: WorkRef[]): Promise<void> {
    const budget = new Budget(this.host.settings.reviewBudgetUsd);
    try {
      const res = await findAuthorWork(id, run.referenceIds, run.subject?.id ?? null, { client: this.host.newReviewClient(), cache: this.host.reviewCache, now: Date.now(), budget });
      await this.host.saveReviewCache();
      this.authorFinds.set(row.key, res);
    } catch (e) {
      new Notice(`The lookup failed: ${e instanceof Error ? e.message : "unknown error"}`, 8000);
      return;
    }
    box.empty();
    this.drawAuthorPanel(box, row, run, uncitedWorks);
  }

  private drawAuthorFinds(box: HTMLElement, found: AuthorWorkResult, paperYear: number | null): void {
    if (found.stopped) box.createEl("p", { cls: "literature-feed-warning", text: `The lookup ${found.stopped}.` });
    if (found.works.length === 0) {
      box.createEl("p", { text: "No other work by this author cites the same references and is missing from the paper." });
      return;
    }
    const sources = this.host.flagSources();
    for (const { paper, shared } of found.works) {
      const when = couldHaveBeenCited(paper.year ?? null, paperYear);
      const f = flagsFor({ id: shortOpenAlexId(paper.openalexId) ?? "", doi: paper.doi ?? null, title: paper.title }, sources);
      this.workRow(box, { title: paper.title, doi: paper.doi ?? null, authors: paper.authors, year: paper.year ?? null, citedBy: paper.citedByCount ?? null },
        `cites ${shared} of the paper's references \u00b7 ${when === "before" ? "out before the paper" : when === "after" ? "out after the paper: it could not have been cited" : "year unknown"}`, f);
    }
  }

  private async createNote(run: GapsRun, input: GapInput, ranAt: string, flags: Flags[], deeperFlags: Flags[]): Promise<void> {
    const text = renderGapsNote({ date: today(), ranAt, input, minCount: this.s.minCount, run, flags, deeperFlags });
    const subject = (run.subject?.title ?? "pasted references").replace(/[\\/:*?"<>|#^[\]]/g, " ").replace(/\s+/g, " ").trim().slice(0, 50);
    const folder = this.host.reviewFolder();
    const path = await this.host.createReviewNote(`${folder === "" ? "" : `${folder}/`}Citation gaps ${today()} ${subject}.md`, text);
    new Notice(`Gaps note made: ${path}`);
  }
}
