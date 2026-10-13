// The prompts the user copies into a chat with an LLM. Pure: no Obsidian, nothing is sent from here. Every prompt says how the
// tool ranks papers, gives the search syntax, and states the exact JSON the answer must have (with one example from schemas.ts).
import type { FeedConfig } from "../settings/data";
import { verdictOf, type Ledger, type ScanRecord } from "../ledger/ledger";
import type { Decision } from "./decisions";
import { NEW_FEED_EXAMPLE, REVIEW_EXAMPLE, TOPIC_EXAMPLE, printJson } from "./schemas";

const MEANING = [
  "How this tool ranks papers (a plain word and phrase match, no AI):",
  "- A search has several search topics. Each topic is one OpenAlex query run against titles and abstracts; the papers all topics return are merged.",
  "- A search has concept groups. A group matches a paper when any one of its terms appears as a whole word or phrase in the title or abstract (British and American spellings count as the same, and a trailing plural is allowed).",
  '- Group roles: "required" = a paper that does not match this group is dropped; "boost" = a match raises the paper to Strong; "priority" = a match raises it to Priority. A paper with no boost or priority match is Possible.',
  '- "drop" terms: a match removes the paper. "lower" terms: a match moves the paper down one tier.',
  "- A paper with no abstract is judged on its title alone and ranks at most Possible.",
  "- The reader ticks the papers they want (they are sent to Zotero), reads them, and can dismiss papers as not relevant.",
].join("\n");

const QUERY_RULES = [
  "Search string rules (OpenAlex):",
  "- Put phrases in double quotes. Write AND, OR and NOT in capitals. Group with parentheses; brackets and quotation marks must balance.",
  "- No field names and no filters: the tool adds the date window itself.",
  "- OpenAlex stems words but does not treat British and American spellings as the same, so write both when they differ, for example (copolymerization OR copolymerisation).",
  "- Keep each string under about 300 characters, and make each topic cover one angle of the subject.",
].join("\n");

const ONLY_JSON = "Answer with JSON only, in one code block, nothing else before or after it. If you cannot open an attachment or link, or cannot do part of the task, say so in the JSON's reason or notes field instead of guessing.";

/** The search as plain text for a prompt. */
export function describeFeed(feed: FeedConfig): string {
  const lines = [`Search name: ${feed.name}`, "Topics (numbered as in the settings):"];
  feed.topics.forEach((t, i) => lines.push(`  ${i + 1}. ${t}`));
  if (feed.topics.length === 0) lines.push("  (none)");
  lines.push("Groups:");
  for (const g of feed.groups) lines.push(`  - ${g.name} [${g.role}]: ${g.terms.join(", ") || "(no terms)"}`);
  if (feed.groups.length === 0) lines.push("  (none)");
  lines.push(`Drop terms: ${feed.drop.join(", ") || "(none)"}`);
  lines.push(`Lower terms: ${feed.lower.join(", ") || "(none)"}`);
  lines.push(`Only papers from this year on: ${feed.yearsFrom ?? "no limit"}`);
  return lines.join("\n");
}

// ---- review a search from its results -----------------------------------------------------------------------------------

export interface ReviewPromptInput {
  feed: FeedConfig;
  /** The search-effectiveness report for this one search, as Markdown. */
  reportMarkdown: string;
  accepted: readonly Decision[];
  rejected: readonly Decision[];
  /** Titles of papers, only when the user ticked the box to include them. */
  titles?: { wanted: readonly string[]; dismissed: readonly string[] };
}

function decisionLines(list: readonly Decision[], withUser: boolean): string[] {
  if (list.length === 0) return ["  (none yet)"];
  return list.map((d) => `  - ${d.at}: ${d.summary}${d.llmReason ? ` (you said: ${d.llmReason})` : ""}${withUser && d.userReason ? ` (the user said: ${d.userReason})` : ""}`);
}

