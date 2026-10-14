import { MarkdownView, Menu, Notice, Plugin, TFile, normalizePath } from "obsidian";
import { registerInboxBlock } from "./inbox/block";
import { localDay, runScan, scanCounts, updatedSeen, type ScanOutcome } from "./inbox/scan";
import { describeSync, findPending, runSync } from "./inbox/sync";
import { buildLiteratureIndex, describeRefresh, findLiteratureNote, isFinished, type LiteratureNote, type RefreshReport } from "./inbox/state";
import { NOTE_NAME_PATTERN, ensureNoteClasses, markRead, markSynced, mergeIntoNote, parseInbox, renderNote, setDismissed, setTick, tidySynced, type DismissReason, type ParsedPaper } from "./inbox/write";
import { emptyLedger, forgetFeeds, normaliseLedger, recordDefinitions, recordDropped, recordScan, updateFromNotes, type Ledger } from "./ledger/ledger";
import { topicStatRows, titlesByVerdict, type TopicStatRow } from "./prompts/build";
import { emptyDecisions, normaliseDecisions, type Decisions } from "./prompts/decisions";
import { PromptModal, type PromptHost, type PromptKind } from "./prompts/modals";
import { addSpend, emptyTally, monthOf, normaliseTally, type SpendTally } from "./review/budget";
import { emptyCache, normaliseCache, type ReviewCache } from "./review/cache";
import type { FlagSources } from "./review/flags";
import { chartBlockProcessor } from "./review/chart-view";
import { GRAPH_BLOCK, graphFromNote, normaliseGraph, type GraphData } from "./review/graph-data";
import { GRAPH_VIEW, GraphView, graphBlockProcessor, type GraphHost } from "./review/graph-view";
import { buildMenu, commandName, commandSpec, type MenuAction } from "./menu";
import { CrossrefClient } from "./refs/crossref";
import { normaliseRefsSession, type RefsSession } from "./refs/panel";
import { crossrefRequester } from "./refs/request";
import { REFS_VIEW, RefsView } from "./refs/view";
import { GAPS_VIEW, GapsView } from "./review/gaps-view";
import { emptyGapsSession, normaliseGapsSession, type GapsSession } from "./review/gaps-input";
import { GAPS_KIND, gapsRecordFromNote, parseGapsSnapshot, sessionFromRecord } from "./review/gaps-note";
import { REPORT_BLOCK, reportsInNote, type ReportKind } from "./ui/report-block";
import { reportBlockProcessor } from "./ui/report-view";
import { recordFromNote, type ReviewRecord } from "./review/record";
import { REVIEW_VIEW, ReviewView } from "./review/review-view";
import { describeSession, normaliseSession, type ReviewSession } from "./review/session";
import type { ReviewHost, StartMode } from "./review/window";
import { buildLookup, emptyIndex, mergeIndex, normaliseIndex, type ZoteroIndex } from "./zotero/library-index";
import type { FixAction, SetupSnapshot } from "./setup/checks";
import type { IntegrationInfo } from "./setup/integrate";
import { SetupModal, type SetupHost } from "./setup/setup-modal";
import { buildOverlap, overlapMarkdown } from "./ledger/overlap";
import { buildReport, reportMarkdown } from "./ledger/report";
import { ReportModal } from "./ledger/report-modal";
import { OpenAlexClient } from "./openalex/client";
import { obsidianRequester } from "./openalex/request";
import { scanDue, syncDue } from "./schedule";
import { defaultSettings, migrateLegacyKeys, normaliseSettings, type SecretName, type Settings } from "./settings/data";
import type { SettingsHost } from "./settings/feed-modal";
import { LiteratureFeedSettingTab } from "./settings/tab";
import { ZoteroClient, describeCollections } from "./zotero/client";
import { CollectionsModal } from "./zotero/collections-modal";
import { zoteroRequester } from "./zotero/request";

/** An inbox note in the archive folder; a number after the name is added when a note of that name was already there. */
const ARCHIVED_NOTE_PATTERN = /^\d{4}-W\d{2} Reading inbox( \d+)?\.md$/;

/** The first automatic check waits this long after Obsidian's layout is ready, so the vault is indexed and the start-up is not slowed. */
/** The command palette name of a command: its group, then its title (`src/menu.ts`). */
const nameOf = (id: string): string => commandName(commandSpec(id));
const START_DELAY_MS = 15_000;
/** While Obsidian stays open the schedule is checked this often. */
const CHECK_EVERY_MS = 60 * 60 * 1000;

const NO_SNAPSHOT = "This note holds no saved report, so its settings were put back. Press Estimate the cost, then Find the gaps (free from the cache for a day).";

export default class LiteratureFeedPlugin extends Plugin implements SettingsHost, PromptHost, SetupHost, ReviewHost, GraphHost {
  settings: Settings = defaultSettings();
  private tab: LiteratureFeedSettingTab | null = null;
  private scanning = false;
  private syncing = false;
  /** The day of the last automatic attempt of each kind in this session: at most one a day, so a failure is not retried hourly. */
  private readonly autoTried = { scan: "", sync: "" };
  /** The long-term record of how each search does (`ledger.json` in the plugin folder). */
  private ledger: Ledger = emptyLedger();
  /** OpenAlex requests made by this plugin, by month (`openalex-spend.json`). */
  spend: SpendTally = emptyTally();
  private spendTimer: number | null = null;
  /** What the last literature reviews fetched, kept 24 hours (`review-cache.json`). */
  reviewCache: ReviewCache = emptyCache();
  /** The literature review in progress (`review-session.json`), so closing the tab does not lose it. */
  session: ReviewSession | null = null;
  /** The reference tidy-up's last list and results (`refs-session.json`). */
  refsSession: RefsSession | null = null;
  /** The citation-gaps tool's last input and run (`gaps-session.json`). */
  gapsSession: GapsSession | null = null;
  /** How the review tab starts the next time it is created. */
  private nextReviewMode: StartMode = "ask";
  /** What each kind of report note can reopen (gaps, graph, …); see `ui/report-block.ts`. */
  readonly reportKinds = new Map<string, ReportKind>();
  /** The graph of the last literature review (`review-graph.json`). */
  graph: GraphData | null = null;
  /** The Zotero library as a local, read-only index (`zotero-index.json`). */
  zoteroIndex: ZoteroIndex = emptyIndex();
  /** Earlier LLM suggestions and what the user decided (`decisions.json` in the plugin folder). */
  decisions: Decisions = emptyDecisions();
  /** Open status blocks and cards; they redraw after a scan. */
  readonly scanListeners = new Set<() => void>();

