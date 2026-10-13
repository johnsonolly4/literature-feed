// Tidying a pasted reference list and finding the DOIs: a paste box, a look-up that shows its progress and can be stopped, and a table
// that puts the references that need a person first ("Needs a look": not found, software, errors, and matches that differ), with the DOI
// editable and an include tick. Used in its own tab and inside the citation-gaps tool. Nothing is sent but the references' text to
// Crossref, when the user presses the button.
import { Notice, Setting, type App } from "obsidian";
import type { Settings } from "../settings/data";
import { listWithDois, toCsv, toMarkdownTable } from "./export";
import type { RefStatus } from "./match";
import { googleUrl, scholarUrl, searchQuery } from "../review/search-links";
import { MAX_REFERENCES, countStatuses, includedByDefault, resolveReferences, type ReferenceSearcher, type ResolvedRow } from "./resolve";
import { doiInText, splitReferences } from "./split";
import { TEXT } from "./text";

/** What the panel needs from the plugin. */
export interface RefsHost {
  app: App;
  settings: Settings;
  newCrossrefClient(): ReferenceSearcher;
  reviewFolder(): string;
  createReviewNote(path: string, text: string, open?: boolean): Promise<string>;
}

/** The state worth keeping when the tab closes. */
export interface RefsSession {
  version: 1;
  text: string;
  rows: ResolvedRow[];
  /** Row numbers (`n`) that are ticked. */
  included: number[];
}

