// The review note: what a literature review found and what the LLM advised, as a Markdown note with links (DOI, Zotero, the
// literature note in the vault). Pure: the plugin writes it. Properties follow the vault rules: an empty line after them.
import { doiUrl, escapeMd } from "../inbox/write";
import type { ReviewPaper } from "./collect";
import type { ExtraRow } from "./network-text";
import { countFlags, type Flags } from "./flags";
import type { LitReviewAnswer, ReadLevel } from "./prompt";
import { READ_LEVELS, paperLabel } from "./prompt";
import { renderRecordSection, type ReviewRecord } from "./record";

export interface NoteInput {
  /** `YYYY-MM-DD`. */
  date: string;
  /** Names of the searches the review used. */
  searches: string[];
  fromDate: string;
  papers: readonly ReviewPaper[];
  flags: readonly Flags[];
  /** Papers the rules kept before the cap. */
  total: number;
  spentUsd: number;
  /** Why the search stopped early, or null. */
  stopped: string | null;
  /** The LLM's answer, or null when the note is made before there is one. */
  answer: LitReviewAnswer | null;
  /** Lines to show after the priorities: the charts and the citation network, when there are any. */
  networkMarkdown?: string[];
  /** Missing (M) and citing (C) works, so the answer's priorities can name them. */
  extraRows?: readonly ExtraRow[];
  /** How the review was made; adds the properties, the section "How this review was made" and the block that repeats it. */
  record?: ReviewRecord | null;
}

const LEVEL_LABEL: Record<ReadLevel, string> = { must: "Must read", should: "Should read", skim: "Skim", skip: "Skip" };

/** A file-name-safe name for a review note. */
export function reviewNoteName(date: string, searches: readonly string[]): string {
  const names = searches.join(", ").replace(/[\\/:*?"<>|#^[\]]/g, " ").replace(/\s+/g, " ").trim();
  return `Literature review ${date}${names === "" ? "" : ` ${names.length > 60 ? `${names.slice(0, 59)}…` : names}`}`;
}

function titleLink(p: ReviewPaper): string {
  const url = doiUrl(p.doi);
  const title = escapeMd(p.title) || "(no title)";
  return url ? `[${title}](${url})` : title;
}

function extraTitle(r: ExtraRow): string {
  const url = doiUrl(r.doi);
  const title = escapeMd(r.title) || "(no title)";
  return url ? `[${title}](${url})` : title;
}

function flagText(f: Flags, searchNames: ReadonlyMap<string, string>): string {
  const parts: string[] = [];
  if (f.zotero) parts.push(`[in Zotero](zotero://select/library/items/${f.zotero})`);
  if (f.vault) parts.push(`[[${f.vault.replace(/\.md$/i, "")}|note]]`);
  if (f.listedBefore.length > 0) parts.push(`listed before (${f.listedBefore.map((id) => escapeMd(searchNames.get(id) ?? id)).join(", ")})`);
  return parts.join(", ");
}

function cell(text: string): string {
  return text.replace(/\s+/g, " ").replace(/\|/g, "\\|").trim();
}

export function renderReviewNote(input: NoteInput, searchNames: ReadonlyMap<string, string> = new Map()): string {
  const counts = countFlags(input.flags);
  const indexOf = new Map(input.papers.map((p, i) => [paperLabel(i), i]));
  const extraByLabel = new Map((input.extraRows ?? []).map((r) => [r.label, r]));
  const lines: string[] = [
    "---", "kind: literature-review", "cssclasses:", "  - vt", `created: ${input.date}`, "searches:", ...input.searches.map((s) => `  - ${JSON.stringify(s)}`),
    ...(input.record ? [`review-run: ${JSON.stringify(input.record.ranAt)}`, `review-from: ${input.record.fromDate}`] : []),
    ...(input.record?.llm && input.record.llm.name !== "" ? [`llm: ${JSON.stringify(input.record.llm.name)}`] : []),
    "---", "",
    `> [!info] ${input.papers.length}${input.total > input.papers.length ? ` of ${input.total}` : ""} papers from ${input.searches.join(", ")}, published since ${input.fromDate}.`
    + ` Already in Zotero: ${counts.zotero}. Already in the vault: ${counts.vault}. Listed before: ${counts.listedBefore}. Search cost about $${input.spentUsd.toFixed(3)}.`,
    "",
  ];
  if (input.stopped) lines.push(`> [!warning] The search ${input.stopped}.`, "");

  const answer = input.answer;
  if (answer) {
    if (answer.themes.length > 0) {
      lines.push("## Themes", "");
      for (const t of answer.themes) {
        lines.push(`### ${escapeMd(t.name)}`, "");
        if (t.summary !== "") lines.push(escapeMd(t.summary), "");
        for (const label of t.papers) {
          const i = indexOf.get(label);
          if (i === undefined) continue;
          const p = input.papers[i];
          lines.push(`- ${titleLink(p)}${p.year === null ? "" : ` (${p.year})`}`);
        }
        lines.push("");
      }
    }
    if (answer.priorities.length > 0) {
      lines.push("## Reading priorities", "", "| Level | Paper | Year | Cited | Already have | Why |", "| --- | --- | --- | --- | --- | --- |");
      for (const level of READ_LEVELS) {
        for (const pr of answer.priorities.filter((x) => x.level === level)) {
          const i = indexOf.get(pr.paper);
          const extra = i === undefined ? extraByLabel.get(pr.paper) : undefined;
          if (extra) {
            lines.push(`| ${LEVEL_LABEL[level]} | ${cell(extraTitle(extra))} (${extra.label}) | ${extra.year ?? ""} | ${extra.citedBy} | ${cell(flagText(extra.flags, searchNames))} | ${cell(escapeMd(pr.reason))} |`);
            continue;
          }
          if (i === undefined) continue;
          const p = input.papers[i];
          lines.push(`| ${LEVEL_LABEL[level]} | ${cell(titleLink(p))} | ${p.year ?? ""} | ${p.citedByCount} | ${cell(flagText(input.flags[i], searchNames))} | ${cell(escapeMd(pr.reason))} |`);
        }
      }
      lines.push("");
    }
    if (answer.gaps.length > 0) lines.push("## Gaps", "", ...answer.gaps.map((g) => `- ${escapeMd(g)}`), "");
    if (answer.searchSuggestions.length > 0) lines.push("## Suggested changes to the searches", "", ...answer.searchSuggestions.map((g) => `- ${escapeMd(g)}`), "");
  } else {
    lines.push("> [!note] No LLM answer has been added yet. The papers are listed below; paste the answer in the review window to add themes and priorities.", "");
  }

  if (input.networkMarkdown && input.networkMarkdown.length > 0) lines.push(...input.networkMarkdown, "");

  const rated = new Set((answer?.priorities ?? []).map((p) => p.paper));
  const rest = input.papers.map((p, i) => ({ p, i })).filter(({ i }) => !rated.has(paperLabel(i)));
  if (rest.length > 0) {
    lines.push(answer ? "## Papers not rated" : "## Papers", "", "| Paper | Year | Cited | Rank | Already have |", "| --- | --- | --- | --- | --- |");
    for (const { p, i } of rest) lines.push(`| ${cell(titleLink(p))} | ${p.year ?? ""} | ${p.citedByCount} | ${p.tier} | ${cell(flagText(input.flags[i], searchNames))} |`);
    lines.push("");
  }
  if (input.record) lines.push(...renderRecordSection(input.record), "");
  return lines.join("\n");
}
