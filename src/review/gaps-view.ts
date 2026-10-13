// The citation-gaps tool in a tab, so clicking elsewhere does not close it; the last run is saved when the tab closes.
import { ItemView, type WorkspaceLeaf } from "obsidian";
import { GapsPanel, type GapsHost } from "./gaps-panel";

export const GAPS_VIEW = "literature-feed-gaps";

export class GapsView extends ItemView {
  private panel: GapsPanel | null = null;

  constructor(leaf: WorkspaceLeaf, private readonly host: GapsHost) {
    super(leaf);
  }

  getViewType(): string {
    return GAPS_VIEW;
  }

  getDisplayText(): string {
    return "Citation gaps";
  }

  getIcon(): string {
    return "search-check";
  }

  onOpen(): Promise<void> {
    this.contentEl.addClass("literature-feed-review");
    this.reload();
    return Promise.resolve();
  }

  /** Draws the tool again from the host's session (a report was opened from a note). */
  reload(): void {
    this.panel?.discard();
    this.contentEl.empty();
    this.panel = new GapsPanel(this.host, this.contentEl);
    this.panel.mount();
  }

  onClose(): Promise<void> {
    this.panel?.flush();
    this.panel = null;
    return Promise.resolve();
  }
}
