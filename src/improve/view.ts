// The Improve tab of one search: how it is doing, how it overlaps the other searches, how its known papers link, search strings built
// from those papers, and the LLM prompts. The numbers come from `model.ts`; this file only fetches and draws. The search is kept in
// the tab's state, so the tab comes back after a restart.
import { ItemView, Notice, type App, type ViewStateResult, type WorkspaceLeaf } from "obsidian";
import { COST_FILTER } from "../review/budget";
import type { ReviewCache } from "../review/cache";
import { describeKnown, knownPapers } from "../review/known";
import type { ReviewHost } from "../review/window";
import { buildSeedProfile, type SeedProfile } from "../review/seeds";
import type { FeedConfig, Settings } from "../settings/data";
import type { ZoteroIndex } from "../zotero/library-index";
import { createReportBar } from "../ui/report-bar";
import { createSection } from "../ui/section";
import { DataTable, type Column } from "../ui/data-table";
import { buildImprove, pairFrom, LEAVE_ONE_OUT_MAX, type ImproveModel } from "./model";
import { rateOf, type Report, type TopicRow } from "../ledger/report";

export const IMPROVE_VIEW = "literature-feed-improve";
// Capitalised words (OpenAlex) sit in constants because the sentence-case lint rule reads literals only.
const NOT_FOUND = "None of the known papers were found in OpenAlex.";

/** What the tab needs from the plugin. */
export interface ImproveHost {
  app: App;
  settings: Settings;
  /** The effectiveness report from the ledger, brought up to date from the inbox notes first. */
  improveReport(): Promise<Report>;
  zoteroIndex: ZoteroIndex;
  refreshZoteroIndex(): Promise<string>;
  newReviewClient: ReviewHost["newReviewClient"];
  reviewCache: ReviewCache;
  saveReviewCache(): Promise<void>;
  /** Adds a search string to a search (it is saved) and says what happened. */
  addTopicToFeed(feedId: string, topic: string): Promise<string>;
  /** Opens one of the LLM prompt windows. */
  openPrompt(kind: "review" | "topics" | "new" | "compare"): Promise<void>;
  /** Adds an OpenAlex request's cost to the monthly tally. */
  recordSpend(usd: number): void;
}

const pct = (r: number | null): string => (r === null ? "none decided" : `${Math.round(r * 100)}%`);

export class ImproveView extends ItemView {
  private feedId = "";
  private profile: SeedProfile | null = null;
  private report: Report | null = null;

  constructor(leaf: WorkspaceLeaf, private readonly host: ImproveHost) {
    super(leaf);
  }

  getViewType(): string {
    return IMPROVE_VIEW;
  }

  getDisplayText(): string {
    const name = this.host.settings.feeds.find((f) => f.id === this.feedId)?.name;
    return name ? `Improve: ${name}` : "Improve a search";
  }

  getIcon(): string {
    return "sliders-horizontal";
  }

  getState(): Record<string, unknown> {
    return { feedId: this.feedId };
  }

  async setState(state: unknown, result: ViewStateResult): Promise<void> {
    const id = typeof state === "object" && state !== null && "feedId" in state ? state.feedId : "";
    const next = typeof id === "string" ? id : "";
    if (next !== this.feedId) this.profile = null;
    this.feedId = next;
    await super.setState(state, result);
    await this.reload();
  }

  async onOpen(): Promise<void> {
    this.contentEl.addClass("literature-feed-review");
    await this.reload();
  }

  /** Reads the report again and draws every section. */
  async reload(): Promise<void> {
    this.contentEl.empty();
    const feed = this.host.settings.feeds.find((f) => f.id === this.feedId);
    if (!feed) {
      this.contentEl.createEl("p", { cls: "literature-feed-meta", text: this.feedId === "" ? "Choose a search to improve from its card, its settings row or the Find papers menu." : "That search no longer exists." });
      return;
    }
    try {
      this.report = await this.host.improveReport();
    } catch (e) {
      this.contentEl.createEl("p", { cls: "literature-feed-warning", text: `Could not read the numbers: ${e instanceof Error ? e.message : "unknown error"}` });
      return;
    }
    this.draw(feed);
  }

