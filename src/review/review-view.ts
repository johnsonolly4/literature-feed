// The literature review in a tab, not a pop-up: clicking elsewhere does not close it, it can sit beside a note or a chat window, and
// closing it saves the work (review-session.json) so it can be picked up again.
import { ItemView, type WorkspaceLeaf } from "obsidian";
import { ReviewPanel, type ReviewHost, type StartMode } from "./window";

export const REVIEW_VIEW = "literature-feed-review";

export class ReviewView extends ItemView {
  private panel: ReviewPanel | null = null;
  /** How the next opening starts; set by the plugin before the tab is shown. */
  mode: StartMode = "ask";

  constructor(leaf: WorkspaceLeaf, private readonly host: ReviewHost) {
    super(leaf);
  }

  getViewType(): string {
    return REVIEW_VIEW;
  }

  getDisplayText(): string {
    return "Literature review";
  }

  getIcon(): string {
    return "telescope";
  }

  onOpen(): Promise<void> {
    this.show(this.mode);
    return Promise.resolve();
  }

  /** Draws the panel again: first opening, or the command run again with the tab already open. */
  show(mode: StartMode): void {
    this.panel?.flush();
    this.contentEl.empty();
    this.contentEl.addClass("literature-feed-review");
    this.panel = new ReviewPanel(this.host, this.contentEl);
    this.panel.mount(mode);
  }

  onClose(): Promise<void> {
    this.panel?.flush();
    this.panel = null;
    return Promise.resolve();
  }
}
