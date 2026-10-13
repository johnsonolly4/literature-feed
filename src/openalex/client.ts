// OpenAlex client. No Obsidian imports: the caller passes in a `Requester` (in the plugin a thin wrapper
// around Obsidian's `requestUrl`, in tests a fake, in scripts/openalex-run.mjs `fetch`).
import { dedupe } from "../match/dedupe";
import type { Paper } from "../match/feed";

const API_URL = "https://api.openalex.org/works";
const SELECT = [
  "id", "doi", "title", "publication_year", "publication_date", "type",
  "abstract_inverted_index", "primary_location", "authorships",
].join(",");
/** OpenAlex basic paging stops at page * per_page = 10,000. */
const PAGING_CAP = 10_000;

export interface RequestOptions {
  url: string;
  headers?: Record<string, string>;
}

/**
 * Must not throw on a non-2xx status (Obsidian: `requestUrl({ throw: false })`) and return `json: null`
 * when the body is not JSON (Obsidian's `json` getter throws, so the wrapper has to catch).
 */
export type Requester = (req: RequestOptions) => Promise<{ status: number; json: unknown }>;

/** `scoped`: `search.title_and_abstract=…` (what the docs recommend). `filter`: `filter=title_and_abstract.search:…` (the plan's wording). */
export type QueryForm = "scoped" | "filter";

export interface SearchUrlOptions {
  /** `YYYY-MM-DD`. Papers published on or after this day. */
  fromDate?: string;
  page?: number;
  perPage?: number;
  form?: QueryForm;
}

/** The one place that knows how a topic becomes a query. */
export function buildSearchUrl(topic: string, opts: SearchUrlOptions = {}): string {
  const { fromDate, page = 1, perPage = 100, form = "scoped" } = opts;
  const params: string[] = [];
  const filters: string[] = [];
  if (fromDate) filters.push(`from_publication_date:${fromDate}`);
  if (form === "scoped") {
    params.push(`search.title_and_abstract=${encodeURIComponent(topic)}`);
  } else {
    // A comma separates filters and a colon splits name from value, so neither may appear unescaped in the value.
    filters.push(`title_and_abstract.search:${topic.replace(/,/g, " ")}`);
  }
  if (filters.length > 0) params.push(`filter=${encodeURIComponent(filters.join(","))}`);
  params.push(`per_page=${perPage}`, `page=${page}`, `select=${SELECT}`);
  return `${API_URL}?${params.join("&")}`;
}

/** OpenAlex sends an abstract as `{ word: [positions] }`; this puts the words back in order. */
export function rebuildAbstract(index?: Record<string, number[]> | null): string | null {
  if (!index) return null;
  const words: string[] = [];
  for (const [word, positions] of Object.entries(index)) {
    for (const pos of positions) words[pos] = word;
  }
  const text = words.filter((w) => w !== undefined).join(" ");
  return text === "" ? null : text;
}

interface OpenAlexSource {
  display_name?: string | null;
  type?: string | null;
}

export interface OpenAlexWork {
  id: string;
  doi?: string | null;
  title?: string | null;
  publication_year?: number | null;
  publication_date?: string | null;
  type?: string | null;
  abstract_inverted_index?: Record<string, number[]> | null;
  primary_location?: { source?: OpenAlexSource | null } | null;
  authorships?: { author?: { display_name?: string | null } | null }[] | null;
}

/** A paper as the scan hands it on: what the engine reads plus what the inbox note shows. */
export interface Candidate extends Paper {
  openalexId: string;
  authors: string[];
  venue: string | null;
  publicationDate: string | null;
}

/** Null for a work without a title (nothing to show or match). */
export function toCandidate(work: OpenAlexWork): Candidate | null {
  const title = work.title?.trim();
  if (!title) return null;
  const source = work.primary_location?.source;
  return {
    title,
    abstract: rebuildAbstract(work.abstract_inverted_index),
    doi: work.doi ?? null,
    year: work.publication_year ?? undefined,
    isPreprint: work.type === "preprint" || source?.type === "repository",
    openalexId: work.id,
    authors: (work.authorships ?? []).map((a) => a.author?.display_name?.trim() ?? "").filter((n) => n !== ""),
    venue: source?.display_name ?? null,
    publicationDate: work.publication_date ?? null,
  };
}

export class OpenAlexError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = "OpenAlexError";
  }
}

export interface ClientOptions {
  request: Requester;
  /** Sent as a Bearer header, never in the URL. Optional: OpenAlex answers without a key, with a smaller daily budget. */
  apiKey?: string;
  /** Waits between tries. Passed in because this file may not touch timers (the plugin passes `window.setTimeout`, tests a no-op). */
  sleep: (ms: number) => Promise<void>;
  /** Tries per request on HTTP 429, first try included. */
  maxTries?: number;
  /** Wait before the second try; doubles each time. */
  backoffMs?: number;
}

