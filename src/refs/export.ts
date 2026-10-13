// The results as text: the list with DOIs appended (the format of `refs_with_doi.txt` in check_refs.py), a CSV, and a Markdown table for
// a note. Pure.
import { escapeMd } from "../inbox/write";
import type { ResolvedRow } from "./resolve";

const PREFIX: Record<string, string> = { CHECK: "[CHECK] ", "NOT FOUND": "[NO DOI FOUND] ", ERROR: "[LOOKUP ERROR] ", MANUAL: "[MANUAL] " };

/** One reference per line, a DOI link at the end when there is one, a tag in front of the ones that need a look. */
export function listWithDois(rows: readonly ResolvedRow[]): string {
  return rows.map((r) => `${PREFIX[r.status] ?? ""}${r.text}${r.doi === "" ? "" : ` https://doi.org/${r.doi}`}`).join("\n");
}

const COLUMNS = ["n", "reference", "doi", "status", "reasons", "crossref_title", "crossref_authors", "crossref_journal", "crossref_year", "crossref_volume", "crossref_pages", "crossref_publisher", "crossref_cited_by"] as const;

function csvCell(value: string | number): string {
  const s = String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows: readonly ResolvedRow[]): string {
  const lines = [COLUMNS.join(",")];
  for (const r of rows) {
    lines.push([r.n, r.text, r.doi, r.status, r.reasons.join("; "), r.crossrefTitle, r.authors, r.journal, r.year, r.volume, r.pages, r.publisher, r.citedBy ?? ""].map(csvCell).join(","));
  }
  return lines.join("\n");
}

function cell(text: string): string {
  return text.replace(/\s+/g, " ").replace(/\|/g, "\\|").trim();
}

/** A Markdown table: the reference, its DOI as a link, the status and why. */
export function toMarkdownTable(rows: readonly ResolvedRow[]): string {
  const lines = ["| # | Reference | DOI | Status | Notes |", "| --- | --- | --- | --- | --- |"];
  for (const r of rows) {
    const doi = r.doi === "" ? "" : `[${r.doi}](https://doi.org/${r.doi})`;
    lines.push(`| ${r.n} | ${cell(escapeMd(r.text))} | ${cell(doi)} | ${r.status} | ${cell(escapeMd([r.authors === "" ? "" : `Crossref: ${r.authors}`, ...r.reasons].filter((x) => x !== "").join("; ")))} |`);
  }
  return lines.join("\n");
}
