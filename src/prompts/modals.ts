// The windows of the LLM prompt features: copy a prompt (after seeing exactly what is copied), then paste the LLM's JSON answer
// back and decide what to keep. Nothing is sent from here: the user does the pasting in and out of their own chat.
import { Modal, Notice, Setting, type App } from "obsidian";
import { parseFeedJson, type FeedConfig, type Settings } from "../settings/data";
import { applySuggestions, describeSuggestion } from "./apply";
import { buildComparePrompt, buildNewFeedPrompt, buildReviewPrompt, buildTopicPrompt, type TopicStatRow } from "./build";
import { decisionsForPrompt, recordDecisions, type Decision, type Decisions } from "./decisions";
import { checkCompareAnswer, checkReviewAnswer, checkTopicAnswer, extractJson, type Advice, type Suggestion } from "./schemas";

export type PromptKind = "review" | "topics" | "new" | "compare";

/** What the windows need from the plugin. */
export interface PromptHost {
  app: App;
  settings: Settings;
  saveSettings(): Promise<void>;
  decisions: Decisions;
  saveDecisions(): Promise<void>;
  /** The search-effectiveness report for one search, as Markdown. */
  reportFor(feedId: string): string;
  /** Titles of one search's wanted and dismissed papers. */
  titlesFor(feedId: string): { wanted: string[]; dismissed: string[] };
  topicStatsFor(feedId: string): TopicStatRow[];
  /** How one search's topics overlap, as Markdown ("" when there is nothing to show). */
  topicOverlapFor(feedId: string): string;
  /** For the compare prompt: a line per search and the overlap section of the report. */
  compareContext(): { summary: string; overlapMarkdown: string };
}

const TITLES: Record<PromptKind, string> = {
  review: "Review a search with an LLM",
  topics: "Tweak search terms with an LLM",
  new: "New search from a description with an LLM",
  compare: "Compare searches with an LLM",
};

const INTRO: Record<PromptKind, string> = {
  review: "Copies a prompt that gives an LLM this search, how it has done so far and what you decided before, and asks for changes as JSON. Nothing is sent from here: you paste the prompt into your own chat, and the answer back.",
  topics: "Copies a prompt that asks an LLM to review and tweak the search strings (topics) of one search, using what each topic returned and had dropped. Nothing is sent from here.",
  new: "Copies a prompt that asks an LLM to write a complete new search from your description. Attach your example papers (PDFs or pages) to the chat yourself: the plugin never reads them. Nothing is sent from here.",
  compare: "Copies a prompt that gives an LLM all your searches and how they overlap (papers listed under more than one, papers one search drops that another lists, topics that add nothing) and asks for advice. The advice is shown to you to read; you make any change by hand. Nothing is sent from here.",
};

