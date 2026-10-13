// The data set of earlier suggestions and what the user decided, kept in `decisions.json` in the plugin folder. The next review
// prompt prints it, so the LLM learns what was refused (and why) and what was accepted. Pure: no Obsidian.
import { SUGGESTION_KINDS, type SuggestionKind } from "./schemas";

/** Decisions kept in the file (the oldest go first). */
export const DECISIONS_CAP = 500;
/** Decisions printed in a prompt, per verdict. */
export const PROMPT_LIMIT = 25;

export interface Decision {
  /** `YYYY-MM-DD`. */
  at: string;
  feedId: string;
  kind: SuggestionKind;
  /** The suggestion in one line (`describeSuggestion`). */
  summary: string;
  /** Why the LLM suggested it. */
  llmReason: string;
  verdict: "accepted" | "rejected";
  /** Why the user said no (or yes), if they said. */
  userReason: string;
}

export interface Decisions {
  version: 1;
  items: Decision[];
}

export function emptyDecisions(): Decisions {
  return { version: 1, items: [] };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Decisions from whatever `decisions.json` held: damaged entries are left out, nothing throws. */
export function normaliseDecisions(raw: unknown): Decisions {
  const out = emptyDecisions();
  if (!isRecord(raw) || !Array.isArray(raw.items)) return out;
  for (const item of raw.items) {
    if (!isRecord(item)) continue;
    const kind = SUGGESTION_KINDS.find((k) => k === item.kind);
    const verdict = item.verdict === "accepted" || item.verdict === "rejected" ? item.verdict : null;
    if (kind === undefined || verdict === null || typeof item.feedId !== "string" || typeof item.summary !== "string") continue;
    if (typeof item.at !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(item.at)) continue;
    out.items.push({
      at: item.at, feedId: item.feedId, kind, summary: item.summary, verdict,
      llmReason: typeof item.llmReason === "string" ? item.llmReason : "",
      userReason: typeof item.userReason === "string" ? item.userReason : "",
    });
  }
  out.items = out.items.slice(-DECISIONS_CAP);
  return out;
}

export function recordDecisions(decisions: Decisions, added: readonly Decision[]): void {
  decisions.items = [...decisions.items, ...added].slice(-DECISIONS_CAP);
}

/** The latest decisions about one feed, newest last, at most `PROMPT_LIMIT` of each verdict. */
export function decisionsForPrompt(decisions: Decisions, feedId: string): { accepted: Decision[]; rejected: Decision[] } {
  const own = decisions.items.filter((d) => d.feedId === feedId);
  return {
    accepted: own.filter((d) => d.verdict === "accepted").slice(-PROMPT_LIMIT),
    rejected: own.filter((d) => d.verdict === "rejected").slice(-PROMPT_LIMIT),
  };
}
