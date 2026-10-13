// The answers an LLM is asked to give back, as JSON: what they look like, how to find them in a chat reply, and how to check
// them. Pure: no Obsidian. The prompts in `build.ts` print the examples below, and a test checks that every example passes the
// validator it is shown with, so a prompt cannot drift from what the plugin accepts.
import { GROUP_ROLES } from "../settings/data";
import type { GroupRole } from "../match/feed";

/** One change an LLM suggests to a search. Topic numbers are 1-based, as in the settings. */
export type Suggestion =
  | { kind: "add_term"; list: string; term: string; reason: string }
  | { kind: "remove_term"; list: string; term: string; reason: string }
  | { kind: "set_group_role"; group: string; role: GroupRole; reason: string }
  | { kind: "add_group"; group: string; role: GroupRole; terms: string[]; reason: string }
  | { kind: "replace_topic"; topic: number; query: string; reason: string }
  | { kind: "add_topic"; query: string; reason: string }
  | { kind: "remove_topic"; topic: number; reason: string };

export type SuggestionKind = Suggestion["kind"];

export const SUGGESTION_KINDS: SuggestionKind[] = ["add_term", "remove_term", "set_group_role", "add_group", "replace_topic", "add_topic", "remove_topic"];

export type Checked<T> = { ok: true; value: T } | { ok: false; errors: string[] };

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * The first JSON value in a chat reply: the inside of a fenced block when there is one (```json or plain), otherwise the text
 * from the first `{` to the last `}`. Anything the LLM wrote around it is ignored.
 */
export function extractJson(reply: string): Checked<unknown> {
  const candidates: string[] = [];
  for (const m of reply.matchAll(/```[a-zA-Z]*[ \t]*\r?\n([\s\S]*?)\r?\n?```/g)) candidates.push(m[1]);
  const first = reply.indexOf("{");
  const last = reply.lastIndexOf("}");
  if (first !== -1 && last > first) candidates.push(reply.slice(first, last + 1));
  if (candidates.length === 0) return { ok: false, errors: ["No JSON found in the pasted text. The answer should be one JSON object, ideally in a code block."] };
  let lastError = "";
  for (const text of candidates) {
    try {
      return { ok: true, value: JSON.parse(text) as unknown };
    } catch (e) {
      lastError = e instanceof Error ? e.message : "parse error";
    }
  }
  return { ok: false, errors: [`The pasted JSON could not be read (${lastError}).`] };
}

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function topicNumber(v: unknown): number | null {
  return typeof v === "number" && Number.isInteger(v) && v >= 1 ? v : null;
}

function role(v: unknown): GroupRole | null {
  return typeof v === "string" && (GROUP_ROLES as string[]).includes(v) ? (v as GroupRole) : null;
}

/** Brackets and quotation marks of a search string must balance (the same test as the feed editor's warnings). */
export function queryProblem(query: string): string | null {
  const open = (query.match(/\(/g) ?? []).length;
  const close = (query.match(/\)/g) ?? []).length;
  const quotes = (query.match(/"/g) ?? []).length;
  if (query === "") return "the search string is empty";
  if (open !== close) return `unbalanced brackets in: ${query}`;
  if (quotes % 2 !== 0) return `unbalanced quotation marks in: ${query}`;
  return null;
}

function suggestionFrom(raw: unknown, where: string, errors: string[]): Suggestion | null {
  if (!isRecord(raw)) {
    errors.push(`${where}: not an object.`);
    return null;
  }
  const reason = str(raw.reason);
  const kind = raw.kind;
  switch (kind) {
    case "add_term":
    case "remove_term": {
      const list = str(raw.list);
      const term = str(raw.term);
      if (list === "" || term === "") {
        errors.push(`${where}: ${kind} needs "list" (a group name, "drop" or "lower") and "term".`);
        return null;
      }
      return { kind, list, term, reason };
    }
    case "set_group_role": {
      const group = str(raw.group);
      const r = role(raw.role);
      if (group === "" || r === null) {
        errors.push(`${where}: set_group_role needs "group" and "role" (${GROUP_ROLES.join(", ")}).`);
        return null;
      }
      return { kind, group, role: r, reason };
    }
    case "add_group": {
      const group = str(raw.group);
      const r = role(raw.role);
      const terms = Array.isArray(raw.terms) ? raw.terms.map(str).filter((t) => t !== "") : [];
      if (group === "" || r === null || terms.length === 0) {
        errors.push(`${where}: add_group needs "group", "role" (${GROUP_ROLES.join(", ")}) and a list of "terms".`);
        return null;
      }
      return { kind, group, role: r, terms, reason };
    }
    case "replace_topic": {
      const topic = topicNumber(raw.topic);
      const query = str(raw.query);
      const problem = queryProblem(query);
      if (topic === null || problem !== null) {
        errors.push(`${where}: replace_topic needs "topic" (1, 2, …) and a valid "query"${problem ? `: ${problem}` : ""}.`);
        return null;
      }
      return { kind, topic, query, reason };
    }
    case "add_topic": {
      const query = str(raw.query);
      const problem = queryProblem(query);
      if (problem !== null) {
        errors.push(`${where}: add_topic needs a valid "query": ${problem}.`);
        return null;
      }
      return { kind, query, reason };
    }
    case "remove_topic": {
      const topic = topicNumber(raw.topic);
      if (topic === null) {
        errors.push(`${where}: remove_topic needs "topic" (1, 2, …).`);
        return null;
      }
      return { kind, topic, reason };
    }
    default:
      errors.push(`${where}: unknown kind ${typeof kind === "string" ? `"${kind}"` : "(missing)"}. Use one of: ${SUGGESTION_KINDS.join(", ")}.`);
      return null;
  }
}

/** The review answer: `{"suggestions": [...]}`. Valid suggestions are kept and every problem is listed. */
export function checkReviewAnswer(value: unknown): Checked<Suggestion[]> {
  if (!isRecord(value) || !Array.isArray(value.suggestions)) return { ok: false, errors: ['The answer must be an object with a "suggestions" list.'] };
  const errors: string[] = [];
  const out: Suggestion[] = [];
  value.suggestions.forEach((raw, i) => {
    const s = suggestionFrom(raw, `Suggestion ${i + 1}`, errors);
    if (s) out.push(s);
  });
  if (out.length === 0 && errors.length === 0) errors.push("The list of suggestions is empty.");
  return out.length > 0 ? { ok: true, value: out } : { ok: false, errors };
}

/** The search-term answer: `{"topics": [{"action": "keep|change|add|remove", ...}]}`, turned into the same suggestions ("keep" is dropped). */
export function checkTopicAnswer(value: unknown): Checked<Suggestion[]> {
  if (!isRecord(value) || !Array.isArray(value.topics)) return { ok: false, errors: ['The answer must be an object with a "topics" list.'] };
  const errors: string[] = [];
  const out: Suggestion[] = [];
  let kept = 0;
  value.topics.forEach((raw, i) => {
    const where = `Topic entry ${i + 1}`;
    if (!isRecord(raw)) {
      errors.push(`${where}: not an object.`);
      return;
    }
    const action = raw.action;
    if (action === "keep") {
      kept++;
      return;
    }
    const map = { change: "replace_topic", add: "add_topic", remove: "remove_topic" } as const;
    if (typeof action !== "string" || !(action in map)) {
      errors.push(`${where}: "action" must be keep, change, add or remove.`);
      return;
    }
    const s = suggestionFrom({ kind: map[action as keyof typeof map], topic: raw.index, query: raw.query, reason: raw.reason }, where, errors);
    if (s) out.push(s);
  });
  if (out.length === 0 && errors.length === 0) errors.push(kept > 0 ? "Nothing to change: every topic is marked keep." : "The list of topics is empty.");
  return out.length > 0 ? { ok: true, value: out } : { ok: false, errors };
}

/** Advice on how several searches relate: read, not applied (merging or splitting searches is done by hand). */
export interface Advice {
  search: string;
  action: "keep" | "narrow" | "broaden" | "merge" | "split" | "remove";
  /** The other search it concerns (for merge), or "". */
  with: string;
  advice: string;
  reason: string;
}

export const ADVICE_ACTIONS: Advice["action"][] = ["keep", "narrow", "broaden", "merge", "split", "remove"];

/** The compare answer: `{"advice": [{"search", "action", "with", "advice", "reason"}]}`. */
export function checkCompareAnswer(value: unknown): Checked<Advice[]> {
  if (!isRecord(value) || !Array.isArray(value.advice)) return { ok: false, errors: ['The answer must be an object with an "advice" list.'] };
  const errors: string[] = [];
  const out: Advice[] = [];
  value.advice.forEach((raw, i) => {
    const where = `Advice ${i + 1}`;
    if (!isRecord(raw)) {
      errors.push(`${where}: not an object.`);
      return;
    }
    const action = ADVICE_ACTIONS.find((a) => a === raw.action);
    const search = str(raw.search);
    const text = str(raw.advice);
    if (search === "" || action === undefined || text === "") {
      errors.push(`${where}: needs "search", an "action" (${ADVICE_ACTIONS.join(", ")}) and "advice".`);
      return;
    }
    out.push({ search, action, with: str(raw.with), advice: text, reason: str(raw.reason) });
  });
  if (out.length === 0 && errors.length === 0) errors.push("The list of advice is empty.");
  return out.length > 0 ? { ok: true, value: out } : { ok: false, errors };
}

// ---- the examples the prompts print ------------------------------------------------------------------------------------

export const REVIEW_EXAMPLE = {
  suggestions: [
    { kind: "add_term", list: "drop", term: "gold nanoparticle", reason: "Appears in 6 of 7 dismissed papers and in none that were wanted." },
    { kind: "remove_term", list: "lower", term: "adhesive", reason: "Papers with this term were wanted as often as the rest." },
    { kind: "set_group_role", group: "Flow or optimisation", role: "priority", reason: "Its papers were wanted most often." },
    { kind: "add_group", group: "Degradation", role: "boost", terms: ["degradable", "depolymerisation"], reason: "Common in wanted papers." },
    { kind: "replace_topic", topic: 2, query: "(\"lipoic acid\" OR \"thioctic acid\") AND (acrylate OR acrylamide)", reason: "Topic 2 returned many papers that rules then dropped." },
    { kind: "add_topic", query: "(\"lipoic acid\" OR dithiolane) AND \"ring-opening\"", reason: "Wanted papers mention ring-opening; no topic searches for it." },
    { kind: "remove_topic", topic: 4, reason: "It returned nothing that was listed in six scans." },
  ],
};

export const TOPIC_EXAMPLE = {
  topics: [
    { action: "keep", index: 1, reason: "Works well." },
    { action: "change", index: 2, query: "(\"lipoic acid\" OR \"thioctic acid\") AND (acrylate OR acrylamide)", reason: "Too broad: 60% of what it returns is dropped." },
    { action: "add", query: "(\"lipoic acid\" OR dithiolane) AND \"ring-opening\"", reason: "Covers a gap in the other topics." },
    { action: "remove", index: 4, reason: "Never returned a paper that was listed." },
  ],
};

export const COMPARE_EXAMPLE = {
  advice: [
    { search: "Lipoic acid copolymers", action: "narrow", with: "", advice: "Drop the broad 'polymer' topic: Flow screening already finds its papers.", reason: "Every paper of topic 3 was also found by topic 1." },
    { search: "Flow chemistry", action: "merge", with: "Lipoic acid copolymers", advice: "Fold this search into the other one as an extra topic.", reason: "They list 40% of the same papers and the shared ones are wanted more often." },
    { search: "Ring-opening", action: "keep", with: "", advice: "Leave it as it is.", reason: "No overlap and a good wanted rate." },
  ],
};

/** A complete feed in the importable format, with the optional `notes` field. */
export const NEW_FEED_EXAMPLE = {
  name: "Lipoic acid copolymers",
  topics: ["(\"lipoic acid\" OR \"thioctic acid\") AND (copolymer OR copolymerisation)"],
  groups: [
    { name: "Lipoic acid", role: "required", terms: ["lipoic acid", "thioctic acid"] },
    { name: "Polymerisation", role: "required", terms: ["polymer", "copolymer", "polymerisation"] },
    { name: "Comonomer class", role: "boost", terms: ["acrylate", "acrylamide"] },
    { name: "Flow or optimisation", role: "priority", terms: ["flow", "bayesian", "high-throughput"] },
  ],
  drop: ["clinical trial"],
  lower: ["adhesive"],
  yearsFrom: null,
  zoteroCollection: "",
  project: "",
  notes: "Paper 3 (a review of dithiolane chemistry) would be missed: it never says polymer in the title or abstract.",
};

/** Pretty JSON for printing in a prompt. */
export function printJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}