function today(): string {
  const d = new Date();
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Step 1: choose what goes into the prompt, see it, copy it. */
export class PromptModal extends Modal {
  private feedId: string;
  private includeTitles = false;
  private note = "";
  private description = "";
  private exampleCount = 3;
  private preview!: HTMLTextAreaElement;
  private count!: HTMLElement;

  constructor(private readonly host: PromptHost, private readonly kind: PromptKind) {
    super(host.app);
    this.feedId = host.settings.feeds[0]?.id ?? "";
  }

  onOpen(): void {
    const { contentEl } = this;
    this.setTitle(TITLES[this.kind]);
    contentEl.createEl("p", { cls: "setting-item-description", text: INTRO[this.kind] });

    if (this.kind === "compare" && this.host.settings.feeds.length < 2) {
      contentEl.createEl("p", { text: "Comparing needs at least two searches. Add or import another first." });
      return;
    }
    if (this.kind !== "new" && this.kind !== "compare") {
      if (this.host.settings.feeds.length === 0) {
        contentEl.createEl("p", { text: "There is no search yet. Add or import one in the settings first." });
        return;
      }
      new Setting(contentEl).setName("Search").addDropdown((d) => {
        for (const f of this.host.settings.feeds) d.addOption(f.id, f.name);
        d.setValue(this.feedId).onChange((v) => { this.feedId = v; this.refresh(); });
      });
    }
    if (this.kind === "review") {
      new Setting(contentEl)
        .setName("Include paper titles")
        .setDesc("Adds the titles of wanted and dismissed papers to the prompt. Off: only numbers and terms are included.")
        .addToggle((t) => t.setValue(false).onChange((v) => { this.includeTitles = v; this.refresh(); }));
    }
    if (this.kind === "topics") {
      new Setting(contentEl).setName("What are you after").setDesc("Optional, in your own words.").addTextArea((t) => {
        t.inputEl.rows = 3;
        t.inputEl.addClass("literature-feed-wide");
        t.onChange((v) => { this.note = v; this.refresh(); });
      });
    }
    if (this.kind === "new") {
      new Setting(contentEl).setName("What do you want to follow?").addTextArea((t) => {
        t.inputEl.rows = 4;
        t.inputEl.addClass("literature-feed-wide");
        t.onChange((v) => { this.description = v; this.refresh(); });
      });
      new Setting(contentEl)
        .setName("Example papers you will attach")
        .setDesc("How many files or web pages you will attach to the chat (0 to 20).")
        .addText((t) => {
          t.inputEl.type = "number";
          t.inputEl.min = "0";
          t.inputEl.max = "20";
          t.setValue(String(this.exampleCount)).onChange((v) => {
            const n = Number(v);
            this.exampleCount = Number.isFinite(n) ? Math.min(20, Math.max(0, Math.floor(n))) : 0;
            this.refresh();
          });
        });
    }

    contentEl.createEl("p", { cls: "setting-item-description", text: "This is exactly what will be copied:" });
    this.preview = contentEl.createEl("textarea", { cls: "literature-feed-prompt" });
    this.preview.readOnly = true;
    this.preview.rows = 14;
    this.count = contentEl.createDiv({ cls: "literature-feed-meta" });
    new Setting(contentEl)
      .addButton((b) => b.setButtonText("Copy prompt").setCta().onClick(() => {
        navigator.clipboard.writeText(this.preview.value).then(
          () => new Notice("Prompt copied. Paste it into your chat."),
          () => new Notice("Could not copy the prompt."),
        );
      }))
      .addButton((b) => b.setButtonText("Paste the answer").onClick(() => {
        this.close();
        new AnswerModal(this.host, this.kind, this.feedId).open();
      }));
    this.refresh();
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private feed(): FeedConfig | undefined {
    return this.host.settings.feeds.find((f) => f.id === this.feedId);
  }

  private refresh(): void {
    const text = this.build();
    this.preview.value = text;
    this.count.setText(`${text.length} characters`);
  }

  private build(): string {
    if (this.kind === "new") return buildNewFeedPrompt({ description: this.description, exampleCount: this.exampleCount });
    if (this.kind === "compare") return buildComparePrompt({ feeds: this.host.settings.feeds, ...this.host.compareContext() });
    const feed = this.feed();
    if (!feed) return "";
    if (this.kind === "topics") return buildTopicPrompt({ feed, stats: this.host.topicStatsFor(feed.id), note: this.note, topicOverlap: this.host.topicOverlapFor(feed.id) });
    const { accepted, rejected } = decisionsForPrompt(this.host.decisions, feed.id);
    return buildReviewPrompt({
      feed, reportMarkdown: this.host.reportFor(feed.id), accepted, rejected,
      titles: this.includeTitles ? this.host.titlesFor(feed.id) : undefined,
    });
  }
}

type Verdict = "accepted" | "rejected" | null;

/** Step 2: paste the answer, check it, decide on each change. */
export class AnswerModal extends Modal {
  private text = "";
  private result!: HTMLElement;

  constructor(private readonly host: PromptHost, private readonly kind: PromptKind, private readonly feedId: string) {
    super(host.app);
  }

  onOpen(): void {
    const { contentEl } = this;
    this.setTitle(`${TITLES[this.kind]}: the answer`);
    contentEl.createEl("p", { cls: "setting-item-description", text: "Paste the LLM's whole reply. Only the JSON in it is used, and nothing changes until you choose." });
    const area = contentEl.createEl("textarea", { cls: "literature-feed-prompt" });
    area.rows = 8;
    area.addEventListener("input", () => { this.text = area.value; });
    new Setting(contentEl).addButton((b) => b.setButtonText("Check answer").setCta().onClick(() => this.check()));
    this.result = contentEl.createDiv();
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private problems(errors: readonly string[]): void {
    this.result.empty();
    for (const e of errors) this.result.createEl("p", { cls: "literature-feed-warning", text: e });
  }

  private check(): void {
    const json = extractJson(this.text);
    if (!json.ok) return this.problems(json.errors);
    if (this.kind === "new") return this.checkNewFeed(json.value);
    if (this.kind === "compare") return this.showAdvice(json.value);
    const checked = this.kind === "review" ? checkReviewAnswer(json.value) : checkTopicAnswer(json.value);
    if (!checked.ok) return this.problems(checked.errors);
    this.showSuggestions(checked.value);
  }

  /** The compare answer is advice to read, not changes to apply. */
  private showAdvice(value: unknown): void {
    const checked = checkCompareAnswer(value);
    if (!checked.ok) return this.problems(checked.errors);
    this.result.empty();
    this.result.createEl("p", { text: "Advice from the LLM. Nothing here is applied: change the searches by hand in the settings if you agree." });
    for (const a of checked.value) {
      const row = this.result.createDiv({ cls: "literature-feed-suggestion" });
      row.createDiv({ cls: "literature-feed-title", text: `${a.search}: ${a.action}${a.with !== "" ? ` (with ${a.with})` : ""}` });
      row.createDiv({ text: a.advice });
      if (a.reason !== "") row.createDiv({ cls: "literature-feed-meta", text: a.reason });
    }
    const text = checked.value.map((a: Advice) => `- ${a.search}: ${a.action}${a.with !== "" ? ` (with ${a.with})` : ""}. ${a.advice}${a.reason !== "" ? ` (${a.reason})` : ""}`).join("\n");
    new Setting(this.result).addButton((b) => b.setButtonText("Copy advice").onClick(() => {
      navigator.clipboard.writeText(text).then(() => new Notice("Advice copied."), () => new Notice("Could not copy the advice."));
    }));
  }

  private checkNewFeed(value: unknown): void {
    const parsed = parseFeedJson(JSON.stringify(value), this.host.settings.feeds);
    if (!parsed.feed) return this.problems(parsed.errors);
    const feed = parsed.feed;
    this.result.empty();
    this.result.createEl("p", { text: `"${feed.name}": ${feed.topics.length} topics, ${feed.groups.length} groups, ${feed.drop.length} drop terms, ${feed.lower.length} lower terms. It is added switched off.` });
    const notes = typeof (value as { notes?: unknown }).notes === "string" ? (value as { notes: string }).notes.trim() : "";
    if (notes !== "") {
      this.result.createEl("p", { cls: "setting-item-description", text: "The LLM's notes:" });
      this.result.createEl("p", { text: notes });
    }
    new Setting(this.result).addButton((b) => b.setButtonText("Add this search").setCta().onClick(() => {
      this.host.settings.feeds.push(feed);
      void this.host.saveSettings().then(() => {
        new Notice(`Added "${feed.name}", switched off. Open it in the settings, try Test, then switch it on.`);
        this.close();
      });
    }));
  }

  private showSuggestions(suggestions: readonly Suggestion[]): void {
    const feed = this.host.settings.feeds.find((f) => f.id === this.feedId);
    this.result.empty();
    if (!feed) {
      this.problems(["That search no longer exists."]);
      return;
    }
    this.result.createEl("p", { text: `${suggestions.length} suggestion${suggestions.length === 1 ? "" : "s"}. Accept or reject each; the ones you leave open are neither applied nor remembered.` });
    const verdicts: Verdict[] = suggestions.map(() => null);
    const reasons: string[] = suggestions.map(() => "");
    suggestions.forEach((s, i) => {
      const row = this.result.createDiv({ cls: "literature-feed-suggestion" });
      row.createDiv({ cls: "literature-feed-title", text: describeSuggestion(s) });
      if (s.reason !== "") row.createDiv({ cls: "literature-feed-meta", text: s.reason });
      const buttons = row.createDiv({ cls: "literature-feed-buttons" });
      const accept = buttons.createEl("button", { text: "Accept" });
      const reject = buttons.createEl("button", { text: "Reject" });
      const why = buttons.createEl("input", { type: "text", placeholder: "Why? (optional, remembered for the next review)" });
      why.addEventListener("input", () => { reasons[i] = why.value; });
      const mark = (v: Verdict): void => {
        verdicts[i] = verdicts[i] === v ? null : v;
        accept.toggleClass("is-accepted", verdicts[i] === "accepted");
        reject.toggleClass("is-rejected", verdicts[i] === "rejected");
        row.toggleClass("is-accepted", verdicts[i] === "accepted");
        row.toggleClass("is-rejected", verdicts[i] === "rejected");
      };
      accept.addEventListener("click", () => mark("accepted"));
      reject.addEventListener("click", () => mark("rejected"));
    });
    const errors = this.result.createDiv();
    new Setting(this.result).addButton((b) => b.setButtonText("Apply decisions").setCta().onClick(() => {
      void this.apply(feed, suggestions, verdicts, reasons, errors);
    }));
  }

  private async apply(feed: FeedConfig, suggestions: readonly Suggestion[], verdicts: readonly Verdict[], reasons: readonly string[], errors: HTMLElement): Promise<void> {
    errors.empty();
    const accepted = suggestions.filter((_, i) => verdicts[i] === "accepted");
    const decided = suggestions.filter((_, i) => verdicts[i] !== null);
    if (decided.length === 0) {
      errors.createEl("p", { cls: "literature-feed-warning", text: "Accept or reject at least one suggestion first." });
      return;
    }
    const result = applySuggestions(feed, accepted);
    if (accepted.length > 0) {
      feed.topics = result.feed.topics;
      feed.groups = result.feed.groups;
      feed.drop = result.feed.drop;
      feed.lower = result.feed.lower;
      await this.host.saveSettings();
    }
    const day = today();
    const items: Decision[] = [];
    suggestions.forEach((s, i) => {
      const verdict = verdicts[i];
      if (verdict === null) return;
      // A suggestion that could not be applied is not remembered as accepted.
      if (verdict === "accepted" && result.errors.some((e) => e.startsWith(`${describeSuggestion(s)}:`))) return;
      items.push({ at: day, feedId: feed.id, kind: s.kind, summary: describeSuggestion(s), llmReason: s.reason, verdict, userReason: reasons[i].trim() });
    });
    recordDecisions(this.host.decisions, items);
    await this.host.saveDecisions();
    if (result.errors.length > 0) {
      for (const e of result.errors) errors.createEl("p", { cls: "literature-feed-warning", text: `Not applied: ${e}` });
      new Notice(`Applied ${accepted.length - result.errors.length} change(s); ${result.errors.length} could not be applied.`, 8000);
      return;
    }
    new Notice(`Applied ${accepted.length} change${accepted.length === 1 ? "" : "s"}; ${decided.length - accepted.length} rejected. Open the search in the settings and try Test.`, 8000);
    this.close();
  }
}
