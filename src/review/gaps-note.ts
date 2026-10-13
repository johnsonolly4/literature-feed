// The note the citation-gaps tool makes: the works a paper (or a pasted reference list) may have missed, with links and what you
// already have, and how it was made (input, threshold, date, cost) so it can be repeated. Pure: the plugin writes it.
import { doiUrl, escapeMd } from "../inbox/write";
import type { Flags } from "./flags";
import type { GapInput } from "./gaps-input";
import type { GapsRun } from "./gaps-fetch";
import { cell, flagText } from "./note";

export const GAPS_RECORD_BLOCK = "literature-feed-gaps-record";

export interface GapsRecord {
  version: 1;
  ranAt: string;
  input: GapInput;
  minCount: number;
  subject: GapsRun["subject"];
  referencesRead: number;
  referencesWithLists: number;
  gaps: { id: string; count: number; share: number }[];
  unresolved: string[];
  searches: number;
  stopped: string | null;
  spentUsd: number;
}

export function buildGapsRecord(ranAt: string, input: GapInput, minCount: number, run: GapsRun): GapsRecord {
  return {
    version: 1, ranAt, input, minCount, subject: run.subject, referencesRead: run.referencesRead, referencesWithLists: run.referencesWithLists,
    gaps: run.gaps.map((g) => ({ id: g.gap.id, count: g.gap.count, share: Math.round(g.gap.share * 1000) / 1000 })), unresolved: run.unresolved,
    searches: run.searches, stopped: run.stopped, spentUsd: run.spentUsd,
  };
}

/** The first gaps record in a note's text, or null. */
export function gapsRecordFromNote(text: string): GapsRecord | null {
  const m = new RegExp("```" + GAPS_RECORD_BLOCK + "\\s*\\r?\\n([\\s\\S]*?)\\r?\\n```").exec(text);
  if (!m) return null;
  try {
    const raw = JSON.parse(m[1]) as Partial<GapsRecord>;
    return raw.version === 1 && typeof raw.ranAt === "string" && raw.input !== undefined && Array.isArray(raw.gaps) ? (raw as GapsRecord) : null;
  } catch {
    return null;
  }
}

function describeInput(input: GapInput): string[] {
  if (input.kind === "work") return [`- **Paper:** ${input.doi ? `DOI ${input.doi}` : `OpenAlex ${input.id ?? ""}`}`];
  if (input.kind === "title") return [`- **Paper:** found by its title, "${escapeMd(input.title)}"`];
  return [
    `- **Pasted references:** ${input.dois.length} with a DOI and ${input.lines.length} without (searched by their text).`,
    ...input.dois.map((d) => `  - DOI ${d}`),
    ...input.lines.map((l) => `  - ${escapeMd(l)}`),
  ];
}

export interface GapsNoteInput {
  /** `YYYY-MM-DD`. */
  date: string;
  ranAt: string;
  input: GapInput;
  minCount: number;
  run: GapsRun;
  flags: readonly Flags[];
  searchNames?: ReadonlyMap<string, string>;
}

export function renderGapsNote(n: GapsNoteInput): string {
  const { run } = n;
  const subject = run.subject ? escapeMd(run.subject.title) : "the pasted references";
  const lines: string[] = [
    "---", "kind: literature-gaps", "cssclasses:", "  - vt", `created: ${n.date}`, ...(run.subject ? [`paper: ${JSON.stringify(run.subject.title)}`] : []), "---", "",
    `> [!info] Works that at least ${n.minCount} of the references of ${subject} cite, and that it does not cite itself. Read ${run.referencesRead} references (${run.referencesWithLists} with a reference list of their own). Cost about $${run.spentUsd.toFixed(4)}.`, "",
  ];
  if (run.message) lines.push(`> [!note] ${run.message}`, "");
  if (run.stopped) lines.push(`> [!warning] The lookup ${run.stopped}.`, "");
  if (run.gaps.length > 0) {
    lines.push("## Possible gaps", "", "| Paper | Year | Cited | Cited by these references | Already have |", "| --- | --- | --- | --- | --- |");
    run.gaps.forEach((g, i) => {
      const p = g.paper;
      const url = doiUrl(p?.doi ?? null);
      const title = p ? (url ? `[${escapeMd(p.title)}](${url})` : escapeMd(p.title)) : g.gap.id;
      lines.push(`| ${cell(title)} | ${p?.year ?? ""} | ${p?.citedByCount ?? ""} | ${g.gap.count} (${Math.round(g.gap.share * 100)}%) | ${cell(n.flags[i] ? flagText(n.flags[i], n.searchNames ?? new Map()) : "")} |`);
    });
    lines.push("");
  } else if (!run.message) {
    lines.push(`No work is cited by ${n.minCount} or more of these references without also being cited by the paper.`, "");
  }
  lines.push("## How this was made", "", ...describeInput(n.input), `- **Run:** ${n.ranAt}. Minimum: cited by ${n.minCount} of the references.`);
  lines.push(`- **OpenAlex requests:** ${run.searches} title search${run.searches === 1 ? "" : "es"}, the rest lookups by id or DOI; about $${run.spentUsd.toFixed(4)}.`);
  if (run.unresolved.length > 0) lines.push("- **Not found in OpenAlex:**", ...run.unresolved.map((u) => `  - ${escapeMd(u)}`));
  lines.push("", "```" + GAPS_RECORD_BLOCK, JSON.stringify(buildGapsRecord(n.ranAt, n.input, n.minCount, run)), "```", "");
  return lines.join("\n");
}
