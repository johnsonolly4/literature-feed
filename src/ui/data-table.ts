// The report table every search uses: chips with counts, a search box, sortable headers, "show more", Copy as CSV and a selectable
// row (for a detail pane). The view (chip, search, sort) is kept per table in Obsidian's local storage. Built with createEl only.
import { Notice, type App } from "obsidian";
import { chipCounts, nextSort, normaliseView, rowsToCsv, viewRows, type ColumnSpec, type TableModel, type ViewState } from "./table-model";

export interface Column<T> extends ColumnSpec<T> {
  render: (cell: HTMLElement, row: T) => void;
  /** Hidden when the report is narrow (styles.css), for the less important columns. */
  secondary?: boolean;
  align?: "end";
}

export interface DataTableOptions<T> {
  app: App;
  /** Where the view is remembered, and which table this is. */
  storageKey: string;
  columns: readonly Column<T>[];
  chips: TableModel<T>["chips"];
  searchText: TableModel<T>["searchText"];
  fallback?: TableModel<T>["fallback"];
  defaultView: ViewState;
  rowKey: (row: T) => string;
  rowClass?: (row: T) => string;
  /** Called with the row that was clicked, or null when the selection was cleared. */
  onSelect?: (row: T | null) => void;
  pageSize?: number;
  searchLabel?: string;
  empty?: string;
  /** Extra controls placed after the search box (a number field, a switch). */
  controls?: (bar: HTMLElement) => void;
  csvNotice?: string;
}

export class DataTable<T> {
  private rows: readonly T[] = [];
  private view: ViewState;
  private shown: number;
  private selected: string | null = null;
  private readonly model: TableModel<T>;
  private readonly root: HTMLElement;
  private chipsEl!: HTMLElement;
  private bodyEl!: HTMLElement;
  private footEl!: HTMLElement;
  private headEl!: HTMLElement;
  private searchEl!: HTMLInputElement;
  private visible: T[] = [];

  constructor(parent: HTMLElement, private readonly o: DataTableOptions<T>) {
    this.model = { columns: o.columns, chips: o.chips, searchText: o.searchText, fallback: o.fallback };
    this.shown = o.pageSize ?? 25;
    let saved: unknown = null;
    try {
      saved = o.app.loadLocalStorage(`literature-feed-table-${o.storageKey}`);
    } catch {
      // Not remembered: the default view is used.
    }
    this.view = normaliseView(saved, this.model, o.defaultView);
    this.root = parent.createDiv({ cls: "literature-feed-list literature-feed-datatable" });
    this.build();
  }

  setRows(rows: readonly T[]): void {
    this.rows = rows;
    this.draw();
  }

  /** The chip to show (for a caller that wants a particular view, such as "Under-cited"). */
  setChip(key: string): void {
    if (!this.o.chips.some((c) => c.key === key)) return;
    this.view = { ...this.view, chip: key };
    this.save();
    this.draw();
  }

  /** Puts a search in the box (and applies it). */
  setQuery(query: string): void {
    this.view = { ...this.view, query };
    this.save();
    this.searchEl.value = query;
    this.draw();
  }

  /** Marks one row as picked (without calling `onSelect`). */
  select(key: string | null): void {
    this.selected = key;
    this.drawBody();
  }

  get currentRows(): readonly T[] {
    return this.visible;
  }

  get currentView(): ViewState {
    return this.view;
  }

  private save(): void {
    try {
      this.o.app.saveLocalStorage(`literature-feed-table-${this.o.storageKey}`, this.view);
    } catch {
      // The view just is not remembered.
    }
  }