export const REVIEW_KINDS_TEXT = [
  "Each suggestion is one object with a \"kind\" and a short \"reason\" that cites the numbers. The kinds and their fields:",
  '- {"kind": "add_term", "list": <group name or "drop" or "lower">, "term": <text>}',
  '- {"kind": "remove_term", "list": <group name or "drop" or "lower">, "term": <text>}',
  '- {"kind": "set_group_role", "group": <group name>, "role": "required" | "boost" | "priority"}',
  '- {"kind": "add_group", "group": <new name>, "role": "required" | "boost" | "priority", "terms": [<text>, ...]}',
  '- {"kind": "replace_topic", "topic": <number>, "query": <search string>}',
  '- {"kind": "add_topic", "query": <search string>}',
  '- {"kind": "remove_topic", "topic": <number>}',
].join("\n");

export function buildReviewPrompt(input: ReviewPromptInput): string {
  const parts: string[] = [
    "You are helping me tune a literature search that feeds a weekly reading list. Below are how the search is defined, how it has done so far, and what you suggested before and what I decided.",
    MEANING,
    QUERY_RULES,
    "THE SEARCH\n" + describeFeed(input.feed),
    "HOW IT HAS DONE (Markdown report; \"wanted\" = I ticked, sent or read it, or could not get it; \"dismissed\" = I marked it not relevant or never wanted it; undecided papers are left out of the rates)\n" + input.reportMarkdown.trim(),
    ["EARLIER SUGGESTIONS I ACCEPTED", ...decisionLines(input.accepted, false), "", "EARLIER SUGGESTIONS I REJECTED (do not suggest these again unless the numbers now clearly support them)", ...decisionLines(input.rejected, true)].join("\n"),
  ];
  if (input.titles) {
    parts.push(["TITLES OF WANTED PAPERS", ...(input.titles.wanted.length > 0 ? input.titles.wanted.map((t) => `  - ${t}`) : ["  (none)"]), "", "TITLES OF DISMISSED PAPERS", ...(input.titles.dismissed.length > 0 ? input.titles.dismissed.map((t) => `  - ${t}`) : ["  (none)"])].join("\n"));
  }
  parts.push(
    "YOUR TASK\nSuggest changes to this search that should raise the share of papers I want. Suggest only what the numbers support, at most 10 suggestions, most useful first. Say in the reason when the evidence is thin (fewer than about 20 decided papers, or a term in fewer than 4). If nothing is worth changing, return an empty list of suggestions.",
    "ANSWER FORMAT\n" + REVIEW_KINDS_TEXT + "\n\nExample of the whole answer:\n```json\n" + printJson(REVIEW_EXAMPLE) + "\n```\n" + ONLY_JSON,
  );
  return parts.join("\n\n");
}

// ---- tweak the search terms ---------------------------------------------------------------------------------------------

export interface TopicStatRow {
  topic: number;
  returned: number;
  listed: number;
  dropped: number;
  scans: number;
}

export interface TopicPromptInput {
  feed: FeedConfig;
  stats: readonly TopicStatRow[];
  /** What the user is after, in their own words (may be empty). */
  note: string;
}

export function buildTopicPrompt(input: TopicPromptInput): string {
  const stats = input.stats.length === 0
    ? "No scan numbers have been recorded yet for this search."
    : ["| Topic | Papers returned | New papers listed | New papers dropped by the rules | Scans |", "| --- | --- | --- | --- | --- |", ...input.stats.map((s) => `| ${s.topic} | ${s.returned} | ${s.listed} | ${s.dropped} | ${s.scans} |`)].join("\n");
  return [
    "You are helping me improve the search strings (the topics) of a literature search that feeds a weekly reading list.",
    MEANING,
    QUERY_RULES,
    "THE SEARCH\n" + describeFeed(input.feed),
    "WHAT EACH TOPIC DID (summed over the recorded scans; a paper several topics return counts under each; \"dropped\" means the group rules above removed it, so a high dropped share means the topic is too broad)\n" + stats,
    "WHAT I AM AFTER\n" + (input.note.trim() === "" ? "(nothing added: judge from the search itself)" : input.note.trim()),
    "YOUR TASK\nReview each topic and say whether to keep it, change it, or remove it, and add topics only for angles the others miss. Prefer narrower strings for topics that return many dropped papers, and say when you have no evidence either way.",
    'ANSWER FORMAT\nOne object with a "topics" list; one entry per existing topic, plus any new ones. Each entry has an "action": "keep", "change", "add" or "remove"; "index" (the topic number) for keep, change and remove; "query" (the full new search string) for change and add; and a short "reason".\n\nExample of the whole answer:\n```json\n' + printJson(TOPIC_EXAMPLE) + "\n```\n" + ONLY_JSON,
  ].join("\n\n");
}

