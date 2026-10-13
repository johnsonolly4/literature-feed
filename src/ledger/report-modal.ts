// The "Search effectiveness" window: the report as rendered Markdown, a Copy button, and a button that clears history of
// searches that are no longer in the settings.
import { Component, MarkdownRenderer, Modal, Notice, type App } from "obsidian";

export class ReportModal extends Modal {
  private readonly renderer = new Component();

  constructor(
    app: App,
    private readonly markdown: string,
    /** Number of searches in the ledger that the settings no longer have. */
    private readonly forgettable: number,
    /** Removes their history; resolves to the number of papers removed. */
    private readonly forget: () => Promise<number>,
  ) {
    super(app);
  }

  onOpen(): void {
    this.setTitle("Search effectiveness");
    this.renderer.load();
    const { contentEl } = this;
    const buttons = contentEl.createDiv({ cls: "literature-feed-buttons" });
    const copy = buttons.createEl("button", { text: "Copy as Markdown" });
    copy.addEventListener("click", () => {
      navigator.clipboard.writeText(this.markdown).then(
        () => new Notice("Report copied."),
        () => new Notice("Could not copy the report."),
      );
    });
    if (this.forgettable > 0) {
      const forget = buttons.createEl("button", {
        text: `Forget history of ${this.forgettable} removed search${this.forgettable === 1 ? "" : "es"}`,
      });
      forget.addEventListener("click", () => {
        void this.forget().then((n) => {
          new Notice(`Removed ${n} paper${n === 1 ? "" : "s"} from the history.`);
          this.close();
        });
      });
    }
    const body = contentEl.createDiv({ cls: "literature-feed-report" });
    void MarkdownRenderer.render(this.app, this.markdown, body, "", this.renderer);
  }

  onClose(): void {
    this.renderer.unload();
    this.contentEl.empty();
  }
}
