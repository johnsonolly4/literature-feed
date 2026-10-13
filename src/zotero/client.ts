// Zotero Web API v3 client (https://www.zotero.org/support/dev/web_api/v3/start). No Obsidian imports: the caller passes in
// an HTTP function (in the plugin a wrapper around `requestUrl`, in tests a fake) and a `sleep`. One request at a time.
// Error text never contains the API key or the address.
import { bareDoi, type ZoteroItem } from "./map";

const API_URL = "https://api.zotero.org";
const PAGE = 100;

export interface HttpRequest {
  url: string;
  method: "GET" | "POST" | "PATCH";
  headers: Record<string, string>;
  body?: string;
}

/** `headers` has lower-case names. Must not throw on a non-2xx status; `json` is null when the body is not JSON. */
export interface HttpResponse {
  status: number;
  json: unknown;
  headers: Record<string, string>;
  /** The body as text, for error messages (Zotero explains a refused request in plain text). Optional. */
  text?: string;
}

export type HttpRequester = (req: HttpRequest) => Promise<HttpResponse>;

export class ZoteroError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = "ZoteroError";
  }
}

export interface ZoteroCollection {
  key: string;
  name: string;
  /** Key of the parent collection, null for a top-level one. */
  parent: string | null;
}

/** A collection as the API returns it, with whether Zotero marks it deleted (in its Trash). */
export interface ZoteroCollectionRow extends ZoteroCollection {
  deleted: boolean;
}

export interface ZoteroTag {
  tag: string;
  type?: number;
}

/** An item already in the library, as far as Sync needs it. */
export interface ZoteroFound {
  key: string;
  version: number;
  collections: string[];
  tags: ZoteroTag[];
}

/** An item read back by its key; `deleted` is true when it is in Zotero's Trash. */
export interface ZoteroStored extends ZoteroFound {
  deleted: boolean;
}

function isTrue(value: unknown): boolean {
  return value === true || value === 1 || value === "1" || value === "true";
}

/** The collections as paths, for the diagnostic window: "Inbox / Name  ·  key ABCD1234" and, if it is in the Trash, "IN TRASH". */
export function describeCollections(rows: readonly ZoteroCollectionRow[]): string[] {
  const byKey = new Map(rows.map((r) => [r.key, r]));
  const pathOf = (row: ZoteroCollectionRow): string => {
    const names: string[] = [];
    const seen = new Set<string>();
    for (let r: ZoteroCollectionRow | undefined = row; r && !seen.has(r.key); r = r.parent ? byKey.get(r.parent) : undefined) {
      seen.add(r.key);
      names.unshift(r.name);
    }
    return names.join("/");
  };
  return rows
    .map((r) => ({ path: pathOf(r), r }))
    .sort((a, b) => a.path.localeCompare(b.path))
    .map(({ path, r }) => `${path}  ·  key ${r.key}${r.deleted ? "  ·  IN TRASH" : ""}`);
}

export interface ClientOptions {
  request: HttpRequester;
  userId: string;
  apiKey: string;
  sleep: (ms: number) => Promise<void>;
  /** Tries per request on HTTP 429 (or 503 with Retry-After), first try included. */
  maxTries?: number;
  /** Wait before the second try when the server gives no Retry-After; doubles each time. */
  backoffMs?: number;
  /** 32 random hex characters for `Zotero-Write-Token`. Injected so tests (which have no `window`) can supply it. */
  writeToken?: () => string;
}

