// The "Generate literature review" window: choose searches and limits, see what the search will cost before it runs, run it within
// the budget, see the papers with what you already have of them, charts and the citation network, copy the prompt for an LLM,
// paste its answer back, and make the review note. Nothing is sent from here except the OpenAlex searches the user starts; the
// prompt only goes to the clipboard.
import { Modal, Notice, Setting, type App } from "obsidian";
import { shortOpenAlexId } from "../inbox/write";
import type { Candidate } from "../openalex/client";
import { extractJson } from "../prompts/schemas";
import type { Settings } from "../settings/data";
import { Budget, CAP_PER_TOPIC, DEFAULT_PROMPT_PAPERS, MAX_PROMPT_PAPERS, monthOf, monthTotal, passesMonthlyLimit, type SpendTally } from "./budget";
import type { ReviewCache } from "./cache";
import { buildCanvas } from "./canvas";
import { chartBlock, chartSpecs } from "./chart";
import { drawChart } from "./chart-view";
import { planReview, runReview, type ReviewClient, type ReviewOptions, type ReviewPlan, type ReviewResult } from "./collect";
import { flagsFor, type FlagSources, type Flags } from "./flags";
import { buildNetwork, chartData, type Network } from "./network";
import { MAX_GAP_REFERENCES, estimateGapRequests, estimateNetworkRequests, fetchCitationGaps, fetchNetworkExtras, type GapResult, type NetworkClient, type NetworkExtras } from "./network-fetch";
import { buildExtraRows, networkMarkdown, networkText, type ExtraRow } from "./network-text";
import { renderReviewNote, reviewNoteName } from "./note";
import { DEFAULT_PROMPT_OPTIONS, buildLitReviewPrompt, checkLitReviewAnswer, paperLabel, type LitChecked } from "./prompt";

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
  /** Makes a file (adding a number to the name when it exists), opens it when asked, and returns its path. */
  createReviewNote(path: string, text: string, open?: boolean): Promise<string>;
}

const TIER_CHOICES: Record<ReviewOptions["minTier"], string> = { possible: "Possible and better", strong: "Strong and better", priority: "Priority only" };

function today(): string {
  const d = new Date();
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function usd(n: number): string {
  return `$${n.toFixed(3)}`;
}

const NO_ROWS = (): { missing: ExtraRow[]; alsoCite: ExtraRow[] } => ({ missing: [], alsoCite: [] });

export class ReviewModal extends Modal {
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

  constructor(private readonly host: ReviewHost) {
    super(host.app);
    const feeds = host.settings.feeds;
    this.selected = new Set(feeds.filter((f) => f.topics.length > 0).map((f) => f.id));
    const years = feeds.map((f) => f.yearsFrom).filter((y): y is number => y !== null);
    this.fromYear = String(years.length > 0 ? Math.min(...years) : new Date().getFullYear() - 5);
  }

  onOpen(): void {
    this.setTitle("Generate literature review");
    const { contentEl } = this;
    const feeds = this.host.settings.feeds.filter((f) => f.topics.length > 0);
    if (feeds.length === 0) {
      contentEl.createEl("p", { text: "There is no search with topics yet. Add or import one in the settings first." });
      return;
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
      .setDesc(`The limit is ${usd(this.host.settings.reviewBudgetUsd)} for this review (Settings → Literature review). This month so far: ${month.requests} requests, about ${usd(month.usd)}.`)
      .addToggle((t) => t.setValue(false).onChange((v) => { this.allowMore = v; }));
    new Setting(contentEl).addButton((b) => b.setButtonText("Estimate the cost").setCta().onClick(() => void this.estimate()));
    this.out = contentEl.createDiv();
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private options(): ReviewOptions | null {
    const year = Number(this.fromYear);
    if (!Number.isInteger(year) || year < 1900 || year > 2100) {
      new Notice("Enter a year such as 2020.");
      return null;
    }
    return { fromDate: `${year}-01-01`, capPerTopic: CAP_PER_TOPIC, maxPapers: this.maxPapers, minTier: this.minTier, refresh: this.refresh };
  }

  private feeds() {
    return this.host.settings.feeds.filter((f) => this.selected.has(f.id) && f.topics.length > 0);
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
    return new Map(this.host.settings.feeds.map((f) => [f.id, f.name]));
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
        void this.host.createReviewNote(this.notePath(name), text).then((path) => new Notice(`Saved as ${path}. Attach it to your chat as a file.`));
      }));

    this.out.createEl("h4", { text: "The LLM's answer" });
    const area = this.out.createEl("textarea", { cls: "literature-feed-prompt" });
    area.rows = 6;
    area.value = this.answerText;
    area.addEventListener("input", () => { this.answerText = area.value; });
    const feedback = this.out.createDiv();
    new Setting(this.out)
      .addButton((b) => b.setButtonText("Check answer").onClick(() => this.checkAnswer(feedback)))
      .addButton((b) => b.setButtonText("Create review note").setCta().onClick(() => void this.createNote(feedback)));
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
    const detailIds = Math.min(40, net.missing.length + 20);
    const requests = estimateNetworkRequests(result.papers.length, detailIds);
    if (this.extras === null) {
      new Setting(this.out)
        .setName("Find missing papers")
        .setDesc(`Works that several of these papers cite but that are not here, and works that cite several of them: about ${requests} requests, ${usd(requests * 0.001)}.`)
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
    new Setting(this.out).setName("Network as a canvas").setDesc("A canvas file with a card per paper by year, and the citations between them.").addButton((b) => b.setButtonText("Save canvas").onClick(() => void this.saveCanvas()));
  }

  private async findMissing(requests: number): Promise<void> {
    const result = this.result;
    const net = this.network;
    if (!result || !net) return;
    const extraUsd = requests * 0.001;
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
    const extraUsd = requests * 0.001;
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

  private async saveCanvas(): Promise<void> {
    const result = this.result;
    const net = this.network;
    if (!result || !net) return;
    const missingCiters = new Map((this.extras?.missing ?? []).flatMap((m) => { const id = shortOpenAlexId(m.paper.openalexId); return id ? [[id, m.citers] as const] : []; }));
    const citingCites = new Map((this.extras?.alsoCite ?? []).flatMap((a) => { const id = shortOpenAlexId(a.paper.openalexId); return id ? [[id, a.cites] as const] : []; }));
    const file = buildCanvas(result.papers, this.flags, net, this.rows, (id) => this.labelOf(id) ?? id, { missingCiters, citingCites });
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
    if (this.network) extra.push(...networkMarkdown(this.network, this.rows, (id) => this.labelOf(id), (id) => this.titleOf(id)));
    const text = renderReviewNote({
      date: today(), searches, fromDate: this.fromYear, papers: result.papers, flags: this.flags, total: result.total,
      spentUsd: result.spentUsd, stopped: result.stopped, answer, networkMarkdown: extra, extraRows: [...this.rows.missing, ...this.rows.alsoCite],
    }, this.names());
    const path = await this.host.createReviewNote(this.notePath(reviewNoteName(today(), searches)), text);
    new Notice(`Review note made: ${path}`);
    this.close();
  }
}
