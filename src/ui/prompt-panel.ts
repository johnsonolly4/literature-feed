// The LLM step of a report, the same for every search: the prompt (shown, copied or saved as a note), a box for the answer, and a
// check that reads it. Nothing is sent from here: the prompt only goes to the clipboard or into a note.
import { Notice } from "obsidian";
import type { Checked } from "../prompts/schemas";
import { createSection } from "./section";

export interface PromptPanelOptions<T> {
  title: string;
  desc?: string;
  /** The prompt, built when the panel is drawn (so it follows the table's current view). */
  prompt: () => string;
  /** Saves the prompt as a note and says where; leave out to hide the button. */
  saveAsNote?: (text: string) => Promise<string>;
  /** The answer as pasted, kept by the caller. */
  answer: string;
  onAnswerText: (text: string) => void;
  check: (answer: string) => Checked<T>;
  /** Called with what the check read; returns what to tell the user. */
  onChecked: (value: T) => string;
  checkLabel?: string;
}

export function createPromptPanel<T>(parent: HTMLElement, o: PromptPanelOptions<T>): void {
  const section = createSection(parent, { title: o.title, desc: o.desc, collapsible: true, open: o.answer !== "" });
  const body = section.body;
  const preview = body.createEl("textarea", { cls: "literature-feed-prompt" });
  preview.readOnly = true;
  preview.rows = 6;
  const meta = body.createDiv({ cls: "literature-feed-meta" });
  const refresh = (): string => {
    const text = o.prompt();
    preview.value = text;
    meta.setText(`${text.length} characters. This is exactly what is copied.`);
    return text;
  };
  refresh();
  const buttons = body.createDiv({ cls: "literature-feed-buttons" });
  const copy = buttons.createEl("button", { text: "Copy prompt", cls: "mod-cta" });
  copy.addEventListener("click", () => {
    navigator.clipboard.writeText(refresh()).then(() => new Notice("Prompt copied. Paste it into a chat that can search the web."), () => new Notice("Could not copy the prompt. Try saving it as a note instead."));
  });
  if (o.saveAsNote) {
    const save = buttons.createEl("button", { text: "Save prompt as note" });
    save.addEventListener("click", () => { void o.saveAsNote?.(refresh()).then((path) => new Notice(`Saved as ${path}. Attach it to your chat as a file.`)); });
  }
  body.createEl("h5", { text: "The LLM's answer" });
  const area = body.createEl("textarea", { cls: "literature-feed-prompt" });
  area.rows = 5;
  area.value = o.answer;
  area.addEventListener("input", () => o.onAnswerText(area.value));
  const feedback = body.createDiv();
  const check = body.createDiv({ cls: "literature-feed-buttons" }).createEl("button", { text: o.checkLabel ?? "Check the answer", cls: "mod-cta" });
  check.addEventListener("click", () => {
    feedback.empty();
    const res = o.check(area.value);
    if (!res.ok) {
      feedback.createEl("p", { cls: "literature-feed-warning", text: "The answer could not be used:" });
      const ul = feedback.createEl("ul");
      for (const e of res.errors) ul.createEl("li", { text: e });
      return;
    }
    feedback.createEl("p", { cls: "literature-feed-result", text: o.onChecked(res.value) });
  });
}
