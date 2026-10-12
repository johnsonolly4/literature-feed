import { Notice, Plugin } from "obsidian";
import { defaultSettings, migrateLegacyKeys, normaliseSettings, type SecretName, type Settings } from "./settings/data";
import type { SettingsHost } from "./settings/feed-modal";
import { LiteratureFeedSettingTab } from "./settings/tab";

export default class LiteratureFeedPlugin extends Plugin implements SettingsHost {
  settings: Settings = defaultSettings();
  private tab: LiteratureFeedSettingTab | null = null;

  async onload(): Promise<void> {
    await this.loadSettings();
    this.tab = new LiteratureFeedSettingTab(this, this);
    this.addSettingTab(this.tab);
    // Scan, inbox and Zotero sync come in later phases (see docs/plans/literature-feed.md).
  }

  async loadSettings(): Promise<void> {
    const raw: unknown = await this.loadData();
    const settings = normaliseSettings(raw);
    try {
      if (migrateLegacyKeys(raw, settings, this.app.secretStorage)) {
        this.settings = settings;
        await this.saveSettings(); // rewrites data.json without the plain-text keys
        new Notice("Literature feed: your API keys were moved to Obsidian's secret storage.");
        return;
      }
    } catch {
      // data.json was not rewritten, so nothing is lost yet; but the plain-text keys are not kept in memory.
      new Notice("Literature feed: could not move your API keys to Obsidian's secret storage. Choose them again in the settings.");
      this.settings = normaliseSettings(raw);
      return;
    }
    this.settings = settings;
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  /** The key's value, read from Obsidian's secret storage at the moment it is needed. "" when none is chosen. */
  getSecret(name: SecretName): string {
    const id = name === "openAlexKey" ? this.settings.openAlexKeySecret : this.settings.zoteroKeySecret;
    return id === "" ? "" : this.app.secretStorage.getSecret(id) ?? "";
  }

  /** `data.json` changed outside Obsidian (for example by a sync service): read it again and redraw the tab. */
  async onExternalSettingsChange(): Promise<void> {
    await this.loadSettings();
    this.tab?.update();
  }
}
