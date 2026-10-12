// Settings and feed configuration. Pure data and validation: no Obsidian imports, so tests can run it.
import type { ConceptGroup, Feed, GroupRole } from "../match/feed";

export const GROUP_ROLES: GroupRole[] = ["required", "boost", "priority"];

export interface FeedConfig extends Feed {
  /** Stable slug, unique among the feeds; used for the Zotero tag `feed/<id>`. */
  id: string;
  enabled: boolean;
  /** OpenAlex search strings, one request series each. */
  topics: string[];
  /** Only papers published in or after this year; null = no limit beyond the scan window. */
  yearsFrom: number | null;
  zoteroCollection: string;
  project: string;
}

/** The two API keys. Their values live in Obsidian's secret storage; settings hold only the id of the secret. */
export type SecretName = "openAlexKey" | "zoteroKey";

export interface Settings {
  /** Id of the secret that holds the OpenAlex key ("" = none chosen). Never the key itself. */
  openAlexKeySecret: string;
  /** Id of the secret that holds the Zotero key ("" = none chosen). Never the key itself. */
  zoteroKeySecret: string;
  zoteroUserId: string;
  inboxFolder: string;
  archiveFolder: string;
  /** 0 = Sunday … 6 = Saturday (`Date.getDay()`). */
  scanDay: number;
  feeds: FeedConfig[];
  /** Day of the last complete scan, `YYYY-MM-DD`; "" = never scanned. */
  lastScan: string;
  /** `<feed id>/<OpenAlex id>` of papers already listed in an inbox note, newest last, so a rescan does not list them again. */
  seen: string[];
  /** Result of the most recent scan; null before the first one. */
  lastScanResult: ScanCounts | null;
}

/** One feed's part of a scan. */
export interface FeedCounts {
  /** The feed's id (as in `FeedConfig`). */
  id: string;
  /** The feed's name at the time of the scan. */
  name: string;
  priority: number;
  strong: number;
  possible: number;
  unchecked: number;
  dropped: number;
  failed: boolean;
}

/** What the most recent scan found; shown on the status block and the Home card. Papers are counted once per feed. */
export interface ScanCounts {
  /** Day of that scan, `YYYY-MM-DD`. */
  at: string;
  priority: number;
  strong: number;
  possible: number;
  unchecked: number;
  /** Candidates the feeds' rules removed. */
  dropped: number;
  /** Feeds that failed in that scan. */
  failed: number;
  /** The same, feed by feed (every feed that was scanned). */
  feeds: FeedCounts[];
}

/** The seen list keeps at most this many ids (the oldest go first). */
export const SEEN_CAP = 5000;

export function defaultSettings(): Settings {
  return {
    openAlexKeySecret: "", zoteroKeySecret: "", zoteroUserId: "", inboxFolder: "", archiveFolder: "", scanDay: 1, feeds: [],
    lastScan: "", seen: [], lastScanResult: null,
  };
}

/** A folder setting: trimmed, and the vault root, which the folder picker gives as "/", is stored as "". */
export function normaliseFolder(value: string): string {
  const folder = value.trim();
  return folder === "/" ? "" : folder;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value.trim() : fallback;
}

/** A list of non-empty, trimmed strings, in order, without repeats. Anything else gives an empty list. */
function textList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    const s = typeof item === "string" ? item.trim() : "";
    if (s !== "" && !out.includes(s)) out.push(s);
  }
  return out;
}

/** The text of a "one per line" box as a list: trimmed, no empty lines, no repeats. */
export function parseLines(value: string): string[] {
  return textList(value.split(/\r?\n/));
}

/** The text of a "years from" box: a whole year between 1900 and 2100, or null for empty or anything else. */
export function parseYear(value: string): number | null {
  return /^\d{4}$/.test(value.trim()) ? normaliseYear(Number(value.trim())) : null;
}

function isRole(value: unknown): value is GroupRole {
  return typeof value === "string" && (GROUP_ROLES as string[]).includes(value);
}

export function slugify(name: string): string {
  const slug = name
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug === "" ? "feed" : slug;
}

function uniqueId(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}

function uniqueName(base: string, taken: readonly string[]): string {
  if (!taken.includes(base)) return base;
  let n = 2;
  while (taken.includes(`${base} ${n}`)) n++;
  return `${base} ${n}`;
}

function normaliseGroup(raw: unknown, index: number): ConceptGroup | null {
  if (!isRecord(raw) || !isRole(raw.role)) return null;
  return { name: text(raw.name) || `Group ${index + 1}`, role: raw.role, terms: textList(raw.terms) };
}

function normaliseYear(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 1900 && value <= 2100 ? value : null;
}

