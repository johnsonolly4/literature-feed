import { Notice, PluginSettingTab, debounce, normalizePath, type Plugin, type SettingDefinition, type SettingDefinitionItem } from "obsidian";
import { duplicateFeed, feedToJson, newFeed, type FeedConfig, type Settings } from "./data";
import { ConfirmModal, FeedModal, ImportModal, type SettingsHost } from "./feed-modal";

type SecretKey = "openAlexKey" | "zoteroKey";

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/**
 * Declarative settings (Obsidian 1.13+; the manifest asks for 1.14). Plain fields are `control` rows read and written
 * through getControlValue / setControlValue; the API keys and the feed rows are `render` rows (a masked input and
 * several buttons are not controls).
 */
export class LiteratureFeedSettingTab extends PluginSettingTab {
  private readonly saveSoon = debounce(() => void this.host.saveSettings(), 500, true);

  constructor(plugin: Plugin, private readonly host: SettingsHost) {
    super(plugin.app, plugin);
  }

  getSettingDefinitions(): SettingDefinitionItem[] {
    return [
      {
        type: "group",
        heading: "Accounts",
        items: [
          this.secretRow("OpenAlex API key", "Sent only to OpenAlex. Stored in this plugin's data file inside your vault.", "openAlexKey"),
          this.secretRow("Zotero API key", "Needs write access to your library. Sent only to Zotero.", "zoteroKey"),
          { name: "Zotero user ID", desc: "The number from the API keys page of your Zotero account.", control: { type: "text", key: "zoteroUserId" } },
        ],
      },
      {
        type: "group",
        heading: "Folders",
        items: [
          { name: "Inbox folder", desc: "Where the weekly reading-inbox notes go.", control: { type: "folder", key: "inboxFolder", includeRoot: true } },
          { name: "Archive folder", desc: "Where finished inbox notes are moved.", control: { type: "folder", key: "archiveFolder", includeRoot: true } },
        ],
      },
      {
        type: "group",
        heading: "Schedule",
        items: [
          {
            name: "Scan day",
            desc: "The weekday of the weekly scan.",
            control: { type: "dropdown", key: "scanDay", options: Object.fromEntries(WEEKDAYS.map((day, i) => [String(i), day])) },
          },
        ],
      },
      {
        type: "list",
        heading: "Feeds",
        emptyState: "No feeds yet. Add one, or import a feed file.",
        addItem: { name: "Add feed", action: () => this.editFeed(newFeed(this.host.settings.feeds)) },
        onDelete: (index) => this.confirmDelete(this.host.settings.feeds[index]),
        items: this.host.settings.feeds.map((feed) => this.feedRow(feed)),
      },
      {
        type: "group",
        items: [
          { name: "Import feed", desc: "Add a feed from a .json file or pasted text. It is added switched off.", action: () => new ImportModal(this.host, () => this.update()).open() },
        ],
      },
    ];
  }

  getControlValue(key: string): unknown {
    const s = this.host.settings;
    switch (key) {
      case "zoteroUserId": return s.zoteroUserId;
      case "inboxFolder": return s.inboxFolder;
      case "archiveFolder": return s.archiveFolder;
      case "scanDay": return String(s.scanDay);
      default: return undefined;
    }
  }

  async setControlValue(key: string, value: unknown): Promise<void> {
    const s = this.host.settings;
    const text = typeof value === "string" ? value.trim() : "";
    switch (key) {
      case "zoteroUserId": s.zoteroUserId = text; break;
      case "inboxFolder": s.inboxFolder = text === "" ? "" : normalizePath(text); break;
      case "archiveFolder": s.archiveFolder = text === "" ? "" : normalizePath(text); break;
      case "scanDay": {
        const day = Number(value);
        if (Number.isInteger(day) && day >= 0 && day <= 6) s.scanDay = day;
        break;
      }
      default: return;
    }
    await this.host.saveSettings();
  }

  private secretRow(name: string, desc: string, key: SecretKey): SettingDefinition {
    return {
      name,
      desc,
      render: (setting) => {
        setting.setName(name).setDesc(desc).addText((t) => {
          t.setValue(this.host.settings[key]).onChange((v) => {
            this.host.settings[key] = v.trim();
            this.saveSoon();
          });
          t.inputEl.type = "password";
        });
      },
    };
  }

  private feedRow(feed: FeedConfig): SettingDefinition {
    const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? "" : "s"}`;
    const detail = `${plural(feed.topics.length, "topic")}, ${plural(feed.groups.length, "group")}`;
    return {
      name: feed.name,
      desc: detail,
      render: (setting) => {
        setting.setName(feed.name).setDesc(detail)
          .addToggle((t) => t.setValue(feed.enabled).setTooltip("Include this feed in the scan").onChange((v) => {
            feed.enabled = v;
            this.saveSoon();
          }))
          .addExtraButton((b) => b.setIcon("pencil").setTooltip("Edit").onClick(() => this.editFeed(feed)))
          .addExtraButton((b) => b.setIcon("copy").setTooltip("Duplicate").onClick(() => void this.duplicate(feed)))
          .addExtraButton((b) => b.setIcon("download").setTooltip("Export as a .json file").onClick(() => void this.exportFeed(feed)));
      },
    };
  }

  private editFeed(feed: FeedConfig): void {
    new FeedModal(this.host, feed, () => this.update()).open();
  }

  private async duplicate(feed: FeedConfig): Promise<void> {
    const settings: Settings = this.host.settings;
    settings.feeds.push(duplicateFeed(feed, settings.feeds));
    await this.host.saveSettings();
    this.update();
  }

  private confirmDelete(feed: FeedConfig | undefined): void {
    if (!feed) return;
    new ConfirmModal(this.app, "Delete feed", `Delete "${feed.name}"? Papers already in Zotero stay there.`, "Delete", () => {
      this.host.settings.feeds = this.host.settings.feeds.filter((f) => f.id !== feed.id);
      void this.host.saveSettings().then(() => this.update());
    }).open();
  }

  /** Writes `<id>.feed.json` into the inbox folder (the vault root if none is set), never over an existing file. */
  private async exportFeed(feed: FeedConfig): Promise<void> {
    const vault = this.app.vault;
    const folder = this.host.settings.inboxFolder;
    try {
      if (folder !== "" && !vault.getFolderByPath(folder)) await vault.createFolder(folder);
      let path = normalizePath(`${folder}/${feed.id}.feed.json`);
      for (let n = 2; vault.getAbstractFileByPath(path); n++) path = normalizePath(`${folder}/${feed.id}-${n}.feed.json`);
      await vault.create(path, feedToJson(feed));
      new Notice(`Feed exported to ${path}`);
    } catch (e) {
      new Notice(`Could not export the feed: ${e instanceof Error ? e.message : "unknown error"}`);
    }
  }
}
