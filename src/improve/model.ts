// What the Improve tab of one search shows, as data: how the search is doing (ledger), how it overlaps the other searches, how its
// known papers link, and search strings built from them. Pure: the view fetches, this decides what to say and what is empty.
import type { Overlap, PairRow, TopicOverlap } from "../ledger/overlap";
import { WEAK_BELOW, rateOf, type FeedReport, type Report } from "../ledger/report";
import { coherence, coherenceLines } from "../review/coherence";
import type { KnownPapers } from "../review/known";
import { leaveOneOut, suggestQueries, type RecallTest, type SeedQuery, type SeedText } from "../review/seed-queries";
import type { SeedProfile } from "../review/seeds";

/** The leave-one-out test rebuilds the strings once per paper, so a long list is tested on its first papers only. */
export const LEAVE_ONE_OUT_MAX = 40;

export interface DoingSection {
  /** "none": the search has no papers in the ledger yet. */
  status: "none" | "ok";
  report: FeedReport | null;
  decided: number;
  rate: number | null;
  /** Fewer than `WEAK_BELOW` papers decided: the rates are weak evidence. */
  weak: boolean;
}

export interface OverlapSection {
  /** Pairs that include this search (read from this search's side by the view). */
  pairs: PairRow[];
  topics: TopicOverlap | null;
}

export interface CoherenceSection {
  /** "no-profile": the known papers have not been read yet. */
  status: "no-profile" | "ok";
  lines: string[];
}

export interface StringsSection {
  status: "no-profile" | "too-few" | "ok";
  papers: SeedText[];
  queries: SeedQuery[];
  test: RecallTest | null;
  /** How many known papers the test covered when the list was longer than `LEAVE_ONE_OUT_MAX`. */
  tested: number;
}

export interface ImproveModel {
  feedId: string;
  name: string;
  doing: DoingSection;
  overlap: OverlapSection;
  coherence: CoherenceSection;
  strings: StringsSection;
  /** The known-papers line (from `describeKnown`) is the view's; the model only says whether there are known papers to read. */
  hasKnown: boolean;
}

function doingOf(report: Report, feedId: string): DoingSection {
  const feed = report.feeds.find((f) => f.feedId === feedId) ?? null;
  if (!feed || feed.totals.listed === 0) return { status: "none", report: feed, decided: 0, rate: null, weak: true };
  const decided = feed.totals.interested + feed.totals.dismissed;
  return { status: "ok", report: feed, decided, rate: rateOf(feed.totals), weak: decided < WEAK_BELOW };
}

function overlapOf(overlap: Overlap, feedId: string): OverlapSection {
  return {
    pairs: overlap.pairs.filter((p) => p.a === feedId || p.b === feedId),
    topics: overlap.topics.find((t) => t.feedId === feedId) ?? null,
  };
}

/**
 * The sections for one search. `profile` is the known papers as read from OpenAlex (null until the user reads them); `background`
 * is the text of other papers of the field, so that phrases common to everything are left out of the strings.
 */
export function buildImprove(
  feed: { id: string; name: string }, report: Report, known: KnownPapers, profile: SeedProfile | null, background: readonly string[] = [],
): ImproveModel {
  const hasKnown = known.dois.length > 0;
  const papers = profile?.papers ?? [];
  let coh: CoherenceSection = { status: "no-profile", lines: [] };
  let strings: StringsSection = { status: "no-profile", papers: [], queries: [], test: null, tested: 0 };
  if (profile) {
    const title = (id: string): string => papers.find((p) => p.id === id)?.title ?? id;
    coh = { status: "ok", lines: coherenceLines(coherence(profile), title) };
    if (papers.length < 2) {
      strings = { status: "too-few", papers, queries: [], test: null, tested: 0 };
    } else {
      const tested = Math.min(papers.length, LEAVE_ONE_OUT_MAX);
      strings = {
        status: "ok", papers, queries: suggestQueries(papers, { background }),
        test: leaveOneOut(papers.slice(0, LEAVE_ONE_OUT_MAX), { background }), tested,
      };
    }
  }
  return { feedId: feed.id, name: feed.name, doing: doingOf(report, feed.id), overlap: overlapOf(report.overlap, feed.id), coherence: coh, strings, hasKnown };
}

/** The other search in a pair, as seen from `feedId`: its name, how many papers each lists and how many both do. */
export function pairFrom(p: PairRow, feedId: string): { other: string; mine: number; theirs: number; both: number; theirRulesDropped: { count: number; wanted: number }; myRulesDropped: { count: number; wanted: number } } {
  const mineIsA = p.a === feedId;
  return {
    other: mineIsA ? p.bName : p.aName, mine: mineIsA ? p.aListed : p.bListed, theirs: mineIsA ? p.bListed : p.aListed, both: p.both,
    // aDropsOfB: papers A's rules dropped that B listed; "myRulesDropped" are the papers this search's rules dropped that the other listed.
    theirRulesDropped: mineIsA ? p.bDropsOfA : p.aDropsOfB, myRulesDropped: mineIsA ? p.aDropsOfB : p.bDropsOfA,
  };
}
