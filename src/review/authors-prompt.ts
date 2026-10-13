// The prompt that asks an LLM with web access to test the authors table of a gaps report: is each flagged author really under- or
// over-represented in the paper's references, or is it an artefact (two people merged under one name, a work the paper could not
// have cited, a different field)? And the check of the pasted answer. Pure: nothing is sent from here.
import { extractJson, printJson, type Checked } from "../prompts/schemas";
import { authorsShort } from "./authors-text";
import { couldHaveBeenCited, worksBy, type AuthorRow, type WorkRef } from "./gaps-authors";

export type AuditClaim = "under-cited" | "over-cited" | "neither";
export type AuditVerdict = "supported" | "refuted" | "unclear";
export const AUDIT_CLAIMS: AuditClaim[] = ["under-cited", "over-cited", "neither"];
export const AUDIT_VERDICTS: AuditVerdict[] = ["supported", "refuted", "unclear"];

export interface AuditEntry {
  author: string;
  claim: AuditClaim;
  verdict: AuditVerdict;
  evidence: { url: string; note: string }[];
  caveats: string;
}

export interface AuditAnswer {
  summary: string;
  authors: AuditEntry[];
}

export interface AuditInput {
  paper: { title: string; year: number | null; doi: string | null; authors: string[] } | null;
  /** Which gaps the table was made from ("first-level gaps", "both levels"). */
  scope: string;
  /** The table rows (all of them); the prompt takes the flagged ones, the paper's own authors, then the biggest differences. */
  rows: readonly AuthorRow[];
  /** The references the paper cites (as works) and the gap works it does not. */
  citedWorks: readonly WorkRef[];
  gapWorks: readonly WorkRef[];
  citedTotal: number;
  uncitedTotal: number;
  minWorks: number;
  /** At most this many authors (default 20). */
  max?: number;
}

export const AUDIT_EXAMPLE: AuditAnswer = {
  summary: "Two of the four flagged authors are genuinely under-cited; one is two different people; one is out of the field.",
  authors: [{
    author: "Ann Lee", claim: "under-cited", verdict: "supported",
    evidence: [{ url: "https://orcid.org/0000-0000-0000-0000", note: "Published 5 papers on this topic in 2018-2022, three before the paper; the paper cites none." }],
    caveats: "One of the gap works has a co-author with the same surname; checked on the author page.",
  }],
};

/** The authors the prompt is about: flagged ones and the paper's own first, then the largest differences, at most `max`. */
export function pickAuditAuthors(rows: readonly AuthorRow[], max = 20): AuthorRow[] {
  const flagged = rows.filter((r) => r.label !== "" || r.own);
  const rest = rows.filter((r) => r.label === "" && !r.own);
  return [...flagged, ...rest].slice(0, max);
}

const short = (title: string, n = 110): string => (title.length > n ? `${title.slice(0, n - 1).trimEnd()}…` : title);

function workLine(label: string, w: WorkRef, paperYear: number | null): string {
  const when = couldHaveBeenCited(w.year, paperYear);
  return `  - ${label} | ${w.year ?? "year unknown"} | ${short(w.title)}${w.doi ? ` | doi:${w.doi}` : ""}${when === "after" ? " | out AFTER the paper (could not have been cited)" : ""}`;
}

