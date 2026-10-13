// OpenAlex client. No Obsidian imports: the caller passes in a `Requester` (in the plugin a thin wrapper
// around Obsidian's `requestUrl`, in tests a fake, in scripts/openalex-run.mjs `fetch`).
import { dedupe } from "../match/dedupe";
import type { Paper } from "../match/feed";

const API_URL = "https://api.openalex.org/works";
const SELECT = [
  "id", "doi", "title", "publication_year", "publication_date", "type",
  "abstract_inverted_index", "primary_location", "authorships",
].join(",");
/** What a literature review also needs: how often a work is cited, and what it cites (a long list, so only review requests ask for it). */
const SELECT_EXTRA = `${SELECT},cited_by_count,referenced_works`;
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
  /** Also ask for `cited_by_count` and `referenced_works` (reviews only; the weekly scan does not). */
  extra?: boolean;
  /** An OpenAlex sort, for example `relevance_score:desc`, so a cap keeps the best works. */
  sort?: string;
  /** Replaces the fields asked for (for example `id` when only the count is wanted). */
  select?: string;
}

/** The one place that knows how a topic becomes a query. */
export function buildSearchUrl(topic: string, opts: SearchUrlOptions = {}): string {
  const { fromDate, page = 1, perPage = 100, form = "scoped", extra = false, sort, select } = opts;
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
  if (sort) params.push(`sort=${encodeURIComponent(sort)}`);
  params.push(`per_page=${perPage}`, `page=${page}`, `select=${select ?? (extra ? SELECT_EXTRA : SELECT)}`);
  return `${API_URL}?${params.join("&")}`;
}

/** Works by their short ids (`W1`, `W2`), at most 50 at a time (the length of the address and OpenAlex's own limit). */
export function buildWorksByIdUrl(ids: readonly string[]): string {
  const list = ids.filter((id) => /^W\d+$/.test(id)).slice(0, 50);
  return `${API_URL}?filter=${encodeURIComponent(`openalex:${list.join("|")}`)}&per_page=${Math.max(list.length, 1)}&select=${SELECT_EXTRA}`;
}

/** A DOI that can sit in a filter: a comma or a bar would split it. */
export function filterSafeDoi(doi: string): boolean {
  return /^10\.\d{4,9}\/\S+$/.test(doi) && !/[,|]/.test(doi);
}

/** Works by DOI (bare, such as `10.1021/jacs.3c08248`), at most 50 at a time. */
export function buildWorksByDoiUrl(dois: readonly string[]): string {
  const list = dois.filter(filterSafeDoi).slice(0, 50);
  return `${API_URL}?filter=${encodeURIComponent(`doi:${list.join("|")}`)}&per_page=${Math.max(list.length, 1)}&select=${SELECT_EXTRA}`;
}

