// Is a work probably a review article? A pointer, never a verdict: the badge never reorders anything and there is no combined score.
// Rules follow the owner's refcheck tool, without its Semantic Scholar step and without answers set by hand.

export type ReviewLevel = "sure" | "suspect" | "";

export interface ReviewFlag {
  level: ReviewLevel;
  /** Why, in words ("OpenAlex type: review", "160 references"); empty when there is no flag. */
  reason: string;
}

export interface ReviewInput {
  /** OpenAlex's work type (`review`, `article`…). */
  type?: string | null;
  venue?: string | null;
  title?: string | null;
  /** How many works it cites; null when the list did not come back. */
  referenceCount?: number | null;
  pages?: number | null;
}

/** Journals that publish reviews only (chemistry; case-insensitive). Angewandte and Proceedings of the IEEE are left out on purpose. */
export const REVIEW_VENUES = /(chemical reviews|chemical society reviews|accounts of|nature reviews|progress in|trends in|annual review|current opinion)/i;

const REVIEW_TITLE = /\b(reviews?|perspectives?|overview|guide|tutorial|primer|current status|trends|recent (advances|developments|progress)|advances in|progress in|state[- ]of[- ]the[- ]art|challenges and opportunities|outlook|roadmap|account|update|introduction to)\b/i;

export const REVIEW_MANY_REFERENCES = 150;
export const REVIEW_LONG_PAPER_PAGES = 15;
export const REVIEW_LONG_PAPER_REFERENCES = 80;

export function reviewFlag(w: ReviewInput, venues: RegExp = REVIEW_VENUES): ReviewFlag {
  if (w.type === "review") return { level: "sure", reason: "OpenAlex type: review" };
  const venue = w.venue?.trim() ?? "";
  if (venue !== "" && venues.test(venue)) return { level: "sure", reason: `review journal: ${venue}` };
  const refs = w.referenceCount ?? 0;
  if (refs >= REVIEW_MANY_REFERENCES) return { level: "suspect", reason: `${refs} references` };
  if ((w.pages ?? 0) >= REVIEW_LONG_PAPER_PAGES && refs >= REVIEW_LONG_PAPER_REFERENCES) {
    return { level: "suspect", reason: `${w.pages} pages and ${refs} references` };
  }
  const word = REVIEW_TITLE.exec(w.title ?? "")?.[1];
  if (word) return { level: "suspect", reason: `title has "${word.toLowerCase()}"` };
  return { level: "", reason: "" };
}