  private draw(feed: FeedConfig): void {
    const report = this.report;
    if (!report) return;
    const el = this.contentEl;
    el.empty();
    const known = knownPapers(feed, this.host.zoteroIndex);
    const background = Object.values(this.host.reviewCache.topics).flatMap((t) => t.papers.map((c) => `${c.title}\n${c.abstract ?? ""}`)).slice(0, 4000);
    const m = buildImprove(feed, report, known, this.profile, background);

    createReportBar(el, [`Improve: ${m.name}`, `${known.dois.length} known papers`], [
      { text: "Refresh", onClick: () => void this.reload() },
    ]);
    this.drawDoing(el, m);
    this.drawOverlap(el, m);
    this.drawCoherence(el, m);
    this.drawStrings(el, m, known);
    this.drawLlm(el);
  }

  private drawDoing(el: HTMLElement, m: ImproveModel): void {
    const s = createSection(el, { title: "How it is doing", desc: "From the papers each scan listed and what you did with them.", app: this.host.app, storageKey: "improve-doing" });
    if (m.doing.status === "none" || !m.doing.report) {
      s.body.createEl("p", { cls: "literature-feed-meta", text: "No papers of this search are in the ledger yet. Scan, tick or dismiss some papers first." });
      return;
    }
    const r = m.doing.report;
    s.body.createEl("p", { text: `${r.totals.listed} papers listed, ${r.totals.interested} wanted, ${r.totals.dismissed} dismissed, ${r.totals.undecided} not decided. Wanted: ${pct(m.doing.rate)} of the decided ones.` });
    if (m.doing.weak) s.body.createEl("p", { cls: "literature-feed-warning", text: `Fewer than 20 decided papers (${m.doing.decided}): treat these rates as weak evidence.` });
    const columns: Column<TopicRow>[] = [
      { key: "topic", label: "No.", sortable: true, compare: (a, b) => a.topic - b.topic, csv: (t) => t.topic, render: (td, t) => td.setText(String(t.topic)) },
      { key: "text", label: "Search string", sortable: true, compare: (a, b) => a.text.localeCompare(b.text), csv: (t) => t.text, render: (td, t) => td.createEl("code", { text: t.text }) },
      { key: "listed", label: "Listed", sortable: true, compare: (a, b) => a.counts.listed - b.counts.listed, csv: (t) => t.counts.listed, render: (td, t) => td.setText(String(t.counts.listed)), align: "end" },
      { key: "wanted", label: "Wanted", sortable: true, compare: (a, b) => (rateOf(a.counts) ?? -1) - (rateOf(b.counts) ?? -1), csv: (t) => pct(rateOf(t.counts)), render: (td, t) => td.setText(pct(rateOf(t.counts))), align: "end" },
      { key: "dropped", label: "Dropped by rules", csv: (t) => t.dropped, render: (td, t) => td.setText(String(t.dropped)), align: "end", secondary: true },
    ];
    const table = new DataTable<TopicRow>(s.body, {
      app: this.host.app, storageKey: "improve-topics", columns, chips: [{ key: "all", label: "All", test: () => true }], searchText: (t) => t.text, rowKey: (t) => String(t.topic),
      defaultView: { chip: "all", query: "", sort: { by: "topic", desc: false } }, empty: "No search strings.", searchLabel: "Search the strings",
    });
    table.setRows(r.byTopic);
  }

