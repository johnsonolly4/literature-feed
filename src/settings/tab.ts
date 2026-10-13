import {
  Notice, PluginSettingTab, SecretComponent, debounce, normalizePath,
  type Plugin, type SettingDefinition, type SettingDefinitionItem,
} from "obsidian";
import { duplicateFeed, feedToJson, newFeed, normaliseFolder, type FeedConfig, type Settings } from "./data";
import { ConfirmModal, FeedModal, ImportModal, type SettingsHost } from "./feed-modal";

type SecretField = "openAlexKeySecret" | "zoteroKeySecret";

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
          this.secretRow("OpenAlex API key", "Sent only to OpenAlex. Kept in Obsidian's secret storage, not in your vault.", "openAlexKeySecret"),
          this.secretRow("Zotero API key", "Needs write access to your library. Sent only to Zotero. Kept in Obsidian's secret storage, not in your vault.", "zoteroKeySecret"),
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
        type: "group",
        heading: "Read state and archive",
        items: [
          {
            name: "Literature notes folder",
            desc: "Where your literature notes are (for example the folder ZotLit writes to). A paper with a note there, found by its Zotero key, DOI or title, gets a Read link. Empty: no read state.",
            control: { type: "folder", key: "literatureFolder", includeRoot: true },
          },
          {
            name: "Archive finished inbox notes",
            desc: "Move a weekly note to the archive folder once every paper in it is read, or has aged out (see the setting below). Needs the archive folder above.",
            control: { type: "toggle", key: "archiveFinished" },
          },
          {
            name: "Mark papers done after (weeks)",
            desc: "A paper that is unticked, or in Zotero but not read, counts as done once its note's week ended this many weeks ago.",
            control: { type: "number", key: "dismissAfterWeeks", min: 1, max: 52, step: 1 },
          },
        ],
      },
      {
        type: "group",
        heading: "Zotero",
        items: [
          {
            name: "Create missing inbox collections",
            desc: "When a synced paper's inbox collection does not exist yet, create it (only its last name, inside an existing parent). Off: create it in Zotero yourself; Sync stops and says which.",
            control: { type: "toggle", key: "createInboxCollections" },
          },
          {
            name: "Create missing project collections",
            desc: "The same for the project collection. Off: create it in Zotero yourself. Leave this off if your Zotero collections turn into folders in your vault.",
            control: { type: "toggle", key: "createProjectCollections" },
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
      case "createInboxCollections": return s.createInboxCollections;
      case "createProjectCollections": return s.createProjectCollections;
      case "literatureFolder": return s.literatureFolder;
      case "archiveFinished": return s.archiveFinished;
      case "dismissAfterWeeks": return s.dismissAfterWeeks;
      default: return undefined;
    }
  }

  async setControlValue(key: string, value: unknown): Promise<void> {
    const s = this.host.settings;
    const text = typeof value === "string" ? value.trim() : "";
    switch (key) {
      case "zoteroUserId": s.zoteroUserId = text; break;
      case "inboxFolder": s.inboxFolder = normaliseFolder(text === "" ? "" : normalizePath(text)); break;
      case "archiveFolder": s.archiveFolder = normaliseFolder(text === "" ? "" : normalizePath(text)); break;
      case "scanDay": {
        const day = Number(value);
        if (Number.isInteger(day) && day >= 0 && day <= 6) s.scanDay = day;
        break;
      }
      case "createInboxCollections": s.createInboxCollections = value === true; break;
      case "createProjectCollections": s.createProjectCollections = value === true; break;
      case "literatureFolder": s.literatureFolder = normaliseFolder(text === "" ? "" : normalizePath(text)); break;
      case "archiveFinished": s.archiveFinished = value === true; break;
      case "dismissAfterWeeks": {
        const weeks = Number(value);
        if (Number.isInteger(weeks) && weeks >= 1 && weeks <= 52) s.dismissAfterWeeks = weeks;
        break;
      }
      default: return;
    }
    await this.host.saveSettings();
  }

  /** The picker stores the id of a secret; the key itself stays in Obsidian's secret storage. */
  private secretRow(name: string, desc: string, field: SecretField): SettingDefinition {
    return {
      name,
      desc,
      render: (setting) => {
        setting.setName(name).setDesc(desc).addComponent((el) => new SecretComponent(this.app, el)
          .setValue(this.host.settings[field])
          .onChange((id) => {
            this.host.settings[field] = id;
            this.saveSoon();
          }));
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
