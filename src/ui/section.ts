// A titled card that can fold: the one grouping used for options, results and settings-like blocks, so every search looks alike.
import type { App } from "obsidian";

export interface SectionOptions {
  title: string;
  desc?: string;
  /** Folds when its title is clicked. */
  collapsible?: boolean;
  /** Open to start with (default true). A remembered choice wins when `app` and `storageKey` are given. */
  open?: boolean;
  app?: App;
  storageKey?: string;
}

export interface Section {
  el: HTMLDetailsElement;
  body: HTMLElement;
  setOpen(open: boolean): void;
}

export function createSection(parent: HTMLElement, o: SectionOptions): Section {
  const el = parent.createEl("details", { cls: "literature-feed-section" });
  let open = o.open ?? true;
  if (o.app && o.storageKey) {
    try {
      const saved: unknown = o.app.loadLocalStorage(`literature-feed-section-${o.storageKey}`);
      if (typeof saved === "boolean") open = saved;
    } catch {
      // Not remembered: the default is used.
    }
  }
  el.open = open || o.collapsible !== true;
  const head = el.createEl("summary", { cls: "literature-feed-section-head" });
  head.createSpan({ cls: "literature-feed-section-title", text: o.title });
  if (o.desc) el.createDiv({ cls: "literature-feed-section-desc", text: o.desc });
  const body = el.createDiv({ cls: "literature-feed-section-body" });
  if (o.collapsible !== true) {
    el.addClass("is-fixed");
    head.addEventListener("click", (e) => e.preventDefault());
  } else if (o.app && o.storageKey) {
    const { app, storageKey } = o;
    el.addEventListener("toggle", () => {
      try {
        app.saveLocalStorage(`literature-feed-section-${storageKey}`, el.open);
      } catch {
        // Not remembered.
      }
    });
  }
  return { el, body, setOpen: (v) => { el.open = v; } };
}

/** A grid for short options (label over a small control), so they do not each take a full-width row. */
export function formGrid(parent: HTMLElement): HTMLElement {
  return parent.createDiv({ cls: "literature-feed-formgrid" });
}