export function buildAuditPrompt(i: AuditInput): string {
  const paperYear = i.paper?.year ?? null;
  const authors = pickAuditAuthors(i.rows, i.max ?? 20);
  const cLabel = new Map(i.citedWorks.map((w, n) => [w.id || w.title, `C${n + 1}`]));
  const gLabel = new Map(i.gapWorks.map((w, n) => [w.id || w.title, `G${n + 1}`]));
  const lines: string[] = [
    "I am checking a citation analysis. For one paper, a tool counted which authors appear on the works the paper cites (its references) and on the \"gap\" works: works that several of its references cite but the paper does not. It then flagged authors who look under-represented or over-represented in the paper's references. The tool matches authors only by family name and first initial, and it only sees what OpenAlex has, so some flags may be wrong. Please test them using the web (author pages, ORCID, Google Scholar, OpenAlex, the publishers). Do not guess: say \"unclear\" when you cannot find evidence.",
    "",
    "## The paper",
    i.paper ? `- Title: ${i.paper.title}\n- Year: ${i.paper.year ?? "unknown"}${i.paper.doi ? `\n- DOI: ${i.paper.doi}` : ""}${i.paper.authors.length > 0 ? `\n- Its authors: ${authorsShort(i.paper.authors)}${i.paper.authors.length > 3 ? ` (${i.paper.authors.length} in all)` : ""}` : ""}` : "- A pasted list of references (no single paper).",
    "",
    "## How the numbers were made",
    `- Cited side: ${i.citedTotal} works the paper cites that have an author list. Uncited side: ${i.uncitedTotal} ${i.scope} (works it does not cite) with an author list.`,
    "- For each author: % of cited works they are on, % of uncited works they are on, and the difference in percentage points (uncited minus cited).",
    "- \"under-cited\" means a bigger share of the uncited works than of the cited ones (+5 points or more, on at least 3 works); \"over-cited\" is the reverse (-5 or less). A star marks the paper's own authors, who are often over-cited by their own paper.",
    `- Only authors on at least ${i.minWorks} works in all are listed. Names are matched by family name and first initial, so two different people can be counted as one.`,
    "",
    `## The authors to check (${authors.length})`,
  ];
  authors.forEach((a, n) => {
    const claim = a.label === "Under-cited" ? "under-cited" : a.label === "Over-cited" ? "over-cited" : "no flag";
    lines.push(`${n + 1}. ${a.own ? "★ " : ""}${a.name} | flagged: ${claim} | on ${a.cited} cited and ${a.uncited} uncited works | ${a.citedPct.toFixed(1)}% of cited, ${a.uncitedPct.toFixed(1)}% of uncited | difference ${a.diff >= 0 ? "+" : "-"}${Math.abs(a.diff).toFixed(0)} points`);
    const cited = worksBy(a.key, i.citedWorks);
    const gaps = worksBy(a.key, i.gapWorks);
    if (cited.length > 0) lines.push("  Works the paper cites:", ...cited.slice(0, 8).map((w) => workLine(cLabel.get(w.id || w.title) ?? "C?", w, paperYear)));
    if (gaps.length > 0) lines.push("  Gap works the paper does not cite:", ...gaps.slice(0, 8).map((w) => workLine(gLabel.get(w.id || w.title) ?? "G?", w, paperYear)));
  });
  lines.push(
    "",
    "## What to do, for each author above",
    "1. Identity: is this one person? Look for namesakes (same family name and initial) and say if the works belong to different people. Use ORCID, OpenAlex or Google Scholar author pages.",
    "2. Record: what has this person published on this topic, and when? Do the listed gap works really belong to them and fit the paper's subject?",
    "3. Judge the claim (under-cited, over-cited, or neither if the author had no flag): \"supported\" if the evidence backs it, \"refuted\" if it does not (for example: a merged namesake, work from another field, work published after the paper, the author is a collaborator whose work the paper cites under another spelling), \"unclear\" if you cannot tell. Weigh timing, self-citation, collaboration with the paper's authors, and how large the field is.",
    "4. Give sources: a URL for every claim you rely on. If you find nothing, say so; never invent papers, authors or URLs.",
    "",
    "## Answer format",
    "Reply with JSON only (a short summary, then one entry per author, in the same order):",
    "",
    "```json",
    printJson(AUDIT_EXAMPLE),
    "```",
    "",
    `"claim" is one of ${AUDIT_CLAIMS.map((c) => `"${c}"`).join(", ")}; "verdict" is one of ${AUDIT_VERDICTS.map((v) => `"${v}"`).join(", ")}. "author" is the name exactly as written above. "evidence" may be empty only when the verdict is "unclear".`,
  );
  return lines.join("\n");
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Checks the LLM's pasted answer: a `{summary, authors}` object (or a bare list of authors); every entry needs a name, a claim and a verdict. */
export function checkAuditAnswer(reply: string): Checked<AuditAnswer> {
  const parsed = extractJson(reply);
  if (!parsed.ok) return parsed;
  const raw = parsed.value;
  const list = Array.isArray(raw) ? raw : isObj(raw) && Array.isArray(raw.authors) ? raw.authors : null;
  if (list === null) return { ok: false, errors: ['The answer needs an "authors" list.'] };
  const errors: string[] = [];
  const authors: AuditEntry[] = [];
  list.forEach((e, n) => {
    if (!isObj(e) || typeof e.author !== "string" || e.author.trim() === "") { errors.push(`Entry ${n + 1} has no "author".`); return; }
    const claim = AUDIT_CLAIMS.find((c) => c === e.claim);
    const verdict = AUDIT_VERDICTS.find((v) => v === e.verdict);
    if (!claim) errors.push(`${e.author}: "claim" must be one of ${AUDIT_CLAIMS.join(", ")}.`);
    if (!verdict) errors.push(`${e.author}: "verdict" must be one of ${AUDIT_VERDICTS.join(", ")}.`);
    if (!claim || !verdict) return;
    const evidence = (Array.isArray(e.evidence) ? e.evidence : []).flatMap((x) => (isObj(x) && typeof x.url === "string" ? [{ url: x.url, note: typeof x.note === "string" ? x.note : "" }] : []));
    authors.push({ author: e.author.trim(), claim, verdict, evidence, caveats: typeof e.caveats === "string" ? e.caveats : "" });
  });
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, value: { summary: isObj(raw) && typeof raw.summary === "string" ? raw.summary : "", authors } };
}

/** The verdict for an author row, matched by name (the name as the prompt gave it, case and accents aside). */
export function verdictFor(answer: AuditAnswer | null, name: string): AuditEntry | null {
  if (!answer) return null;
  const plain = (s: string): string => s.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  return answer.authors.find((a) => plain(a.author) === plain(name)) ?? null;
}
