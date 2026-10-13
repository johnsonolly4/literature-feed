// The "Generate literature review" panel (shown in a tab, see review-view.ts): choose searches and limits, see what the search will
// cost before it runs, run it within the budget, see the papers with what you already have of them, charts and the citation network,
// copy the prompt for an LLM, paste its answer back, and make the review note. The state is saved as it changes (session.ts) so
// nothing is lost when the tab is closed. Nothing is sent from here except the OpenAlex searches the user starts; the prompt only
// goes to the clipboard.
import { Notice, Setting, type App } from "obsidian";
import { shortOpenAlexId } from "../inbox/write";
import type { Candidate } from "../openalex/client";
import { extractJson } from "../prompts/schemas";
import type { FeedConfig, Settings } from "../settings/data";
import { Budget, CAP_PER_TOPIC, COST_FILTER, DEFAULT_PROMPT_PAPERS, MAX_PROMPT_PAPERS, monthOf, monthTotal, passesMonthlyLimit, type SpendTally } from "./budget";
import type { ReviewCache } from "./cache";
import { buildCanvas } from "./canvas";
import { chartBlock, chartSpecs } from "./chart";
import { drawChart } from "./chart-view";
import { planReview, runReview, type ReviewClient, type ReviewOptions, type ReviewPlan, type ReviewResult } from "./collect";
import { flagsFor, type FlagSources, type Flags } from "./flags";
import { buildGraphData, graphBlock, type GraphData } from "./graph-data";
import { buildNetwork, chartData, referenceCoverage, type Network } from "./network";
import { MAX_GAP_REFERENCES, estimateGapRequests, estimateNetworkRequests, fetchCitationGaps, fetchNetworkExtras, type GapResult, type NetworkClient, type NetworkExtras } from "./network-fetch";
import { buildExtraRows, citingLabel, networkMarkdown, networkText, type ExtraRow } from "./network-text";
import { renderReviewNote, reviewNoteName } from "./note";
import { DEFAULT_PROMPT_OPTIONS, buildLitReviewPrompt, checkLitReviewAnswer, paperLabel, type LitChecked } from "./prompt";
import { buildRecord, diffPapers, feedFromSnapshot, runInfo, sha256Hex, snapshotFeed, type RecordLink, type ReviewRecord, type RunInfo } from "./record";
import { describeSession, type ReviewSession } from "./session";

/** What the window needs from the plugin. */
export interface ReviewHost {
  app: App;
  settings: Settings;
  newReviewClient(): ReviewClient & NetworkClient;
  reviewCache: ReviewCache;
  saveReviewCache(): Promise<void>;
  spend: SpendTally;
  /** Reads the Zotero library into the local index (read-only) and says what it found. */
  refreshZoteroIndex(): Promise<string>;
  flagSources(): FlagSources;
  /** The folder review notes go in ("" = the vault root). */
  reviewFolder(): string;
  /** Opens the review graph (a tab) with this data. */
  openGraph(data: GraphData): Promise<void>;
  /** Makes a file (adding a number to the name when it exists), opens it when asked, and returns its path. */
  createReviewNote(path: string, text: string, open?: boolean): Promise<string>;
  /** The saved review in progress, if any (`review-session.json`). */
  session: ReviewSession | null;
  saveSession(session: ReviewSession): void;
}

/** How the panel starts when a saved review exists: ask, pick it up, or start fresh. */
export type StartMode = "ask" | "resume" | "new";

const TIER_CHOICES: Record<ReviewOptions["minTier"], string> = { possible: "Possible and better", strong: "Strong and better", priority: "Priority only" };

