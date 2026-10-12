// Windows opened from the settings tab: confirm, edit a feed (with Test), import a feed.
import { App, Modal, Setting } from "obsidian";
import { OpenAlexClient } from "../openalex/client";
import { obsidianRequester } from "../openalex/request";
import {
  GROUP_ROLES, checkFeed, cloneFeed, parseFeedJson, parseLines, parseYear,
  type FeedConfig, type SecretName, type Settings,
} from "./data";
import { runFeedTest, type TestSummary } from "./test-feed";
import type { GroupRole } from "../match/feed";

/** What the windows need from the plugin. */
export interface SettingsHost {
  app: App;
  settings: Settings;
  saveSettings(): Promise<void>;
  /** The value of an API key, read from Obsidian's secret storage ("" when none is chosen). */
  getSecret(name: SecretName): string;
}

const ROLE_LABELS: Record<GroupRole, string> = {
  required: "Required (paper is dropped without it)",
  boost: "Boost (raises a paper to Strong)",
  priority: "Priority (raises a paper to Priority)",
};

const TIER_LABELS: [keyof TestSummary["perTier"], string][] = [
  ["priority", "Priority"], ["strong", "Strong"], ["possible", "Possible"], ["unchecked", "Unchecked"], ["dropped", "Dropped"],
];

export class ConfirmModal extends Modal {
  constructor(app: App, private readonly title: string, private readonly message: string, private readonly action: string, private readonly onConfirm: () => void) {
    super(app);
  }

