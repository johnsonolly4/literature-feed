import { Plugin } from "obsidian";
import { defaultSettings, normaliseSettings, type Settings } from "./settings/data";
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
    this.settings = normaliseSettings(await this.loadData());
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  /** `data.json` changed outside Obsidian (for example by a sync service): read it again and redraw the tab. */
  async onExternalSettingsChange(): Promise<void> {
    await this.loadSettings();
    this.tab?.update();
  }
}
