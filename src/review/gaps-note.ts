// The note the citation-gaps tool makes: the works a paper (or a pasted reference list) may have missed, with links and what you
// already have, and how it was made (input, threshold, date, cost) so it can be repeated. Pure: the plugin writes it.
import { doiUrl, escapeMd } from "../inbox/write";
import type { Flags } from "./flags";
import { authorsShort } from "./authors-text";
import { authorShares, authorTableCallout } from "./gaps-authors";
import { withRunDefaults, type GapInput, type GapsSession } from "./gaps-input";
import type { GapsRun } from "./gaps-fetch";
import { cell, flagText } from "./note";
import type { Candidate } from "../openalex/client";
import { HEAVY_CITATIONS } from "./network-fetch";
import { reportBlock } from "../ui/report-block";
import { checkAuditAnswer, type AuditAnswer } from "./authors-prompt";

export const GAPS_RECORD_BLOCK = "literature-feed-gaps-record";

/** The kind name of a gaps report in a note's report block. */
export const GAPS_KIND = "gaps";

/** Everything the gaps view needs to show a run again, without asking OpenAlex anything. */
export interface GapsSnapshot {
  input: GapInput;
  ranAt: string;
  minCount: number;
  run: GapsRun;
  /** What the LLM that checked the authors answered (absent when none was asked). */
  audit?: AuditAnswer | null;
}

/** A work cut down to what the view shows (abstracts and the rest are dropped to keep the note small). */
function slim(c: Candidate | null): Candidate | null {
  return c ? { title: c.title, abstract: null, doi: c.doi, year: c.year, openalexId: c.openalexId, authors: c.authors, authorIds: c.authorIds, venue: null, publicationDate: null, citedByCount: c.citedByCount } : null;
}

export function gapsSnapshot(ranAt: string, input: GapInput, minCount: number, run: GapsRun, audit: AuditAnswer | null = null): GapsSnapshot {
  return {
    input, ranAt, minCount, ...(audit ? { audit } : {}),
    run: { ...run, gaps: run.gaps.map((g) => ({ gap: g.gap, paper: slim(g.paper) })), deeper: run.deeper ? { ...run.deeper, gaps: run.deeper.gaps.map((g) => ({ gap: g.gap, paper: slim(g.paper) })) } : null,
      ...(run.similar ? { similar: { ...run.similar, rows: run.similar.rows.map((r) => ({ gap: r.gap, paper: slim(r.paper) })) } } : {}) },
  };
}

/** The snapshot from a report block's data, or null when it is not usable. Older snapshots get the fields they lack. */
export function parseGapsSnapshot(data: unknown): GapsSnapshot | null {
  if (typeof data !== "object" || data === null) return null;
  const d = data as Partial<GapsSnapshot>;
  if (typeof d.ranAt !== "string" || typeof d.minCount !== "number" || typeof d.input !== "object" || d.input === null || typeof d.run !== "object" || d.run === null || !Array.isArray((d.run as { gaps?: unknown }).gaps)) return null;
  const audit = d.audit ? checkAuditAnswer(JSON.stringify(d.audit)) : null;
  return { input: d.input, ranAt: d.ranAt, minCount: d.minCount, run: withRunDefaults(d.run as unknown as Record<string, unknown>), ...(audit?.ok ? { audit: audit.value } : {}) };
}

/**
 * The tool's inputs set from an older note's record (which holds no snapshot): the same paper or references, minimum and second level.
 * The run itself is made again (free from the cache for a day), so `last` is left empty.
 */
export function sessionFromRecord(rec: Pick<GapsRecord, "input" | "minCount" | "addedDois" | "deeper" | "similar">, base: GapsSession): GapsSession {
  const s: GapsSession = { ...base, last: null, minCount: rec.minCount, extraDois: (rec.addedDois ?? []).join("\n"), deeper: rec.deeper != null, similar: rec.similar != null, deeperMin: rec.deeper?.minCount ?? base.deeperMin };
  const input = rec.input;
  if (input.kind === "work") return { ...s, mode: "paper", paperText: input.doi ?? input.id ?? "" };
  if (input.kind === "title") return { ...s, mode: "paper", paperText: input.title };
  return { ...s, mode: "paste", pasted: [...input.dois, ...input.lines].join("\n"), refs: null, searchUnfound: input.lines.length > 0 };
}

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
  /** DOIs added by hand that OpenAlex knew (absent in older notes). */
  addedDois?: string[];
  /** The second level, when it was run (absent in older notes). */
  deeper?: { minCount: number; hubsRead: number; gaps: { id: string; count: number; share: number }[] } | null;
  /** The similar-paper scan, when it ran (absent in older notes): what it needed and what it listed. */
  similar?: { minShared: number; neighbours: number; similarFound: number; minimum: number; rows: { id: string; count: number; share: number }[] } | null;
}

