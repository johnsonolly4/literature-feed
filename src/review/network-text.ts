// The citation network as text: for the prompt (so an LLM can reason about it) and for the review note. Pure. Papers in the set
// are P1, P2, …; works the set cites often but does not contain are M1, M2, …; works outside the set that cite several of its papers
// are C1, C2, …. The same labels are used in the answer, the note and the graph.
import type { Candidate } from "../openalex/client";
import { shortOpenAlexId } from "../inbox/write";
import { escapeMd, doiUrl } from "../inbox/write";
import type { ReviewPaper } from "./collect";
import type { Flags } from "./flags";
import { referenceCoverage, type Network } from "./network";
import type { NetworkExtras } from "./network-fetch";

export const citingLabel = (index: number): string => `C${index + 1}`;

export interface ExtraRow {
  label: string;
  id: string;
  title: string;
  year: number | null;
  doi: string | null;
  citedBy: number;
  /** "cited by 6 of these papers (P1, P4)" or "cites 4 of these papers (P2, P3)". */
  detail: string;
  flags: Flags;
}

function row(label: string, c: Candidate, detail: string, flags: Flags): ExtraRow {
  return { label, id: shortOpenAlexId(c.openalexId) ?? "", title: c.title, year: c.year ?? null, doi: c.doi ?? null, citedBy: c.citedByCount ?? 0, detail, flags };
}

/** The missing and also-citing works as labelled rows. `labelOf` gives the P-label of a paper id in the set. */
export function buildExtraRows(extras: NetworkExtras, labelOf: (id: string) => string | undefined, flagsOf: (c: Candidate) => Flags): { missing: ExtraRow[]; alsoCite: ExtraRow[] } {
  const labels = (ids: readonly string[]): string => ids.map((id) => labelOf(id)).filter((l): l is string => l !== undefined).join(", ");
  return {
    missing: extras.missing.map((m, i) => row(`M${i + 1}`, m.paper, `cited by ${m.count} of these papers (${labels(m.citers)})`, flagsOf(m.paper))),
    alsoCite: extras.alsoCite.map((a, i) => row(citingLabel(i), a.paper, `cites ${a.count} of these papers (${labels(a.cites)})`, flagsOf(a.paper))),
  };
}

function haveText(f: Flags): string {
  return [f.zotero ? "already in my Zotero" : "", f.vault ? "I have a literature note" : ""].filter((x) => x !== "").join(", ");
}

function titleLine(r: ExtraRow): string {
  const have = haveText(r.flags);
  return `${r.label} | ${r.year ?? "year unknown"} | ${r.citedBy} citations | ${r.title} | ${r.detail}${have === "" ? "" : ` | ${have}`}`;
}

/** The network for the prompt: hubs, clusters, isolated papers, and the missing and also-citing works. */
export function networkText(papers: readonly ReviewPaper[], network: Network, rows: { missing: ExtraRow[]; alsoCite: ExtraRow[] }, labelOf: (id: string) => string | undefined): string {
  const label = (id: string): string => labelOf(id) ?? id;
  const cover = referenceCoverage(papers);
  const lines: string[] = [
    `${network.edges.length} citations among these ${papers.length} papers. OpenAlex lists references for ${cover.withList} of them${cover.withList < cover.total ? `; the other ${cover.total - cover.withList} may cite more than shows here, so treat missing links with care` : ""}.`,
  ];
  if (network.hubs.length > 0) {
    lines.push("Cited most by the others in the set:");
    for (const id of network.hubs) lines.push(`- ${label(id)}: cited by ${network.degree.get(id)?.in ?? 0} of them`);
  }
  if (network.clusters.length > 0) {
    lines.push("Groups of papers that cite each other:");
    network.clusters.slice(0, 6).forEach((c, i) => lines.push(`- Group ${i + 1} (${c.length} papers): ${c.slice(0, 12).map(label).join(", ")}${c.length > 12 ? ", …" : ""}`));
  }
  if (network.isolated.length > 0) lines.push(`${network.isolated.length} papers neither cite nor are cited by another paper in the set.`);
  if (rows.missing.length > 0) {
    lines.push("Not in the set, but cited by several of its papers (possible missing papers):", ...rows.missing.map((r) => `- ${titleLine(r)}`));
  }
  if (rows.alsoCite.length > 0) {
    lines.push("Not in the set, but citing several of its papers (follow-ups, reviews):", ...rows.alsoCite.map((r) => `- ${titleLine(r)}`));
  }
  if (rows.missing.length > 0 || rows.alsoCite.length > 0) lines.push("Rate the M and C works in \"priorities\" like the P papers (use their labels).");
  return lines.join("\n");
}

function flagsMd(f: Flags): string {
  const parts: string[] = [];
  if (f.zotero) parts.push(`[in Zotero](zotero://select/library/items/${f.zotero})`);
  if (f.vault) parts.push(`[[${f.vault.replace(/\.md$/i, "")}|note]]`);
  return parts.join(", ");
}

function cell(text: string): string {
  return text.replace(/\s+/g, " ").replace(/\|/g, "\\|").trim();
}

/** The network for the review note: the missing and also-citing works as tables, and a line on the hubs. */
export function networkMarkdown(network: Network, rows: { missing: ExtraRow[]; alsoCite: ExtraRow[] }, labelOf: (id: string) => string | undefined, titleOf: (id: string) => string): string[] {
  const out: string[] = ["## Citation network", "", `${network.edges.length} citations among the papers; ${network.clusters.length} group${network.clusters.length === 1 ? "" : "s"} that cite each other; ${network.isolated.length} papers with no link to another.`, ""];
  if (network.hubs.length > 0) {
    out.push("Cited most by the others in the set:", "");
    for (const id of network.hubs.slice(0, 5)) out.push(`- ${labelOf(id) ?? id}: ${escapeMd(titleOf(id))} (cited by ${network.degree.get(id)?.in ?? 0})`);
    out.push("");
  }
  const table = (title: string, list: ExtraRow[]): void => {
    if (list.length === 0) return;
    out.push(`### ${title}`, "", "| Label | Paper | Year | Cited | How it relates | Already have |", "| --- | --- | --- | --- | --- | --- |");
    for (const r of list) {
      const url = doiUrl(r.doi);
      const name = url ? `[${escapeMd(r.title)}](${url})` : escapeMd(r.title);
      out.push(`| ${r.label} | ${cell(name)} | ${r.year ?? ""} | ${r.citedBy} | ${cell(escapeMd(r.detail))} | ${cell(flagsMd(r.flags))} |`);
    }
    out.push("");
  };
  table("Possibly missing papers (cited by several of these)", rows.missing);
  table("Papers that cite several of these", rows.alsoCite);
  return out;
}
