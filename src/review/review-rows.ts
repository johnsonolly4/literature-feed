// The rows of the review's papers table, and its columns, chips and search text. Pure: the window only draws them (with the UI kit's
// DataTable). The rows keep the order of the result (rank, then the order chosen in the window), which is the table's default sort.
import type { InboxPaper, ListedTier } from "../inbox/write";
import type { ReviewPaper } from "./collect";
import { fitOfNew, type Fit } from "./coherence";
import type { Flags } from "./flags";
import { paperLabel } from "./prompt";
import { authorKey } from "./gaps-authors";
import type { SeedProfile } from "./seeds";
import type { Chip, ColumnSpec } from "../ui/table-model";

export interface ReviewRow {
  /** A stable key: the OpenAlex id. */
  key: string;
  /** Position in the result, the P-label's number minus one. */
  index: number;
  label: string;
  title: string;
  authors: string[];
  year: number | null;
  citedBy: number;
  tier: ListedTier;
  /** Overlap with the known papers; null when none were given. */
  seed: ReviewPaper["seed"] | null;
  /** Whether the paper fits the known papers; null when they are too few to say, or the paper is one of them. */
  fit: Fit | null;
  /** The ids and names of the searches that found it. */
  feedIds: string[];
  searches: string[];
  flags: Flags;
}

export const TIER_ORDER: readonly ListedTier[] = ["priority", "strong", "possible", "unchecked"];
export const TIER_NAME: Record<ListedTier, string> = { priority: "Priority", strong: "Strong", possible: "Possible", unchecked: "No abstract" };

/** One row per paper, in the order given. `flags` is parallel to `papers`. */
export function buildReviewRows(
  papers: readonly ReviewPaper[], flags: readonly Flags[], names: ReadonlyMap<string, string>, profile: SeedProfile | null,
  /** The known papers of the other searches, when they are at hand: a paper that does not fit then names the search it fits better. */
  others: readonly { name: string; profile: SeedProfile }[] = [],
): ReviewRow[] {
  return papers.map((p, i) => {
    const feedIds = [...new Set(p.finds.map((f) => f.feedId))];
    const fit = profile && !p.seed?.isSeed
      ? fitOfNew({ id: p.id, refs: [...new Set(p.referencedWorks)], authors: [...new Set(p.authors.map(authorKey).filter((k) => k !== ""))] }, profile, others)
      : null;
    return {
      key: p.id, index: i, label: paperLabel(i), title: p.title, authors: p.authors, year: p.year, citedBy: p.citedByCount, tier: p.tier,
      seed: p.seed ?? null, fit, feedIds, searches: feedIds.map((id) => names.get(id) ?? id), flags: flags[i] ?? { zotero: null, vault: null, listedBefore: [] },
    };
  });
}

/**
 * The inbox entry for a review paper under one search: the tier, terms and topics are that search's own find; a search that did
 * not find the paper gets it at "possible" (the user chose to add it). The line is marked as coming from the review.
 */
export function reviewPaperToInbox(p: ReviewPaper, feedId: string): InboxPaper {
  const find = p.finds.find((f) => f.feedId === feedId);
  return {
    openalexId: p.id, title: p.title, authors: p.authors, venue: p.venue, year: p.year, publicationDate: p.publicationDate, doi: p.doi,
    isPreprint: p.isPreprint, noAbstract: !p.abstract?.trim(), tier: find?.tier ?? "possible", matched: find?.matched ?? [], topics: find?.topics ?? [], origin: "review",
  };
}

/** The chips: All, one per rank present, one per search, what you have, and (with known papers) known and fitting. */
export function reviewChips(searches: readonly { id: string; name: string }[], hasSeeds: boolean): Chip<ReviewRow>[] {
  return [
    { key: "all", label: "All", test: () => true },
    ...TIER_ORDER.map((t): Chip<ReviewRow> => ({ key: `tier:${t}`, label: TIER_NAME[t], test: (r) => r.tier === t })),
    ...searches.map((s): Chip<ReviewRow> => ({ key: `search:${s.id}`, label: s.name, test: (r) => r.feedIds.includes(s.id), when: () => searches.length > 1 })),
    { key: "have", label: "In Zotero or vault", tone: "done", test: (r) => r.flags.zotero !== null || r.flags.vault !== null },
    { key: "missing", label: "Not in Zotero", tone: "waiting", test: (r) => r.flags.zotero === null },
    { key: "known", label: "Known paper", tone: "done", test: (r) => r.seed?.isSeed === true, when: () => hasSeeds },
    { key: "fits", label: "Fits my known papers", tone: "doing", test: (r) => r.fit?.fits === true, when: () => hasSeeds },
    { key: "nofit", label: "Doesn't fit", tone: "waiting", test: (r) => r.fit !== null && !r.fit.fits, when: () => hasSeeds },
  ];
}

const num = (n: number | null): number => n ?? -1;

export function fitText(r: ReviewRow): string {
  if (r.seed?.isSeed) return "Known";
  if (r.fit === null) return "";
  if (r.fit.fits) return "Fits";
  return r.fit.betterSearch ? `Fits ${r.fit.betterSearch} better` : "Doesn't fit";
}

/** "order" is the position in the result, so the default view is the order the prompt, the note and the graph use. */
export const REVIEW_COLUMNS: ColumnSpec<ReviewRow>[] = [
  { key: "order", label: "No.", sortable: true, compare: (a, b) => a.index - b.index, csv: (r) => r.label },
  { key: "title", label: "Paper", sortable: true, compare: (a, b) => a.title.localeCompare(b.title), csv: (r) => r.title },
  { key: "year", label: "Year", sortable: true, compare: (a, b) => num(a.year) - num(b.year), csv: (r) => r.year ?? "" },
  { key: "cited", label: "Cited", sortable: true, compare: (a, b) => a.citedBy - b.citedBy, csv: (r) => r.citedBy },
  { key: "rank", label: "Rank", sortable: true, compare: (a, b) => TIER_ORDER.indexOf(a.tier) - TIER_ORDER.indexOf(b.tier), csv: (r) => r.tier },
  { key: "overlap", label: "Overlap", sortable: true, compare: (a, b) => (a.seed?.score ?? -1) - (b.seed?.score ?? -1), csv: (r) => r.seed?.score ?? "" },
  { key: "fit", label: "Fit", csv: (r) => fitText(r) },
  { key: "have", label: "Have", csv: (r) => [r.flags.zotero ? "Zotero" : "", r.flags.vault ? "note" : "", r.flags.listedBefore.length > 0 ? "listed" : ""].filter((x) => x !== "").join(", ") },
  { key: "searches", label: "Searches", csv: (r) => r.searches.join("; ") },
];

export const reviewSearchText = (r: ReviewRow): string => `${r.title} ${r.authors.join(" ")} ${r.year ?? ""} ${r.label}`;
