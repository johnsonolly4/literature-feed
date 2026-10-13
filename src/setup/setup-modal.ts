// The Check setup window: one row per check with its Fix button, then (when Lab Kit is there) the integration step. It stays open
// and checks again after every button, so the list always shows the state of the vault. Nothing is written without a button.
import { Modal, Notice, type App } from "obsidian";
import { checkSetup, type FixAction, type SetupRow, type SetupSnapshot } from "./checks";
import { BY_HAND, INTEGRATIONS, planIntegration, removeIntegration, type IntegrationInfo } from "./integrate";

/** What the window needs from the plugin. */
export interface SetupHost {
  app: App;
  buildSnapshot(): Promise<SetupSnapshot>;
  applyFix(fix: FixAction): Promise<void>;
  /** The text of the note an integration goes into, or null when it was not found. */
  readTarget(info: IntegrationInfo): Promise<{ path: string; text: string } | null>;
  editTarget(path: string, change: (text: string) => string): Promise<void>;
}

const MARK: Record<SetupRow["state"], string> = { ok: "✓", todo: "!", info: "i" };

export class SetupModal extends Modal {
  constructor(private readonly host: SetupHost) {
    super(host.app);
  }

  onOpen(): void {
    this.setTitle("Check setup");
    void this.render();
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private async render(): Promise<void> {
    const snapshot = await this.host.buildSnapshot();
    const rows = checkSetup(snapshot);
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("p", { cls: "setting-item-description", text: "What this plugin needs, and whether it is there. Nothing changes until you press a button; the list checks again after each one." });

    const todo = rows.filter((r) => r.state === "todo").length;
    contentEl.createEl("p", { text: todo === 0 ? "Nothing to do." : `${todo} thing${todo === 1 ? "" : "s"} to do.` });
    for (const row of rows) this.renderRow(contentEl, row);

    if (rows.find((r) => r.id === "lab-kit")?.state === "ok") await this.renderIntegration(contentEl, snapshot);
  }

  private renderRow(parent: HTMLElement, row: SetupRow): void {
    const el = parent.createDiv({ cls: `literature-feed-setup-row is-${row.state}` });
    el.createSpan({ cls: "literature-feed-setup-mark", text: MARK[row.state] });
    const text = el.createDiv({ cls: "literature-feed-setup-text" });
    text.createDiv({ cls: "literature-feed-title", text: row.title });
    text.createDiv({ cls: "literature-feed-meta", text: row.detail });
    if (row.fix) {
      const { label, action } = row.fix;
      const button = el.createEl("button", { text: label });
      button.addEventListener("click", () => {
        button.disabled = true;
        void this.host.applyFix(action).then(() => this.render(), (e: unknown) => {
          new Notice(`Could not do that: ${e instanceof Error ? e.message : "unknown error"}`, 8000);
          return this.render();
        });
      });
    }
  }

  private async renderIntegration(parent: HTMLElement, snapshot: SetupSnapshot): Promise<void> {
    const ctx = { inboxFolder: snapshot.settings.inboxFolder };
    parent.createEl("h3", { text: "Add parts of this plugin to your kit notes" });
    parent.createEl("p", {
      cls: "setting-item-description",
      text: "Each part is added only when you press its button, after you have seen exactly what will be written; leave a part alone to skip it. Each addition can be taken out again later. A kit update treats an edited note as changed by you and keeps your edit when the edits do not overlap.",
    });
    for (const info of INTEGRATIONS) {
      const target = await this.host.readTarget(info);
      const plan = planIntegration(info.id, target?.text ?? null, ctx);
      const el = parent.createDiv({ cls: "literature-feed-setup-row" });
      el.createSpan({ cls: "literature-feed-setup-mark", text: plan.state === "already-added" ? MARK.ok : MARK.info });
      const text = el.createDiv({ cls: "literature-feed-setup-text" });
      text.createDiv({ cls: "literature-feed-title", text: info.label });
      text.createDiv({ cls: "literature-feed-meta", text: info.description });
      if (plan.state === "target-missing") {
        text.createDiv({ cls: "literature-feed-meta", text: target === null ? `No note named "${info.noteName}" in this vault.` : `The place for it (${info.where}) was not found in "${info.noteName}".` });
        continue;
      }
      if (plan.state === "addable") {
        const details = text.createEl("details");
        details.createEl("summary", { text: `Preview: added ${info.where} of "${info.noteName}"` });
        details.createEl("pre", { text: `${plan.anchor}\n${plan.added.join("\n")}` });
        const add = el.createEl("button", { text: "Add" });
        add.addEventListener("click", () => {
          add.disabled = true;
          void this.change(target?.path ?? "", (t) => planIntegration(info.id, t, ctx).next ?? t);
        });
      } else {
        text.createDiv({ cls: "literature-feed-meta", text: plan.removable ? `Already added to "${info.noteName}".` : `"${info.noteName}" already has a reading inbox card that was not added here; it is left as it is.` });
        if (plan.removable) {
          const remove = el.createEl("button", { text: "Remove" });
          remove.addEventListener("click", () => {
            remove.disabled = true;
            void this.change(target?.path ?? "", (t) => removeIntegration(info.id, t));
          });
        }
      }
    }
    parent.createEl("p", { cls: "setting-item-description", text: "Not offered, because they would mean editing the kit's queries or structure; do them by hand if you want them:" });
    const list = parent.createEl("ul");
    for (const item of BY_HAND) list.createEl("li", { text: item });
  }

  private async change(path: string, change: (text: string) => string): Promise<void> {
    try {
      if (path !== "") await this.host.editTarget(path, change);
    } catch (e) {
      new Notice(`Could not change the note: ${e instanceof Error ? e.message : "unknown error"}`, 8000);
    }
    await this.render();
  }
}