/** The works that best match a title or a whole reference line (a relevance search), a few of them, with their reference lists. */
export function buildTitleSearchUrl(text: string, perPage = 5): string {
  const clean = text.replace(/[^\p{L}\p{N}\s'-]+/gu, " ").replace(/\s+/g, " ").trim().slice(0, 300);
  return `${API_URL}?search=${encodeURIComponent(clean)}&per_page=${perPage}&select=${SELECT_EXTRA}`;
}

/** An author's works (author id `A123`) that cite any of the given works (short ids, at most 50). One filtered list. */
export function buildAuthorWorksUrl(authorId: string, citedIds: readonly string[], perPage = 100): string {
  const list = citedIds.filter((id) => /^W\d+$/.test(id)).slice(0, 50);
  return `${API_URL}?filter=${encodeURIComponent(`authorships.author.id:${authorId},cites:${list.join("|")}`)}&per_page=${perPage}&sort=cited_by_count:desc&select=${SELECT_EXTRA}`;
}

/** Works that cite any of the given works (short ids, at most 50). */
export function buildCitingUrl(ids: readonly string[], page = 1, perPage = 100): string {
  const list = ids.filter((id) => /^W\d+$/.test(id)).slice(0, 50);
  return `${API_URL}?filter=${encodeURIComponent(`cites:${list.join("|")}`)}&per_page=${perPage}&page=${page}&select=${SELECT_EXTRA}`;
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
  authorships?: { author?: { id?: string | null; display_name?: string | null } | null }[] | null;
  cited_by_count?: number | null;
  referenced_works?: string[] | null;
}

/** A paper as the scan hands it on: what the engine reads plus what the inbox note shows. */
export interface Candidate extends Paper {
  openalexId: string;
  authors: string[];
  /** The OpenAlex ids of the authors (`A123`), one for each name in `authors` ("" when there is none); absent in older saved data. */
  authorIds?: string[];
  venue: string | null;
  publicationDate: string | null;
  /** Only in review requests: times the work is cited, and the short ids (`W123`) of the works it cites. */
  citedByCount?: number;
  referencedWorks?: string[];
}

/** `https://openalex.org/W123` to `W123`; null when it is not a work address. */
export function shortWorkId(id: string): string | null {
  return /(?:^|\/)(W\d+)$/.exec(id)?.[1] ?? null;
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
    authorIds: (work.authorships ?? []).filter((a) => (a.author?.display_name?.trim() ?? "") !== "").map((a) => /(A\d+)$/.exec(a.author?.id ?? "")?.[1] ?? ""),
    venue: source?.display_name ?? null,
    publicationDate: work.publication_date ?? null,
    ...(typeof work.cited_by_count === "number" ? { citedByCount: work.cited_by_count } : {}),
    ...(Array.isArray(work.referenced_works)
      ? { referencedWorks: work.referenced_works.map((w) => shortWorkId(w)).filter((w): w is string => w !== null) }
      : {}),
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
  /** Called with the cost (`meta.cost_usd`) of every answer that states one, for the monthly tally. */
  onCost?: (usd: number) => void;
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
  private readonly onCost?: (usd: number) => void;

  constructor(opts: ClientOptions) {
    this.onCost = opts.onCost;
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
      const body = res.json as Record<string, unknown>;
      const cost = (body.meta as { cost_usd?: unknown } | undefined)?.cost_usd;
      if (typeof cost === "number" && cost > 0) this.onCost?.(cost);
      return body;
    }
  }

  /** How many works a topic matches, for the price of one tiny request. Used to estimate a review before it spends anything. */
  async countTopic(topic: string, opts: SearchUrlOptions = {}): Promise<{ count: number; costUsd: number }> {
    const body = await this.get(buildSearchUrl(topic, { ...opts, page: 1, perPage: 1, select: "id" }));
    const meta = (body.meta ?? {}) as { count?: number; cost_usd?: number };
    return { count: meta.count ?? 0, costUsd: meta.cost_usd ?? 0 };
  }

  /** One page of one topic. `fetched` is how many works came back (works without a title are left out of `papers`). */
  async searchPage(topic: string, page: number, opts: SearchUrlOptions = {}): Promise<{ papers: Candidate[]; fetched: number; count: number; costUsd: number }> {
    const body = await this.get(buildSearchUrl(topic, { ...opts, page }));
    const meta = (body.meta ?? {}) as { count?: number; cost_usd?: number };
    const results = Array.isArray(body.results) ? (body.results as OpenAlexWork[]) : [];
    const papers: Candidate[] = [];
    for (const work of results) {
      const candidate = toCandidate(work);
      if (candidate) papers.push(candidate);
    }
    return { papers, fetched: results.length, count: meta.count ?? 0, costUsd: meta.cost_usd ?? 0 };
  }

  /** Works by short id, in batches of 50 (one request each); works without a title are left out. */
  async getWorks(ids: readonly string[]): Promise<{ papers: Candidate[]; costUsd: number }> {
    const unique = [...new Set(ids.filter((id) => /^W\d+$/.test(id)))];
    const papers: Candidate[] = [];
    let costUsd = 0;
    for (let i = 0; i < unique.length; i += 50) {
      const body = await this.get(buildWorksByIdUrl(unique.slice(i, i + 50)));
      costUsd += ((body.meta ?? {}) as { cost_usd?: number }).cost_usd ?? 0;
      for (const work of Array.isArray(body.results) ? (body.results as OpenAlexWork[]) : []) {
        const candidate = toCandidate(work);
        if (candidate) papers.push(candidate);
      }
    }
    return { papers, costUsd };
  }

  /** One page of works that cite any of up to 50 given works. */
  async citingPage(ids: readonly string[], page = 1): Promise<{ papers: Candidate[]; fetched: number; count: number; costUsd: number }> {
    const body = await this.get(buildCitingUrl(ids, page));
    const meta = (body.meta ?? {}) as { count?: number; cost_usd?: number };
    const results = Array.isArray(body.results) ? (body.results as OpenAlexWork[]) : [];
    const papers: Candidate[] = [];
    for (const work of results) {
      const candidate = toCandidate(work);
      if (candidate) papers.push(candidate);
    }
    return { papers, fetched: results.length, count: meta.count ?? 0, costUsd: meta.cost_usd ?? 0 };
  }

  /** An author's works that cite at least one of `citedIds` (at most 50 of them), most cited first; one filtered list. */
  async authorWorks(authorId: string, citedIds: readonly string[]): Promise<{ papers: Candidate[]; costUsd: number }> {
    if (!/^A\d+$/.test(authorId)) return { papers: [], costUsd: 0 };
    const body = await this.get(buildAuthorWorksUrl(authorId, citedIds));
    const papers: Candidate[] = [];
    for (const work of Array.isArray(body.results) ? (body.results as OpenAlexWork[]) : []) {
      const candidate = toCandidate(work);
      if (candidate) papers.push(candidate);
    }
    return { papers, costUsd: ((body.meta ?? {}) as { cost_usd?: number }).cost_usd ?? 0 };
  }

  /** Works by DOI, in batches of 50 (a filtered list, one credit each); DOIs that cannot sit in a filter are skipped. */
  async getWorksByDoi(dois: readonly string[]): Promise<{ papers: Candidate[]; costUsd: number }> {
    const unique = [...new Set(dois.filter(filterSafeDoi))];
    const papers: Candidate[] = [];
    let costUsd = 0;
    for (let i = 0; i < unique.length; i += 50) {
      const body = await this.get(buildWorksByDoiUrl(unique.slice(i, i + 50)));
      costUsd += ((body.meta ?? {}) as { cost_usd?: number }).cost_usd ?? 0;
      for (const work of Array.isArray(body.results) ? (body.results as OpenAlexWork[]) : []) {
        const candidate = toCandidate(work);
        if (candidate) papers.push(candidate);
      }
    }
    return { papers, costUsd };
  }

  /** One work by DOI or short id, with its references and citation count. A single record is free. Null when OpenAlex has none. */
  async getFullWork(ref: { doi?: string | null; id?: string | null }): Promise<Candidate | null> {
    const path = ref.id && /^W\d+$/.test(ref.id) ? ref.id : ref.doi && filterSafeDoi(ref.doi) ? `https://doi.org/${ref.doi}` : null;
    if (path === null) return null;
    try {
      const body = await this.get(`${API_URL}/${path}?select=${SELECT_EXTRA}`);
      return typeof body.id === "string" ? toCandidate(body as unknown as OpenAlexWork) : null;
    } catch (e) {
      if (e instanceof OpenAlexError && e.status === 404) return null;
      throw e;
    }
  }

  /** A few works that match a title or a reference line (one search, ten credits). */
  async findByTitle(title: string): Promise<{ papers: Candidate[]; costUsd: number }> {
    const body = await this.get(buildTitleSearchUrl(title));
    const papers: Candidate[] = [];
    for (const work of Array.isArray(body.results) ? (body.results as OpenAlexWork[]) : []) {
      const candidate = toCandidate(work);
      if (candidate) papers.push(candidate);
    }
    return { papers, costUsd: ((body.meta ?? {}) as { cost_usd?: number }).cost_usd ?? 0 };
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