/** Null when the entry is not an object or has no name. `taken` holds the ids already used; the new id is added to it. */
function normaliseFeed(raw: unknown, taken: Set<string>): FeedConfig | null {
  if (!isRecord(raw)) return null;
  const name = text(raw.name);
  if (name === "") return null;
  const id = uniqueId(slugify(text(raw.id) || name), taken);
  taken.add(id);
  const groups = Array.isArray(raw.groups)
    ? raw.groups.map(normaliseGroup).filter((g): g is ConceptGroup => g !== null)
    : [];
  return {
    id,
    name,
    enabled: raw.enabled === true,
    topics: textList(raw.topics),
    groups,
    drop: textList(raw.drop),
    lower: textList(raw.lower),
    yearsFrom: normaliseYear(raw.yearsFrom),
    zoteroCollection: text(raw.zoteroCollection),
    project: text(raw.project),
  };
}

/** Reads whatever `loadData()` returned. Never throws: wrong types fall back to the defaults, unknown fields are dropped. */
export function normaliseSettings(raw: unknown): Settings {
  const out = defaultSettings();
  if (!isRecord(raw)) return out;
  out.openAlexKeySecret = secretId(raw.openAlexKeySecret);
  out.zoteroKeySecret = secretId(raw.zoteroKeySecret);
  out.zoteroUserId = text(raw.zoteroUserId);
  out.inboxFolder = normaliseFolder(text(raw.inboxFolder));
  out.archiveFolder = normaliseFolder(text(raw.archiveFolder));
  if (typeof raw.scanDay === "number" && Number.isInteger(raw.scanDay) && raw.scanDay >= 0 && raw.scanDay <= 6) {
    out.scanDay = raw.scanDay;
  }
  out.lastScan = typeof raw.lastScan === "string" && /^\d{4}-\d{2}-\d{2}$/.test(raw.lastScan) ? raw.lastScan : "";
  out.seen = textList(raw.seen).slice(-SEEN_CAP);
  out.lastScanResult = normaliseScanCounts(raw.lastScanResult);
  const taken = new Set<string>();
  if (Array.isArray(raw.feeds)) {
    for (const entry of raw.feeds) {
      const feed = normaliseFeed(entry, taken);
      if (feed) out.feeds.push(feed);
    }
  }
  return out;
}

function count(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
}

function normaliseScanCounts(raw: unknown): ScanCounts | null {
  if (!isRecord(raw) || typeof raw.at !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(raw.at)) return null;
  const [priority, strong, possible, unchecked, dropped, failed] =
    ["priority", "strong", "possible", "unchecked", "dropped", "failed"].map((k) => count(raw[k]));
  if ([priority, strong, possible, unchecked, dropped, failed].some((n) => n === null)) return null;
  const feeds = Array.isArray(raw.feeds) ? raw.feeds.map(normaliseFeedCounts).filter((f): f is FeedCounts => f !== null) : [];
  return { at: raw.at, priority: priority!, strong: strong!, possible: possible!, unchecked: unchecked!, dropped: dropped!, failed: failed!, feeds };
}

function normaliseFeedCounts(raw: unknown): FeedCounts | null {
  if (!isRecord(raw) || typeof raw.id !== "string" || raw.id === "" || typeof raw.name !== "string" || typeof raw.failed !== "boolean") return null;
  const [priority, strong, possible, unchecked, dropped] = ["priority", "strong", "possible", "unchecked", "dropped"].map((k) => count(raw[k]));
  if ([priority, strong, possible, unchecked, dropped].some((n) => n === null)) return null;
  return { id: raw.id, name: raw.name, priority: priority!, strong: strong!, possible: possible!, unchecked: unchecked!, dropped: dropped!, failed: raw.failed };
}

/** A secret id as Obsidian allows it: lower-case letters, digits and dashes. Anything else is no id. */
function secretId(value: unknown): string {
  const id = text(value);
  return /^[a-z0-9]+(-[a-z0-9]+)*$/.test(id) ? id : "";
}

export interface SecretStore {
  getSecret(id: string): string | null;
  setSecret(id: string, secret: string): void;
}

export const DEFAULT_SECRET_IDS: Record<SecretName, string> = {
  openAlexKey: "literature-feed-openalex",
  zoteroKey: "literature-feed-zotero",
};

/**
 * Earlier versions kept the keys as plain text in `data.json` (`openAlexKey`, `zoteroKey`). Moves any such value into
 * the secret store and records the secret's id in `settings`. A secret that already holds a value is never overwritten.
 * Returns true when something moved, so the caller saves the settings (which no longer hold the plain text).
 * May throw (from `setSecret`); `settings` may then be half-updated, so the caller must discard it and not save.
 */
export function migrateLegacyKeys(raw: unknown, settings: Settings, store: SecretStore): boolean {
  if (!isRecord(raw)) return false;
  let moved = false;
  for (const name of ["openAlexKey", "zoteroKey"] as const) {
    const legacy = text(raw[name]);
    if (legacy === "") continue;
    const field = `${name}Secret` as const;
    const id = settings[field] || DEFAULT_SECRET_IDS[name];
    if (!store.getSecret(id)) store.setSecret(id, legacy);
    settings[field] = id;
    moved = true;
  }
  return moved;
}