  private build(): void {
    const bar = this.root.createDiv({ cls: "literature-feed-tablebar" });
    this.chipsEl = bar.createDiv({ cls: "literature-feed-filters" });
    const tools = bar.createDiv({ cls: "literature-feed-tabletools" });
    const label = this.o.searchLabel ?? "Search";
    const search = tools.createEl("input", { type: "search", cls: "literature-feed-search", placeholder: label, attr: { "aria-label": label } });
    this.searchEl = search;
    search.value = this.view.query;
    search.addEventListener("input", () => {
      this.view = { ...this.view, query: search.value };
      this.save();
      this.draw();
    });
    this.o.controls?.(tools);
    const csv = tools.createEl("button", { text: "Copy as CSV", cls: "literature-feed-sync" });
    csv.addEventListener("click", () => {
      void navigator.clipboard.writeText(rowsToCsv(this.visible, this.o.columns)).then(() => new Notice(this.o.csvNotice ?? "Copied as CSV (opens in Excel)."));
    });
    const wrap = this.root.createDiv({ cls: "literature-feed-tablewrap" });
    const table = wrap.createEl("table", { cls: "literature-feed-papers" });
    this.headEl = table.createEl("thead").createEl("tr");
    this.bodyEl = table.createEl("tbody");
    this.footEl = this.root.createDiv({ cls: "literature-feed-tablefoot" });
  }

  private draw(): void {
    this.drawChips();
    this.drawHead();
    this.drawBody();
  }

  private drawChips(): void {
    this.chipsEl.empty();
    const counts = chipCounts(this.rows, this.model, this.view.query);
    for (const c of this.o.chips) {
      if (c.when && !c.when()) continue;
      const cls = `literature-feed-filter${c.tone ? ` tone-${c.tone}` : ""}${this.view.chip === c.key ? " is-active" : ""}`;
      const chip = this.chipsEl.createEl("button", { cls, text: `${c.label} ${counts.get(c.key) ?? 0}` });
      chip.addEventListener("click", () => {
        this.view = { ...this.view, chip: c.key };
        this.shown = this.o.pageSize ?? 25;
        this.save();
        this.draw();
      });
    }
  }

  private drawHead(): void {
    this.headEl.empty();
    for (const col of this.o.columns) {
      const active = this.view.sort.by === col.key;
      const th = this.headEl.createEl("th", { cls: `${active ? "is-sorted" : ""}${col.secondary ? " is-secondary" : ""}${col.align === "end" ? " is-num" : ""}` });
      if (col.sortable) {
        const b = th.createEl("button", { cls: "literature-feed-sort", text: `${col.label}${active ? (this.view.sort.desc ? " ▼" : " ▲") : ""}` });
        b.addEventListener("click", () => {
          this.view = { ...this.view, sort: nextSort(this.view.sort, col.key) };
          this.save();
          this.draw();
        });
      } else {
        th.setText(col.label);
      }
    }
  }

  private drawBody(): void {
    this.bodyEl.empty();
    this.footEl.empty();
    this.visible = viewRows(this.rows, this.model, this.view);
    if (this.visible.length === 0) {
      this.bodyEl.createEl("tr").createEl("td", { attr: { colspan: String(this.o.columns.length) }, cls: "literature-feed-empty", text: this.o.empty ?? "Nothing in this view." });
      return;
    }
    for (const row of this.visible.slice(0, this.shown)) {
      const key = this.o.rowKey(row);
      const tr = this.bodyEl.createEl("tr", { cls: `${this.o.rowClass?.(row) ?? ""}${key === this.selected ? " is-selected" : ""}${this.o.onSelect ? " is-pickable" : ""}`.trim() });
      for (const col of this.o.columns) {
        const td = tr.createEl("td", { cls: `${col.secondary ? "is-secondary" : ""}${col.align === "end" ? " is-num" : ""}`.trim() });
        col.render(td, row);
      }
      if (this.o.onSelect) {
        tr.addEventListener("click", (e) => {
          if ((e.target as HTMLElement).closest("a, button, input")) return;
          this.selected = this.selected === key ? null : key;
          this.drawBody();
          this.o.onSelect?.(this.selected === null ? null : row);
        });
      }
    }
    if (this.visible.length > this.shown) {
      this.footEl.createSpan({ cls: "literature-feed-meta", text: `Showing ${this.shown} of ${this.visible.length}.` });
      const more = this.footEl.createEl("button", { text: "Show 15 more" });
      more.addEventListener("click", () => { this.shown += 15; this.drawBody(); });
      const all = this.footEl.createEl("button", { text: `Show all ${this.visible.length}` });
      all.addEventListener("click", () => { this.shown = this.visible.length; this.drawBody(); });
    } else if (this.visible.length > (this.o.pageSize ?? 25)) {
      this.footEl.createSpan({ cls: "literature-feed-meta", text: `All ${this.visible.length} shown.` });
    }
  }
}
