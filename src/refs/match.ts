// Checking a Crossref record against a reference: does the title appear in the citation, and do the first author, year, volume and
// first page agree? Pure. A port of `evaluate` in `check_refs.py` (title by longest common substring of the letters-and-digits form).
import type { ParsedReference } from "./split";

export interface CrossrefAuthor {
  given?: string;
  family?: string;
  name?: string;
  ORCID?: string;
}

/** The part of a Crossref work that the check reads. */
export interface CrossrefItem {
  DOI: string;
  title?: string[];
  author?: CrossrefAuthor[];
  volume?: string;
  issue?: string;
  page?: string;
  "article-number"?: string;
  issued?: { "date-parts"?: (number | null)[][] };
  "published-online"?: { "date-parts"?: (number | null)[][] };
  "published-print"?: { "date-parts"?: (number | null)[][] };
  "container-title"?: string[];
  publisher?: string;
  type?: string;
  "is-referenced-by-count"?: number;
}

export type RefStatus = "OK" | "CHECK" | "NOT FOUND" | "MANUAL" | "ERROR";

export interface Evaluation {
  /** For choosing among candidates: the title share plus 0.3 for the author and 0.2 for the year. */
  score: number;
  status: "OK" | "CHECK" | "NOT FOUND";
  reasons: string[];
  titleScore: number;
}

/** A title share at or above this is a good match; below `TITLE_FOUND` nothing resembled the title. */
export const TITLE_OK = 0.85;
export const TITLE_FOUND = 0.6;

/** Letters and digits only, lower case, accents removed. */
export function compact(text: string): string {
  return (text ?? "").normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Length of the longest run of characters that `a` and `b` have in common. */
export function longestCommonSubstring(a: string, b: string): number {
  if (a === "" || b === "") return 0;
  let best = 0;
  let prev = new Array<number>(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    const row = new Array<number>(b.length + 1).fill(0);
    for (let j = 1; j <= b.length; j++) {
      if (a[i - 1] === b[j - 1]) {
        row[j] = prev[j - 1] + 1;
        if (row[j] > best) best = row[j];
      }
    }
    prev = row;
  }
  return best;
}

/** How much of the Crossref title (letters and digits) occurs, in one piece, in the citation. */
export function titleScore(citation: string, crossrefTitle: string): number {
  const a = compact(crossrefTitle);
  if (a === "") return 0;
  return longestCommonSubstring(compact(citation), a) / a.length;
}

export function crossrefYears(item: CrossrefItem): number[] {
  const years = new Set<number>();
  for (const part of [item.issued, item["published-online"], item["published-print"]]) {
    const y = part?.["date-parts"]?.[0]?.[0];
    if (typeof y === "number" && Number.isFinite(y)) years.add(y);
  }
  return [...years].sort((x, y) => x - y);
}

function authorOk(firstAuthor: string, item: CrossrefItem): boolean {
  const cit = compact(firstAuthor);
  const first = item.author?.[0];
  const fam = compact(first?.family ?? first?.name ?? "");
  return cit !== "" && fam !== "" && (cit === fam || cit.includes(fam) || fam.includes(cit));
}

/** "Veldmar KR; Orrinson PT": family names with the initials of the given names. */
export function authorsLine(item: CrossrefItem, max = 8): string {
  const list = (item.author ?? []).map((a) => {
    const family = a.family ?? a.name ?? "";
    const initials = (a.given ?? "").split(/[\s.-]+/).filter((w) => w !== "").map((w) => w[0].toUpperCase()).join("");
    return `${family}${initials === "" ? "" : ` ${initials}`}`.trim();
  }).filter((x) => x !== "");
  return list.length > max ? `${list.slice(0, max).join("; ")}; et al.` : list.join("; ");
}

/** One candidate against one reference. */
export function evaluate(info: ParsedReference, item: CrossrefItem): Evaluation {
  const reasons: string[] = [];
  const title = item.title?.[0] ?? "";
  const ts = titleScore(info.body, title);
  const aOk = authorOk(info.firstAuthor, item);
  const years = crossrefYears(item);
  const ydiff = info.year !== null && years.length > 0 ? Math.min(...years.map((y) => Math.abs((info.year as number) - y))) : null;
  const score = ts + (aOk ? 0.3 : 0) + (ydiff !== null && ydiff <= 1 ? 0.2 : 0);

  if (ts < TITLE_FOUND) return { score, status: "NOT FOUND", reasons: ["no close title match"], titleScore: ts };
  if (ts < TITLE_OK) reasons.push(`title similarity ${ts.toFixed(2)}`);
  if (!aOk) reasons.push("first author differs");
  if (ydiff === null) reasons.push("year not comparable");
  else if (ydiff === 1) reasons.push("year +/-1 (online vs print?)");
  else if (ydiff > 1) reasons.push(`year differs (${info.year} vs ${years.join(", ")})`);
  const crVol = (item.volume ?? "").trim();
  if (info.volume !== "" && crVol !== "" && info.volume.toLowerCase() !== crVol.toLowerCase()) reasons.push(`volume differs (${info.volume} vs ${crVol})`);
  const citFirst = info.pages.split(/[-–—]/)[0].trim().toLowerCase();
  const crFirst = (item.page ?? "").split(/[-–—]/)[0].trim().toLowerCase();
  const crArt = (item["article-number"] ?? "").trim().toLowerCase();
  if (citFirst !== "" && (crFirst !== "" || crArt !== "") && citFirst !== crFirst && citFirst !== crArt) reasons.push(`pages differ (${info.pages} vs ${item.page ?? crArt})`);

  const hard = reasons.filter((r) => !r.startsWith("year +/-1"));
  return { score, status: hard.length === 0 ? "OK" : "CHECK", reasons, titleScore: ts };
}

/** The best of the candidates (highest score), or null when there are none. */
export function chooseBest(info: ParsedReference, items: readonly CrossrefItem[]): { item: CrossrefItem; evaluation: Evaluation } | null {
  let best: { item: CrossrefItem; evaluation: Evaluation } | null = null;
  for (const item of items) {
    const evaluation = evaluate(info, item);
    if (best === null || evaluation.score > best.evaluation.score) best = { item, evaluation };
  }
  return best;
}
