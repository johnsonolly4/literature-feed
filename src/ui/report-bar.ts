// The line above a report: what it is (counts, cost, date) and the buttons that act on it. The inbox's status look, shared.
export interface BarAction {
  text: string;
  onClick: () => void;
  cta?: boolean;
  title?: string;
  disabled?: boolean;
}

export interface ReportBar {
  el: HTMLElement;
  setStatus(lines: readonly string[]): void;
}

export function createReportBar(parent: HTMLElement, status: readonly string[], actions: readonly BarAction[]): ReportBar {
  const el = parent.createDiv({ cls: "literature-feed-status literature-feed-reportbar" });
  const lines = el.createDiv();
  const setStatus = (s: readonly string[]): void => {
    lines.empty();
    for (const l of s) lines.createDiv({ cls: "literature-feed-status-line", text: l });
  };
  setStatus(status);
  if (actions.length > 0) {
    const buttons = el.createDiv({ cls: "literature-feed-buttons" });
    for (const a of actions) {
      const b = buttons.createEl("button", { text: a.text, cls: a.cta ? "mod-cta" : "", attr: a.title ? { title: a.title } : {} });
      b.disabled = a.disabled === true;
      b.addEventListener("click", a.onClick);
    }
  }
  return { el, setStatus };
}
