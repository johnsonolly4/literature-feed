// The citation-gaps tool: for one paper, what many of its references cite and it does not. The paper is given as a DOI or OpenAlex id,
// picked from the Zotero library (the local index), or replaced by a pasted reference list. The cost is shown before anything is
// requested, and the last run is kept so closing the tab loses nothing. Nothing is sent but the OpenAlex requests the user starts.
// The report is drawn with the plugin's UI kit (src/ui): one table (Works or Authors, switched by chips) beside a detail pane.
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
import { authorIdFor, authorShares, couldHaveBeenCited, worksBy, type AuthorRow, type WorkRef } from "./gaps-authors";
import { googleUrl, scholarUrl, searchQuery } from "./search-links";
import { findAuthorWork, runGaps, toWorkRef, type AuthorWorkResult, type GapsClient, type GapsRun, type ScanEstimate } from "./gaps-fetch";
import { HEAVY_CITATIONS } from "./network-fetch";
import { renderGapsNote } from "./gaps-note";
import { buildAuditPrompt, checkAuditAnswer, verdictFor, type AuditAnswer } from "./authors-prompt";
import { createPromptPanel } from "../ui/prompt-panel";
import { AUTHOR_CHIPS, AUTHOR_COLUMNS, WORK_CHIPS, WORK_COLUMNS, authorSearchText, buildWorkRows, findAuthorRow, pctText, workSearchText, type WorkRow } from "./gaps-rows";
import { DataTable } from "../ui/data-table";
import { createReportBar } from "../ui/report-bar";
import { createSection, formGrid, type Section } from "../ui/section";
import { createSplitPane } from "../ui/split-pane";
import { drawScatter } from "../ui/scatter";
import { diagonalPoints } from "./gaps-chart";
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
const EXTRA_DESC = "DOIs of works the paper cites that OpenAlex or the pasted list left out. They count as cited, and their own references are read too. Paste any text: the DOIs are picked out.";
const SIMILAR_NAME = "Also find similar papers";
const SIMILAR_DESC = "Reads the works that cite the references, finds the ones that share at least five of them, and lists what those similar papers cite and the paper does not. Costs more; the price is shown first.";
const CAVEAT = "Pointers, not verdicts. In one test of the source tool, 13 of 30 held-out references came back. The similar papers are a modelling choice (how many, how many references they share), and the counts here depend on it.";
const AUDIT_DESC = "A prompt for a chat that can search the web: it tests whether the flagged authors are really under- or over-represented, or an artefact (a merged namesake, a work out after the paper, another field).";
const OLD_RUN = "This run was saved before author details were kept, so the authors table and the author view are empty. Press Find the gaps again: it is free from the cache.";
const SEARCH_UNFOUND_NAME = "Also search the ones not found in OpenAlex";
const PRESS_TIDY = "Press Tidy and find DOIs first: it finds DOIs for free. Searching lines without a DOI in OpenAlex costs $0.001 each (switch that on below).";

const MODES: Record<GapsMode, string> = { paper: "A paper (DOI or OpenAlex id)", zotero: "A paper from my Zotero library", paste: "A pasted reference list" };

function usd(n: number): string {
  return `$${n.toFixed(4)}`;
}