export function newFeed(existing: readonly FeedConfig[]): FeedConfig {
  const name = uniqueName("New feed", existing.map((f) => f.name));
  return {
    id: uniqueId(slugify(name), new Set(existing.map((f) => f.id))),
    name,
    enabled: false,
    topics: [],
    groups: [],
    drop: [],
    lower: [],
    yearsFrom: null,
    zoteroCollection: "",
    project: "",
  };
}

/** A deep copy, so an editor can change it without touching the saved feed. */
export function cloneFeed(feed: FeedConfig): FeedConfig {
  return {
    ...feed,
    topics: [...feed.topics],
    groups: feed.groups.map((g) => ({ ...g, terms: [...g.terms] })),
    drop: [...feed.drop],
    lower: [...feed.lower],
  };
}

/** A copy that is switched off, with its own name and id. */
export function duplicateFeed(feed: FeedConfig, existing: readonly FeedConfig[]): FeedConfig {
  const name = uniqueName(`${feed.name} copy`, existing.map((f) => f.name));
  return { ...cloneFeed(feed), id: uniqueId(slugify(name), new Set(existing.map((f) => f.id))), name, enabled: false };
}

/** Problems worth showing in the editor. They warn, they do not block saving. */
export function checkFeed(feed: FeedConfig): string[] {
  const warnings: string[] = [];
  if (feed.topics.length === 0) warnings.push("No search topics: the feed will find nothing.");
  for (const topic of feed.topics) {
    const open = (topic.match(/\(/g) ?? []).length;
    const close = (topic.match(/\)/g) ?? []).length;
    const quotes = (topic.match(/"/g) ?? []).length;
    if (open !== close) warnings.push(`Unbalanced brackets in topic: ${topic}`);
    if (quotes % 2 !== 0) warnings.push(`Unbalanced quotation marks in topic: ${topic}`);
  }
  if (!feed.groups.some((g) => g.role === "required")) {
    warnings.push("No required group: every paper that is not dropped will count as Possible.");
  }
  for (const group of feed.groups) {
    if (group.terms.length === 0) warnings.push(`The group "${group.name}" has no terms, so it never matches.`);
  }
  return warnings;
}

/** The feed as it is exported: no id, no on/off switch, never a key. */
export function feedToJson(feed: FeedConfig): string {
  const { name, topics, groups, drop, lower, yearsFrom, zoteroCollection, project } = feed;
  return JSON.stringify({ name, topics, groups, drop, lower, yearsFrom, zoteroCollection, project }, null, 2) + "\n";
}

export interface ParsedFeed {
  feed?: FeedConfig;
  errors: string[];
}

/** Takes the text of a `.json` file or a pasted block (a code fence around it is fine). The feed comes back switched off. */
export function parseFeedJson(input: string, existing: readonly FeedConfig[] = []): ParsedFeed {
  let body = input.trim();
  const fenced = /^```[a-z]*[ \t]*\r?\n([\s\S]*?)\r?\n```$/i.exec(body);
  if (fenced) body = fenced[1];
  let raw: unknown;
  try {
    raw = JSON.parse(body);
  } catch (e) {
    return { errors: [`This is not valid JSON (${e instanceof Error ? e.message : "parse error"}).`] };
  }
  if (!isRecord(raw)) return { errors: ["A feed is a JSON object with a name, topics and groups."] };

  const errors: string[] = [];
  if (text(raw.name) === "") errors.push('The feed needs a "name".');
  if (raw.topics !== undefined && !Array.isArray(raw.topics)) errors.push('"topics" must be a list of search strings.');
  for (const key of ["drop", "lower"] as const) {
    if (raw[key] !== undefined && !Array.isArray(raw[key])) errors.push(`"${key}" must be a list of terms.`);
  }
  if (raw.groups !== undefined && !Array.isArray(raw.groups)) {
    errors.push('"groups" must be a list.');
  } else if (Array.isArray(raw.groups)) {
    raw.groups.forEach((g, i) => {
      if (!isRecord(g)) errors.push(`Group ${i + 1} must be an object with a name, a role and terms.`);
      else if (!isRole(g.role)) errors.push(`Group ${i + 1} needs a role: ${GROUP_ROLES.join(", ")}.`);
      else if (g.terms !== undefined && !Array.isArray(g.terms)) errors.push(`Group ${i + 1}: "terms" must be a list.`);
    });
  }
  if (raw.yearsFrom !== undefined && raw.yearsFrom !== null && normaliseYear(raw.yearsFrom) === null) {
    errors.push('"yearsFrom" must be a year between 1900 and 2100, or null.');
  }
  if (errors.length > 0) return { errors };

  const feed = normaliseFeed({ ...raw, id: undefined, enabled: false }, new Set(existing.map((f) => f.id)));
  if (!feed) return { errors: ['The feed needs a "name".'] };
  feed.name = uniqueName(feed.name, existing.map((f) => f.name));
  return { feed, errors: [] };
}