  onOpen(): void {
    this.setTitle(this.title);
    this.contentEl.createEl("p", { text: this.message });
    new Setting(this.contentEl)
      .addButton((b) => b.setButtonText("Cancel").onClick(() => this.close()))
      .addButton((b) => b.setButtonText(this.action).setCta().onClick(() => {
        this.close();
        this.onConfirm();
      }));
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

export class FeedModal extends Modal {
  private readonly draft: FeedConfig;
  private warningsEl!: HTMLElement;
  private groupsEl!: HTMLElement;
  private resultEl!: HTMLElement;
  private testing = false;

  constructor(private readonly host: SettingsHost, feed: FeedConfig, private readonly onSaved: () => void) {
    super(host.app);
    this.draft = cloneFeed(feed);
  }

  onOpen(): void {
    const { contentEl } = this;
    this.setTitle("Edit feed");
    contentEl.addClass("literature-feed-modal");
    const draft = this.draft;

    new Setting(contentEl).setName("Name").addText((t) => t.setValue(draft.name).onChange((v) => { draft.name = v.trim(); }));
    new Setting(contentEl).setName("Years from")
      .setDesc("Only papers from this year on. Leave empty for no limit.")
      .addText((t) => t.setValue(draft.yearsFrom === null ? "" : String(draft.yearsFrom)).setPlaceholder("2020")
        .onChange((v) => { draft.yearsFrom = parseYear(v); }));
    new Setting(contentEl).setName("Zotero collection")
      .setDesc("Where synced papers go: a collection, or a slash between a collection and the one inside it. It must exist in Zotero unless creating inbox collections is switched on in the settings.")
      .addText((t) => t.setValue(draft.zoteroCollection).onChange((v) => { draft.zoteroCollection = v.trim(); }));
    new Setting(contentEl).setName("Project")
      .setDesc("Optional second collection, written the same way. It must exist in Zotero unless creating project collections is switched on in the settings.")
      .addText((t) => t.setValue(draft.project).onChange((v) => { draft.project = v.trim(); }));

    this.addLines("Search topics", "One OpenAlex search per line. Quotes, brackets, AND and OR work.", () => draft.topics, (v) => { draft.topics = v; }, 5);

    new Setting(contentEl).setName("Concept groups").setHeading();
    contentEl.createEl("p", {
      cls: "setting-item-description",
      text: "A paper matches a group when any of its terms is in the title or abstract. Every required group must match.",
    });
    this.groupsEl = contentEl.createDiv();
    this.renderGroups();
    new Setting(contentEl).addButton((b) => b.setButtonText("Add group").onClick(() => {
      draft.groups.push({ name: `Group ${draft.groups.length + 1}`, role: "required", terms: [] });
      this.renderGroups();
      this.refreshWarnings();
    }));

    this.addLines("Drop terms", "A paper with any of these is removed.", () => draft.drop, (v) => { draft.drop = v; }, 4);
    this.addLines("Lower terms", "A paper with any of these moves down one tier.", () => draft.lower, (v) => { draft.lower = v; }, 4);

    this.warningsEl = contentEl.createDiv({ cls: "literature-feed-warnings" });
    this.refreshWarnings();

    this.resultEl = contentEl.createDiv({ cls: "literature-feed-result" });
    new Setting(contentEl)
      .addButton((b) => b.setButtonText("Test").setTooltip("Run a real search and show how the papers would score. Nothing is saved.").onClick(() => this.askTest()))
      .addButton((b) => b.setButtonText("Cancel").onClick(() => this.close()))
      .addButton((b) => b.setButtonText("Save").setCta().onClick(() => void this.save()));
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private addLines(name: string, desc: string, get: () => string[], set: (v: string[]) => void, rows: number): void {
    new Setting(this.contentEl).setName(name).setDesc(desc).setClass("literature-feed-stacked")
      .addTextArea((t) => {
        t.setValue(get().join("\n")).onChange((v) => { set(parseLines(v)); this.refreshWarnings(); });
        t.inputEl.rows = rows;
      });
  }

  private renderGroups(): void {
    const el = this.groupsEl;
    el.empty();
    this.draft.groups.forEach((group, index) => {
      const box = el.createDiv({ cls: "literature-feed-group" });
      new Setting(box).setName("Group name")
        .addText((t) => t.setValue(group.name).onChange((v) => { group.name = v.trim() || `Group ${index + 1}`; this.refreshWarnings(); }))
        .addExtraButton((b) => b.setIcon("trash").setTooltip("Remove group").onClick(() => {
          this.draft.groups.splice(index, 1);
          this.renderGroups();
          this.refreshWarnings();
        }));
      new Setting(box).setName("Role").addDropdown((d) => {
        for (const role of GROUP_ROLES) d.addOption(role, ROLE_LABELS[role]);
        d.setValue(group.role).onChange((v) => { group.role = v as GroupRole; this.refreshWarnings(); });
      });
      new Setting(box).setName("Terms").setDesc("One per line.").setClass("literature-feed-stacked")
        .addTextArea((t) => {
          t.setValue(group.terms.join("\n")).onChange((v) => { group.terms = parseLines(v); this.refreshWarnings(); });
          t.inputEl.rows = 4;
        });
    });
  }

  private refreshWarnings(): void {
    this.warningsEl.empty();
    for (const warning of checkFeed(this.draft)) this.warningsEl.createEl("p", { cls: "literature-feed-warning", text: warning });
  }

  private askTest(): void {
    if (this.testing) return;
    const topics = this.draft.topics.length;
    if (topics === 0) {
      this.showResultMessage("Add at least one search topic first.");
      return;
    }
    const message = `This sends at least ${topics} request${topics === 1 ? "" : "s"} to OpenAlex (about $0.001 each, one more per 100 papers found) `
      + "and looks back one year. Nothing is written to your vault.";
    new ConfirmModal(this.app, "Test this feed", message, "Run test", () => void this.runTest()).open();
  }

  private async runTest(): Promise<void> {
    this.testing = true;
    this.showResultMessage("Searching OpenAlex…");
    try {
      const client = new OpenAlexClient({
        request: obsidianRequester,
        apiKey: this.host.getSecret("openAlexKey") || undefined,
        sleep: (ms) => new Promise((resolve) => window.setTimeout(resolve, ms)),
      });
      this.showSummary(await runFeedTest(client, this.draft));
    } catch (e) {
      this.showResultMessage(`The test failed: ${e instanceof Error ? e.message : "unknown error"}`);
    } finally {
      this.testing = false;
    }
  }

  private showResultMessage(message: string): void {
    this.resultEl.empty();
    this.resultEl.createEl("p", { text: message });
  }

  /** Titles come from OpenAlex (untrusted): they are only ever set as text. */
  private showSummary(s: TestSummary): void {
    const el = this.resultEl;
    el.empty();
    el.createEl("p", { text: `${s.papers} papers published since ${s.windowStart} (duplicates between topics merged). Cost: $${s.costUsd.toFixed(4)}.` });
    el.createEl("p", { text: TIER_LABELS.map(([tier, label]) => `${label} ${s.perTier[tier]}`).join(" · ") });
    const topics = el.createEl("ul");
    for (const t of s.perTopic) topics.createEl("li", { text: `${t.count} works: ${t.topic}` });
    if (s.top.length > 0) {
      el.createEl("p", { text: "Best matches:" });
      const list = el.createEl("ul");
      for (const t of s.top) list.createEl("li", { text: `${t.tier}: ${t.title}` });
    }
  }

  private async save(): Promise<void> {
    const draft = this.draft;
    if (draft.name === "") {
      this.showResultMessage("The feed needs a name.");
      return;
    }
    const feeds = this.host.settings.feeds;
    const index = feeds.findIndex((f) => f.id === draft.id);
    if (index === -1) feeds.push(draft);
    else feeds[index] = draft;
    await this.host.saveSettings();
    this.close();
    this.onSaved();
  }
}

export class ImportModal extends Modal {
  private text = "";
  private errorsEl!: HTMLElement;

  constructor(private readonly host: SettingsHost, private readonly onImported: () => void) {
    super(host.app);
  }

  onOpen(): void {
    const { contentEl } = this;
    this.setTitle("Import feed");
    contentEl.createEl("p", { text: "Paste the feed JSON, or choose a .json file. The feed is added switched off." });

    const area = contentEl.createEl("textarea", { cls: "literature-feed-import" });
    area.rows = 10;
    area.addEventListener("input", () => { this.text = area.value; });

    const picker = contentEl.createEl("input", { type: "file", attr: { accept: ".json,application/json" } });
    picker.addEventListener("change", () => {
      const file = picker.files?.[0];
      if (!file) return;
      void file.text().then((content) => {
        this.text = content;
        area.value = content;
      });
    });

    this.errorsEl = contentEl.createDiv({ cls: "literature-feed-warnings" });
    new Setting(contentEl)
      .addButton((b) => b.setButtonText("Cancel").onClick(() => this.close()))
      .addButton((b) => b.setButtonText("Import").setCta().onClick(() => void this.import()));
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private async import(): Promise<void> {
    this.errorsEl.empty();
    const { feed, errors } = parseFeedJson(this.text, this.host.settings.feeds);
    if (!feed) {
      for (const error of errors) this.errorsEl.createEl("p", { cls: "literature-feed-warning", text: error });
      return;
    }
    this.host.settings.feeds.push(feed);
    await this.host.saveSettings();
    this.close();
    this.onImported();
  }
}
