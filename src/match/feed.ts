// Types for the matching engine. Pure data: no Obsidian imports in src/match/.

/** How a concept group counts towards the tier (see "Tiers" in docs/plans/literature-feed.md). */
export type GroupRole = "required" | "boost" | "priority";

export interface ConceptGroup {
  name: string;
  role: GroupRole;
  /** The group matches a paper when any one of these terms does. */
  terms: string[];
}

/** The part of a feed the engine reads. Topics, years, Zotero collection and project belong to later phases. */
export interface Feed {
  name: string;
  groups: ConceptGroup[];
  /** A match removes the paper. */
  drop: string[];
  /** A match moves the paper down one tier (once, however many match). */
  lower: string[];
}

export interface Paper {
  title: string;
  abstract?: string | null;
  doi?: string | null;
  year?: number;
  /** True for a preprint version; dedupe prefers the journal version. */
  isPreprint?: boolean;
}

export type Tier = "priority" | "strong" | "possible" | "dropped";

export interface GroupMatch {
  name: string;
  role: GroupRole;
  /** The configured terms that matched, in the order they are configured. */
  terms: string[];
}

export interface Score {
  tier: Tier;
  /** Groups that matched, in feed order. */
  groups: GroupMatch[];
  dropTerms: string[];
  lowerTerms: string[];
}