  async onload(): Promise<void> {
    await this.loadSettings();
    this.ledger = await this.loadLedger();
    this.decisions = await this.loadDecisions();
    this.spend = normaliseTally(await this.readPluginJson("openalex-spend.json"));
    this.reviewCache = normaliseCache(await this.readPluginJson("review-cache.json"));
    this.zoteroIndex = normaliseIndex(await this.readPluginJson("zotero-index.json"));
    this.graph = normaliseGraph(await this.readPluginJson("review-graph.json"));
    this.session = normaliseSession(await this.readPluginJson("review-session.json"));
    this.gapsSession = normaliseGapsSession(await this.readPluginJson("gaps-session.json"));
    this.refsSession = normaliseRefsSession(await this.readPluginJson("refs-session.json"));
    this.registerView(REFS_VIEW, (leaf) => new RefsView(leaf, this));
    this.addCommand({ id: "find-dois", name: nameOf("find-dois"), callback: () => void this.openRefs() });
    this.registerView(GAPS_VIEW, (leaf) => new GapsView(leaf, this));
    this.addCommand({ id: "citation-gaps", name: nameOf("citation-gaps"), callback: () => void this.openGaps() });
    this.registerView(REVIEW_VIEW, (leaf) => {
      const view = new ReviewView(leaf, this);
      view.mode = this.nextReviewMode;
      this.nextReviewMode = "ask";
      return view;
    });
    this.registerView(GRAPH_VIEW, (leaf) => new GraphView(leaf, this));
    this.addRibbonIcon("telescope", "Find papers", (evt) => this.reviewMenu(evt));
    this.addCommand({
      id: "repeat-review", name: nameOf("repeat-review"),
      editorCheckCallback: (checking, editor) => {
        const record = recordFromNote(editor.getValue());
        if (record && !checking) void this.openReview("new", record);
        return record !== null;
      },
    });
    this.addCommand({
      id: "resume-review", name: nameOf("resume-review"),
      checkCallback: (checking) => {
        if (this.session && !checking) void this.openReview("resume");
        return this.session !== null;
      },
    });
    this.reportKinds.set(GAPS_KIND, { label: "gaps view", open: (data) => this.openGapsSnapshot(data) });
    this.reportKinds.set("graph", { label: "graph view", open: async (data) => { const g = normaliseGraph(data); if (g) await this.openGraph(g); return g !== null; } });
    this.registerMarkdownCodeBlockProcessor(REPORT_BLOCK, (source, el) => reportBlockProcessor(source, el, this.reportKinds));
    // In any report note: opens the interactive view the note was made from (a snapshot in the note, else its record, else a graph).
    this.addCommand({
      id: "open-note-report", name: nameOf("open-note-report"),
      editorCheckCallback: (checking, editor) => {
        const open = this.reportOpener(editor.getValue());
        if (open && !checking) void open();
        return open !== null;
      },
    });
    this.registerMarkdownCodeBlockProcessor(GRAPH_BLOCK, (source, el, ctx) => graphBlockProcessor(source, el, ctx, this.app, (g) => void this.openGraph(g)));
    this.tab = new LiteratureFeedSettingTab(this, this);
    this.addSettingTab(this.tab);
    registerInboxBlock(this);
    this.addCommand({ id: "scan-now", name: nameOf("scan-now"), callback: () => void this.scanNow() });
    this.addCommand({ id: "check-setup", name: nameOf("check-setup"), callback: () => void this.openSetup() });
    this.registerMarkdownCodeBlockProcessor("literature-feed-chart", (source, el) => chartBlockProcessor(source, el));
    this.addCommand({ id: "literature-review", name: nameOf("literature-review"), callback: () => void this.openReview() });
    this.addCommand({ id: "llm-review", name: nameOf("llm-review"), callback: () => void this.openPrompt("review") });
    this.addCommand({ id: "llm-topics", name: nameOf("llm-topics"), callback: () => void this.openPrompt("topics") });
    this.addCommand({ id: "llm-compare", name: nameOf("llm-compare"), callback: () => void this.openPrompt("compare") });
    this.addCommand({ id: "llm-new-search", name: nameOf("llm-new-search"), callback: () => void this.openPrompt("new") });
    this.addCommand({ id: "open-inbox", name: nameOf("open-inbox"), callback: () => void this.openInbox() });
    this.addRibbonIcon("book-open", "Open reading inbox", () => void this.openInbox());
    // A link a note can hold: [Reading inbox](obsidian://literature-feed-inbox) opens the newest weekly note (its name changes every week).
    this.registerObsidianProtocolHandler("literature-feed-inbox", () => void this.openInbox());
    this.addCommand({ id: "sync-ticked", name: nameOf("sync-ticked"), callback: () => void this.syncNow() });
    this.addCommand({ id: "update-read-archive", name: nameOf("update-read-archive"), callback: () => void this.refreshAndReport(true) });
    this.addCommand({ id: "search-effectiveness", name: nameOf("search-effectiveness"), callback: () => void this.showEffectiveness() });
    this.addCommand({ id: "show-zotero-collections", name: nameOf("show-zotero-collections"), callback: () => void this.showCollections() });
    this.app.workspace.onLayoutReady(() => {
      const first = window.setTimeout(() => void this.checkSchedule(), START_DELAY_MS);
      this.register(() => window.clearTimeout(first));
      this.registerInterval(window.setInterval(() => void this.checkSchedule(), CHECK_EVERY_MS));
    });
  }