export function emptyRefsSession(): RefsSession {
  return { version: 1, text: "", rows: [], included: [] };
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const STATUSES: readonly string[] = ["OK", "CHECK", "NOT FOUND", "MANUAL", "ERROR"];

/** The session from whatever the file held; null when it holds nothing usable. */
export function normaliseRefsSession(raw: unknown): RefsSession | null {
  if (!isObj(raw) || raw.version !== 1) return null;
  const out = emptyRefsSession();
  if (typeof raw.text === "string") out.text = raw.text;
  if (Array.isArray(raw.rows)) {
    for (const r of raw.rows) {
      if (!isObj(r) || typeof r.n !== "number" || typeof r.text !== "string" || typeof r.doi !== "string" || typeof r.status !== "string" || !STATUSES.includes(r.status)) continue;
      const str = (v: unknown): string => (typeof v === "string" ? v : "");
      out.rows.push({
        n: r.n, text: r.text, doi: r.doi, status: r.status as RefStatus, reasons: Array.isArray(r.reasons) ? r.reasons.filter((x): x is string => typeof x === "string") : [],
        crossrefTitle: str(r.crossrefTitle), authors: str(r.authors), journal: str(r.journal), year: str(r.year), volume: str(r.volume), pages: str(r.pages), publisher: str(r.publisher),
        citedBy: typeof r.citedBy === "number" ? r.citedBy : null, fromText: r.fromText === true, confirmed: r.confirmed === true, skipped: r.skipped === true,
      });
    }
  }
  if (Array.isArray(raw.included)) out.included = raw.included.filter((n): n is number => typeof n === "number");
  return out;
}

/** What the rest of the plugin takes from the panel. */
export interface RefsSelection {
  /** Whether the references have been looked up (otherwise the other fields are empty). */
  looked: boolean;
  /** The DOIs that are ticked, once each. */
  dois: string[];
  /** The tidied text of references that were not found or failed (not software), for a search elsewhere. */
  unfound: string[];
  /** References with no DOI that are left out. */
  skipped: ResolvedRow[];
}

const STATUS_LABEL: Record<RefStatus, string> = { OK: "Found", CHECK: "Check", "NOT FOUND": "Not found", MANUAL: "Manual", ERROR: "Error" };
const NEEDS_LOOK: readonly RefStatus[] = ["CHECK", "NOT FOUND", "MANUAL", "ERROR"];
const MARK: Record<string, string> = { ok: "\u2713", todo: "!", bad: "\u2715", off: "\u25cb" };

function today(): string {
  const d = new Date();
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export class RefsPanel {
  private text: string;
  private rows: ResolvedRow[];
  private included: Set<number>;
  private running = false;
  private stop = false;
  private area!: HTMLTextAreaElement;
  private out!: HTMLElement;
  private saveTimer: number | null = null;

  constructor(
    private readonly host: RefsHost,
    private readonly root: HTMLElement,
    initial: RefsSession | null,
    private readonly onSession: (session: RefsSession) => void,
    private readonly onSelection?: (selection: RefsSelection) => void,
  ) {
    this.text = initial?.text ?? "";
    this.rows = initial?.rows ?? [];
    this.included = new Set(initial?.included ?? this.rows.filter(includedByDefault).map((r) => r.n));
  }

  mount(): void {
    const el = this.root;
    el.empty();
    el.createEl("p", {
      cls: "setting-item-description",
      text: TEXT.intro,
    });
    this.area = el.createEl("textarea", { cls: "literature-feed-prompt" });
    this.area.rows = 8;
    this.area.placeholder = "Paste the reference list here";
    this.area.value = this.text;
    this.area.addEventListener("input", () => { this.text = this.area.value; this.saveSoon(); });
    new Setting(el).addButton((b) => b.setButtonText(TEXT.run).setCta().onClick(() => void this.run()));
    this.out = el.createDiv();
    if (this.rows.length > 0) this.renderRows();
    this.emit();
  }

  /** The pasted text as it is now. */
  currentText(): string {
    return this.text;
  }

  flush(): void {
    if (this.saveTimer !== null) window.clearTimeout(this.saveTimer);
    this.saveTimer = null;
    this.onSession(this.session());
  }

  /** Stops a pending save (the panel is being replaced and must not write over what replaces it). */
  discard(): void {
    if (this.saveTimer !== null) window.clearTimeout(this.saveTimer);
    this.saveTimer = null;
  }

  /** What the rest of the plugin should use now. */
  selection(): RefsSelection {
    const looked = this.rows.length > 0;
    const dois = [...new Set(this.rows.filter((r) => this.included.has(r.n) && r.doi !== "").map((r) => r.doi))];
    const unfound = this.rows.filter((r) => !r.skipped && (r.status === "NOT FOUND" || r.status === "ERROR") && !(this.included.has(r.n) && r.doi !== "")).map((r) => r.text);
    const skipped = this.rows.filter((r) => !(this.included.has(r.n) && r.doi !== ""));
    return { looked, dois, unfound, skipped };
  }

  private session(): RefsSession {
    return { version: 1, text: this.text, rows: this.rows, included: [...this.included] };
  }

  private saveSoon(): void {
    if (this.saveTimer !== null) window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => { this.saveTimer = null; this.onSession(this.session()); }, 1000);
  }

  private emit(): void {
    this.onSelection?.(this.selection());
  }

  private async run(): Promise<void> {
    if (this.running) return;
    const refs = splitReferences(this.text);
    if (refs.length === 0) {
      new Notice("Paste some references first.");
      return;
    }
    this.running = true;
    this.stop = false;
    this.out.empty();
    const status = this.out.createEl("p", { text: `Found ${refs.length} reference${refs.length === 1 ? "" : "s"}${refs.length > MAX_REFERENCES ? ` (only the first ${MAX_REFERENCES} are looked up)` : ""}. Looking them up, about ${Math.ceil(Math.min(refs.length, MAX_REFERENCES) * 0.3)} seconds…` });
    new Setting(this.out).addButton((b) => b.setButtonText("Stop").onClick(() => { this.stop = true; b.setDisabled(true); }));
    try {
      const result = await resolveReferences(refs, this.host.newCrossrefClient(), {
        max: MAX_REFERENCES,
        isCancelled: () => this.stop,
        onProgress: (done, total) => status.setText(`Looked up ${done} of ${total}…`),
      });
      this.rows = result.rows;
      this.included = new Set(result.rows.filter(includedByDefault).map((r) => r.n));
      if (result.cancelled) new Notice(`Stopped after ${result.rows.length} references.`);
      if (result.skipped > 0) new Notice(`${result.skipped} references beyond the first ${MAX_REFERENCES} were left out.`);
    } finally {
      this.running = false;
    }
    this.flush();
    this.renderRows();
    this.emit();
  }

  /** Looks up again only the references whose look-up failed. */
  private async retryErrors(): Promise<void> {
    if (this.running) return;
    const failed = this.rows.filter((r) => r.status === "ERROR" && !r.skipped);
    if (failed.length === 0) return;
    this.running = true;
    this.stop = false;
    new Notice(`Looking up ${failed.length} again…`);
    try {
      const result = await resolveReferences(failed.map((r) => ({ n: r.n, text: r.text })), this.host.newCrossrefClient(), { isCancelled: () => this.stop });
      const byN = new Map(result.rows.map((r) => [r.n, r] as const));
      this.rows = this.rows.map((r) => byN.get(r.n) ?? r);
      for (const r of result.rows) if (includedByDefault(r)) this.included.add(r.n);
    } finally {
      this.running = false;
    }
    this.flush();
    this.renderRows();
    this.emit();
  }

  private renderRows(): void {
    const out = this.out;
    out.empty();
    const live = this.rows.filter((r) => !r.skipped);
    const skippedRows = this.rows.filter((r) => r.skipped);
    const c = countStatuses(live);
    const confirmed = live.filter((r) => r.confirmed).length;
    out.createEl("p", { text: `${this.rows.length} references: ${c.OK} found, ${c.CHECK} to check, ${c["NOT FOUND"]} not found, ${c.MANUAL} manual, ${c.ERROR} failed; ${confirmed} confirmed by you, ${skippedRows.length} skipped. Ticked ones are used.` });

    new Setting(out)
      .addButton((b) => b.setButtonText(TEXT.copyList).onClick(() => { void navigator.clipboard.writeText(listWithDois(this.rows)).then(() => new Notice(TEXT.copiedList)); }))
      .addButton((b) => b.setButtonText("Copy as CSV").onClick(() => { void navigator.clipboard.writeText(toCsv(this.rows)).then(() => new Notice(TEXT.copiedCsv)); }))
      .addButton((b) => b.setButtonText("Create note").onClick(() => void this.createNote()))
      .addButton((b) => { b.setButtonText("Skip software and web pages").onClick(() => this.skipMany((r) => r.status === "MANUAL")); b.setDisabled(!live.some((r) => r.status === "MANUAL")); })
      .addButton((b) => { b.setButtonText("Look up the failed ones again").onClick(() => void this.retryErrors()); b.setDisabled(c.ERROR === 0); });

    const needs = live.filter((r) => !r.confirmed && NEEDS_LOOK.includes(r.status));
    const found = live.filter((r) => r.confirmed || !NEEDS_LOOK.includes(r.status));
    const group = (title: string, hint: string, list: ResolvedRow[]): void => {
      if (list.length === 0) return;
      out.createEl("h4", { text: `${title} (${list.length})` });
      out.createEl("p", { cls: "literature-feed-meta", text: hint });
      const box = out.createDiv({ cls: "literature-feed-refs-list" });
      for (const r of list) this.renderRow(box, r);
    };
    group("Needs a look", "Follow the link on the status or search for the paper, then press Confirm if the DOI is right. Not found, software and failed look-ups are not used unless you type a DOI and tick them; Skip takes one out of the check.", needs);
    group("Found", "The title, first author and year agree with the Crossref record, or the DOI was in the text, or you confirmed it.", found);
    if (skippedRows.length > 0) {
      const details = out.createEl("details");
      details.createEl("summary", { text: `Skipped (${skippedRows.length})` });
      const box = details.createDiv({ cls: "literature-feed-refs-list" });
      for (const r of skippedRows) this.renderRow(box, r);
    }
  }

  private skipMany(pick: (r: ResolvedRow) => boolean): void {
    for (const r of this.rows) {
      if (!pick(r)) continue;
      r.skipped = true;
      this.included.delete(r.n);
    }
    this.afterEdit();
  }

  private afterEdit(): void {
    this.flush();
    this.renderRows();
    this.emit();
  }

  private renderRow(parent: HTMLElement, r: ResolvedRow): void {
    const good = r.confirmed || r.status === "OK";
    const state = r.skipped ? "off" : good ? "ok" : r.status === "CHECK" ? "todo" : r.status === "MANUAL" ? "off" : "bad";
    const row = parent.createDiv({ cls: `literature-feed-setup-row literature-feed-ref is-${state}` });
    const box = row.createEl("input", { type: "checkbox", cls: "literature-feed-ref-use", attr: { title: "Use this reference" } });
    box.checked = this.included.has(r.n) && r.doi !== "" && !r.skipped;
    box.disabled = r.skipped;
    box.addEventListener("change", () => {
      if (box.checked && r.doi === "") { box.checked = false; new Notice(TEXT.typeDoi); return; }
      if (box.checked) this.included.add(r.n);
      else this.included.delete(r.n);
      this.saveSoon();
      this.emit();
    });
    row.createSpan({ cls: "literature-feed-setup-mark", text: MARK[state] });

    const text = row.createDiv({ cls: "literature-feed-setup-text" });
    const matched = r.status === "OK" || r.status === "CHECK";
    const query = searchQuery(matched ? r.crossrefTitle : "", r.text);
    text.createDiv({ cls: "literature-feed-title" }).createEl("a", { cls: "external-link", text: r.text, href: googleUrl(query), attr: { target: "_blank", rel: "noopener", title: "Search for this paper on Google" } });
    if (r.crossrefTitle !== "" && r.status !== "OK") text.createDiv({ cls: "literature-feed-meta", text: `Closest in Crossref: ${r.authors === "" ? "" : `${r.authors}. `}${r.crossrefTitle}${r.year === "" ? "" : ` (${r.year})`}` });
    else if (r.authors !== "") text.createDiv({ cls: "literature-feed-meta", text: `${r.authors}${r.journal === "" ? "" : ` \u00b7 ${r.journal}`}${r.year === "" ? "" : ` \u00b7 ${r.year}`}` });
    if (r.reasons.length > 0 && r.status !== "OK") text.createDiv({ cls: "literature-feed-meta", text: r.reasons.join("; ") });
    const links = text.createDiv({ cls: "literature-feed-meta literature-feed-ref-links" });
    const label = r.skipped ? "Skipped" : r.confirmed ? "Confirmed" : STATUS_LABEL[r.status];
    const chipCls = `literature-feed-status status-${(r.confirmed ? "ok" : r.status).toLowerCase().replace(" ", "-")}`;
    if (r.doi !== "" && !r.skipped) links.createEl("a", { cls: `${chipCls} external-link`, text: label, href: `https://doi.org/${r.doi}`, attr: { target: "_blank", rel: "noopener", title: TEXT.openDoi } });
    else links.createSpan({ cls: chipCls, text: label });
    links.createEl("a", { cls: "external-link", text: "Google", href: googleUrl(query), attr: { target: "_blank", rel: "noopener" } });
    links.createEl("a", { cls: "external-link", text: "Scholar", href: scholarUrl(query), attr: { target: "_blank", rel: "noopener" } });

    const actions = row.createDiv({ cls: "literature-feed-ref-actions" });
    const doi = actions.createEl("input", { type: "text", placeholder: "10.\u2026" });
    doi.value = r.doi;
    doi.disabled = r.skipped;
    doi.addEventListener("change", () => {
      const typed = doiInText(doi.value) || doi.value.trim().toLowerCase();
      r.doi = /^10\.\d{4,9}\/\S+$/.test(typed) ? typed : "";
      r.confirmed = false;
      if (r.doi !== "") this.included.add(r.n);
      else this.included.delete(r.n);
      this.afterEdit();
    });
    const buttons = actions.createDiv({ cls: "literature-feed-buttons" });
    if (r.skipped) {
      buttons.createEl("button", { text: "Restore" }).addEventListener("click", () => { r.skipped = false; if (includedByDefault(r)) this.included.add(r.n); this.afterEdit(); });
    } else {
      if (r.doi !== "" && !r.confirmed) buttons.createEl("button", { text: "Confirm", cls: "mod-cta", attr: { title: TEXT.doiRight } }).addEventListener("click", () => { r.confirmed = true; this.included.add(r.n); this.afterEdit(); });
      if (r.confirmed) buttons.createEl("button", { text: "Undo" }).addEventListener("click", () => { r.confirmed = false; this.afterEdit(); });
      buttons.createEl("button", { text: "Skip", attr: { title: "Do not check this one (a repository, a web page)" } }).addEventListener("click", () => { r.skipped = true; this.included.delete(r.n); this.afterEdit(); });
    }
  }

  private async createNote(): Promise<void> {
    const folder = this.host.reviewFolder();
    const lines = ["---", "kind: reference-list", "cssclasses:", "  - vt", `created: ${today()}`, "---", "", `> [!info] ${this.rows.length} references, tidied and looked up on Crossref. Rows marked Check, Not found or Manual need a look.`, "", toMarkdownTable(this.rows), ""];
    const path = await this.host.createReviewNote(`${folder === "" ? "" : `${folder}/`}References with DOIs ${today()}.md`, lines.join("\n"));
    new Notice(`Note made: ${path}`);
  }
}