export interface SearchOptions extends SearchUrlOptions {
  /** Called after each page, e.g. to show progress. */
  onPage?: (fetched: number, total: number) => void;
}

export interface TopicResult {
  topic: string;
  /** Works OpenAlex reports for the topic (`meta.count`). */
  count: number;
  /** Candidates fetched (works without a title are left out). */
  papers: Candidate[];
  costUsd: number;
  /** True when the 10,000-result paging cap stopped the fetch before `count` was reached. */
  truncated: boolean;
}

export class OpenAlexClient {
  private readonly request: Requester;
  private readonly headers: Record<string, string>;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly maxTries: number;
  private readonly backoffMs: number;

  constructor(opts: ClientOptions) {
    this.request = opts.request;
    this.headers = { Accept: "application/json" };
    if (opts.apiKey) this.headers.Authorization = `Bearer ${opts.apiKey}`;
    this.sleep = opts.sleep;
    this.maxTries = opts.maxTries ?? 4;
    this.backoffMs = opts.backoffMs ?? 1000;
  }

  /** One GET with back-off on 429. The error text never contains the URL or the key. */
  private async get(url: string): Promise<Record<string, unknown>> {
    let wait = this.backoffMs;
    for (let attempt = 1; ; attempt++) {
      const res = await this.request({ url, headers: this.headers });
      if (res.status === 429 && attempt < this.maxTries) {
        await this.sleep(wait);
        wait *= 2;
        continue;
      }
      if (res.status === 429) {
        throw new OpenAlexError(`OpenAlex says the request budget is used up or too many requests (HTTP 429), after ${attempt} tries`, 429);
      }
      if (res.status === 401 || res.status === 403) {
        throw new OpenAlexError(`OpenAlex refused the API key (HTTP ${res.status})`, res.status);
      }
      if (res.status < 200 || res.status >= 300) {
        throw new OpenAlexError(`OpenAlex request failed (HTTP ${res.status})`, res.status);
      }
      if (typeof res.json !== "object" || res.json === null) {
        throw new OpenAlexError("OpenAlex answered with something that is not JSON", res.status);
      }
      return res.json as Record<string, unknown>;
    }
  }

  /** One work by its short id (`W123`), with the same fields as a search result. Used when a ticked paper goes to Zotero. */
  async getWork(id: string): Promise<OpenAlexWork> {
    if (!/^W\d+$/.test(id)) throw new OpenAlexError("That is not an OpenAlex work id");
    const body = await this.get(`${API_URL}/${id}?select=${SELECT}`);
    if (typeof body.id !== "string") throw new OpenAlexError("OpenAlex answered with something that is not a work");
    return body as unknown as OpenAlexWork;
  }

  /** All works for one topic, page by page. Cost is the sum of `meta.cost_usd` over the pages. */
  async searchTopic(topic: string, opts: SearchOptions = {}): Promise<TopicResult> {
    const perPage = opts.perPage ?? 100;
    const papers: Candidate[] = [];
    let costUsd = 0;
    let count = 0;
    let fetched = 0;
    let truncated = false;

    for (let page = 1; ; page++) {
      const body = await this.get(buildSearchUrl(topic, { ...opts, page, perPage }));
      const meta = (body.meta ?? {}) as { count?: number; cost_usd?: number };
      const results = Array.isArray(body.results) ? (body.results as OpenAlexWork[]) : [];
      count = meta.count ?? count;
      costUsd += meta.cost_usd ?? 0;
      fetched += results.length;
      for (const work of results) {
        const candidate = toCandidate(work);
        if (candidate) papers.push(candidate);
      }
      opts.onPage?.(fetched, count);

      if (results.length === 0 || fetched >= count) break;
      if (page * perPage >= PAGING_CAP) {
        truncated = true;
        break;
      }
    }
    return { topic, count, papers, costUsd, truncated };
  }

  /** Every topic in turn; papers found by several topics are merged (DOI, then title). */
  async scan(topics: readonly string[], opts: SearchOptions = {}): Promise<ScanResult> {
    const perTopic: TopicResult[] = [];
    for (const topic of topics) perTopic.push(await this.searchTopic(topic, opts));
    return {
      perTopic,
      papers: dedupe(perTopic.flatMap((t) => t.papers)),
      costUsd: perTopic.reduce((sum, t) => sum + t.costUsd, 0),
    };
  }
}

export interface ScanResult {
  perTopic: TopicResult[];
  papers: Candidate[];
  costUsd: number;
}
