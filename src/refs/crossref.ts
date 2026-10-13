// A small Crossref client for finding the DOI of a reference. No Obsidian imports: the caller passes in a `Requester` (in the plugin a
// wrapper around `requestUrl`, in tests a fake) and a `sleep`. One request at a time with a pause between requests, back-off on HTTP 429
// and server errors. Crossref needs no key; a contact email (`mailto`) puts the requests in its faster "polite" pool.
import type { CrossrefItem } from "./match";

export interface CrossrefRequest {
  url: string;
  headers?: Record<string, string>;
}

/** Must not throw on a non-2xx status (Obsidian: `requestUrl({ throw: false })`); `json` is null when the answer is not JSON. */
export type CrossrefRequester = (req: CrossrefRequest) => Promise<{ status: number; json: unknown }>;

export interface CrossrefOptions {
  request: CrossrefRequester;
  sleep: (ms: number) => Promise<void>;
  /** Sent as `mailto=` so Crossref serves the polite pool. Never required. */
  mailto?: string;
  /** Pause before every request after the first (default 250 ms: at most four a second). */
  gapMs?: number;
  /** Tries per request on HTTP 429 or a server error, first try included (default 3). */
  maxTries?: number;
  /** Wait before the second try; doubles each time (default 1000 ms). */
  backoffMs?: number;
}

export class CrossrefError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = "CrossrefError";
  }
}

const API = "https://api.crossref.org/works";
const SELECT = [
  "DOI", "title", "author", "container-title", "volume", "issue", "page", "article-number", "issued", "published-online", "published-print",
  "publisher", "type", "is-referenced-by-count",
].join(",");

/** The address of a bibliographic search for a reference's text (without the contact email). */
export function buildBibliographicUrl(text: string, rows = 5): string {
  return `${API}?query.bibliographic=${encodeURIComponent(text.replace(/\s+/g, " ").trim().slice(0, 1500))}&rows=${rows}&select=${SELECT}`;
}

export class CrossrefClient {
  private readonly opts: Required<Omit<CrossrefOptions, "mailto">> & { mailto: string };
  private count = 0;

  constructor(opts: CrossrefOptions) {
    this.opts = { request: opts.request, sleep: opts.sleep, mailto: opts.mailto?.trim() ?? "", gapMs: opts.gapMs ?? 250, maxTries: opts.maxTries ?? 3, backoffMs: opts.backoffMs ?? 1000 };
  }

  /** The best few works for a reference's text, as Crossref ranks them. An error is thrown only after the tries are used up. */
  async search(text: string): Promise<CrossrefItem[]> {
    if (this.count++ > 0) await this.opts.sleep(this.opts.gapMs);
    const url = buildBibliographicUrl(text) + (this.opts.mailto === "" ? "" : `&mailto=${encodeURIComponent(this.opts.mailto)}`);
    let wait = this.opts.backoffMs;
    for (let attempt = 1; ; attempt++) {
      const res = await this.opts.request({ url, headers: { Accept: "application/json" } });
      const retryable = res.status === 429 || res.status >= 500;
      if (retryable && attempt < this.opts.maxTries) {
        await this.opts.sleep(wait);
        wait *= 2;
        continue;
      }
      if (res.status === 429) throw new CrossrefError(`Crossref asked for fewer requests (HTTP 429) after ${attempt} tries`, 429);
      if (res.status < 200 || res.status >= 300) throw new CrossrefError(`Crossref request failed (HTTP ${res.status})`, res.status);
      const message = (res.json as { message?: { items?: unknown } } | null)?.message;
      if (!message || !Array.isArray(message.items)) throw new CrossrefError("Crossref answered with something that is not a list of works", res.status);
      return message.items.filter((i): i is CrossrefItem => typeof i === "object" && i !== null && typeof (i as { DOI?: unknown }).DOI === "string");
    }
  }
}