// ---- a new search from a description and example papers -----------------------------------------------------------------

export interface NewFeedPromptInput {
  description: string;
  /** How many example papers (PDFs or links) the user attaches to the chat. */
  exampleCount: number;
}

export function buildNewFeedPrompt(input: NewFeedPromptInput): string {
  const n = Math.max(0, Math.floor(input.exampleCount));
  const examples = n === 0
    ? "I am not attaching example papers: work from the description."
    : `${n} example paper${n === 1 ? " is" : "s are"} attached to this chat (PDFs or web pages). Read ${n === 1 ? "it" : "them"} and build the search from what ${n === 1 ? "it has" : "they have"} in common with my description. Write the groups and terms so that ${n === 1 ? "this paper" : "these papers"} would be found and ranked high.`;
  return [
    "You are helping me set up a literature search that feeds a weekly reading list. Build one complete search definition as JSON.",
    MEANING,
    QUERY_RULES,
    "WHAT I WANT TO FOLLOW\n" + (input.description.trim() === "" ? "(no description: use the example papers)" : input.description.trim()),
    "EXAMPLE PAPERS\n" + examples,
    "YOUR TASK\nWrite the search: a name, 3 to 6 topics (each covering one angle), 2 to 5 concept groups with sensible roles (one or two \"required\" groups that every wanted paper must match, \"boost\" for what makes a paper more interesting, \"priority\" for what I would drop everything for), drop terms for off-topic papers that the topics will otherwise bring in, lower terms for papers that match but are rarely wanted. Leave \"zoteroCollection\" and \"project\" empty. Aim for a search that returns roughly 10 to 40 papers a week, not hundreds.",
    'ANSWER FORMAT\nOne object with exactly these fields: "name" (text), "topics" (list of search strings), "groups" (list of {"name", "role": "required" | "boost" | "priority", "terms": [text, ...]}), "drop" (list of text), "lower" (list of text), "yearsFrom" (a year or null), "zoteroCollection" (""), "project" (""), and optionally "notes" (text): in "notes" say which example papers your terms would still miss and why.\n\nExample of the whole answer:\n```json\n' + printJson(NEW_FEED_EXAMPLE) + "\n```\n" + ONLY_JSON,
  ].join("\n\n");
}

// ---- numbers for the prompts, from the ledger ----------------------------------------------------------------------------

/** What each topic did over the logged scans of one search: returned, newly listed, dropped by the rules, and how many scans. */
export function topicStatRows(scans: readonly ScanRecord[], feedId: string): TopicStatRow[] {
  const own = scans.filter((s) => s.feedId === feedId);
  const count = Math.max(0, ...own.map((s) => s.topics.length));
  return Array.from({ length: count }, (_, i) => {
    const entries = own.flatMap((s) => (s.topics[i] ? [s.topics[i]] : []));
    return {
      topic: i + 1,
      returned: entries.reduce((n, t) => n + t.returned, 0),
      listed: entries.reduce((n, t) => n + t.listed, 0),
      dropped: entries.reduce((n, t) => n + t.dropped, 0),
      scans: entries.length,
    };
  });
}

/** Titles of one search's wanted and dismissed papers (newest weeks first, at most `cap` each); undecided papers are left out. */
export function titlesByVerdict(ledger: Ledger, feedId: string, today: string, dismissAfterWeeks: number, cap = 40): { wanted: string[]; dismissed: string[] } {
  const own = Object.entries(ledger.papers)
    .filter(([key]) => key.startsWith(`${feedId}/`))
    .map(([, p]) => p)
    .filter((p) => p.title !== "")
    .sort((a, b) => b.start.localeCompare(a.start));
  const pick = (verdict: "interested" | "dismissed"): string[] =>
    own.filter((p) => verdictOf(p, today, dismissAfterWeeks) === verdict).slice(0, cap).map((p) => p.title);
  return { wanted: pick("interested"), dismissed: pick("dismissed") };
}