/** Supported first, then unclear, then refuted, then none, for sorting the LLM check column. */
function verdictRank(answer: AuditAnswer | null, name: string): number {
  const v = verdictFor(answer, name)?.verdict;
  return v === "supported" ? 0 : v === "unclear" ? 1 : v === "refuted" ? 2 : 3;
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
  private inputs!: Section;
  private saveTimer: number | null = null;
  private refsPanel: RefsPanel | null = null;
  /** What "find their other work" found, by author key (kept while the tab is open). */
  private authorFinds = new Map<string, AuthorWorkResult>();

  constructor(private readonly host: GapsHost, private readonly root: HTMLElement) {
    this.s = host.gapsSession ?? emptyGapsSession();
  }

  mount(): void {
    this.render();
  }

  flush(): void {
    this.refsPanel?.flush();
    if (this.saveTimer !== null) window.clearTimeout(this.saveTimer);
    this.saveTimer = null;
    this.host.saveGapsSession(this.s);
  }

  /** Stops any pending save, for when the tool is about to be shown again from another session (so the old state is not written over it). */
  discard(): void {
    if (this.saveTimer !== null) window.clearTimeout(this.saveTimer);
    this.saveTimer = null;
    this.refsPanel?.discard();
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
    this.inputs = createSection(el, { title: "What to look up", collapsible: true, open: this.s.last === null });
    const body = this.inputs.body;
    body.addClass("literature-feed-gaps-formhost");
    // Two tiles side by side in a wide tab (settings left, references right); one column in a narrow one (styles.css).
    const form = body.createDiv({ cls: "literature-feed-gaps-form" });
    const left = form.createDiv({ cls: "literature-feed-gaps-main" });
    const right = form.createDiv({ cls: "literature-feed-gaps-refs" });
    new Setting(left).setName("Start from").addDropdown((d) => {
      for (const [k, label] of Object.entries(MODES)) d.addOption(k, label);
      d.setValue(this.s.mode).onChange((v) => { this.s.mode = v as GapsMode; this.estimate = null; this.render(); this.saveSoon(); });
    });
    if (this.s.mode === "paper") {
      new Setting(left).setName("Paper identifier").setDesc("A DOI, a doi.org link, an OpenAlex id (W…) or an openalex.org link. A title also works, and costs one search ($0.001).")
        .addText((t) => t.setPlaceholder("10.1021/jacs.3c08248").setValue(this.s.paperText).onChange((v) => { this.s.paperText = v; this.estimate = null; this.saveSoon(); }));
      right.createEl("p", { cls: "setting-item-description", text: "The paper's own references are read from OpenAlex. To use a pasted list instead, pick that under Start from." });
    } else if (this.s.mode === "zotero") {
      this.renderZotero(right);
    } else {
      right.createEl("p", { cls: "setting-item-description", text: "Paste the references of a paper as they came out of the PDF. Press the button to split them and find their DOIs for free; then only the ticked ones are looked up in OpenAlex, about $0.0001 for 50." });
      this.refsPanel = new RefsPanel(
        this.host, right.createDiv(), normaliseRefsSession(this.s.refs),
        (s: RefsSession) => { this.s.refs = s as unknown as Record<string, unknown>; this.saveSoon(); },
        () => { this.estimate = null; },
      );
      this.refsPanel.mount();
      new Setting(left).setName(SEARCH_UNFOUND_NAME).setDesc(`References no DOI was found for are searched in OpenAlex by their text: about $0.001 each, at most ${MAX_TITLE_SEARCHES}. Off by default.`)
        .addToggle((t) => t.setValue(this.s.searchUnfound).onChange((v) => { this.s.searchUnfound = v; this.estimate = null; this.saveSoon(); }));
    }
    new Setting(left).setName(EXTRA_NAME).setDesc(EXTRA_DESC)
      .addTextArea((t) => {
        t.inputEl.rows = 2;
        t.setPlaceholder("10.1021/…").setValue(this.s.extraDois).onChange((v) => { this.s.extraDois = v; this.estimate = null; this.saveSoon(); });
      });
    const grid = formGrid(left);
    new Setting(grid).setName("Gap when cited by at least").setDesc("How many of the references must cite a work (3 is a good start; 2 finds more, with more noise).")
      .addText((t) => {
        t.inputEl.type = "number";
        t.setValue(String(this.s.minCount)).onChange((v) => {
          const n = Math.floor(Number(v));
          this.s.minCount = Number.isFinite(n) ? Math.min(10, Math.max(2, n)) : 3;
          this.saveSoon();
        });
      });
    new Setting(grid).setName("Go a second level").setDesc("Also reads the works several references cite (up to 300): the foundations under the foundations. About $0.0007 more.")
      .addToggle((t) => t.setValue(this.s.deeper).onChange((v) => { this.s.deeper = v; this.estimate = null; this.saveSoon(); }));
    new Setting(grid).setName("Second level: cited by at least").setDesc("How many of those shared works must cite a work (5 is a good start; lower finds more, with more noise).")
      .addText((t) => {
        t.inputEl.type = "number";
        t.setValue(String(this.s.deeperMin)).onChange((v) => {
          const n = Math.floor(Number(v));
          this.s.deeperMin = Number.isFinite(n) ? Math.min(20, Math.max(2, n)) : 5;
          this.saveSoon();
        });
      });
    new Setting(grid).setName(SIMILAR_NAME).setDesc(SIMILAR_DESC)
      .addToggle((t) => t.setValue(this.s.similar).onChange((v) => { this.s.similar = v; this.estimate = null; this.saveSoon(); }));
    new Setting(left).addButton((b) => b.setButtonText("Estimate the cost").setCta().onClick(() => this.doEstimate()));
    this.out = el.createDiv();
    const last = this.s.last;
    if (last) this.renderRun(last.run, last.input, last.ranAt);
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
    const e = estimateGaps(input, this.s.deeper, input.kind === "references" ? 0 : parseDoiList(this.s.extraDois).length, this.s.similar);
    const limit = this.host.settings.reviewBudgetUsd;
    const over = e.usd > limit + 1e-9;
    const parts = [e.free > 0 ? `${e.free} free record` : "", e.filtered > 0 ? `up to ${e.filtered} lookups` : "", e.searches > 0 ? `${e.searches} search${e.searches === 1 ? "" : "es"}` : ""].filter((p) => p !== "");
    const text = `${parts.join(", ")}: about ${usd(e.usd)} at most (the limit is ${usd(limit)}, Settings → Literature review).${e.skippedLines > 0 ? ` ${e.skippedLines} references without a DOI are over the limit of ${MAX_TITLE_SEARCHES} searches and will be left out.` : ""}`;
    this.estimate = { input, text, over };
    this.out.empty();
    const box = createSection(this.out, { title: "Cost" }).body;
    box.createEl("p", { text });
    if (e.scanLater) box.createEl("p", { cls: "literature-feed-meta", text: "The scan for similar papers is not in that figure: its price depends on how often the references are cited, so it is shown, with the references it will skip, after they are read, and you decide then." });
    if (over) box.createEl("p", { cls: "literature-feed-warning", text: "That is over your limit. Paste fewer references, or raise the limit in the settings." });
    new Setting(box).addButton((b) => { b.setButtonText(`Find the gaps (${usd(e.usd)})`).setCta().onClick(() => void this.run(input)); b.setDisabled(over); });
  }

  private async run(input: GapInput): Promise<void> {
    this.out.empty();
    this.out.createEl("p", { text: "Looking up…" });
    const budget = new Budget(this.host.settings.reviewBudgetUsd);
    let run: GapsRun;
    try {
      run = await runGaps(input, { client: this.host.newReviewClient(), cache: this.host.reviewCache, now: Date.now(), budget }, this.s.minCount, this.s.deeper ? this.s.deeperMin : null, input.kind === "references" ? [] : parseDoiList(this.s.extraDois), this.s.similar ? { confirm: (est) => this.confirmScan(est, budget) } : null);
    } catch (e) {
      this.out.empty();
      this.out.createEl("p", { cls: "literature-feed-warning", text: `The lookup failed: ${e instanceof Error ? e.message : "unknown error"}` });
      return;
    }
    await this.host.saveReviewCache();
    const ranAt = new Date().toISOString();
    this.s.last = { input, run, ranAt };
    this.s.audit = null;
    this.flush();
    this.inputs.setOpen(false);
    this.renderRun(run, input, ranAt);
  }

  /** Shows the real price of the scan and the references it will skip, and waits for the reader to go ahead or skip it. */
  private confirmScan(est: ScanEstimate, budget: Budget): Promise<boolean> {
    return new Promise((resolve) => {
      this.out.empty();
      const box = createSection(this.out, { title: "Scan for similar papers" }).body;
      const left = budget.remaining;
      const over = est.costUsd > left + 1e-9;
      box.createEl("p", { text: `Reads the works that cite ${est.scanned} of the references: up to ${est.requests} requests, about ${usd(est.costUsd)} at most (${est.works} citations in all; works that cite several references are read once).` });
      if (est.heavy.length > 0) {
        box.createEl("p", { cls: "literature-feed-meta", text: `${est.heavy.length} reference${est.heavy.length === 1 ? " is" : "s are"} cited ${HEAVY_CITATIONS} times or more and will be skipped (they still count everywhere else):` });
        const ul = box.createEl("ul");
        for (const h of est.heavy) ul.createEl("li", { text: `${h.title ?? h.id} (${h.citedBy} citations)` });
      }
      if (over) box.createEl("p", { cls: "literature-feed-warning", text: `That is more than the ${usd(left)} left of your limit, so the scan will stop when the limit is reached and say which references it did not read.` });
      new Setting(box)
        .addButton((b) => b.setButtonText(`Scan (up to ${usd(est.costUsd)})`).setCta().onClick(() => { this.out.empty(); this.out.createEl("p", { text: "Scanning…" }); resolve(true); }))
        .addButton((b) => b.setButtonText("Skip the scan").onClick(() => { this.out.empty(); this.out.createEl("p", { text: "Finishing without the scan…" }); resolve(false); }));
    });
  }

  private flagsOf(list: GapsRun["gaps"]): Flags[] {
    const sources = this.host.flagSources();
    return list.map((g) => flagsFor({ id: g.paper ? shortOpenAlexId(g.paper.openalexId) ?? g.gap.id : g.gap.id, doi: g.paper?.doi ?? null, title: g.paper?.title ?? "" }, sources));
  }

  /** One work as a block in a detail pane: the title (a link to its DOI, else a web search), the authors, and what is known. */
  private workRow(parent: HTMLElement, w: { title: string; doi: string | null; authors: string[]; year: number | null; citedBy: number | null }, info: string, f?: Flags): void {
    const row = parent.createDiv({ cls: "literature-feed-detailwork" });
    const query = searchQuery(w.title);
    const url = doiUrl(w.doi);
    row.createDiv({ cls: "literature-feed-title" }).createEl("a", { cls: "external-link", text: w.title, href: url ?? googleUrl(query), attr: { target: "_blank", rel: "noopener" } });
    const who = authorsShort(w.authors);
    if (who !== "") row.createDiv({ cls: "literature-feed-meta", text: who });
    row.createDiv({ cls: "literature-feed-meta", text: [w.year ? String(w.year) : "", info, w.citedBy !== null ? `${w.citedBy} citations` : "", f?.zotero ? "in Zotero" : "", f?.vault ? "in the vault" : ""].filter((t) => t !== "").join(" · ") });
    this.searchLinks(row, query);
  }

  private searchLinks(parent: HTMLElement, query: string): void {
    const links = parent.createDiv({ cls: "literature-feed-meta literature-feed-ref-links" });
    links.createEl("a", { cls: "external-link", text: "Google", href: googleUrl(query), attr: { target: "_blank", rel: "noopener" } });
    links.createEl("a", { cls: "external-link", text: "Scholar", href: scholarUrl(query), attr: { target: "_blank", rel: "noopener" } });
  }

  /** The report: a bar, then one table (Works or Authors, switched by chips) beside a detail pane. */
  private renderRun(run: GapsRun, input: GapInput, ranAt: string): void {
    this.out.empty();
    const out = this.out;
    const flags = this.flagsOf(run.gaps);
    const deeperFlags = run.deeper ? this.flagsOf(run.deeper.gaps) : [];
    const similarFlags = run.similar && !run.similar.skipped ? this.flagsOf(run.similar.rows.map((r) => ({ gap: { id: r.gap.id, count: r.gap.count, share: r.gap.share }, paper: r.paper }))) : [];
    const title = run.subject ? `${run.subject.title}${run.subject.year ? ` (${run.subject.year})` : ""}` : "Pasted references";
    createReportBar(out, [title, `Read ${run.referencesRead} references (${run.referencesWithLists} with a reference list of their own). Spent about ${usd(run.spentUsd)}.`], [
      { text: "Create gaps note", onClick: () => void this.createNote(run, input, ranAt, flags, deeperFlags, similarFlags) },
      { text: "Change the settings", onClick: () => { this.inputs.setOpen(true); this.inputs.el.scrollIntoView({ behavior: "smooth", block: "start" }); } },
    ]);
    if (run.message) out.createEl("p", { cls: "literature-feed-warning", text: run.message });
    if (run.stopped) out.createEl("p", { cls: "literature-feed-warning", text: `The lookup ${run.stopped}.` });
    if (run.gaps.length === 0 && !run.message) out.createEl("p", { text: `No work is cited by ${this.s.minCount} or more of these references without also being cited by the paper.` });
    if (run.similar) this.drawScanNotes(out, run.similar, run.referencesRead);
    const detailsKept = run.detailsKept !== false;
    if (!detailsKept) out.createEl("p", { cls: "literature-feed-warning", text: OLD_RUN });

    const works = buildWorkRows(run, (list) => (list === run.gaps ? flags : list === run.deeper?.gaps ? deeperFlags : this.flagsOf(list)));
    const scan = run.similar && !run.similar.skipped ? run.similar : null;
    const paperYear = run.subject?.year ?? null;
    let authorsTable: DataTable<AuthorRow> | null = null;
    let worksTable: DataTable<WorkRow> | null = null;
    const split = createSplitPane(out, () => { worksTable?.select(null); authorsTable?.select(null); });
    const switcher = split.main.createDiv({ cls: "literature-feed-chip-row" });
    const worksHolder = split.main.createDiv();
    const authorsHolder = split.main.createDiv();
    const chartHolder = split.main.createDiv();
    const diagonal = scan ? diagonalPoints(works) : null;

    // ---- the works table ----
    const workDetail = (r: WorkRow): void => {
      split.show(r.title, (box) => {
        const query = searchQuery(r.title);
        const url = doiUrl(r.doi);
        box.createDiv().createEl("a", { cls: "external-link", text: url ? "Open the paper (DOI)" : "Search for it on Google", href: url ?? googleUrl(query), attr: { target: "_blank", rel: "noopener" } });
        box.createDiv({ cls: "literature-feed-meta", text: [r.year ? String(r.year) : "", r.citedBy !== null ? `${r.citedBy} citations` : "", `cited by ${r.count} of ${r.of} ${r.level === 1 ? "references" : "shared works"} (${Math.round(r.share * 100)}%)`].filter((t) => t !== "").join(" · ") });
        if (r.similarCount !== null) box.createDiv({ cls: "literature-feed-meta", text: `Cited by ${r.similarCount} of the ${r.similarOf ?? ""} most similar papers${r.route === "both" ? ", and by the references too (both routes)" : ""}.` });
        if (r.timing !== "unknown") box.createDiv({ cls: "literature-feed-meta", text: r.timing === "before" ? "Out before the paper: it could have been cited." : "Out after the paper: it could not have been cited." });
        this.searchLinks(box, query);
        box.createEl("h5", { text: "Authors" });
        if (r.authors.length === 0) box.createEl("p", { cls: "literature-feed-meta", text: "No author list came back." });
        const list = box.createDiv({ cls: "literature-feed-authorlinks" });
        for (const name of r.authors) {
          const a = list.createEl("a", { text: name, href: "#" });
          a.addEventListener("click", (e) => { e.preventDefault(); showAuthor(name); });
        }
      });
    };
    worksTable = new DataTable<WorkRow>(worksHolder, {
      app: this.host.app, storageKey: "gaps-works", searchLabel: "Search the works", empty: "No work matches.",
      columns: [
        { ...WORK_COLUMNS[0], render: (td, r) => {
          const url = doiUrl(r.doi);
          td.createDiv({ cls: "literature-feed-title" }).createEl("a", { cls: "external-link", text: r.title, href: url ?? googleUrl(searchQuery(r.title)), attr: { target: "_blank", rel: "noopener" } });
          const who = authorsShort(r.authors);
          if (who !== "") td.createDiv({ cls: "literature-feed-meta", text: who });
        } },
        { ...WORK_COLUMNS[1], secondary: true, render: (td, r) => td.setText(r.year ? String(r.year) : "") },
        { ...WORK_COLUMNS[2], render: (td, r) => td.setText(`${r.count} of ${r.of} (${Math.round(r.share * 100)}%)`) },
        { ...WORK_COLUMNS[3], secondary: true, align: "end", render: (td, r) => td.setText(r.citedBy === null ? "" : String(r.citedBy)) },
        { ...WORK_COLUMNS[4], secondary: true, render: (td, r) => td.setText(r.level === 1 ? "First" : "Second") },
        { ...WORK_COLUMNS[5], render: (td, r) => {
          if (r.flags.zotero) td.createSpan({ cls: "literature-feed-status status-ok", text: "Zotero" });
          if (r.flags.vault) td.createSpan({ cls: "literature-feed-status status-ok", text: "Vault" });
        } },
        { ...WORK_COLUMNS[7], render: (td, r) => {
          if (r.review.level !== "") td.createSpan({ cls: "literature-feed-status status-check", text: r.review.level === "sure" ? "Review" : "Possible review", attr: { title: r.review.reason } });
        } },
        { ...WORK_COLUMNS[8], secondary: true, align: "end", render: (td, r) => {
          if (r.niche !== null) td.createSpan({ text: r.niche.toFixed(2), attr: { title: `Cited by ${r.count} of your list per ${r.citedBy} citations; ${Math.round(r.nichePct ?? 0)}th percentile in this table.` } });
        } },
        ...(scan ? [
          { ...WORK_COLUMNS[9], render: (td: HTMLElement, r: WorkRow) => { if (r.similarCount !== null) td.setText(`${r.similarCount} of ${r.similarOf ?? ""}`); } },
          { ...WORK_COLUMNS[10], align: "end" as const, render: (td: HTMLElement, r: WorkRow) => { if (r.gap !== null) td.createSpan({ text: `${r.gap >= 0 ? "+" : "−"}${Math.abs(r.gap).toFixed(0)}`, attr: { title: "Share of the similar papers that cite it, minus the share of the references that cite it, in percentage points." } }); } },
        ] : []),
      ],
      chips: WORK_CHIPS(run.deeper !== null, paperYear !== null, scan !== null), searchText: workSearchText, rowKey: (r) => r.key,
      defaultView: { chip: "all", query: "", sort: { by: "count", desc: true } },
      onSelect: (r) => { if (r) workDetail(r); else split.close(); },
    });
    worksTable.setRows(works);

    // ---- the authors table ----
    let scope: "first" | "second" | "both" = "first";
    let min = 2;
    const uncitedFor = (): GapsRun["gaps"] => (scope === "first" ? run.gaps : scope === "second" ? (run.deeper?.gaps ?? []) : [...run.gaps, ...(run.deeper?.gaps ?? [])]);
    const lists = (items: GapsRun["gaps"]): string[][] => items.flatMap((g) => (g.paper ? [g.paper.authors] : []));
    const workRefs = (items: GapsRun["gaps"]): WorkRef[] => items.flatMap((g) => (g.paper ? [toWorkRef(g.paper)] : []));
    const tableFor = (m: number): ReturnType<typeof authorShares> => authorShares(run.citedAuthors, lists(uncitedFor()), { min: m, own: run.subject?.authors ?? [] });
    const note = authorsHolder.createEl("p", { cls: "literature-feed-meta" });
    const refresh = (): void => {
      const t = tableFor(min);
      note.setText(detailsKept
        ? `Shares are of the ${t.citedWorks} cited works and the ${t.uncitedWorks} uncited works that have an author list. Authors are matched by family name and first initial. Under-cited: a bigger share of the gaps than of the references; over-cited: the reverse (starred: the paper's own authors).${t.rows.length === 0 ? " No author is on enough works to compare: try a lower minimum." : ""}`
        : "");
      authorsTable?.setRows(t.rows);
    };
    const authorDetail = (row: AuthorRow): void => {
      split.show(`${row.own ? "★ " : ""}${row.name}`, (box) => this.drawAuthorPanel(box, row, run, workRefs(uncitedFor())));
    };
    authorsTable = new DataTable<AuthorRow>(authorsHolder, {
      app: this.host.app, storageKey: "gaps-authors", searchLabel: "Search the authors", empty: "No author matches.",
      columns: [
        { ...AUTHOR_COLUMNS[0], render: (td, r) => td.setText(`${r.own ? "★ " : ""}${r.name}`) },
        { ...AUTHOR_COLUMNS[1], align: "end", render: (td, r) => td.setText(String(r.cited)) },
        { ...AUTHOR_COLUMNS[2], secondary: true, align: "end", render: (td, r) => td.setText(pctText(r.citedPct)) },
        { ...AUTHOR_COLUMNS[3], align: "end", render: (td, r) => td.setText(String(r.uncited)) },
        { ...AUTHOR_COLUMNS[4], secondary: true, align: "end", render: (td, r) => td.setText(pctText(r.uncitedPct)) },
        { ...AUTHOR_COLUMNS[5], align: "end", render: (td, r) => td.setText(`${r.diff >= 0 ? "+" : "−"}${Math.abs(r.diff).toFixed(0)} points`) },
        { ...AUTHOR_COLUMNS[6], render: (td, r) => { if (r.label !== "") td.createSpan({ cls: `literature-feed-status ${r.label === "Under-cited" ? "status-check" : "status-over"}`, text: r.label }); } },
        { key: "llm", label: "LLM check", sortable: true, compare: (a, b) => verdictRank(this.s.audit?.result ?? null, a.name) - verdictRank(this.s.audit?.result ?? null, b.name), csv: (r) => verdictFor(this.s.audit?.result ?? null, r.name)?.verdict ?? "", render: (td, r) => {
          const v = verdictFor(this.s.audit?.result ?? null, r.name);
          if (v) td.createSpan({ cls: `literature-feed-status ${v.verdict === "supported" ? "status-ok" : v.verdict === "refuted" ? "status-not-found" : ""}`, text: v.verdict, attr: { title: v.caveats } });
        } },
      ],
      chips: AUTHOR_CHIPS, searchText: authorSearchText, rowKey: (r) => r.key,
      defaultView: { chip: "all", query: "", sort: { by: "diff", desc: true } },
      onSelect: (r) => { if (r) authorDetail(r); else split.close(); },
      controls: (bar) => {
        if (run.deeper) {
          const sel = bar.createEl("select", { cls: "dropdown", attr: { "aria-label": "Which gaps" } });
          for (const [k, label] of [["first", "First-level gaps"], ["second", "Second-level gaps"], ["both", "Both"]] as const) sel.createEl("option", { value: k, text: label });
          sel.addEventListener("change", () => { scope = sel.value as typeof scope; split.close(); refresh(); });
        }
        const field = bar.createEl("input", { type: "number", cls: "literature-feed-narrow", attr: { min: "1", "aria-label": "Minimum works", title: "Minimum works an author is on" } });
        field.value = String(min);
        field.addEventListener("change", () => { const n = Math.floor(Number(field.value)); min = Number.isFinite(n) && n >= 1 ? n : 2; refresh(); });
      },
    });

    // ---- the LLM check of the authors ----
    const scopeName = (): string => (scope === "first" ? "first-level gaps" : scope === "second" ? "second-level gaps" : "gaps of both levels");
    if (detailsKept && run.citedAuthors.length > 0) {
      createPromptPanel(authorsHolder, {
        title: "Check these authors with an LLM", desc: AUDIT_DESC,
        prompt: () => { const t = tableFor(min); return buildAuditPrompt({ paper: run.subject, scope: scopeName(), rows: t.rows, citedWorks: run.citedWorks, gapWorks: workRefs(uncitedFor()), citedTotal: t.citedWorks, uncitedTotal: t.uncitedWorks, minWorks: min }); },
        saveAsNote: (text) => this.host.createReviewNote(`${this.host.reviewFolder() === "" ? "" : `${this.host.reviewFolder()}/`}Author check prompt ${today()}.md`, text),
        answer: this.s.audit?.answer ?? "", onAnswerText: (t) => { this.s.audit = { answer: t, result: this.s.audit?.result ?? null }; this.saveSoon(); },
        check: checkAuditAnswer, checkLabel: "Check the answer and add it to the table",
        onChecked: (value) => {
          this.s.audit = { answer: this.s.audit?.answer ?? "", result: value };
          this.flush();
          authorsTable?.setRows(tableFor(min).rows);
          const n = (v: string): number => value.authors.filter((a) => a.verdict === v).length;
          return `Read ${value.authors.length} authors: ${n("supported")} supported, ${n("refuted")} refuted, ${n("unclear")} unclear. They are in the LLM check column; Create gaps note keeps them.`;
        },
      });
    }

    // ---- the switch between the two tables ----
    const chips = new Map<string, HTMLElement>();
    const show = (v: "works" | "authors" | "chart"): void => {
      split.close();
      worksTable?.select(null);
      authorsTable?.select(null);
      worksHolder.toggleClass("literature-feed-hidden", v !== "works");
      authorsHolder.toggleClass("literature-feed-hidden", v !== "authors");
      chartHolder.toggleClass("literature-feed-hidden", v !== "chart");
      for (const [k, c] of chips) c.toggleClass("is-active", k === v);
    };
    const switches: (readonly ["works" | "authors" | "chart", string])[] = [["works", `Works (${works.length})`], ["authors", "Authors"], ...(diagonal && diagonal.points.length > 0 ? [["chart", "Chart"] as const] : [])];
    for (const [key, label] of switches) {
      const chip = switcher.createEl("button", { cls: "literature-feed-chip", text: label });
      chips.set(key, chip);
      chip.addEventListener("click", () => show(key));
    }
    const showAuthor = (name: string): void => {
      show("authors");
      const row = findAuthorRow(tableFor(1).rows, name);
      if (!row) {
        new Notice("That author is on too few works to be in the table.");
        return;
      }
      min = Math.min(min, row.cited + row.uncited);
      refresh();
      authorsTable?.setQuery(row.name);
      authorsTable?.select(row.key);
      authorDetail(row);
    };
    if (diagonal && diagonal.points.length > 0) {
      drawScatter(chartHolder, {
        title: "Who cites each work: your references or the similar papers",
        points: diagonal.points.map((p) => ({ key: p.key, x: p.x, y: p.y, ring: p.both, label: p.label, tip: p.tip })),
        max: diagonal.max, diagonal: true,
        xNote: "share of your references that cite it", yNote: "share of the similar papers that cite it",
        legend: [{ ring: true, text: "found on both routes" }, { ring: false, text: "cited by the similar papers" }],
        onPick: (key) => {
          const row = works.find((w) => w.key === key);
          if (!row) return;
          show("works");
          worksTable?.select(key);
          workDetail(row);
        },
      });
      chartHolder.createEl("p", { cls: "literature-feed-meta", text: `${diagonal.above} of ${diagonal.points.length} works are above the line: the similar papers cite them more than your references do (${diagonal.aboveBoth} of those are on both routes). ${diagonal.on} are on the line and ${diagonal.below} below it. The five largest gaps are labelled; click a point for details.${diagonal.left > 0 ? ` ${diagonal.left} works are left out because this run did not save how many of your references cite them: run it again.` : ""}` });
    }
    refresh();
    show("works");

    if (run.deeper) out.createEl("p", { cls: "literature-feed-meta", text: `Second level: read ${run.deeper.hubsRead} works that several of the references cite (${run.deeper.hubsWithLists} with a reference list). Their gaps are cited by at least ${run.deeper.minCount} of them, and are neither the paper, its references nor those shared works.` });
    if (run.unresolved.length > 0) {
      const details = out.createEl("details");
      details.createEl("summary", { text: `${run.unresolved.length} reference${run.unresolved.length === 1 ? "" : "s"} not found in OpenAlex` });
      const ul = details.createEl("ul");
      for (const u of run.unresolved) ul.createEl("li", { text: u });
    }
  }

  /** What the scan did and how far to trust it: the caveat, each threshold beside the list length, and what was skipped. */
  private drawScanNotes(out: HTMLElement, s: NonNullable<GapsRun["similar"]>, referencesRead: number): void {
    if (s.skipped) {
      out.createEl("p", { cls: "literature-feed-meta", text: s.message ?? "The scan for similar papers did not run." });
      return;
    }
    out.createEl("p", { cls: "literature-feed-meta", text: CAVEAT });
    if (s.warning) out.createEl("p", { cls: "literature-feed-warning", text: s.warning });
    if (s.unscanned > 0) out.createEl("p", { cls: "literature-feed-warning", text: `The scan stopped before it read the citing works of ${s.unscanned} of the ${referencesRead} references (the most cited ones).` });
    // The detail is folded away so the table comes first.
    const how = createSection(out, { title: "How the scan was made", collapsible: true, open: false, app: this.host.app, storageKey: "gaps-scan-notes" }).body;
    how.createEl("p", { cls: "literature-feed-meta", text: `Read ${s.citersRead} works that cite the references (${s.requests} requests). ${s.similarFound} share at least ${s.minShared} of your ${s.referenceCount} references; the ${s.neighbours} most similar are the neighbours. A work is listed when at least ${s.minimum} of the ${s.neighbours} neighbours cite it.` });
    if (s.heavySkipped.length > 0) how.createEl("p", { cls: "literature-feed-meta", text: `Skipped ${s.heavySkipped.length} reference${s.heavySkipped.length === 1 ? "" : "s"} cited ${HEAVY_CITATIONS} times or more: ${s.heavySkipped.map((h) => h.title).join("; ")}.` });
  }

  /** One author: their papers the paper cites, their papers it does not (among the gaps), and a look for their other work on the same ground. */
  private drawAuthorPanel(box: HTMLElement, row: AuthorRow, run: GapsRun, uncitedWorks: WorkRef[]): void {
    box.createDiv({ cls: "literature-feed-meta", text: `${row.cited} cited, ${row.uncited} uncited · ${pctText(row.citedPct)} of the cited works, ${pctText(row.uncitedPct)} of the uncited${row.label !== "" ? ` · ${row.label}` : ""}` });
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
        `cites ${shared} of the paper's references · ${when === "before" ? "out before the paper" : when === "after" ? "out after the paper: it could not have been cited" : "year unknown"}`, f);
    }
  }

  private async createNote(run: GapsRun, input: GapInput, ranAt: string, flags: Flags[], deeperFlags: Flags[], similarFlags: Flags[]): Promise<void> {
    const text = renderGapsNote({ date: today(), ranAt, input, minCount: this.s.minCount, run, flags, deeperFlags, similarFlags, audit: this.s.audit?.result ?? null });
    const subject = (run.subject?.title ?? "pasted references").replace(/[\\/:*?"<>|#^[\]]/g, " ").replace(/\s+/g, " ").trim().slice(0, 50);
    const folder = this.host.reviewFolder();
    const path = await this.host.createReviewNote(`${folder === "" ? "" : `${folder}/`}Citation gaps ${today()} ${subject}.md`, text);
    new Notice(`Gaps note made: ${path}`);
  }
}