function randomToken(): string {
  const bytes = new Uint8Array(16);
  window.crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Lower-case letters and digits only, for comparing titles. */
export function titleKey(title: string): string {
  return title.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

export interface CollectionPlan {
  /** Key of the collection when the whole path exists, else null. */
  key: string | null;
  /** Names still to create, outermost first (empty when the path exists). */
  toCreate: string[];
  /** Key of the deepest collection that exists on the path (the parent of the first one to create), or null. */
  parentKey: string | null;
}

/** Splits "Inbox/Lipoic acid copolymers" into names (trimmed, no empty parts). */
export function pathParts(path: string): string[] {
  return path.split("/").map((p) => p.trim()).filter((p) => p !== "");
}

/** Walks the path through the existing collections (exact name and parent match); says what is missing. */
export function planCollection(collections: readonly ZoteroCollection[], path: string): CollectionPlan {
  const parts = pathParts(path);
  let parent: string | null = null;
  for (let i = 0; i < parts.length; i++) {
    const found = collections.find((c) => c.name === parts[i] && c.parent === parent);
    if (!found) return { key: null, toCreate: parts.slice(i), parentKey: parent };
    parent = found.key;
  }
  return { key: parent, toCreate: [], parentKey: parent };
}

export class ZoteroClient {
  private readonly http: HttpRequester;
  private readonly base: string;
  private readonly headers: Record<string, string>;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly maxTries: number;
  private readonly backoffMs: number;
  private readonly token: () => string;
  /** Seconds the server asked us to wait (`Backoff` header) before the next request. */
  private pause = 0;

  constructor(opts: ClientOptions) {
    if (!/^\d+$/.test(opts.userId)) throw new ZoteroError("The Zotero user ID must be a number.");
    this.http = opts.request;
    this.base = `${API_URL}/users/${opts.userId}`;
    this.headers = { "Zotero-API-Key": opts.apiKey, "Zotero-API-Version": "3", Accept: "application/json" };
    this.sleep = opts.sleep;
    this.maxTries = opts.maxTries ?? 4;
    this.backoffMs = opts.backoffMs ?? 1000;
    this.token = opts.writeToken ?? randomToken;
  }

  /** One request with the rules of the API: wait when asked (`Backoff`), retry on 429 with `Retry-After`, no key in errors. */
  private async send(method: HttpRequest["method"], what: string, path: string, opts: { body?: unknown; headers?: Record<string, string> } = {}): Promise<HttpResponse> {
    const url = `${this.base}${path}`;
    const headers: Record<string, string> = { ...this.headers, ...opts.headers };
    let body: string | undefined;
    if (opts.body !== undefined) {
      body = JSON.stringify(opts.body);
      headers["Content-Type"] = "application/json";
    }
    let wait = this.backoffMs;
    for (let attempt = 1; ; attempt++) {
      if (this.pause > 0) {
        await this.sleep(this.pause * 1000);
        this.pause = 0;
      }
      const res = await this.http({ url, method, headers, body });
      const backoff = Number(res.headers["backoff"]);
      if (backoff > 0) this.pause = backoff;
      const retryable = res.status === 429 || (res.status === 503 && res.headers["retry-after"] !== undefined);
      if (retryable && attempt < this.maxTries) {
        const retryAfter = Number(res.headers["retry-after"]);
        await this.sleep(retryAfter > 0 ? retryAfter * 1000 : wait);
        wait *= 2;
        continue;
      }
      if (res.status === 429) throw new ZoteroError(`Zotero says there are too many requests (HTTP 429), after ${attempt} tries.`, 429);
      if (res.status === 401 || res.status === 403) throw new ZoteroError(`Zotero refused the API key or user ID (HTTP ${res.status}). Check both in the settings.`, res.status);
      if (res.status === 409) throw new ZoteroError("Zotero says the library is locked (HTTP 409). Try again in a moment.", 409);
      if (res.status === 412) throw new ZoteroError("The item changed in Zotero in the meantime (HTTP 412). Press Sync again.", 412);
      if (res.status < 200 || res.status >= 300) {
        // Zotero explains a refused request in a short plain-text body; it never repeats the key.
        const reason = (res.text ?? "").replace(/\p{Cc}+/gu, " ").replace(/\s+/g, " ").trim().slice(0, 300);
        throw new ZoteroError(`Zotero request failed while trying to ${what} (HTTP ${res.status})${reason !== "" ? `: ${reason}` : "."}`, res.status);
      }
      return res;
    }
  }

  /** Every collection the API returns (all pages), including any Zotero marks as deleted. */
  async listCollectionsRaw(): Promise<ZoteroCollectionRow[]> {
    const out: ZoteroCollectionRow[] = [];
    for (let start = 0; ; start += PAGE) {
      const res = await this.send("GET", "list your collections", `/collections?limit=${PAGE}&start=${start}`);
      const rows = Array.isArray(res.json) ? res.json : [];
      for (const row of rows) {
        if (!isRecord(row) || typeof row.key !== "string" || !isRecord(row.data) || typeof row.data.name !== "string") continue;
        const parent = row.data.parentCollection;
        out.push({
          key: row.key, name: row.data.name, parent: typeof parent === "string" && parent !== "" ? parent : null,
          deleted: isTrue(row.data.deleted) || isTrue(row.deleted),
        });
      }
      const total = Number(res.headers["total-results"]);
      if (rows.length === 0 || (total > 0 ? out.length >= total && start + PAGE >= total : rows.length < PAGE)) break;
    }
    return out;
  }

  /** The collections that exist: those in Zotero's Trash are left out, so a trashed collection counts as missing. */
  async listCollections(): Promise<ZoteroCollection[]> {
    return (await this.listCollectionsRaw()).filter((c) => !c.deleted).map(({ key, name, parent }) => ({ key, name, parent }));
  }

  /** Creates one collection (a top-level one when `parentKey` is null) and returns its key. */
  async createCollection(name: string, parentKey: string | null): Promise<string> {
    const res = await this.send("POST", "create a collection", "/collections", {
      body: [{ name, parentCollection: parentKey ?? false }],
      headers: { "Zotero-Write-Token": this.token() },
    });
    return this.firstKey(res.json, `Zotero did not create the collection "${name}"`);
  }

  private firstKey(json: unknown, failure: string): string {
    if (isRecord(json)) {
      const ok = isRecord(json.successful) ? json.successful["0"] : undefined;
      if (isRecord(ok) && typeof ok.key === "string") return ok.key;
      const failed = isRecord(json.failed) ? json.failed["0"] : undefined;
      if (isRecord(failed)) {
        throw new ZoteroError(`${failure}: ${typeof failed.message === "string" ? failed.message : "no reason given"}`, typeof failed.code === "number" ? failed.code : undefined);
      }
    }
    throw new ZoteroError(`${failure}.`);
  }

  private toFound(row: unknown): { found: ZoteroFound; doi: string; title: string; type: string } | null {
    if (!isRecord(row) || typeof row.key !== "string" || typeof row.version !== "number" || !isRecord(row.data)) return null;
    const data = row.data;
    const tags = Array.isArray(data.tags)
      ? data.tags.filter((t): t is Record<string, unknown> => isRecord(t) && typeof t.tag === "string").map((t) => ({ tag: String(t.tag), ...(typeof t.type === "number" ? { type: t.type } : {}) }))
      : [];
    const collections = Array.isArray(data.collections) ? data.collections.filter((c): c is string => typeof c === "string") : [];
    return {
      found: { key: row.key, version: row.version, collections, tags },
      doi: bareDoi(typeof data.DOI === "string" ? data.DOI : ""),
      title: typeof data.title === "string" ? data.title : "",
      type: typeof data.itemType === "string" ? data.itemType : "",
    };
  }

  private async search(query: string, everything: boolean): Promise<ReturnType<ZoteroClient["toFound"]>[]> {
    const mode = everything ? "&qmode=everything" : "";
    const res = await this.send("GET", "look for the paper in your library", `/items?q=${encodeURIComponent(query)}${mode}&itemType=-attachment&limit=${PAGE}`);
    return (Array.isArray(res.json) ? res.json : []).map((row) => this.toFound(row));
  }

  /** The item with this DOI, if the library has one. */
  async findByDoi(doi: string): Promise<ZoteroFound | null> {
    const wanted = bareDoi(doi);
    if (wanted === "") return null;
    const hit = (await this.search(wanted, true)).find((r) => r !== null && r.doi === wanted);
    return hit?.found ?? null;
  }

  /** For a paper without a DOI: an item whose title is the same apart from case and punctuation. */
  async findByTitle(title: string): Promise<ZoteroFound | null> {
    const wanted = titleKey(title);
    if (wanted === "") return null;
    const hit = (await this.search(title, false)).find((r) => r !== null && titleKey(r.title) === wanted);
    return hit?.found ?? null;
  }

  /** Reads one item back by its key; null when Zotero has no such item. Used to check that a write really landed. */
  async getItem(key: string): Promise<ZoteroStored | null> {
    let res: HttpResponse;
    try {
      res = await this.send("GET", "read the item back", `/items/${encodeURIComponent(key)}`);
    } catch (e) {
      if (e instanceof ZoteroError && e.status === 404) return null;
      throw e;
    }
    const parsed = this.toFound(res.json);
    if (!parsed) return null;
    const data = isRecord(res.json) && isRecord(res.json.data) ? res.json.data : {};
    return { ...parsed.found, deleted: isTrue(data.deleted) };
  }

  /** Creates one item and returns what was made (so a second feed that finds the same paper can add to it). */
  async createItem(item: ZoteroItem): Promise<ZoteroFound> {
    const res = await this.send("POST", "create the item", "/items", { body: [item], headers: { "Zotero-Write-Token": this.token() } });
    const key = this.firstKey(res.json, "Zotero rejected the item");
    const ok = isRecord(res.json) && isRecord(res.json.successful) ? res.json.successful["0"] : undefined;
    const version = isRecord(ok) && typeof ok.version === "number" ? ok.version : Number(res.headers["last-modified-version"]) || 0;
    const collections = Array.isArray(item.collections) ? item.collections.filter((c): c is string => typeof c === "string") : [];
    const tags = Array.isArray(item.tags) ? item.tags.filter((t): t is ZoteroTag => isRecord(t) && typeof t.tag === "string") : [];
    return { key, version, collections, tags };
  }

  /**
   * Adds collections and tags to an existing item, keeping everything it already has. Sends nothing when the item has them
   * all. Returns the item as it is afterwards (the version is the response's `Last-Modified-Version` when there was a change).
   */
  async addToCollectionsAndTag(found: ZoteroFound, collections: readonly string[], tags: readonly string[]): Promise<{ item: ZoteroFound; changed: boolean }> {
    const nextCollections = [...new Set([...found.collections, ...collections])];
    const nextTags = [...found.tags, ...tags.filter((t) => !found.tags.some((x) => x.tag === t)).map((tag) => ({ tag }))];
    if (nextCollections.length === found.collections.length && nextTags.length === found.tags.length) return { item: found, changed: false };
    const res = await this.send("PATCH", "add the paper to its collections", `/items/${encodeURIComponent(found.key)}`, {
      body: { collections: nextCollections, tags: nextTags },
      headers: { "If-Unmodified-Since-Version": String(found.version) },
    });
    const version = Number(res.headers["last-modified-version"]) || found.version;
    return { item: { key: found.key, version, collections: nextCollections, tags: nextTags }, changed: true };
  }
}