  private drawOverlap(el: HTMLElement, m: ImproveModel): void {
    const s = createSection(el, { title: "Overlap with other searches", desc: "Papers listed under both searches, and papers one search's rules drop that the other lists.", app: this.host.app, storageKey: "improve-overlap" });
    if (m.overlap.pairs.length === 0) {
      s.body.createEl("p", { cls: "literature-feed-meta", text: "No other search has listed papers yet, so there is nothing to compare." });
    }
    for (const p of m.overlap.pairs) {
      const v = pairFrom(p, m.feedId);
      const box = s.body.createDiv({ cls: "literature-feed-detailwork" });
      box.createEl("strong", { text: v.other });
      box.createDiv({ cls: "literature-feed-meta", text: `${v.mine} listed here, ${v.theirs} there, ${v.both} under both.` });
      if (v.myRulesDropped.count > 0) box.createDiv({ cls: "literature-feed-meta", text: `This search's rules dropped ${v.myRulesDropped.count} that ${v.other} listed (${v.myRulesDropped.wanted} wanted there).` });
      if (v.theirRulesDropped.count > 0) box.createDiv({ cls: "literature-feed-meta", text: `${v.other}'s rules dropped ${v.theirRulesDropped.count} that this search listed (${v.theirRulesDropped.wanted} wanted here).` });
    }
    if (m.overlap.topics && m.overlap.topics.lines.length > 0) for (const l of m.overlap.topics.lines) s.body.createDiv({ cls: "literature-feed-meta", text: l });
  }

  private drawCoherence(el: HTMLElement, m: ImproveModel): void {
    const s = createSection(el, { title: "How your papers link", desc: "Whether the known papers of this search form one path: outliers and strands.", app: this.host.app, storageKey: "improve-coherence" });
    if (m.coherence.status === "no-profile") {
      s.body.createEl("p", { cls: "literature-feed-meta", text: m.hasKnown ? "Read the known papers below to check how they link." : "This search has no known papers yet. Put papers in its seed collection (Check setup can create it) or add DOIs in its settings." });
      return;
    }
    if (m.coherence.lines.length === 0) s.body.createEl("p", { cls: "literature-feed-meta", text: "Too few papers to say how they link." });
    for (const l of m.coherence.lines) s.body.createDiv({ cls: "literature-feed-meta", text: l });
  }