function today(): string {
  const d = new Date();
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function usd(n: number): string {
  return `$${n < 0.01 && n !== 0 ? n.toFixed(4) : n.toFixed(3)}`;
}

const NO_ROWS = (): { missing: ExtraRow[]; alsoCite: ExtraRow[] } => ({ missing: [], alsoCite: [] });

export class ReviewPanel {
  private selected: Set<string>;
  private fromYear: string;
  private maxPapers = DEFAULT_PROMPT_PAPERS;
  private minTier: ReviewOptions["minTier"] = "possible";
  private abstracts = true;
  private refresh = false;
  private allowMore = false;
  private monthlyOk = false;
  private plan: ReviewPlan | null = null;
  private spentSoFar = 0;
  private result: ReviewResult | null = null;
  private flags: Flags[] = [];
  private sources: FlagSources | null = null;
  private network: Network | null = null;
  private extras: NetworkExtras | null = null;
  private rows = NO_ROWS();
  private gapIndex = 0;
  private gaps: { paper: string; result: GapResult; flags: Flags[] } | null = null;
  private answerText = "";
  private checked: LitChecked | null = null;
  private out!: HTMLElement;
  private offerResume = false;
  private saveTimer: number | null = null;
  /** What was fixed when the search started, for the record. */
  private runMeta: RunInfo | null = null;
  private llm = "";
  private keepPrompt = true;
  private promptNote: string | null = null;
  /** The earlier review this one repeats, and whether its search definitions are used (else the current settings). */
  private baseline: ReviewRecord | null = null;
  private snapshotFeeds: FeedConfig[] | null = null;

  constructor(private readonly host: ReviewHost, private readonly root: HTMLElement) {
    const feeds = host.settings.feeds;
    this.selected = new Set(feeds.filter((f) => f.topics.length > 0).map((f) => f.id));
    const years = feeds.map((f) => f.yearsFrom).filter((y): y is number => y !== null);
    this.fromYear = String(years.length > 0 ? Math.min(...years) : new Date().getFullYear() - 5);
  }

  /** Shows the panel. With a saved review it offers to pick it up (`ask`), picks it up (`resume`) or ignores it (`new`). */
  mount(mode: StartMode = "ask"): void {
    const saved = this.host.session;
    if (saved && mode === "resume") {
      this.restore(saved);
      return;
    }
    this.offerResume = saved !== null && mode === "ask" && this.result === null;
    this.render();
  }

  /** Writes the state now (the tab is closing). */
  flush(): void {
    if (this.saveTimer !== null) window.clearTimeout(this.saveTimer);
    this.saveTimer = null;
    this.save();
  }

  private snapshot(): ReviewSession | null {
    if (!this.result) return null;
    return {
      version: 1, savedAt: Date.now(), selected: [...this.selected], fromYear: this.fromYear, maxPapers: this.maxPapers, minTier: this.minTier,
      abstracts: this.abstracts, result: this.result, extras: this.extras, answerText: this.answerText,
      run: this.runMeta, llm: this.llm, promptNote: this.promptNote, baseline: this.baseline, snapshot: this.snapshotFeeds ? this.snapshotFeeds.map(snapshotFeed) : null,
    };
  }

  private save(): void {
    const s = this.snapshot();
    if (s) this.host.saveSession(s);
  }

  private saveSoon(): void {
    if (this.saveTimer !== null) window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => { this.saveTimer = null; this.save(); }, 1000);
  }

  /** Puts a saved review back: the form, the papers, what was looked up and the pasted answer. */
  private restore(s: ReviewSession): void {
    this.snapshotFeeds = s.snapshot ? s.snapshot.map(feedFromSnapshot) : null;
    const known = new Set(this.feedList().map((f) => f.id));
    const selected = s.selected.filter((id) => known.has(id));
    if (selected.length > 0) this.selected = new Set(selected);
    this.fromYear = s.fromYear === "" ? this.fromYear : s.fromYear;
    this.maxPapers = Math.min(MAX_PROMPT_PAPERS, s.maxPapers);
    this.minTier = s.minTier;
    this.abstracts = s.abstracts;
    this.result = s.result;
    this.extras = s.extras;
    this.answerText = s.answerText;
    this.runMeta = s.run;
    this.llm = s.llm;
    this.promptNote = s.promptNote;
    this.baseline = s.baseline;
    this.offerResume = false;
    this.plan = null;
    this.gaps = null;
    this.rows = NO_ROWS();
    this.render();
    this.computeFlags();
    this.network = buildNetwork(s.result.papers);
    this.recheck();
    this.renderResult();
  }

  /** Sets up a repeat of an earlier review from its record: the same searches (as recorded), window, tier and prompt options. */
  loadRecord(record: ReviewRecord): void {
    this.baseline = record;
    this.snapshotFeeds = record.feeds.map(feedFromSnapshot);
    this.selected = new Set(record.feeds.filter((f) => f.topics.length > 0).map((f) => f.id));
    this.fromYear = record.fromDate.slice(0, 4);
    this.maxPapers = Math.min(MAX_PROMPT_PAPERS, record.maxPapers);
    this.minTier = record.minTier;
    this.abstracts = record.abstracts;
    this.result = null;
    this.extras = null;
    this.answerText = "";
    this.llm = "";
    this.promptNote = null;
    this.runMeta = null;
    this.plan = null;
    this.rows = NO_ROWS();
    this.offerResume = false;
    this.render();
  }

  /** The choice between the recorded search definitions and the current ones, shown while repeating a review. */
  private renderDefinitionsChoice(contentEl: HTMLElement): void {
    const base = this.baseline;
    if (!base) return;
    new Setting(contentEl)
      .setName(`Repeating the review of ${base.ranAt.slice(0, 10)}`)
      .setDesc("The same window, rank limit and prompt options. Choose which search definitions to use: the topics and rules as they were then, or your searches as they are now.")
      .addDropdown((d) => {
        d.addOption("recorded", "As recorded");
        d.addOption("current", "Current settings");
        d.setValue(this.snapshotFeeds ? "recorded" : "current").onChange((v) => {
          this.snapshotFeeds = v === "recorded" ? base.feeds.map(feedFromSnapshot) : null;
          const ids = new Set(this.feedList().map((f) => f.id));
          const keep = base.feeds.map((f) => f.id).filter((id) => ids.has(id));
          this.selected = new Set(keep.length > 0 ? keep : [...ids]);
          this.plan = null;
          this.result = null;
          this.render();
        });
      });
  }

  /** Checks a restored answer again, quietly: the result is used by the graph and the note. */
  private recheck(): void {
    this.checked = null;
    if (this.answerText.trim() === "") return;
    const json = extractJson(this.answerText);
    if (!json.ok) return;
    const checked = checkLitReviewAnswer(json.value, this.answerLabels());
    if (checked.ok) this.checked = checked;
  }

  private render(): void {
    const contentEl = this.root;
    contentEl.empty();
    const feeds = this.feedList().filter((f) => f.topics.length > 0);
    if (feeds.length === 0) {
      contentEl.createEl("p", { text: "There is no search with topics yet. Add or import one in the settings first." });
      return;
    }
    this.renderDefinitionsChoice(contentEl);
    const saved = this.host.session;
    if (this.offerResume && saved) {
      const names = new Map(this.host.settings.feeds.map((f) => [f.id, f.name]));
      new Setting(contentEl)
        .setName("Pick up the last review?")
        .setDesc(describeSession(saved, names))
        .addButton((b) => b.setButtonText("Resume").setCta().onClick(() => this.restore(saved)))
        .addButton((b) => b.setButtonText("Start new").onClick(() => { this.offerResume = false; this.render(); }));
    }
    contentEl.createEl("p", {
      cls: "setting-item-description",
      text: "Runs your searches over a wider window, shows what each step costs before it spends anything, flags the papers you already have, and builds a prompt for an LLM to group and prioritise them. Nothing is sent but the searches you start; the prompt goes to your clipboard.",
    });
    for (const feed of feeds) {
      new Setting(contentEl).setName(feed.name).setDesc(`${feed.topics.length} topic${feed.topics.length === 1 ? "" : "s"}`).addToggle((t) => t.setValue(this.selected.has(feed.id)).onChange((v) => {
        if (v) this.selected.add(feed.id);
        else this.selected.delete(feed.id);
        this.plan = null;
      }));
    }
    new Setting(contentEl).setName("Published since (year)").addText((t) => {
      t.inputEl.type = "number";
      t.setValue(this.fromYear).onChange((v) => { this.fromYear = v.trim(); this.plan = null; });
    });
    new Setting(contentEl).setName("Papers in the prompt").setDesc(`At most ${MAX_PROMPT_PAPERS}. The best matches come first.`).addText((t) => {
      t.inputEl.type = "number";
      t.setValue(String(this.maxPapers)).onChange((v) => {
        const n = Math.floor(Number(v));
        this.maxPapers = Number.isFinite(n) ? Math.min(MAX_PROMPT_PAPERS, Math.max(1, n)) : DEFAULT_PROMPT_PAPERS;
      });
    });
    new Setting(contentEl).setName("Keep papers ranked").addDropdown((d) => {
      for (const [k, label] of Object.entries(TIER_CHOICES)) d.addOption(k, label);
      d.setValue(this.minTier).onChange((v) => { this.minTier = v as ReviewOptions["minTier"]; this.plan = null; });
    });
    new Setting(contentEl).setName("Include abstracts in the prompt").addToggle((t) => t.setValue(this.abstracts).onChange((v) => { this.abstracts = v; this.renderResult(); }));
    new Setting(contentEl).setName("Fetch again").setDesc("Ignore results saved in the last 24 hours. This spends credits again.").addToggle((t) => t.setValue(false).onChange((v) => { this.refresh = v; this.plan = null; }));
    const month = monthTotal(this.host.spend, monthOf(new Date()));
    new Setting(contentEl)
      .setName("Allow going over the spending limit")
      .setDesc(`The limit is ${usd(this.host.settings.reviewBudgetUsd)} for this review (Settings → Literature review); the free OpenAlex plan includes $1.00 a day. This month so far: ${month.requests} requests, about ${usd(month.usd)}.`)
      .addToggle((t) => t.setValue(false).onChange((v) => { this.allowMore = v; }));
    new Setting(contentEl).addButton((b) => b.setButtonText("Estimate the cost").setCta().onClick(() => void this.estimate()));
    this.out = contentEl.createDiv();
  }

  private options(): ReviewOptions | null {
    const year = Number(this.fromYear);
    if (!Number.isInteger(year) || year < 1900 || year > 2100) {
      new Notice("Enter a year such as 2020.");
      return null;
    }
    return { fromDate: `${year}-01-01`, capPerTopic: CAP_PER_TOPIC, maxPapers: this.maxPapers, minTier: this.minTier, refresh: this.refresh };
  }

  /** The searches in use: the recorded definitions of a repeat, or the current settings. */
  private feedList(): FeedConfig[] {
    return this.snapshotFeeds ?? this.host.settings.feeds;
  }

  private feeds() {
    return this.feedList().filter((f) => this.selected.has(f.id) && f.topics.length > 0);
  }

  /** The limit for a step that follows others: the usual one, or enough for this step when the user allowed it. */
  private limitFor(spent: number, extraUsd: number): number {
    return this.allowMore ? Math.max(this.host.settings.reviewBudgetUsd, spent + extraUsd) : this.host.settings.reviewBudgetUsd;
  }

  private async estimate(): Promise<void> {
    const opts = this.options();
    const feeds = this.feeds();
    if (opts === null) return;
    if (feeds.length === 0) {
      new Notice("Choose at least one search.");
      return;
    }
    this.out.empty();
    this.out.createEl("p", { text: "Counting what each topic matches (a tiny request each)…" });
    const budget = new Budget(this.host.settings.reviewBudgetUsd);
    try {
      this.plan = await planReview(feeds, opts, { client: this.host.newReviewClient(), cache: this.host.reviewCache, now: Date.now(), budget });
      this.spentSoFar = budget.spent;
    } catch (e) {
      this.plan = null;
      this.out.empty();
      this.out.createEl("p", { cls: "literature-feed-warning", text: e instanceof Error ? e.message : "The count failed." });
      return;
    }
    this.out.empty();
    const plan = this.plan;
    const table = this.out.createEl("table");
    const head = table.createEl("thead").createEl("tr");
    for (const h of ["Topic", "Matches", "To fetch", "Requests"]) head.createEl("th", { text: h });
    const body = table.createEl("tbody");
    for (const t of plan.topics) {
      const tr = body.createEl("tr");
      tr.createEl("td", { text: t.topic.length > 70 ? `${t.topic.slice(0, 69)}…` : t.topic });
      tr.createEl("td", { text: String(t.count) });
      tr.createEl("td", { text: t.fromCache ? `${t.fetch} (saved)` : String(t.fetch) });
      tr.createEl("td", { text: String(t.requests) });
    }
    const total = plan.estimate.usd + this.spentSoFar;
    this.out.createEl("p", {
      text: `${plan.estimate.works} works in ${plan.estimate.requests} requests: about ${usd(plan.estimate.usd)}, plus ${usd(this.spentSoFar)} already spent counting. The limit is ${usd(this.host.settings.reviewBudgetUsd)}.`,
    });
    if (plan.estimate.works >= plan.topics.length * CAP_PER_TOPIC) this.out.createEl("p", { cls: "literature-feed-meta", text: `Each topic is capped at ${CAP_PER_TOPIC} works, best matches first. Narrow the year to see more of the rest.` });
    const over = plan.overBudget && !this.allowMore;
    if (over) {
      this.out.createEl("p", { cls: "literature-feed-warning", text: `This would cost about ${usd(total)}, over your limit. Raise the year, choose fewer searches, or allow going over the limit above, once.` });
    }
    const monthly = passesMonthlyLimit(this.host.spend, monthOf(new Date()), plan.estimate.usd, this.host.settings.reviewMonthlyLimitUsd);
    if (monthly && !this.monthlyOk) {
      this.out.createEl("p", { cls: "literature-feed-warning", text: `This would take this month's requests over your monthly soft limit of ${usd(this.host.settings.reviewMonthlyLimitUsd)}.` });
      new Setting(this.out).addButton((b) => b.setButtonText("Allow this once").onClick(() => { this.monthlyOk = true; void this.estimate(); }));
    }
    new Setting(this.out).addButton((b) => {
      b.setButtonText(`Run the search (${usd(plan.estimate.usd)})`).setCta().onClick(() => void this.run());
      b.setDisabled(over || (monthly && !this.monthlyOk));
    });
  }

  private async run(): Promise<void> {
    const opts = this.options();
    const plan = this.plan;
    if (opts === null || plan === null) return;
    const feeds = this.feeds();
    const budget = new Budget(this.limitFor(this.spentSoFar, plan.estimate.usd));
    budget.add(this.spentSoFar);
    this.out.empty();
    this.out.createEl("p", { text: "Searching…" });
    try {
      this.result = await runReview(feeds, plan, opts, { client: this.host.newReviewClient(), cache: this.host.reviewCache, now: Date.now(), budget });
    } catch (e) {
      this.out.empty();
      this.out.createEl("p", { cls: "literature-feed-warning", text: `The search failed: ${e instanceof Error ? e.message : "unknown error"}` });
      return;
    }
    this.runMeta = runInfo(new Date(), feeds, opts, this.abstracts);
    await this.host.saveReviewCache();
    this.sources = this.host.flagSources();
    this.computeFlags();
    this.network = buildNetwork(this.result.papers);
    this.extras = null;
    this.rows = NO_ROWS();
    this.gaps = null;
    this.gapIndex = 0;
    this.answerText = "";
    this.checked = null;
    this.renderResult();
    this.save();
  }

  private flagsOfCandidate(c: Candidate): Flags {
    const sources = this.sources ?? this.host.flagSources();
    return flagsFor({ id: shortOpenAlexId(c.openalexId) ?? "", doi: c.doi ?? null, title: c.title }, sources);
  }

  private computeFlags(): void {
    if (!this.result) return;
    this.sources = this.host.flagSources();
    this.flags = this.result.papers.map((p) => flagsFor(p, this.sources as FlagSources));
    if (this.extras) this.rows = buildExtraRows(this.extras, (id) => this.labelOf(id), (c) => this.flagsOfCandidate(c));
  }

  private labelOf(id: string): string | undefined {
    const i = this.result?.papers.findIndex((p) => p.id === id) ?? -1;
    return i >= 0 ? paperLabel(i) : undefined;
  }

  private titleOf(id: string): string {
    return this.result?.papers.find((p) => p.id === id)?.title ?? id;
  }

  private names(): Map<string, string> {
    return new Map(this.feedList().map((f) => [f.id, f.name]));
  }

  private promptText(): string {
    if (!this.result) return "";
    const net = this.network;
    const hasNet = net !== null && (net.edges.length > 0 || this.rows.missing.length > 0 || this.rows.alsoCite.length > 0);
    return buildLitReviewPrompt({
      feeds: this.feeds(), papers: this.result.papers, flags: this.flags, total: this.result.total, names: this.names(),
      networkText: hasNet && net ? networkText(this.result.papers, net, this.rows, (id) => this.labelOf(id)) : undefined,
      options: { ...DEFAULT_PROMPT_OPTIONS, includeAbstracts: this.abstracts },
    });
  }

  private answerLabels(): Set<string> {
    const labels = new Set((this.result?.papers ?? []).map((_, i) => paperLabel(i)));
    for (const r of [...this.rows.missing, ...this.rows.alsoCite]) labels.add(r.label);
    return labels;
  }

  private renderResult(): void {
    const result = this.result;
    if (!result || !this.out) return;
    this.out.empty();
    const have = this.flags.filter((f) => f.zotero || f.vault).length;
    this.out.createEl("p", { text: `${result.papers.length}${result.total > result.papers.length ? ` of ${result.total}` : ""} papers kept. Spent about ${usd(result.spentUsd)}. ${have} you already have.` });
    if (result.stopped) this.out.createEl("p", { cls: "literature-feed-warning", text: `The search ${result.stopped}.` });
    this.renderChanges(result);
    this.renderGraphRow();

    new Setting(this.out)
      .setName("Already in Zotero?")
      .setDesc(this.host.settings.zoteroUserId === "" ? "Add your Zotero key and user ID in the settings to check." : "Reads your library (read-only) into a local index; the first time takes a few requests.")
      .addButton((b) => b.setButtonText("Check against Zotero").onClick(() => {
        b.setDisabled(true);
        this.host.refreshZoteroIndex().then(
          (message) => { new Notice(message); this.computeFlags(); this.renderResult(); },
          (e: unknown) => { new Notice(`Could not read Zotero: ${e instanceof Error ? e.message : "unknown error"}`, 8000); b.setDisabled(false); },
        );
      }));

    const table = this.out.createEl("table", { cls: "literature-feed-papers" });
    const head = table.createEl("thead").createEl("tr");
    for (const h of ["", "Paper", "Year", "Cited", "Rank", "Have"]) head.createEl("th", { text: h });
    const body = table.createEl("tbody");
    result.papers.forEach((p, i) => {
      const tr = body.createEl("tr");
      tr.createEl("td", { text: paperLabel(i) });
      tr.createEl("td", { text: p.title });
      tr.createEl("td", { text: p.year === null ? "" : String(p.year) });
      tr.createEl("td", { text: String(p.citedByCount) });
      tr.createEl("td", { text: p.tier });
      const f = this.flags[i];
      tr.createEl("td", { text: [f.zotero ? "Zotero" : "", f.vault ? "note" : "", f.listedBefore.length > 0 ? "listed" : ""].filter((x) => x !== "").join(", ") });
    });

    this.renderCharts();
    this.renderNetwork();
    this.renderGaps();

    const text = this.promptText();
    this.out.createEl("h4", { text: "Prompt for an LLM" });
    const preview = this.out.createEl("textarea", { cls: "literature-feed-prompt" });
    preview.readOnly = true;
    preview.rows = 10;
    preview.value = text;
    this.out.createDiv({ cls: "literature-feed-meta", text: `${text.length} characters. This is exactly what is copied.` });
    new Setting(this.out)
      .addButton((b) => b.setButtonText("Copy prompt").setCta().onClick(() => {
        navigator.clipboard.writeText(text).then(() => new Notice("Prompt copied. Paste it into your chat."), () => new Notice("Could not copy the prompt. Try saving it as a note instead."));
      }))
      .addButton((b) => b.setButtonText("Save prompt as note").onClick(() => {
        const name = `Literature review prompt ${today()}`;
        void this.host.createReviewNote(this.notePath(name), text).then((path) => { this.promptNote = path; this.saveSoon(); new Notice(`Saved as ${path}. Attach it to your chat as a file.`); });
      }));
    new Setting(this.out)
      .setName("LLM used (optional)")
      .setDesc("Recorded in the review note, with the prompt and the answer, so the review can be repeated.")
      .addText((t) => t.setPlaceholder("For example: model name and version").setValue(this.llm).onChange((v) => { this.llm = v; this.saveSoon(); }));
    new Setting(this.out)
      .setName("Keep the exact prompt with the note")
      .setDesc("Saves the prompt as its own note when you make the review note, because the data a search returns changes over time.")
      .addToggle((t) => t.setValue(this.keepPrompt).onChange((v) => { this.keepPrompt = v; }));

    this.out.createEl("h4", { text: "The LLM's answer" });
    const area = this.out.createEl("textarea", { cls: "literature-feed-prompt" });
    area.rows = 6;
    area.value = this.answerText;
    area.addEventListener("input", () => { this.answerText = area.value; this.saveSoon(); });
    const feedback = this.out.createDiv();
    new Setting(this.out)
      .addButton((b) => b.setButtonText("Check answer").onClick(() => this.checkAnswer(feedback)))
      .addButton((b) => b.setButtonText("Create review note").setCta().onClick(() => void this.createNote(feedback)));
  }

  /** When this repeats an earlier review: what is new, what is gone and what changed rank since then. */
  private renderChanges(result: ReviewResult): void {
    const base = this.baseline;
    if (!base) return;
    const c = diffPapers(base.papers, result.papers);
    this.out.createEl("p", { text: `Compared with the review of ${base.ranAt.slice(0, 10)}: ${c.added.length} new, ${c.removed.length} no longer returned, ${c.tierChanged.length} with a different rank.` });
    if (c.added.length + c.removed.length + c.tierChanged.length === 0) return;
    const details = this.out.createEl("details");
    details.createEl("summary", { text: "Show what changed" });
    const list = (title: string, items: string[]): void => {
      if (items.length === 0) return;
      details.createEl("h5", { text: title });
      const ul = details.createEl("ul");
      for (const t of items.slice(0, 25)) ul.createEl("li", { text: t });
      if (items.length > 25) ul.createEl("li", { text: `and ${items.length - 25} more` });
    };
    list("New", c.added.map((p) => p.title));
    list("No longer returned", c.removed.map((p) => p.title));
    list("Different rank", c.tierChanged.map((p) => `${p.title}: ${p.from} → ${p.to}`));
  }

  private chartSpecsNow() {
    if (!this.result || !this.network) return [];
    return chartSpecs(chartData(this.result.papers, this.network), (id) => this.labelOf(id) ?? id, (id) => this.titleOf(id));
  }

  private renderCharts(): void {
    const specs = this.chartSpecsNow();
    if (specs.length === 0) return;
    this.out.createEl("h4", { text: "Charts" });
    for (const spec of specs) drawChart(this.out, spec);
  }

  private renderNetwork(): void {
    const result = this.result;
    const net = this.network;
    if (!result || !net) return;
    this.out.createEl("h4", { text: "Citation network" });
    this.out.createEl("p", {
      text: `${net.edges.length} citations among these papers; ${net.clusters.length} group${net.clusters.length === 1 ? "" : "s"} that cite each other; ${net.isolated.length} with no link to another. This much needed no extra requests.`,
    });
    const cover = referenceCoverage(result.papers);
    this.out.createEl("p", {
      cls: cover.withList < cover.total * 0.7 ? "literature-feed-warning" : "literature-feed-meta",
      text: `OpenAlex lists references for ${cover.withList} of ${cover.total} papers${cover.withList < cover.total * 0.7 ? ", so the network is missing many links and the missing-paper counts are probably too low" : ""}.`,
    });
    const detailIds = Math.min(40, net.missing.length + 20);
    const requests = estimateNetworkRequests(result.papers.length, detailIds);
    if (this.extras === null) {
      new Setting(this.out)
        .setName("Find missing papers")
        .setDesc(`Works that several of these papers cite but that are not here, and works that cite several of them: about ${requests} requests, ${usd(requests * COST_FILTER)}.`)
        .addButton((b) => b.setButtonText("Find them").onClick(() => void this.findMissing(requests)));
    } else {
      if (this.extras.stopped) this.out.createEl("p", { cls: "literature-feed-warning", text: `The lookup ${this.extras.stopped}.` });
      for (const [title, list] of [["Possibly missing (cited by several of these)", this.rows.missing], ["Cite several of these", this.rows.alsoCite]] as const) {
        if (list.length === 0) continue;
        this.out.createEl("h5", { text: title });
        const t = this.out.createEl("table", { cls: "literature-feed-papers" });
        const h = t.createEl("thead").createEl("tr");
        for (const x of ["", "Paper", "Year", "Cited", "How it relates", "Have"]) h.createEl("th", { text: x });
        const b = t.createEl("tbody");
        for (const r of list) {
          const tr = b.createEl("tr");
          tr.createEl("td", { text: r.label });
          tr.createEl("td", { text: r.title });
          tr.createEl("td", { text: r.year === null ? "" : String(r.year) });
          tr.createEl("td", { text: String(r.citedBy) });
          tr.createEl("td", { text: r.detail });
          tr.createEl("td", { text: [r.flags.zotero ? "Zotero" : "", r.flags.vault ? "note" : ""].filter((x) => x !== "").join(", ") });
        }
      }
    }
  }

  /** The graph row, at the top of the results so it is easy to find. */
  private renderGraphRow(): void {
    new Setting(this.out)
      .setName("Citation graph")
      .setDesc("Opens in a tab (pan, zoom, click a paper). It is also put in the review note. The canvas is a file with a card per paper by year, and the citations between them.")
      .addButton((b) => b.setButtonText("Open graph").setCta().onClick(() => void this.openGraph()))
      .addButton((b) => b.setButtonText("Save canvas").onClick(() => void this.saveCanvas()));
  }

  private async findMissing(requests: number): Promise<void> {
    const result = this.result;
    const net = this.network;
    if (!result || !net) return;
    const extraUsd = requests * COST_FILTER;
    if (!this.allowMore && result.spentUsd + extraUsd > this.host.settings.reviewBudgetUsd + 1e-9) {
      new Notice(`That would take this review to about ${usd(result.spentUsd + extraUsd)}, over the ${usd(this.host.settings.reviewBudgetUsd)} limit. Allow going over the limit at the top to do it.`, 8000);
      return;
    }
    const budget = new Budget(this.limitFor(result.spentUsd, extraUsd));
    budget.add(result.spentUsd);
    new Notice("Looking up the citing and missing works…");
    try {
      this.extras = await fetchNetworkExtras(result.papers, net, { client: this.host.newReviewClient(), cache: this.host.reviewCache, now: Date.now(), budget });
    } catch (e) {
      new Notice(`The lookup failed: ${e instanceof Error ? e.message : "unknown error"}`, 8000);
      return;
    }
    result.spentUsd = budget.spent;
    await this.host.saveReviewCache();
    this.rows = buildExtraRows(this.extras, (id) => this.labelOf(id), (c) => this.flagsOfCandidate(c));
    this.checked = null;
    this.renderResult();
    this.save();
  }

  private renderGaps(): void {
    const result = this.result;
    if (!result || result.papers.length === 0) return;
    this.out.createEl("h4", { text: "Citation gaps of one paper" });
    this.out.createEl("p", { cls: "setting-item-description", text: "What many of a paper's own references cite, but the paper does not: works it may have missed." });
    const paper = result.papers[this.gapIndex] ?? result.papers[0];
    const requests = estimateGapRequests(paper.referencedWorks.length);
    new Setting(this.out)
      .setName("Paper")
      .addDropdown((d) => {
        for (const [i, p] of result.papers.entries()) d.addOption(String(i), `${paperLabel(i)} ${p.title.length > 60 ? `${p.title.slice(0, 59)}…` : p.title}`);
        d.setValue(String(this.gapIndex)).onChange((v) => { this.gapIndex = Number(v); this.gaps = null; this.renderResult(); });
      })
      .addButton((b) => {
        b.setButtonText(`Find gaps (about ${requests} requests)`).onClick(() => void this.findGaps(requests));
        b.setDisabled(paper.referencedWorks.length === 0);
      });
    if (paper.referencedWorks.length === 0) this.out.createEl("p", { cls: "literature-feed-meta", text: "No references are listed for this paper." });
    const gaps = this.gaps;
    if (gaps && gaps.paper === paper.id) {
      const g = gaps.result;
      this.out.createEl("p", { text: `Read ${g.referencesRead} of its ${paper.referencedWorks.length} references (${g.referencesWithLists} with a reference list${paper.referencedWorks.length > MAX_GAP_REFERENCES ? `; at most ${MAX_GAP_REFERENCES} are read` : ""}).` });
      if (g.stopped) this.out.createEl("p", { cls: "literature-feed-warning", text: `The lookup ${g.stopped}.` });
      if (g.gaps.length === 0) this.out.createEl("p", { text: "No work is cited by three or more of its references without also being cited by it." });
      g.gaps.forEach((x, i) => {
        const row = this.out.createDiv({ cls: "literature-feed-suggestion" });
        row.createDiv({ cls: "literature-feed-title", text: x.paper ? x.paper.title : x.gap.id });
        const f = gaps.flags[i];
        row.createDiv({ cls: "literature-feed-meta", text: [
          x.paper?.year ? String(x.paper.year) : "", `cited by ${x.gap.count} of its references (${Math.round(x.gap.share * 100)}%)`, x.paper?.citedByCount !== undefined ? `${x.paper.citedByCount} citations` : "",
          f.zotero ? "in Zotero" : "", f.vault ? "in the vault" : "",
        ].filter((s) => s !== "").join(" · ") });
      });
    }
  }

  private async findGaps(requests: number): Promise<void> {
    const result = this.result;
    if (!result) return;
    const paper = result.papers[this.gapIndex];
    if (!paper) return;
    const extraUsd = requests * COST_FILTER;
    if (!this.allowMore && result.spentUsd + extraUsd > this.host.settings.reviewBudgetUsd + 1e-9) {
      new Notice(`That would take this review to about ${usd(result.spentUsd + extraUsd)}, over the ${usd(this.host.settings.reviewBudgetUsd)} limit. Allow going over the limit at the top to do it.`, 8000);
      return;
    }
    const budget = new Budget(this.limitFor(result.spentUsd, extraUsd));
    budget.add(result.spentUsd);
    new Notice("Reading the paper's references…");
    try {
      const found = await fetchCitationGaps(paper, { client: this.host.newReviewClient(), cache: this.host.reviewCache, now: Date.now(), budget });
      this.gaps = { paper: paper.id, result: found, flags: found.gaps.map((x) => (x.paper ? this.flagsOfCandidate(x.paper) : { zotero: null, vault: null, listedBefore: [] })) };
    } catch (e) {
      new Notice(`The lookup failed: ${e instanceof Error ? e.message : "unknown error"}`, 8000);
      return;
    }
    result.spentUsd = budget.spent;
    await this.host.saveReviewCache();
    this.renderResult();
  }

  private citationLinks(): { missingCiters: Map<string, readonly string[]>; citingCites: Map<string, readonly string[]> } {
    const missingCiters = new Map((this.extras?.missing ?? []).flatMap((m) => { const id = shortOpenAlexId(m.paper.openalexId); return id ? [[id, m.citers] as const] : []; }));
    const citingCites = new Map((this.extras?.alsoCite ?? []).flatMap((a) => { const id = shortOpenAlexId(a.paper.openalexId); return id ? [[id, a.cites] as const] : []; }));
    return { missingCiters, citingCites };
  }

  /** The graph of what is on screen now (with the missing papers, if they were looked up, and the LLM's levels, if checked). */
  private currentGraph(): GraphData | null {
    const result = this.result;
    const net = this.network;
    if (!result || !net) return null;
    const levels = new Map((this.checked && this.checked.ok ? this.checked.value.priorities : []).map((p) => [p.paper, p.level] as const));
    const themes = this.checked && this.checked.ok ? this.checked.value.themes.map((t) => ({ name: t.name, papers: t.papers })) : [];
    return buildGraphData(result.papers, this.flags, net, this.rows, (id) => this.labelOf(id) ?? id, this.citationLinks(), levels, themes);
  }

  private async openGraph(): Promise<void> {
    const graph = this.currentGraph();
    if (graph) await this.host.openGraph(graph);
  }

  private async saveCanvas(): Promise<void> {
    const result = this.result;
    const net = this.network;
    if (!result || !net) return;
    const file = buildCanvas(result.papers, this.flags, net, this.rows, (id) => this.labelOf(id) ?? id, this.citationLinks());
    const folder = this.host.reviewFolder();
    const path = await this.host.createReviewNote(`${folder === "" ? "" : `${folder}/`}Literature review network ${today()}.canvas`, JSON.stringify(file), false);
    new Notice(`Canvas saved: ${path}`);
  }

  private notePath(name: string): string {
    const folder = this.host.reviewFolder();
    return `${folder === "" ? "" : `${folder}/`}${name}.md`;
  }

  private checkAnswer(feedback: HTMLElement): void {
    feedback.empty();
    this.checked = null;
    const json = extractJson(this.answerText);
    if (!json.ok) {
      for (const e of json.errors) feedback.createEl("p", { cls: "literature-feed-warning", text: e });
      return;
    }
    const checked = checkLitReviewAnswer(json.value, this.answerLabels());
    if (!checked.ok) {
      for (const e of checked.errors) feedback.createEl("p", { cls: "literature-feed-warning", text: e });
      return;
    }
    this.checked = checked;
    feedback.createEl("p", { text: `${checked.value.themes.length} themes, ${checked.value.priorities.length} papers rated, ${checked.value.gaps.length} gaps.` });
    for (const w of checked.warnings) feedback.createEl("p", { cls: "literature-feed-warning", text: w });
  }

  private async createNote(feedback: HTMLElement): Promise<void> {
    const result = this.result;
    if (!result) return;
    if (this.answerText.trim() !== "" && this.checked === null) this.checkAnswer(feedback);
    const answer = this.checked && this.checked.ok ? this.checked.value : null;
    if (this.answerText.trim() !== "" && answer === null) return; // the answer has problems: they are shown
    const searches = this.feeds().map((f) => f.name);
    const extra: string[] = [];
    const specs = this.chartSpecsNow();
    if (specs.length > 0) {
      extra.push("## Charts", "");
      for (const spec of specs) extra.push(...chartBlock(spec), "");
    }
    const graph = this.currentGraph();
    if (this.network) extra.push(...networkMarkdown(this.network, this.rows, (id) => this.labelOf(id), (id) => this.titleOf(id), graph && graph.nodes.length > 0 ? graphBlock(graph) : []));
    const promptText = this.promptText();
    if (this.keepPrompt && this.promptNote === null) this.promptNote = await this.host.createReviewNote(this.notePath(`Literature review prompt ${today()}`), promptText, false);
    const record = this.runMeta ? buildRecord({
      run: this.runMeta, result, coverage: referenceCoverage(result.papers),
      missing: (this.extras?.missing ?? []).map((m, i): RecordLink => ({ label: `M${i + 1}`, id: shortOpenAlexId(m.paper.openalexId) ?? "", count: m.count })),
      citing: (this.extras?.alsoCite ?? []).map((a, i): RecordLink => ({ label: citingLabel(i), id: shortOpenAlexId(a.paper.openalexId) ?? "", count: a.count })),
      llm: this.answerText.trim() === "" ? null : { name: this.llm.trim(), promptChars: promptText.length, promptHash: await sha256Hex(promptText), promptNote: this.promptNote, answer: this.answerText },
    }) : null;
    const text = renderReviewNote({
      date: today(), searches, fromDate: this.fromYear, papers: result.papers, flags: this.flags, total: result.total,
      spentUsd: result.spentUsd, stopped: result.stopped, answer, networkMarkdown: extra, extraRows: [...this.rows.missing, ...this.rows.alsoCite], record,
    }, this.names());
    const path = await this.host.createReviewNote(this.notePath(reviewNoteName(today(), searches)), text);
    new Notice(`Review note made: ${path}`);
  }
}
