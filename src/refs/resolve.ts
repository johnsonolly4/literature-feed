// Finding the DOI of every reference in a pasted list: split, look each one up (a reference that already has a DOI is not looked up),
// judge the match, and say which ones need a person to look. Pure: the client is passed in (a fake in tests).
import { authorsLine, chooseBest, crossrefYears, type CrossrefItem, type RefStatus } from "./match";
import { doiInText, parseReference, type RawReference } from "./split";

/** The part of the Crossref client the resolver uses. */
export interface ReferenceSearcher {
  search(text: string): Promise<CrossrefItem[]>;
}

export interface ResolvedRow {
  n: number;
  /** The reference as tidied (one line). */
  text: string;
  /** The DOI to use, or "" when none was found (it can be typed in by hand). */
  doi: string;
  status: RefStatus;
  reasons: string[];
  /** What Crossref called the best match (even when it was judged not to be it). */
  crossrefTitle: string;
  authors: string;
  journal: string;
  year: string;
  volume: string;
  pages: string;
  publisher: string;
  citedBy: number | null;
  /** The DOI was in the text itself, so nothing was looked up. */
  fromText: boolean;
}

export interface ResolveOptions {
  onProgress?: (done: number, total: number) => void;
  isCancelled?: () => boolean;
  /** At most this many references are looked up in one run (default 200). */
  max?: number;
}

export interface Resolution {
  rows: ResolvedRow[];
  /** References left out because of the limit. */
  skipped: number;
  /** The run was stopped before the end. */
  cancelled: boolean;
}

export const MAX_REFERENCES = 200;

const blank = (ref: RawReference): ResolvedRow => ({
  n: ref.n, text: ref.text, doi: "", status: "NOT FOUND", reasons: [], crossrefTitle: "", authors: "", journal: "", year: "", volume: "", pages: "", publisher: "", citedBy: null, fromText: false,
});

function fill(row: ResolvedRow, item: CrossrefItem): void {
  row.crossrefTitle = item.title?.[0] ?? "";
  row.authors = authorsLine(item);
  row.journal = item["container-title"]?.[0] ?? "";
  row.year = crossrefYears(item).join(", ");
  row.volume = item.volume ?? "";
  row.pages = item.page ?? item["article-number"] ?? "";
  row.publisher = item.publisher ?? "";
  row.citedBy = typeof item["is-referenced-by-count"] === "number" ? item["is-referenced-by-count"] : null;
}

/** Whether a row's DOI is used unless the user says otherwise: found, or found but with something to look at. */
export function includedByDefault(row: ResolvedRow): boolean {
  return (row.status === "OK" || row.status === "CHECK") && row.doi !== "";
}

export async function resolveReferences(refs: readonly RawReference[], client: ReferenceSearcher, opts: ResolveOptions = {}): Promise<Resolution> {
  const max = opts.max ?? MAX_REFERENCES;
  const list = refs.slice(0, max);
  const rows: ResolvedRow[] = [];
  let cancelled = false;
  for (const ref of list) {
    if (opts.isCancelled?.()) {
      cancelled = true;
      break;
    }
    const row = blank(ref);
    const info = parseReference(ref.text);
    const known = doiInText(ref.text);
    if (known !== "") {
      row.doi = known;
      row.status = "OK";
      row.reasons = ["DOI in the text"];
      row.fromText = true;
    } else if (info.software) {
      row.status = "MANUAL";
      row.reasons = ["software or web page: no Crossref DOI expected"];
    } else {
      try {
        const best = chooseBest(info, await client.search(info.body));
        if (best === null) {
          row.reasons = ["no Crossref results"];
        } else {
          row.status = best.evaluation.status;
          row.reasons = best.evaluation.reasons;
          fill(row, best.item);
          if (row.status === "OK" || row.status === "CHECK") row.doi = best.item.DOI.toLowerCase();
        }
      } catch (e) {
        row.status = "ERROR";
        row.reasons = [e instanceof Error ? e.message : "lookup failed"];
      }
    }
    rows.push(row);
    opts.onProgress?.(rows.length, list.length);
  }
  return { rows, skipped: Math.max(0, refs.length - list.length), cancelled };
}

export function countStatuses(rows: readonly ResolvedRow[]): Record<RefStatus, number> {
  const out: Record<RefStatus, number> = { OK: 0, CHECK: 0, "NOT FOUND": 0, MANUAL: 0, ERROR: 0 };
  for (const r of rows) out[r.status]++;
  return out;
}
