// Who wrote what the paper cites and what it does not: for every author, the share of the cited works and the share of the uncited
// works (the gaps) that they appear on, so an author who is common among the uncited works and rare among the cited ones (or the other
// way round, such as the paper's own authors) stands out. Pure.
export interface AuthorRow {
  /** Family name and first initial, lower case. */
  key: string;
  /** The way the name is most often written. */
  name: string;
  /** Works (cited, uncited) the author is on. */
  cited: number;
  uncited: number;
  /** Those as a percent of the cited and the uncited works that have an author list. */
  citedPct: number;
  uncitedPct: number;
  /** Uncited share minus cited share, in percentage points: positive = under-cited by this paper. */
  diff: number;
  label: "Under-cited" | "Over-cited" | "";
  /** The author is one of the paper's own authors. */
  own: boolean;
}

export interface AuthorTable {
  rows: AuthorRow[];
  /** Works with an author list, on each side: the totals the percentages are of. */
  citedWorks: number;
  uncitedWorks: number;
}

export interface AuthorOptions {
  /** Authors with fewer works than this in all (cited and uncited together) are left out (default 2). */
  min?: number;
  /** The paper's own authors, to mark them. */
  own?: readonly string[];
  /** Percentage points of difference that earn a label (default 5). */
  threshold?: number;
}

/** The name as "family|initial": accents and punctuation dropped, "Hawker, C. J." and "Craig J. Hawker" alike. */
export function authorKey(name: string): string {
  const plain = name.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().trim();
  if (plain === "") return "";
  let family: string;
  let given: string;
  if (plain.includes(",")) {
    const [f, ...rest] = plain.split(",");
    family = f;
    given = rest.join(" ");
  } else {
    const parts = plain.split(/[\s.]+/).filter((p) => p !== "");
    family = parts[parts.length - 1] ?? "";
    given = parts.slice(0, -1).join(" ");
  }
  const fam = family.replace(/[^a-z0-9]/g, "");
  const initial = given.replace(/[^a-z]/g, "").charAt(0);
  return fam === "" ? "" : `${fam}|${initial}`;
}

/** Each author once per work, as keys (a work listing a name twice counts once). */
function keysOf(authors: readonly string[]): Set<string> {
  return new Set(authors.map(authorKey).filter((k) => k !== ""));
}

/**
 * The comparison. `cited` and `uncited` are the author lists of the works on each side. Works with no author list are left out of the
 * totals. Sorted by the size of the difference, then by how many works the author is on.
 */
export function authorShares(cited: readonly (readonly string[])[], uncited: readonly (readonly string[])[], opts: AuthorOptions = {}): AuthorTable {
  const min = opts.min ?? 2;
  const threshold = opts.threshold ?? 5;
  const own = new Set((opts.own ?? []).map(authorKey).filter((k) => k !== ""));
  const withList = (lists: readonly (readonly string[])[]): (readonly string[])[] => lists.filter((l) => keysOf(l).size > 0);
  const c = withList(cited);
  const u = withList(uncited);
  const spelling = new Map<string, Map<string, number>>();
  const note = (list: readonly string[]): void => {
    for (const name of list) {
      const k = authorKey(name);
      if (k === "") continue;
      const m = spelling.get(k) ?? new Map<string, number>();
      m.set(name.trim(), (m.get(name.trim()) ?? 0) + 1);
      spelling.set(k, m);
    }
  };
  const count = (lists: readonly (readonly string[])[]): Map<string, number> => {
    const out = new Map<string, number>();
    for (const l of lists) {
      note(l);
      for (const k of keysOf(l)) out.set(k, (out.get(k) ?? 0) + 1);
    }
    return out;
  };
  const cc = count(c);
  const uc = count(u);
  const rows: AuthorRow[] = [];
  for (const key of new Set([...cc.keys(), ...uc.keys()])) {
    const nc = cc.get(key) ?? 0;
    const nu = uc.get(key) ?? 0;
    if (nc + nu < min) continue;
    const citedPct = c.length === 0 ? 0 : (nc / c.length) * 100;
    const uncitedPct = u.length === 0 ? 0 : (nu / u.length) * 100;
    const diff = uncitedPct - citedPct;
    const label = nc + nu >= 3 && diff >= threshold ? "Under-cited" : nc + nu >= 3 && diff <= -threshold ? "Over-cited" : "";
    const names = [...(spelling.get(key) ?? new Map<string, number>())].sort((a, b) => b[1] - a[1] || b[0].length - a[0].length || a[0].localeCompare(b[0]));
    rows.push({ key, name: names[0]?.[0] ?? key, cited: nc, uncited: nu, citedPct, uncitedPct, diff, label, own: own.has(key) });
  }
  rows.sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff) || b.cited + b.uncited - (a.cited + a.uncited) || a.name.localeCompare(b.name));
  return { rows, citedWorks: c.length, uncitedWorks: u.length };
}

const pct = (n: number): string => `${n.toFixed(n > 0 && n < 10 ? 1 : 0)}%`;

/** The table as Markdown for a note (the first `top` rows). */
export function authorTableMarkdown(table: AuthorTable, top = 25): string[] {
  if (table.rows.length === 0) return ["No author appears on enough works to compare.", ""];
  const lines = [
    `Shares are of the ${table.citedWorks} cited works and the ${table.uncitedWorks} uncited works (the gaps) that have an author list. Authors are matched by family name and first initial, so two people who share both are counted as one.`, "",
    "| Author | Cited works | % of cited | Uncited works | % of uncited | Difference | |", "| --- | --- | --- | --- | --- | --- | --- |",
  ];
  for (const r of table.rows.slice(0, top)) {
    lines.push(`| ${r.own ? "★ " : ""}${r.name.replace(/\|/g, " ")} | ${r.cited} | ${pct(r.citedPct)} | ${r.uncited} | ${pct(r.uncitedPct)} | ${r.diff >= 0 ? "+" : "−"}${Math.abs(r.diff).toFixed(0)} points | ${r.label} |`);
  }
  lines.push("");
  return lines;
}

/** The table as CSV. */
export function authorTableCsv(table: AuthorTable): string {
  const cell = (s: string | number): string => (/[",\n]/.test(String(s)) ? `"${String(s).replace(/"/g, '""')}"` : String(s));
  const lines = ["author,own_author,cited_works,cited_percent,uncited_works,uncited_percent,difference_points,label"];
  for (const r of table.rows) lines.push([r.name, r.own ? "yes" : "", r.cited, r.citedPct.toFixed(1), r.uncited, r.uncitedPct.toFixed(1), r.diff.toFixed(1), r.label].map(cell).join(","));
  return lines.join("\n");
}