  private drawStrings(el: HTMLElement, m: ImproveModel, known: ReturnType<typeof knownPapers>): void {
    const s = createSection(el, { title: "From your known papers", desc: "Search strings built from the phrases your known papers share.", app: this.host.app, storageKey: "improve-strings" });
    const feed = this.host.settings.feeds.find((f) => f.id === m.feedId);
    for (const line of describeKnown(known, m.name)) s.body.createEl("p", { cls: line.warn ? "literature-feed-warning" : "literature-feed-meta", text: line.text });
    const cost = COST_FILTER * Math.max(1, Math.ceil(known.dois.length / 50));
    const row = s.body.createDiv({ cls: "literature-feed-buttons" });
    row.createEl("button", { text: "Read Zotero library", attr: { title: "Reads your library (read-only) so the seed collection is current." } }).addEventListener("click", (e) => {
      const b = e.currentTarget as HTMLButtonElement;
      b.disabled = true;
      this.host.refreshZoteroIndex().then(
        (message) => { new Notice(message); void this.reload(); },
        (err: unknown) => { new Notice(`Could not read Zotero: ${err instanceof Error ? err.message : "unknown error"}`, 8000); b.disabled = false; },
      );
    });
    const read = row.createEl("button", { text: `Read the known papers (about $${cost.toFixed(4)})`, cls: "mod-cta" });
    read.disabled = known.dois.length === 0;
    read.addEventListener("click", () => void this.readKnown(known.dois, read));

    if (m.strings.status === "no-profile") return;
    if (m.strings.status === "too-few") {
      s.body.createEl("p", { cls: "literature-feed-meta", text: "Two or more papers are needed to find what they share." });
      return;
    }
    const { papers, queries, test } = m.strings;
    if (test) s.body.createEl("p", { text: `${papers.length} papers read. Strings built like these find a paper they were not built from ${test.found} times out of ${test.total} (each ${papers.length > LEAVE_ONE_OUT_MAX ? `of the first ${LEAVE_ONE_OUT_MAX} papers` : "paper"} left out in turn): treat them as a start, not a net.` });
    if (queries.length === 0) {
      s.body.createEl("p", { cls: "literature-feed-meta", text: "These papers share too little wording to build a string from. Add more papers on the same subject." });
      return;
    }
    const title = (id: string): string => papers.find((p) => p.id === id)?.title ?? id;
    for (const q of queries) {
      const box = s.body.createDiv({ cls: "literature-feed-detailwork" });
      box.createEl("code", { text: q.text });
      box.createDiv({ cls: "literature-feed-meta", text: `Finds ${q.matches.length} of your ${papers.length} papers.` });
      const sizeLine = box.createDiv({ cls: "literature-feed-meta" });
      const missed = papers.filter((p) => !q.matches.includes(p.id));
      if (missed.length > 0) {
        const d = box.createEl("details");
        d.createEl("summary", { text: `Does not find ${missed.length}` });
        for (const p of missed) d.createDiv({ cls: "literature-feed-meta", text: title(p.id) });
      }
      const buttons = box.createDiv({ cls: "literature-feed-buttons" });
      buttons.createEl("button", { text: "Check size ($0.0001)" }).addEventListener("click", (e) => {
        const b = e.currentTarget as HTMLButtonElement;
        b.disabled = true;
        const from = feed?.yearsFrom ?? null;
        void this.host.newReviewClient().countTopic(q.text, { fromDate: from === null ? undefined : `${from}-01-01` }).then(
          (r) => { this.host.recordSpend(COST_FILTER); sizeLine.setText(`${r.count} works match since ${from ?? "the start"}.`); },
          (err: unknown) => { sizeLine.setText(`The check failed: ${err instanceof Error ? err.message : "unknown error"}`); b.disabled = false; },
        );
      });
      buttons.createEl("button", { text: "Add to this search", cls: "mod-cta" }).addEventListener("click", () => {
        void this.host.addTopicToFeed(m.feedId, q.text).then((message) => { new Notice(message, 8000); void this.reload(); });
      });
    }
  }

  /** Reads the known papers from OpenAlex (about $0.0001 per 50) and keeps the profile for this tab. */
  private async readKnown(dois: readonly string[], button: HTMLButtonElement): Promise<void> {
    button.disabled = true;
    try {
      const res = await this.host.newReviewClient().getWorksByDoi(dois);
      this.host.recordSpend(res.costUsd > 0 ? res.costUsd : COST_FILTER * Math.ceil(dois.length / 50));
      await this.host.saveReviewCache();
      const profile = buildSeedProfile(dois, res.papers);
      if (profile.ids.length === 0) {
        new Notice(NOT_FOUND, 8000);
        button.disabled = false;
        return;
      }
      this.profile = profile;
      await this.reload();
    } catch (e) {
      new Notice(`Could not read the papers: ${e instanceof Error ? e.message : "unknown error"}`, 8000);
      button.disabled = false;
    }
  }

  private drawLlm(el: HTMLElement): void {
    const s = createSection(el, { title: "Ask an LLM", desc: "Each button copies a prompt for the LLM you use and takes its answer back. Nothing is sent from here.", app: this.host.app, storageKey: "improve-llm" });
    const row = s.body.createDiv({ cls: "literature-feed-buttons" });
    const button = (text: string, kind: "review" | "topics" | "compare"): void => {
      row.createEl("button", { text }).addEventListener("click", () => void this.host.openPrompt(kind));
    };
    button("Review this search", "review");
    button("Tweak search terms", "topics");
    button("Compare searches", "compare");
    s.body.createEl("p", { cls: "literature-feed-meta", text: "The window asks which search the prompt is for." });
  }

  onClose(): Promise<void> {
    this.contentEl.empty();
    return Promise.resolve();
  }
}
