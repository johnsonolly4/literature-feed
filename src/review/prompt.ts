// The literature-review prompt (copy and paste): the searches, the numbered papers with what the user already has of them, the
// task, and the exact JSON the answer must have; and the check of the pasted answer. Pure: nothing is sent from here.
import { MEANING, ONLY_JSON, describeFeed } from "../prompts/build";
import { printJson } from "../prompts/schemas";
import type { FeedConfig } from "../settings/data";
import type { Flags } from "./flags";
import type { ReviewPaper } from "./collect";

/** The label a paper has in the prompt and in the answer: P1, P2, …. */
export const paperLabel = (index: number): string => `P${index + 1}`;
/** The label of a missing paper (Phase B): M1, M2, …. */
export const missingLabel = (index: number): string => `M${index + 1}`;

export type ReadLevel = "must" | "should" | "skim" | "skip";
export const READ_LEVELS: ReadLevel[] = ["must", "should", "skim", "skip"];

export interface PromptOptions {
  includeAbstracts: boolean;
  /** Characters of abstract kept per paper. */
  abstractChars: number;
}

export const DEFAULT_PROMPT_OPTIONS: PromptOptions = { includeAbstracts: true, abstractChars: 600 };

export interface PromptInput {
  feeds: readonly FeedConfig[];
  papers: readonly ReviewPaper[];
  /** Flags in the same order as `papers`. */
  flags: readonly Flags[];
  /** Papers the rules kept before the cap on the prompt. */
  total: number;
  /** Names of the searches by id, for "found by". */
  names: ReadonlyMap<string, string>;
  /** The citation network as text (Phase B), when there is one. */
  networkText?: string;
  options?: PromptOptions;
}

export function cutAbstract(text: string | null, max: number): string {
  if (!text) return "";
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 1).trimEnd()}…` : clean;
}

function authorsShort(authors: readonly string[]): string {
  if (authors.length === 0) return "";
  return authors.length > 3 ? `${authors.slice(0, 3).join(", ")} et al.` : authors.join(", ");
}

function flagText(f: Flags, names: ReadonlyMap<string, string>): string {
  const parts: string[] = [];
  if (f.zotero) parts.push("already in my Zotero library");
  if (f.vault) parts.push("I already have a literature note");
  if (f.listedBefore.length > 0) parts.push(`listed before by ${f.listedBefore.map((id) => names.get(id) ?? id).join(", ")}`);
  return parts.join("; ");
}

/** One paper as it appears in the prompt. */
export function paperBlock(label: string, p: ReviewPaper, flags: Flags, names: ReadonlyMap<string, string>, opts: PromptOptions): string {
  const head = [
    label, p.year === null ? "year unknown" : String(p.year), p.venue ?? "venue unknown", `${p.citedByCount} citations`, `rank ${p.tier}`,
    `found by ${[...new Set(p.finds.map((f) => names.get(f.feedId) ?? f.feedId))].join(", ")}`,
  ];
  const lines = [head.join(" | "), `${p.title}${p.authors.length > 0 ? ` (${authorsShort(p.authors)})` : ""}${p.isPreprint ? " [preprint]" : ""}`];
  const terms = [...new Set(p.finds.flatMap((f) => f.matched))];
  if (terms.length > 0) lines.push(`Matched terms: ${terms.join(", ")}`);
  const flag = flagText(flags, names);
  if (flag !== "") lines.push(`Note: ${flag}`);
  if (opts.includeAbstracts) {
    const abstract = cutAbstract(p.abstract, opts.abstractChars);
    lines.push(abstract === "" ? "Abstract: (none returned)" : `Abstract: ${abstract}`);
  }
  return lines.join("\n");
}

export const LIT_REVIEW_EXAMPLE = {
  themes: [
    { name: "Flow synthesis", summary: "Continuous and automated routes to the polymers.", papers: ["P1", "P4"] },
    { name: "Degradation", summary: "How and when the materials break down.", papers: ["P2", "P3"] },
  ],
  priorities: [
    { paper: "P1", level: "must", reason: "Closest to my subject, recent, and well cited." },
    { paper: "P2", level: "should", reason: "Useful background; already in my Zotero library." },
    { paper: "P3", level: "skim", reason: "Related, but about a different monomer." },
    { paper: "P4", level: "skip", reason: "Only mentions the subject in passing." },
  ],
  gaps: ["Nothing on recycling at scale.", "No review article among these papers."],
  search_suggestions: ["Add a topic for chemical recycling.", "Lower the weight of 'adhesive': it brings in unrelated papers."],
};

export function buildLitReviewPrompt(input: PromptInput): string {
  const opts = input.options ?? DEFAULT_PROMPT_OPTIONS;
  const names = input.names;
  const shown = input.papers.length;
  const parts: string[] = [
    "You are helping me with a literature review. Below are the papers my saved searches found, ranked by how well they match my rules, with what I already have of each. Analyse them and tell me what to read first.",
    MEANING,
    `THE SEARCHES\n${input.feeds.map((f) => describeFeed(f)).join("\n\n")}`,
    `THE PAPERS (${shown}${input.total > shown ? ` of the ${input.total} that matched; the rest are left out` : ""}; best match first)\n${input.papers.map((p, i) => paperBlock(paperLabel(i), p, input.flags[i], names, opts)).join("\n\n")}`,
  ];
  if (input.networkText && input.networkText.trim() !== "") parts.push(`HOW THEY CITE EACH OTHER\n${input.networkText.trim()}`);
  parts.push(
    "YOUR TASK\n1. Group the papers into 3 to 7 themes (a paper in at most one theme; leave out papers that fit none).\n2. Give every paper a reading level: \"must\" (read in full soon), \"should\" (read when there is time), \"skim\" (abstract and figures), or \"skip\". Keep \"must\" to about a fifth. A paper I already have (in Zotero or as a note) should not be \"must\" unless it matters for a theme: say so in the reason.\n3. Say what is missing: topics the searches do not cover, and kinds of papers (reviews, methods, early work) you would expect but cannot see.\n4. Suggest changes to the searches, as sentences; I will review them separately.\nUse only the papers above: do not invent papers or facts, and say so when the title and abstract do not let you tell.",
    `ANSWER FORMAT\nOne object with: "themes" (a list of {"name", "summary", "papers": [labels]}), "priorities" (a list of {"paper": label, "level": "must" | "should" | "skim" | "skip", "reason"}, one per paper you rate), "gaps" (a list of sentences) and "search_suggestions" (a list of sentences). Refer to papers only by their labels (P1, P2, …).\n\nExample of the whole answer:\n\`\`\`json\n${printJson(LIT_REVIEW_EXAMPLE)}\n\`\`\`\n${ONLY_JSON}`,
  );
  return parts.join("\n\n");
}

