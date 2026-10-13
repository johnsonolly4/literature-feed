// A read-only window that lists the Zotero collections the API returns, to compare with what Zotero shows.
import { Modal, type App } from "obsidian";

export class CollectionsModal extends Modal {
  constructor(app: App, private readonly lines: string[]) {
    super(app);
  }

  onOpen(): void {
    this.setTitle("Zotero collections the plugin sees");
    const { contentEl } = this;
    contentEl.createEl("p", {
      cls: "setting-item-description",
      text: "As Zotero's server reports them, with the parent name before a slash. A collection marked in trash is deleted in Zotero and does not count.",
    });
    if (this.lines.length === 0) {
      contentEl.createEl("p", { text: "The library has no collections." });
      return;
    }
    const list = contentEl.createEl("ul", { cls: "literature-feed-collections" });
    for (const line of this.lines) list.createEl("li", { text: line });
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
