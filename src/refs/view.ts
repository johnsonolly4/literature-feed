// The reference tidy-up in a tab of its own: paste a list, find the DOIs, copy the list with DOIs. The last list and its results are
// saved when the tab closes.
import { ItemView, type WorkspaceLeaf } from "obsidian";
import { TEXT } from "./text";
import { RefsPanel, type RefsHost, type RefsSession } from "./panel";

export const REFS_VIEW = "literature-feed-refs";

export interface RefsViewHost extends RefsHost {
  refsSession: RefsSession | null;
  saveRefsSession(session: RefsSession): void;
}

export class RefsView extends ItemView {
  private panel: RefsPanel | null = null;

  constructor(leaf: WorkspaceLeaf, private readonly host: RefsViewHost) {
    super(leaf);
  }

  getViewType(): string {
    return REFS_VIEW;
  }

  getDisplayText(): string {
    return TEXT.viewTitle;
  }

  getIcon(): string {
    return "list-checks";
  }

  onOpen(): Promise<void> {
    this.contentEl.empty();
    this.contentEl.addClass("literature-feed-review");
    this.panel = new RefsPanel(this.host, this.contentEl, this.host.refsSession, (s) => this.host.saveRefsSession(s));
    this.panel.mount();
    return Promise.resolve();
  }

  onClose(): Promise<void> {
    this.panel?.flush();
    this.panel = null;
    return Promise.resolve();
  }
}
