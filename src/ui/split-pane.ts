// Master and detail side by side: the table on the left, what is picked on the right (sticky, scrolling on its own). In a narrow
// tab the detail goes below instead (styles.css, container query). With nothing picked the table has the whole width.
export interface SplitPane {
  el: HTMLElement;
  main: HTMLElement;
  /** Shows a detail with a title and a close button; `draw` fills the body. */
  show(title: string, draw: (body: HTMLElement) => void): void;
  close(): void;
  readonly isOpen: boolean;
}

export function createSplitPane(parent: HTMLElement, onClose?: () => void): SplitPane {
  const el = parent.createDiv({ cls: "literature-feed-split" });
  const main = el.createDiv({ cls: "literature-feed-split-main" });
  const side = el.createDiv({ cls: "literature-feed-split-side" });
  let open = false;
  const pane: SplitPane = {
    el, main,
    get isOpen() { return open; },
    show(title, draw) {
      open = true;
      el.addClass("has-detail");
      side.empty();
      const head = side.createDiv({ cls: "literature-feed-split-head" });
      head.createDiv({ cls: "literature-feed-title", text: title });
      const close = head.createEl("button", { cls: "literature-feed-icon", text: "✕", attr: { "aria-label": "Close the detail" } });
      close.addEventListener("click", () => { pane.close(); onClose?.(); });
      draw(side.createDiv({ cls: "literature-feed-split-body" }));
    },
    close() {
      open = false;
      el.removeClass("has-detail");
      side.empty();
    },
  };
  return pane;
}
