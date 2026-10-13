// The "Generate literature review" window: choose searches and limits, see what the search will cost before it runs, run it within
// the budget, see the papers with what you already have of them, copy the prompt for an LLM, paste its answer back, and make the
// review note. Nothing is sent from here except the OpenAlex searches the user starts; the prompt only goes to the clipboard.
import { Modal, Notice, Setting, type App } from "obsidian";
import type { Settings } from "../settings/data";
import { extractJson } from "../prompts/schemas";
import { Budget, CAP_PER_TOPIC, DEFAULT_PROMPT_PAPERS, MAX_PROMPT_PAPERS, monthOf, monthTotal, passesMonthlyLimit, type SpendTally } from "./budget";
import type { ReviewCache } from "./cache";
import { planReview, runReview, type ReviewClient, type ReviewOptions, type ReviewPlan, type ReviewResult } from "./collect";
import { flagsFor, type FlagSources, type Flags } from "./flags";
import { renderReviewNote, reviewNoteName } from "./note";
import { DEFAULT_PROMPT_OPTIONS, buildLitReviewPrompt, checkLitReviewAnswer, paperLabel, type LitChecked } from "./prompt";

/** What the window needs from the plugin. */
export interface ReviewHost {
  app: App;
  settings: Settings;
  newReviewClient(): ReviewClient;
  reviewCache: ReviewCache;
  saveReviewCache(): Promise<void>;
  spend: SpendTally;
  /** Reads the Zotero library into the local index (read-only) and says what it found. */
  refreshZoteroIndex(): Promise<string>;
  flagSources(): FlagSources;
  /** The folder review notes go in ("" = the vault root). */
  reviewFolder(): string;
  /** Makes a note (adding a number to the name when it exists), opens it, and returns its path. */
  createReviewNote(path: string, text: string): Promise<string>;
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
    new Setting(contentEl)
      .setName("Spending limit")
      .setDesc(`${usd(this.host.settings.reviewBudgetUsd)} for this review (Settings → Literature review). This month so far: ${monthTotal(this.host.spend, monthOf(new Date())).requests} requests, about ${usd(monthTotal(this.host.spend, monthOf(new Date())).usd)}.`)
      .addToggle((t) => t.setValue(false).onChange((v) => { this.allowMore = v; })).setTooltip("Allow going over the limit for this review");
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
      this.out.createEl("p", { cls: "literature-feed-warning", text: `This would cost about ${usd(total)}, over your limit. Raise the year, choose fewer searches, or switch on "Spending limit" above to allow it once.` });
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
    const limit = this.allowMore ? Math.max(this.host.settings.reviewBudgetUsd, plan.estimate.usd + this.spentSoFar) : this.host.settings.reviewBudgetUsd;
    const budget = new Budget(limit);
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
    this.computeFlags();
    this.answerText = "";
    this.checked = null;
    this.renderResult();
  }

  private computeFlags(): void {
    if (!this.result) return;
    const sources = this.host.flagSources();
    this.flags = this.result.papers.map((p) => flagsFor(p, sources));
  }

  private names(): Map<string, string> {
    return new Map(this.host.settings.feeds.map((f) => [f.id, f.name]));
  }

  private promptText(): string {
    if (!this.result) return "";
    return buildLitReviewPrompt({
      feeds: this.feeds(), papers: this.result.papers, flags: this.flags, total: this.result.total, names: this.names(),
      options: { ...DEFAULT_PROMPT_OPTIONS, includeAbstracts: this.abstracts },
    });
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
    const labels = new Set((this.result?.papers ?? []).map((_, i) => paperLabel(i)));
    const checked = checkLitReviewAnswer(json.value, labels);
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
    const text = renderReviewNote({
      date: today(), searches, fromDate: this.fromYear, papers: result.papers, flags: this.flags, total: result.total,
      spentUsd: result.spentUsd, stopped: result.stopped, answer,
    }, this.names());
    const path = await this.host.createReviewNote(this.notePath(reviewNoteName(today(), searches)), text);
    new Notice(`Review note made: ${path}`);
    this.close();
  }
}