  /** The automatic scan (when the scan day has passed since the last one) and sync (once a day), if their settings are on. */
  async checkSchedule(): Promise<void> {
    const today = localDay(new Date());
    const s = this.settings;
    if (s.autoScan && this.autoTried.scan !== today && s.feeds.some((f) => f.enabled && f.topics.length > 0) && scanDue(s.lastScan, today, s.scanDay)) {
      this.autoTried.scan = today;
      await this.scanNow(true);
    }
    if (s.autoSync && this.autoTried.sync !== today && syncDue(s.lastSync, today)) {
      this.autoTried.sync = today;
      await this.syncNow(true);
    }
  }

  /** Opens the newest weekly inbox note, or says there is none yet. */
  async openInbox(): Promise<void> {
    const newest = this.inboxFiles().sort((a, b) => b.name.localeCompare(a.name))[0];
    if (!newest) {
      new Notice("No reading inbox yet. Scan for papers first.");
      return;
    }
    await this.app.workspace.getLeaf(false).openFile(newest);
  }

  async loadSettings(): Promise<void> {
    const raw: unknown = await this.loadData();
    const settings = normaliseSettings(raw);
    try {
      if (migrateLegacyKeys(raw, settings, this.app.secretStorage)) {
        this.settings = settings;
        await this.saveSettings(); // rewrites data.json without the plain-text keys
        new Notice("Literature feed: your API keys were moved to Obsidian's secret storage.");
        return;
      }
    } catch {
      // data.json was not rewritten, so nothing is lost yet; but the plain-text keys are not kept in memory.
      new Notice("Literature feed: could not move your API keys to Obsidian's secret storage. Choose them again in the settings.");
      this.settings = normaliseSettings(raw);
      return;
    }
    this.settings = settings;
  }