// ---- the pasted answer ------------------------------------------------------------------------------------------------

export interface LitReviewAnswer {
  themes: { name: string; summary: string; papers: string[] }[];
  priorities: { paper: string; level: ReadLevel; reason: string }[];
  gaps: string[];
  searchSuggestions: string[];
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function strings(v: unknown): string[] {
  return Array.isArray(v) ? v.map(str).filter((s) => s !== "") : [];
}

/**
 * The review answer. `labels` are the paper labels that exist (P1…Pn); an entry that names another label is left out and
 * reported, the good ones are kept. Fails only when nothing usable is left.
 */
export type LitChecked = { ok: true; value: LitReviewAnswer; warnings: string[] } | { ok: false; errors: string[] };

export function checkLitReviewAnswer(value: unknown, labels: ReadonlySet<string>): LitChecked {
  if (!isRecord(value)) return { ok: false, errors: ["The answer must be one JSON object."] };
  const errors: string[] = [];
  const themes: LitReviewAnswer["themes"] = [];
  if (Array.isArray(value.themes)) {
    value.themes.forEach((t, i) => {
      if (!isRecord(t) || str(t.name) === "") {
        errors.push(`Theme ${i + 1}: needs a "name".`);
        return;
      }
      const papers = strings(t.papers);
      const unknown = papers.filter((l) => !labels.has(l));
      if (unknown.length > 0) errors.push(`Theme "${str(t.name)}": unknown paper label${unknown.length === 1 ? "" : "s"} ${unknown.join(", ")} (left out).`);
      themes.push({ name: str(t.name), summary: str(t.summary), papers: papers.filter((l) => labels.has(l)) });
    });
  } else {
    errors.push('"themes" is missing or is not a list.');
  }
  const priorities: LitReviewAnswer["priorities"] = [];
  if (Array.isArray(value.priorities)) {
    const seen = new Set<string>();
    value.priorities.forEach((p, i) => {
      const level = READ_LEVELS.find((l) => isRecord(p) && p.level === l);
      const paper = isRecord(p) ? str(p.paper) : "";
      if (level === undefined || paper === "") {
        errors.push(`Priority ${i + 1}: needs "paper" and a "level" (${READ_LEVELS.join(", ")}).`);
        return;
      }
      if (!labels.has(paper)) {
        errors.push(`Priority ${i + 1}: unknown paper label ${paper} (left out).`);
        return;
      }
      if (seen.has(paper)) return;
      seen.add(paper);
      priorities.push({ paper, level, reason: isRecord(p) ? str(p.reason) : "" });
    });
  } else {
    errors.push('"priorities" is missing or is not a list.');
  }
  if (themes.length === 0 && priorities.length === 0) return { ok: false, errors: errors.length > 0 ? errors : ["The answer has no themes and no priorities."] };
  return { ok: true, value: { themes, priorities, gaps: strings(value.gaps), searchSuggestions: strings(value.search_suggestions) }, warnings: errors };
}
