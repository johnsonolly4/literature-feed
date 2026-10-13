import type { Feed, GroupMatch, Paper, Score, Tier } from "./feed";

const TIERS: Tier[] = ["priority", "strong", "possible", "dropped"];

/**
 * Lower-case, strip accents and invisible characters (soft hyphen, zero-width spaces), and turn every run of
 * non-letters/digits (hyphens, dashes, slashes, punctuation) into one space.
 */
export function normaliseText(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[\u00AD\u200B-\u200D\u2060\uFEFF]|\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

// British <-> American endings: -ise/-ize (+ation, ed, ing, ...) and -yse/-yze.
const IZE = /iz(ation|ations|e|es|ed|ing|er|ers)$/;
const ISE = /is(ation|ations|e|es|ed|ing|er|ers)$/;
const YZE = /yz(e|es|ed|ing|er|ers)$/;
const YSE = /ys(e|es|ed|ing|er|ers)$/;

function wordSpellings(word: string): string[] {
  const out = new Set([word]);
  out.add(word.replace(ISE, "iz$1"));
  out.add(word.replace(IZE, "is$1"));
  out.add(word.replace(YSE, "yz$1"));
  out.add(word.replace(YZE, "ys$1"));
  return [...out];
}

/** Every normalised form a configured term can take in the text: both spellings, and a plural on the last word. */
export function termVariants(term: string): string[] {
  const words = normaliseText(term).split(" ").filter(Boolean);
  if (words.length === 0) return [];
  let phrases = [""];
  for (const word of words) {
    const spellings = wordSpellings(word);
    phrases = phrases.flatMap((phrase) => spellings.map((s) => (phrase ? `${phrase} ${s}` : s)));
  }
  return [...new Set(phrases.flatMap((p) => [p, `${p}s`, `${p}es`]))];
}

function pad(text: string): string {
  return ` ${normaliseText(text)} `;
}

function found(paddedFields: string[], term: string): boolean {
  const variants = termVariants(term);
  return variants.some((v) => paddedFields.some((field) => field.includes(` ${v} `)));
}

/** Whole-word phrase match on normalised text; either spelling; a trailing plural is allowed. */
export function containsTerm(text: string, term: string): boolean {
  return found([pad(text)], term);
}

function lowerBy(tier: Tier, steps: number): Tier {
  return TIERS[Math.min(TIERS.indexOf(tier) + steps, TIERS.length - 1)];
}

/**
 * Tier for one paper (rules: "Tiers" in docs/plans/literature-feed.md).
 * Title and abstract are matched separately, so a phrase never spans the two.
 * A paper with no abstract is matched on its title alone and can rank at most Possible; if the title cannot show
 * the required terms it is Unchecked rather than Dropped, unless a drop term is in the title (docs/decisions.md).
 */
export function scorePaper(paper: Paper, feed: Feed): Score {
  const fields = [pad(paper.title), pad(paper.abstract ?? "")];
  const matching = (terms: string[]): string[] => terms.filter((t) => found(fields, t));

  const groups: GroupMatch[] = [];
  const required = feed.groups.filter((g) => g.role === "required");
  let requiredMet = true;
  for (const group of feed.groups) {
    const terms = matching(group.terms);
    if (terms.length > 0) groups.push({ name: group.name, role: group.role, terms });
    else if (group.role === "required") requiredMet = false;
  }

  const dropTerms = matching(feed.drop);
  const lowerTerms = matching(feed.lower);
  const result = (tier: Tier): Score => ({ tier, groups, dropTerms, lowerTerms });

  const noAbstract = !paper.abstract?.trim();
  if (dropTerms.length > 0) return result("dropped");
  if (required.length > 0 && !requiredMet) return result(noAbstract ? "unchecked" : "dropped");

  const has = (role: "priority" | "boost"): boolean => groups.some((g) => g.role === role);
  let tier: Tier = has("priority") ? "priority" : has("boost") ? "strong" : "possible";
  if (noAbstract) tier = "possible";
  if (lowerTerms.length > 0) tier = lowerBy(tier, 1);
  return result(tier);
}
