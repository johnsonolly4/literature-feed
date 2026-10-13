// The citation-gaps tool: for one paper, what many of its references cite and it does not. The paper is given as a DOI or OpenAlex id,
// picked from the Zotero library (the local index), or replaced by a pasted reference list. The cost is shown before anything is
// requested, and the last run is kept so closing the tab loses nothing. Nothing is sent but the OpenAlex requests the user starts.
import { Notice, Setting, type App } from "obsidian";
import { shortOpenAlexId } from "../inbox/write";
import type { Settings } from "../settings/data";
import type { ZoteroIndex } from "../zotero/library-index";
import { Budget } from "./budget";
import type { ReviewCache } from "./cache";
import { flagsFor, type FlagSources, type Flags } from "./flags";
import { RefsPanel, normaliseRefsSession, type RefsSession } from "../refs/panel";
import type { ReferenceSearcher } from "../refs/resolve";
import { runGaps, type GapsClient, type GapsRun } from "./gaps-fetch";
import { renderGapsNote } from "./gaps-note";
import {
  MAX_TITLE_SEARCHES, emptyGapsSession, estimateGaps, parseReferenceList, parseWorkInput, searchZoteroIndex, type GapInput, type GapsMode, type GapsSession,
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
      return { kind: "references", dois: sel.dois, lines };
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
    return { kind: "references", dois: r.dois, lines: this.s.searchUnfound ? r.lines : [] };
  }

  private doEstimate(): void {
    const input = this.input();
    if (input === null) return;
    const e = estimateGaps(input, this.s.deeper);
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
      run = await runGaps(input, { client: this.host.newReviewClient(), cache: this.host.reviewCache, now: Date.now(), budget }, this.s.minCount, this.s.deeper ? this.s.deeperMin : null);
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

  /** A list of gaps, the first `shown` of them, with how many there are and buttons for more. */
  private drawList(container: HTMLElement, items: GapsRun["gaps"], flags: Flags[], shown: number, line: (x: GapsRun["gaps"][number]) => string, more: (n: number) => void): void {
    container.empty();
    items.slice(0, shown).forEach((x, i) => {
      const row = container.createDiv({ cls: "literature-feed-suggestion" });
      row.createDiv({ cls: "literature-feed-title", text: x.paper ? x.paper.title : x.gap.id });
      const f = flags[i];
      row.createDiv({ cls: "literature-feed-meta", text: [x.paper?.year ? String(x.paper.year) : "", line(x), x.paper?.citedByCount !== undefined ? `${x.paper.citedByCount} citations` : "", f.zotero ? "in Zotero" : "", f.vault ? "in the vault" : ""].filter((t) => t !== "").join(" · ") });
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
    if (run.unresolved.length > 0) {
      const details = out.createEl("details");
      details.createEl("summary", { text: `${run.unresolved.length} reference${run.unresolved.length === 1 ? "" : "s"} not found in OpenAlex` });
      const ul = details.createEl("ul");
      for (const u of run.unresolved) ul.createEl("li", { text: u });
    }
    new Setting(out).addButton((b) => b.setButtonText("Create gaps note").onClick(() => void this.createNote(run, input, ranAt, flags, deeperFlags)));
  }

  private async createNote(run: GapsRun, input: GapInput, ranAt: string, flags: Flags[], deeperFlags: Flags[]): Promise<void> {
    const text = renderGapsNote({ date: today(), ranAt, input, minCount: this.s.minCount, run, flags, deeperFlags });
    const subject = (run.subject?.title ?? "pasted references").replace(/[\\/:*?"<>|#^[\]]/g, " ").replace(/\s+/g, " ").trim().slice(0, 50);
    const folder = this.host.reviewFolder();
    const path = await this.host.createReviewNote(`${folder === "" ? "" : `${folder}/`}Citation gaps ${today()} ${subject}.md`, text);
    new Notice(`Gaps note made: ${path}`);
  }
}