  /** Adds a search string to a search's topics (once), saves, and says what happened. */
  async addTopicToFeed(feedId: string, topic: string): Promise<string> {
    const feed = this.settings.feeds.find((f) => f.id === feedId);
    if (!feed) return "That search no longer exists.";
    if (feed.topics.includes(topic)) return `"${feed.name}" already has this topic.`;
    feed.topics.push(topic);
    await this.saveSettings();
    return `Added to "${feed.name}" (now ${feed.topics.length} topics). Papers it finds are still ranked by that search's rules. Run the review again to use it.`;
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  /** The key's value, read from Obsidian's secret storage at the moment it is needed. "" when none is chosen. */
  getSecret(name: SecretName): string {
    const id = name === "openAlexKey" ? this.settings.openAlexKeySecret : this.settings.zoteroKeySecret;
    return id === "" ? "" : this.app.secretStorage.getSecret(id) ?? "";
  }

  /** `data.json` changed outside Obsidian (for example by a sync service): read it again and redraw the tab. */
  async onExternalSettingsChange(): Promise<void> {
    await this.loadSettings();
    this.tab?.update();
  }

  /**
   * One scan of every enabled feed; writes or extends this week's inbox note and says what it found. `auto` (the schedule):
   * does not open the note and stays silent when there is nothing to do.
   */
  async scanNow(auto = false): Promise<void> {
    if (this.scanning) {
      if (!auto) new Notice("A scan is already running.");
      return;
    }
    this.scanning = true;
    try {
      if (!this.settings.feeds.some((f) => f.enabled && f.topics.length > 0)) {
        if (!auto) new Notice("No feed is switched on. Turn one on in the settings first.");
        return;
      }
      new Notice("Scanning for new papers…");
      const client = this.newOpenAlexClient();
      const now = new Date();
      const outcome = await runScan(this.settings, { client, now });
      const scanned = this.settings.feeds.filter((f) => outcome.topicStats.some((s) => s.feedId === f.id));
      const ledgerChanged = [
        recordDefinitions(this.ledger, scanned, localDay(now)),
        recordScan(this.ledger, localDay(now), outcome.topicStats),
        recordDropped(this.ledger, outcome.droppedIds),
      ].some(Boolean);
      if (ledgerChanged) await this.saveLedger();
      const path = outcome.note ? await this.writeNote(outcome.note) : null;
      this.settings.lastScan = outcome.lastScan;
      this.settings.seen = updatedSeen(this.settings.seen, outcome.seenAdd);
      this.settings.lastScanResult = scanCounts(outcome, localDay(now));
      await this.saveSettings();
      for (const redraw of this.scanListeners) redraw();
      new Notice(describeOutcome(outcome), outcome.failures.length > 0 ? 10_000 : 6_000);
      await this.refreshAndReport();
      if (!auto && path && this.app.vault.getFileByPath(path)) await this.app.workspace.openLinkText(path, "", "tab");
    } catch (e) {
      new Notice(`The ${auto ? "automatic " : ""}scan failed: ${e instanceof Error ? e.message : "unknown error"}`, 10_000);
    } finally {
      this.scanning = false;
    }
  }

  /** Sends every ticked paper in the inbox notes to Zotero and links the note lines to the new items. */
  async syncNow(auto = false): Promise<void> {
    if (this.syncing) {
      if (!auto) new Notice("A sync is already running.");
      return;
    }
    this.syncing = true;
    try {
      const apiKey = this.getSecret("zoteroKey");
      const userId = this.settings.zoteroUserId;
      if (apiKey === "" || userId === "") {
        if (!auto) new Notice("Add your Zotero API key and user ID in the settings first.");
        return;
      }
      await this.saveOpenInboxNotes();
      const notes = await this.readInboxNotes();
      for (const note of notes) {
        // Papers linked before the "In Zotero" list existed are moved into it.
        const tidy = tidySynced(note.text);
        if (tidy !== note.text) {
          await this.app.vault.process(note.file, tidySynced);
          note.text = tidy;
        }
      }
      const pending = findPending(notes.map((n) => ({ path: n.file.path, text: n.text })));
      if (pending.length === 0) {
        if (!auto) new Notice("Nothing to sync: tick the papers you want first.");
        return;
      }
      new Notice(`Sending ${pending.length} paper${pending.length === 1 ? "" : "s"} to Zotero…`);
      const sleep = (ms: number): Promise<void> => new Promise((resolve) => window.setTimeout(resolve, ms));
      const result = await runSync(this.settings.feeds, pending, {
        zotero: new ZoteroClient({ request: zoteroRequester, userId, apiKey, sleep }),
        openalex: this.newOpenAlexClient(),
      }, { createInboxCollections: this.settings.createInboxCollections, createProjectCollections: this.settings.createProjectCollections });
      for (const note of notes) {
        const marks = result.synced.filter((s) => s.path === note.file.path);
        if (marks.length > 0) await this.app.vault.process(note.file, (current) => markSynced(current, marks));
      }
      this.settings.lastSync = localDay(new Date());
      await this.saveSettings();
      new Notice(describeSync(result), result.failed.length > 0 || result.blocked.length > 0 ? 15_000 : 8_000);
      await this.refreshAndReport();
      for (const redraw of this.scanListeners) redraw();
    } catch (e) {
      new Notice(`The ${auto ? "automatic " : ""}sync failed: ${e instanceof Error ? e.message : "unknown error"}`, 10_000);
    } finally {
      this.syncing = false;
    }
  }

  /** The table's checkbox: sets the tick of one paper's line in the note, nothing else. */
  async toggleTick(path: string, feedId: string, openalexId: string, ticked: boolean): Promise<void> {
    const file = this.app.vault.getFileByPath(path);
    if (!file) return;
    await this.app.vault.process(file, (current) => setTick(current, feedId, openalexId, ticked));
    await this.updateLedgerNow();
  }

  /** The table's dismiss button: dismisses one paper's line (or takes it back with null), nothing else. */
  async setDismissed(path: string, feedId: string, openalexId: string, reason: DismissReason | null): Promise<void> {
    const file = this.app.vault.getFileByPath(path);
    if (!file) return;
    await this.app.vault.process(file, (current) => setDismissed(current, feedId, openalexId, reason));
    await this.updateLedgerNow();
  }

  /** Records what the inbox notes now show in the ledger, quietly (a failure is not worth a message here). */
  private async updateLedgerNow(): Promise<void> {
    try {
      const inbox = (await this.readInboxNotes()).map((n) => ({ name: n.file.name, papers: parseInbox(n.text).papers }));
      await this.recordLedger(inbox);
    } catch {
      // The next refresh or report records it.
    }
  }

  /** Marks papers that have a literature note as read and archives finished notes; says so when it changed something. */
  async refreshAndReport(verbose = false): Promise<void> {
    try {
      await this.saveOpenInboxNotes();
      const report = await this.refreshInbox();
      if (verbose) {
        new Notice(describeRefresh(report), 12_000);
        return;
      }
      const { read, archived } = report;
      const parts = [
        read > 0 ? `${read} paper${read === 1 ? "" : "s"} marked read` : "",
        archived > 0 ? `${archived} note${archived === 1 ? "" : "s"} archived` : "",
      ].filter((p) => p !== "");
      if (parts.length > 0) new Notice(`${parts.join(", ")}.`);
    } catch (e) {
      new Notice(`Could not update the read state: ${e instanceof Error ? e.message : "unknown error"}`, 10_000);
    }
  }

  /** The literature folder's notes with their frontmatter (from Obsidian's cache). */
  private literatureNotes(): LiteratureNote[] {
    const folder = this.settings.literatureFolder === "" ? null : this.app.vault.getFolderByPath(this.settings.literatureFolder);
    const out: LiteratureNote[] = [];
    const walk = (f: { children: unknown[] }): void => {
      for (const child of f.children) {
        if (child instanceof TFile) {
          if (child.extension === "md") out.push({ path: child.path, frontmatter: this.app.metadataCache.getFileCache(child)?.frontmatter });
        } else if (typeof child === "object" && child !== null && "children" in child) {
          walk(child as { children: unknown[] });
        }
      }
    };
    if (folder) walk(folder);
    return out;
  }

  /** For each inbox note: Read links for papers with a literature note, then the move to the archive if it is finished. */
  async refreshInbox(): Promise<RefreshReport> {
    const { vault } = this.app;
    const literature = this.literatureNotes();
    const index = buildLiteratureIndex(literature);
    const inbox = await this.readInboxNotes();
    let papers = 0;
    const today = localDay(new Date());
    let read = 0;
    let archived = 0;
    const forLedger: { name: string; papers: ParsedPaper[] }[] = [];
    for (const note of inbox) {
      let text = note.text;
      const withClasses = ensureNoteClasses(text);
      if (withClasses !== text) {
        // Notes made before the table existed get the classes that show it and hide the checkbox lines.
        await vault.process(note.file, ensureNoteClasses);
        text = withClasses;
      }
      papers += parseInbox(text).papers.length;
      if (this.settings.literatureFolder !== "") {
        const marks: { feedId: string; openalexId: string; link: string }[] = [];
        for (const p of parseInbox(text).papers) {
          const link = findLiteratureNote(index, p.doi, p.key, p.title);
          if (link !== null) marks.push({ feedId: p.feedId, openalexId: p.openalexId, link });
        }
        const next = markRead(text, marks);
        if (next !== text) {
          read += parseInbox(next).papers.filter((p) => p.read).length - parseInbox(text).papers.filter((p) => p.read).length;
          await vault.process(note.file, (current) => markRead(current, marks));
          text = next;
        }
      }
      forLedger.push({ name: note.file.name, papers: parseInbox(text).papers });
      const folder = this.settings.archiveFolder;
      if (this.settings.archiveFinished && folder !== "" && isFinished(parseInbox(text).papers, note.file.name, today, this.settings.dismissAfterWeeks)) {
        if (!vault.getFolderByPath(folder)) await vault.createFolder(folder);
        const base = note.file.name.replace(/\.md$/i, "");
        let path = normalizePath(`${folder}/${base}.md`);
        for (let n = 2; vault.getAbstractFileByPath(path); n++) path = normalizePath(`${folder}/${base} ${n}.md`);
        await this.app.fileManager.renameFile(note.file, path);
        archived++;
      }
    }
    await this.recordLedger(forLedger);
    return {
      inboxFolder: this.settings.inboxFolder, inboxNotes: inbox.length, literatureFolder: this.settings.literatureFolder,
      literatureNotes: literature.length, papers, read, archived,
    };
  }

  /** Where the ledger is kept: next to `data.json`, in the plugin's folder. Null when Obsidian does not say where that is. */
  private ledgerPath(): string | null {
    return this.manifest.dir ? normalizePath(`${this.manifest.dir}/ledger.json`) : null;
  }

  /** An OpenAlex client with the user's key; every request's cost goes into the monthly tally. */
  private newOpenAlexClient(): OpenAlexClient {
    return new OpenAlexClient({
      request: obsidianRequester,
      apiKey: this.getSecret("openAlexKey") || undefined,
      sleep: (ms) => new Promise((resolve) => window.setTimeout(resolve, ms)),
      onCost: (usd) => this.recordSpend(usd),
    });
  }

  newReviewClient(): OpenAlexClient {
    return this.newOpenAlexClient();
  }

  /** Adds a request's cost to this month's tally; the file is written a moment later, once for a burst of requests. */
  recordSpend(usd: number): void {
    addSpend(this.spend, monthOf(new Date()), usd);
    if (this.spendTimer !== null) return;
    this.spendTimer = window.setTimeout(() => {
      this.spendTimer = null;
      void this.writePluginJson("openalex-spend.json", this.spend);
    }, 2000);
  }

  onunload(): void {
    if (this.spendTimer !== null) {
      window.clearTimeout(this.spendTimer);
      void this.writePluginJson("openalex-spend.json", this.spend);
    }
  }

  private async readPluginJson(name: string): Promise<unknown> {
    if (!this.manifest.dir) return null;
    const path = normalizePath(`${this.manifest.dir}/${name}`);
    try {
      if (!(await this.app.vault.adapter.exists(path))) return null;
      return JSON.parse(await this.app.vault.adapter.read(path)) as unknown;
    } catch {
      return null;
    }
  }

  private async writePluginJson(name: string, data: unknown): Promise<void> {
    if (!this.manifest.dir) return;
    try {
      await this.app.vault.adapter.write(normalizePath(`${this.manifest.dir}/${name}`), JSON.stringify(data));
    } catch (e) {
      new Notice(`Could not save ${name}: ${e instanceof Error ? e.message : "unknown error"}`, 10_000);
    }
  }

  /** Opens the review in a tab (the one that is open, if any). `resume` picks up the saved review, `new` starts fresh. */
  async openReview(mode: StartMode = "ask", repeat?: ReviewRecord): Promise<void> {
    await this.updateLedgerNow();
    const existing = this.app.workspace.getLeavesOfType(REVIEW_VIEW)[0];
    const leaf = existing ?? this.app.workspace.getLeaf("tab");
    if (!existing) {
      this.nextReviewMode = mode;
      await leaf.setViewState({ type: REVIEW_VIEW, active: true });
    }
    if (leaf.view instanceof ReviewView && (repeat || (existing && mode !== "ask"))) leaf.view.show(mode, repeat);
    await this.app.workspace.revealLeaf(leaf);
  }

  /** Opens the citation-gaps tool in a tab (the one that is open, if any). */
  async openGaps(): Promise<void> {
    await this.updateLedgerNow();
    const existing = this.app.workspace.getLeavesOfType(GAPS_VIEW)[0];
    const leaf = existing ?? this.app.workspace.getLeaf("tab");
    if (!existing) await leaf.setViewState({ type: GAPS_VIEW, active: true });
    await this.app.workspace.revealLeaf(leaf);
  }

  /** Shows the tool in its tab from the given session (a saved run, or the inputs of an older note). */
  private async openGapsSession(session: GapsSession): Promise<void> {
    this.saveGapsSession(session);
    await this.updateLedgerNow();
    const existing = this.app.workspace.getLeavesOfType(GAPS_VIEW)[0];
    const leaf = existing ?? this.app.workspace.getLeaf("tab");
    if (!existing) await leaf.setViewState({ type: GAPS_VIEW, active: true });
    else if (leaf.view instanceof GapsView) leaf.view.reload();
    await this.app.workspace.revealLeaf(leaf);
  }

  /** Reopens a saved gaps report (the snapshot a note holds) without asking OpenAlex anything. */
  async openGapsSnapshot(data: unknown): Promise<boolean> {
    const snap = parseGapsSnapshot(data);
    if (!snap) return false;
    const base = sessionFromRecord({ input: snap.input, minCount: snap.minCount, addedDois: snap.run.addedDois, deeper: snap.run.deeper ? { minCount: snap.run.deeper.minCount, hubsRead: snap.run.deeper.hubsRead, gaps: [] } : null }, this.gapsSession ?? emptyGapsSession());
    await this.openGapsSession({ ...base, audit: snap.audit ? { answer: JSON.stringify(snap.audit, null, 2), result: snap.audit } : null, last: { input: snap.input, run: snap.run, ranAt: snap.ranAt } });
    return true;
  }

  /**
   * What "open this note's report" would do for the text of a note, or null when it holds nothing to open: a report block of a
   * registered kind, else an older graph block, else an older gaps record (its inputs are put back and the run is made again).
   */
  private reportOpener(text: string): (() => Promise<void>) | null {
    for (const snap of reportsInNote(text)) {
      const kind = this.reportKinds.get(snap.kind);
      if (kind) return async () => { if (!(await kind.open(snap.data))) new Notice("The report in this note could not be read."); };
    }
    const graph = graphFromNote(text);
    if (graph) return () => this.openGraph(graph);
    const record = gapsRecordFromNote(text);
    if (record) {
      return async () => {
        await this.openGapsSession(sessionFromRecord(record, this.gapsSession ?? emptyGapsSession()));
        new Notice(NO_SNAPSHOT, 10000);
      };
    }
    return null;
  }

  /** Opens the reference tidy-up in a tab (the one that is open, if any). */
  async openRefs(): Promise<void> {
    const existing = this.app.workspace.getLeavesOfType(REFS_VIEW)[0];
    const leaf = existing ?? this.app.workspace.getLeaf("tab");
    if (!existing) await leaf.setViewState({ type: REFS_VIEW, active: true });
    await this.app.workspace.revealLeaf(leaf);
  }

  saveRefsSession(session: RefsSession): void {
    this.refsSession = session;
    void this.writePluginJson("refs-session.json", session);
  }

  /** A Crossref client for looking up references: one request at a time; the contact email only if the user gave one. */
  newCrossrefClient(): CrossrefClient {
    return new CrossrefClient({ request: crossrefRequester, sleep: (ms) => new Promise((resolve) => window.setTimeout(resolve, ms)), mailto: this.settings.crossrefEmail });
  }

  saveGapsSession(session: GapsSession): void {
    this.gapsSession = session;
    void this.writePluginJson("gaps-session.json", session);
  }

  /** The ribbon icon's menu (Find papers): Watch, Discover, Expand, Improve and the tools, as `buildMenu` lists them. */
  private reviewMenu(evt: MouseEvent): void {
    const saved = this.session;
    const names = new Map(this.settings.feeds.map((f) => [f.id, f.name]));
    const run: Record<MenuAction, () => void> = {
      "open-inbox": () => void this.openInbox(),
      "scan-now": () => void this.scanNow(),
      "review-new": () => void this.openReview("new"),
      "review-resume": () => void this.openReview("resume"),
      "open-graph": () => void this.openGraph(this.graph),
      "gaps": () => void this.openGaps(),
      "gaps-last": () => void this.openGaps(),
      // Until the Improve tab exists (searches-merge plan, Phase 6) this is the search-effectiveness report.
      "improve": () => void this.showEffectiveness(),
      "find-dois": () => void this.openRefs(),
      "check-setup": () => void this.openSetup(),
    };
    const menu = new Menu();
    buildMenu({ resume: saved ? describeSession(saved, names) : null, hasGraph: this.graph !== null, hasGapsReport: Boolean(this.gapsSession?.last) }).forEach((section, i) => {
      if (i > 0) menu.addSeparator();
      menu.addItem((item) => item.setTitle(section.label).setIsLabel(true));
      for (const entry of section.entries) menu.addItem((item) => item.setTitle(entry.title).setIcon(entry.icon).onClick(run[entry.action]));
    });
    menu.showAtMouseEvent(evt);
  }

  /** Keeps the review in progress (the file is written now; a review is saved a few times, not on every keystroke). */
  saveSession(session: ReviewSession): void {
    this.session = session;
    void this.writePluginJson("review-session.json", session);
  }

  /** Shows the review graph in a tab (the given one, which is also kept for next time). */
  async openGraph(data: GraphData | null): Promise<void> {
    if (data === null) {
      new Notice("No review graph yet. Make a literature review first.");
      return;
    }
    this.graph = data;
    await this.writePluginJson("review-graph.json", data);
    const existing = this.app.workspace.getLeavesOfType(GRAPH_VIEW)[0];
    const leaf = existing ?? this.app.workspace.getLeaf("tab");
    if (!existing) await leaf.setViewState({ type: GRAPH_VIEW, active: true });
    else if (leaf.view instanceof GraphView) leaf.view.render();
    await this.app.workspace.revealLeaf(leaf);
  }

  async saveReviewCache(): Promise<void> {
    await this.writePluginJson("review-cache.json", this.reviewCache);
  }

  /** Reads the Zotero library (read-only) into the local index, only what changed since the last time, and says what it found. */
  async refreshZoteroIndex(): Promise<string> {
    const apiKey = this.getSecret("zoteroKey");
    const userId = this.settings.zoteroUserId;
    if (apiKey === "" || userId === "") throw new Error("Add your Zotero API key and user ID in the settings first.");
    const sleep = (ms: number): Promise<void> => new Promise((resolve) => window.setTimeout(resolve, ms));
    const client = new ZoteroClient({ request: zoteroRequester, userId, apiKey, sleep });
    const since = this.zoteroIndex.libraryVersion;
    const [fetched, deleted] = await Promise.all([client.listLibraryItems(since), client.listDeleted(since)]);
    this.zoteroIndex = mergeIndex(this.zoteroIndex, fetched.items, deleted, fetched.libraryVersion);
    await this.writePluginJson("zotero-index.json", this.zoteroIndex);
    return `Zotero index up to date: ${Object.keys(this.zoteroIndex.items).length} items (${fetched.items.length} read this time${deleted.length > 0 ? `, ${deleted.length} removed` : ""}).`;
  }

  /** Where the three flags (in Zotero, in the vault, listed before) come from; a source that is not available is left out. */
  flagSources(): FlagSources {
    return {
      zotero: Object.keys(this.zoteroIndex.items).length > 0 ? buildLookup(this.zoteroIndex) : null,
      literature: this.settings.literatureFolder === "" ? null : buildLiteratureIndex(this.literatureNotes()),
      ledger: this.ledger,
      seen: this.settings.seen,
    };
  }

  /** Review notes go in a Reviews folder under the literature notes folder, or the vault root when there is none. */
  reviewFolder(): string {
    return this.settings.literatureFolder === "" ? "" : normalizePath(`${this.settings.literatureFolder}/Reviews`);
  }

  /** Makes a file (a number is added to its name when one exists), opens it when asked, and returns its path. */
  async createReviewNote(path: string, text: string, open = true): Promise<string> {
    const { vault } = this.app;
    const clean = normalizePath(path);
    const folder = clean.includes("/") ? clean.slice(0, clean.lastIndexOf("/")) : "";
    if (folder !== "" && !vault.getFolderByPath(folder)) await vault.createFolder(folder);
    const ext = /\.[A-Za-z0-9]+$/.exec(clean)?.[0] ?? ".md";
    const base = clean.endsWith(ext) ? clean.slice(0, clean.length - ext.length) : clean;
    let final = `${base}${ext}`;
    for (let n = 2; vault.getAbstractFileByPath(final); n++) final = `${base} ${n}${ext}`;
    await vault.create(final, text);
    if (open) await this.app.workspace.openLinkText(final, "", "tab");
    return final;
  }

  async openSetup(): Promise<void> {
    new SetupModal(this).open();
  }

  /** The facts Check setup needs about this vault (folders, notes, other plugins) and the settings. */
  async buildSnapshot(): Promise<SetupSnapshot> {
    const { vault } = this.app;
    const adapter = vault.adapter;
    const configDir = vault.configDir;
    let enabled: string[] = [];
    try {
      const raw: unknown = JSON.parse(await adapter.read(normalizePath(`${configDir}/community-plugins.json`)));
      enabled = Array.isArray(raw) ? raw.filter((id): id is string => typeof id === "string") : [];
    } catch {
      // No list of enabled plugins: treat every other plugin as off.
    }
    const installed = new Set<string>();
    for (const id of ["zotlit", "lab-kit"]) {
      if (await adapter.exists(normalizePath(`${configDir}/plugins/${id}/manifest.json`))) installed.add(id);
    }
    const notes = new Set(vault.getMarkdownFiles().map((f) => f.basename));
    return {
      settings: this.settings,
      keyReadable: { openAlex: this.getSecret("openAlexKey") !== "", zotero: this.getSecret("zoteroKey") !== "" },
      folderExists: (path) => vault.getFolderByPath(normalizePath(path)) !== null,
      noteExists: (name) => notes.has(name),
      pluginInstalled: (id) => installed.has(id),
      pluginEnabled: (id) => enabled.includes(id),
    };
  }

  async applyFix(fix: FixAction): Promise<void> {
    if (fix.kind === "create-folder") {
      const path = normalizePath(fix.path);
      if (!this.app.vault.getFolderByPath(path)) await this.app.vault.createFolder(path);
      return;
    }
    this.settings.literatureFolder = normalizePath(fix.path);
    await this.saveSettings();
  }

  async readTarget(info: IntegrationInfo): Promise<{ path: string; text: string } | null> {
    const file = this.app.vault.getMarkdownFiles().find((f) => f.basename === info.noteName);
    return file ? { path: file.path, text: await this.app.vault.read(file) } : null;
  }

  async createNote(name: string, text: string): Promise<void> {
    const path = normalizePath(`${name}.md`);
    if (!this.app.vault.getFileByPath(path)) await this.app.vault.create(path, text);
    await this.app.workspace.openLinkText(path, "", "tab");
  }

  async editTarget(path: string, change: (text: string) => string): Promise<void> {
    const file = this.app.vault.getFileByPath(path);
    if (file) await this.app.vault.process(file, change);
  }

  /** Opens the window of one LLM prompt feature, after bringing the ledger up to date (the review prompts print its numbers). */
  async openPrompt(kind: PromptKind): Promise<void> {
    if (kind !== "new") await this.updateLedgerNow();
    new PromptModal(this, kind).open();
  }

  reportFor(feedId: string): string {
    const report = buildReport(this.ledger, this.settings.feeds, localDay(new Date()), this.settings.dismissAfterWeeks);
    const own = {
      ...report,
      feeds: report.feeds.filter((f) => f.feedId === feedId),
      overlap: {
        pairs: report.overlap.pairs.filter((p) => p.a === feedId || p.b === feedId),
        topics: report.overlap.topics.filter((t) => t.feedId === feedId),
      },
    };
    return reportMarkdown(own);
  }

  titlesFor(feedId: string): { wanted: string[]; dismissed: string[] } {
    return titlesByVerdict(this.ledger, feedId, localDay(new Date()), this.settings.dismissAfterWeeks);
  }

  topicOverlapFor(feedId: string): string {
    const overlap = buildOverlap(this.ledger, this.settings.feeds, localDay(new Date()), this.settings.dismissAfterWeeks);
    return overlapMarkdown({ pairs: [], topics: overlap.topics.filter((t) => t.feedId === feedId) }).join("\n");
  }

  compareContext(): { summary: string; overlapMarkdown: string } {
    const today = localDay(new Date());
    const report = buildReport(this.ledger, this.settings.feeds, today, this.settings.dismissAfterWeeks);
    const summary = report.feeds.map((f) => {
      const decided = f.totals.interested + f.totals.dismissed;
      return `- ${f.name}: ${f.totals.listed} papers listed, ${decided} decided, ${f.rate === null ? "no wanted rate yet" : `${Math.round(f.rate * 100)}% wanted`}`;
    }).join("\n");
    return { summary, overlapMarkdown: overlapMarkdown(report.overlap).join("\n") };
  }

  topicStatsFor(feedId: string): TopicStatRow[] {
    return topicStatRows(this.ledger.scans, feedId);
  }

  private decisionsPath(): string | null {
    return this.manifest.dir ? normalizePath(`${this.manifest.dir}/decisions.json`) : null;
  }

  private async loadDecisions(): Promise<Decisions> {
    const path = this.decisionsPath();
    if (path === null) return emptyDecisions();
    try {
      if (!(await this.app.vault.adapter.exists(path))) return emptyDecisions();
      return normaliseDecisions(JSON.parse(await this.app.vault.adapter.read(path)));
    } catch {
      return emptyDecisions();
    }
  }

  async saveDecisions(): Promise<void> {
    const path = this.decisionsPath();
    if (path === null) return;
    try {
      await this.app.vault.adapter.write(path, JSON.stringify(this.decisions));
    } catch (e) {
      new Notice(`Could not save the decisions: ${e instanceof Error ? e.message : "unknown error"}`, 10_000);
    }
  }

  /** The ledger from disk; an empty one when there is none or it cannot be read (the next refresh rebuilds it from the notes). */
  private async loadLedger(): Promise<Ledger> {
    const path = this.ledgerPath();
    if (path === null) return emptyLedger();
    try {
      if (!(await this.app.vault.adapter.exists(path))) return emptyLedger();
      return normaliseLedger(JSON.parse(await this.app.vault.adapter.read(path)));
    } catch {
      return emptyLedger();
    }
  }

  private async saveLedger(): Promise<void> {
    const path = this.ledgerPath();
    if (path === null) return;
    try {
      await this.app.vault.adapter.write(path, JSON.stringify(this.ledger));
    } catch (e) {
      new Notice(`Could not save the search history: ${e instanceof Error ? e.message : "unknown error"}`, 10_000);
    }
  }

  /** Inbox-named notes that were moved to the archive folder, so archived weeks keep counting. */
  private async readArchivedNotes(): Promise<{ name: string; papers: ParsedPaper[] }[]> {
    const folder = this.settings.archiveFolder === "" ? null : this.app.vault.getFolderByPath(this.settings.archiveFolder);
    const files = (folder?.children ?? []).filter((f): f is TFile => f instanceof TFile && ARCHIVED_NOTE_PATTERN.test(f.name));
    return Promise.all(files.map(async (file) => ({ name: file.name, papers: parseInbox(await this.app.vault.read(file)).papers })));
  }

  /** Brings the ledger up to date from the given inbox notes and the archived ones. */
  private async recordLedger(inbox: { name: string; papers: ParsedPaper[] }[]): Promise<void> {
    const notes = [...inbox, ...(await this.readArchivedNotes())];
    if (updateFromNotes(this.ledger, notes, localDay(new Date()))) await this.saveLedger();
  }

  /** The report window: how each search has done so far, and candidate changes to its rules. */
  async showEffectiveness(): Promise<void> {
    try {
      await this.saveOpenInboxNotes();
      const inbox = (await this.readInboxNotes()).map((n) => ({ name: n.file.name, papers: parseInbox(n.text).papers }));
      await this.recordLedger(inbox);
      const report = buildReport(this.ledger, this.settings.feeds, localDay(new Date()), this.settings.dismissAfterWeeks);
      const forgettable = report.feeds.filter((f) => !f.known).length;
      new ReportModal(this.app, reportMarkdown(report), forgettable, async () => {
        const removed = forgetFeeds(this.ledger, new Set(this.settings.feeds.map((f) => f.id)));
        await this.saveLedger();
        return removed;
      }).open();
    } catch (e) {
      new Notice(`Could not build the report: ${e instanceof Error ? e.message : "unknown error"}`, 10_000);
    }
  }

  /** Lists the collections Zotero's server reports (a diagnostic: compare it with what Zotero shows). */
  async showCollections(): Promise<void> {
    const apiKey = this.getSecret("zoteroKey");
    const userId = this.settings.zoteroUserId;
    if (apiKey === "" || userId === "") {
      new Notice("Add your Zotero API key and user ID in the settings first.");
      return;
    }
    try {
      const sleep = (ms: number): Promise<void> => new Promise((resolve) => window.setTimeout(resolve, ms));
      const rows = await new ZoteroClient({ request: zoteroRequester, userId, apiKey, sleep }).listCollectionsRaw();
      new CollectionsModal(this.app, describeCollections(rows)).open();
    } catch (e) {
      new Notice(`Could not read your Zotero collections: ${e instanceof Error ? e.message : "unknown error"}`, 10_000);
    }
  }

  /** Writes an open, edited inbox note to disk first. Obsidian saves edits a moment late, and Sync reads from disk. */
  private async saveOpenInboxNotes(): Promise<void> {
    for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
      const view = leaf.view;
      if (view instanceof MarkdownView && view.file && NOTE_NAME_PATTERN.test(view.file.name)) await view.save();
    }
  }