export function buildGapsRecord(ranAt: string, input: GapInput, minCount: number, run: GapsRun): GapsRecord {
  return {
    version: 1, ranAt, input, minCount, subject: run.subject, referencesRead: run.referencesRead, referencesWithLists: run.referencesWithLists,
    gaps: run.gaps.map((g) => ({ id: g.gap.id, count: g.gap.count, share: Math.round(g.gap.share * 1000) / 1000 })), unresolved: run.unresolved,
    searches: run.searches, stopped: run.stopped, spentUsd: run.spentUsd, addedDois: run.addedDois,
    deeper: run.deeper ? { minCount: run.deeper.minCount, hubsRead: run.deeper.hubsRead, gaps: run.deeper.gaps.map((g) => ({ id: g.gap.id, count: g.gap.count, share: Math.round(g.gap.share * 1000) / 1000 })) } : null,
    similar: run.similar && !run.similar.skipped ? { minShared: run.similar.minShared, neighbours: run.similar.neighbours, similarFound: run.similar.similarFound, minimum: run.similar.minimum, rows: run.similar.rows.map((r) => ({ id: r.gap.id, count: r.gap.count, share: Math.round(r.gap.share * 1000) / 1000 })) } : null,
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
  /** Flags of the second level's works, in order. */
  deeperFlags?: readonly Flags[];
  /** Flags of the works the similar papers cite, in order. */
  similarFlags?: readonly Flags[];
  searchNames?: ReadonlyMap<string, string>;
  /** What an LLM answered when asked to check the authors table. */
  audit?: AuditAnswer | null;
}

export function renderGapsNote(n: GapsNoteInput): string {
  const { run } = n;
  const subject = run.subject ? escapeMd(run.subject.title) : "the pasted references";
  const lines: string[] = [
    "---", "kind: literature-gaps", "cssclasses:", "  - vt", `created: ${n.date}`, ...(run.subject ? [`paper: ${JSON.stringify(run.subject.title)}`] : []), "---", "",
    `> [!info] Works that at least ${n.minCount} of the references of ${subject} cite, and that it does not cite itself. Read ${run.referencesRead} references (${run.referencesWithLists} with a reference list of their own). Cost about $${run.spentUsd.toFixed(4)}.`, "",
  ];
  lines.push(...reportBlock(GAPS_KIND, gapsSnapshot(n.ranAt, n.input, n.minCount, run, n.audit ?? null), `${run.gaps.length + (run.deeper?.gaps.length ?? 0)} works and ${run.citedAuthors.length} references, made ${n.date}`), "");
  if (run.message) lines.push(`> [!note] ${run.message}`, "");
  if (run.stopped) lines.push(`> [!warning] The lookup ${run.stopped}.`, "");
  if (run.gaps.length > 0) {
    lines.push("## Possible gaps", "", "| Paper | Authors | Year | Cited | Cited by these references | Already have |", "| --- | --- | --- | --- | --- | --- |");
    run.gaps.forEach((g, i) => {
      const p = g.paper;
      const url = doiUrl(p?.doi ?? null);
      const title = p ? (url ? `[${escapeMd(p.title)}](${url})` : escapeMd(p.title)) : g.gap.id;
      lines.push(`| ${cell(title)} | ${cell(escapeMd(authorsShort(p?.authors ?? [])))} | ${p?.year ?? ""} | ${p?.citedByCount ?? ""} | ${g.gap.count} (${Math.round(g.gap.share * 100)}%) | ${cell(n.flags[i] ? flagText(n.flags[i], n.searchNames ?? new Map()) : "")} |`);
    });
    lines.push("");
  } else if (!run.message) {
    lines.push(`No work is cited by ${n.minCount} or more of these references without also being cited by the paper.`, "");
  }
  const sim = run.similar && !run.similar.skipped ? run.similar : null;
  if (sim) {
    lines.push("## Cited by similar papers", "", `Pointers, not verdicts. Read ${sim.citersRead} works that cite the references; ${sim.similarFound} share at least ${sim.minShared} of the ${sim.referenceCount} references, and the ${sim.neighbours} most similar are the neighbours. Listed: cited by at least ${sim.minimum} of them, and not among the references. The choice of neighbours is a modelling choice.`, "");
    if (sim.warning) lines.push(`> [!warning] ${sim.warning}`, "");
    if (sim.heavySkipped.length > 0) lines.push(`Skipped (cited ${HEAVY_CITATIONS} times or more): ${sim.heavySkipped.map((h) => escapeMd(h.title)).join("; ")}.`, "");
    if (sim.unscanned > 0) lines.push(`> [!warning] The scan stopped before it read the citing works of ${sim.unscanned} references (the most cited ones).`, "");
    if (sim.rows.length > 0) {
      const both = new Set(sim.bothIds);
      lines.push("| Paper | Authors | Year | Cited | Cited by these similar papers | Both routes | Already have |", "| --- | --- | --- | --- | --- | --- | --- |");
      sim.rows.forEach((r, i) => {
        const p = r.paper;
        const url = doiUrl(p?.doi ?? null);
        const title = p ? (url ? `[${escapeMd(p.title)}](${url})` : escapeMd(p.title)) : r.gap.id;
        const f = n.similarFlags?.[i];
        lines.push(`| ${cell(title)} | ${cell(escapeMd(authorsShort(p?.authors ?? [])))} | ${p?.year ?? ""} | ${p?.citedByCount ?? ""} | ${r.gap.count} of ${sim.neighbours} | ${both.has(r.gap.id) ? "yes" : ""} | ${cell(f ? flagText(f, n.searchNames ?? new Map()) : "")} |`);
      });
      lines.push("");
    } else {
      lines.push("Nothing is cited by that many of the neighbours.", "");
    }
  }
  const deeper = run.deeper;
  if (deeper) {
    lines.push("## Deeper: what the shared works rest on", "", `Read ${deeper.hubsRead} works that several of the references cite (${deeper.hubsWithLists} with a reference list). Listed: cited by at least ${deeper.minCount} of them, and not the paper, its references or those shared works.`, "");
    if (deeper.gaps.length > 0) {
      lines.push("| Paper | Authors | Year | Cited | Cited by these shared works | Already have |", "| --- | --- | --- | --- | --- | --- |");
      deeper.gaps.forEach((g, i) => {
        const p = g.paper;
        const url = doiUrl(p?.doi ?? null);
        const title = p ? (url ? `[${escapeMd(p.title)}](${url})` : escapeMd(p.title)) : g.gap.id;
        const f = n.deeperFlags?.[i];
        lines.push(`| ${cell(title)} | ${cell(escapeMd(authorsShort(p?.authors ?? [])))} | ${p?.year ?? ""} | ${p?.citedByCount ?? ""} | ${g.gap.count} of ${deeper.hubsRead} | ${cell(f ? flagText(f, n.searchNames ?? new Map()) : "")} |`);
      });
      lines.push("");
    } else {
      lines.push("Nothing is cited by that many of them.", "");
    }
  }
  if (run.citedAuthors.length > 0 && run.gaps.length > 0) {
    const lists = (items: GapsRun["gaps"]): string[][] => items.flatMap((g) => (g.paper ? [g.paper.authors] : []));
    const own = run.subject?.authors ?? [];
    lines.push("## Authors: cited and not cited", "", "Each author's share of the paper's references and of the gaps, to see who is over- or under-represented. Open a table by clicking its title; every author is listed, and the note's search finds names inside.", "");
    lines.push(...authorTableCallout("First-level gaps", authorShares(run.citedAuthors, lists(run.gaps), { own })));
    if (run.deeper) {
      lines.push(...authorTableCallout("Second-level gaps", authorShares(run.citedAuthors, lists(run.deeper.gaps), { own })));
      lines.push(...authorTableCallout("Both", authorShares(run.citedAuthors, [...lists(run.gaps), ...lists(run.deeper.gaps)], { own })));
    }
  }
  if (n.audit) {
    lines.push("## Authors checked by an LLM", "");
    if (n.audit.summary) lines.push(escapeMd(n.audit.summary), "");
    lines.push("| Author | Claim | Verdict | Evidence | Caveats |", "| --- | --- | --- | --- | --- |");
    for (const a of n.audit.authors) {
      const evidence = a.evidence.map((e) => `[${cell(escapeMd(e.note || e.url))}](${e.url})`).join("; ");
      lines.push(`| ${cell(escapeMd(a.author))} | ${a.claim} | ${a.verdict} | ${evidence} | ${cell(escapeMd(a.caveats))} |`);
    }
    lines.push("");
  }
  lines.push("## How this was made", "", ...describeInput(n.input), `- **Run:** ${n.ranAt}. Minimum: cited by ${n.minCount} of the references.`);
  lines.push(`- **OpenAlex requests:** ${run.searches} title search${run.searches === 1 ? "" : "es"}, the rest lookups by id or DOI; about $${run.spentUsd.toFixed(4)}.`);
  if (sim) lines.push(`- **Similar papers:** scanned ${sim.requests} requests; similar = shares at least ${sim.minShared} references; ${sim.neighbours} neighbours; listed when ${sim.minimum} cite it.`);
  if (run.addedDois.length > 0) lines.push(`- **Added by hand:** ${run.addedDois.map((d) => `[${d}](https://doi.org/${d})`).join(", ")}`);
  if (run.unresolved.length > 0) lines.push("- **Not found in OpenAlex:**", ...run.unresolved.map((u) => `  - ${escapeMd(u)}`));
  lines.push("", "```" + GAPS_RECORD_BLOCK, JSON.stringify(buildGapsRecord(n.ranAt, n.input, n.minCount, run)), "```", "");
  return lines.join("\n");
}