  /** The inbox notes (by their file name) in the inbox folder, with their text. */
  private async readInboxNotes(): Promise<{ file: TFile; text: string }[]> {
    return Promise.all(this.inboxFiles().map(async (file) => ({ file, text: await this.app.vault.read(file) })));
  }

  /** The weekly notes (by file name) in the inbox folder. */
  private inboxFiles(): TFile[] {
    const { vault } = this.app;
    const folder = this.settings.inboxFolder === "" ? vault.getRoot() : vault.getFolderByPath(this.settings.inboxFolder);
    return (folder?.children ?? []).filter((f): f is TFile => f instanceof TFile && NOTE_NAME_PATTERN.test(f.name));
  }

  /** Creates this week's note, or adds to it inside `vault.process`, so a tick made meanwhile is kept. Returns its path. */
  private async writeNote(note: NonNullable<ScanOutcome["note"]>): Promise<string> {
    const { vault } = this.app;
    const path = normalizePath(note.path);
    const existing = vault.getFileByPath(path);
    if (existing) {
      await vault.process(existing, (current) => mergeIntoNote(ensureNoteClasses(tidySynced(current)), note.input));
      return path;
    }
    const folder = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
    if (folder !== "" && !vault.getFolderByPath(folder)) await vault.createFolder(folder);
    await vault.create(path, renderNote(note.input));
    return path;
  }
}

function describeOutcome(o: ScanOutcome): string {
  const total = o.perTier.priority + o.perTier.strong + o.perTier.possible + o.perTier.unchecked;
  const cost = `cost $${o.costUsd.toFixed(3)}`;
  const parts = [
    total === 0
      ? `No new papers (${cost}).`
      : `${total} new: ${o.perTier.priority} priority, ${o.perTier.strong} strong, ${o.perTier.possible} possible, ${o.perTier.unchecked} without abstract (${cost}).`,
  ];
  if (o.failures.length > 0) {
    parts.push(`${o.failures.length} of ${o.feedsScanned} feeds failed: ${o.failures.map((f) => `${f.feed} (${f.message})`).join("; ")}. Last scan date not moved.`);
  }
  return parts.join(" ");
}
