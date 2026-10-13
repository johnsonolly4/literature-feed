// Turning text copied from a paper's reference list into one reference per entry, and reading the parts of an entry (first author, year,
// volume, pages) that are used to check a Crossref match. Pure. Copied references come with uneven line breaks, words broken across
// lines, page headers in the middle, and often no numbering; this tidies all of that. A port of `check_refs.py` with the unnumbered
// cases added.

export interface RawReference {
  n: number;
  text: string;
}

export interface ParsedReference {
  /** The reference without its list number. */
  body: string;
  firstAuthor: string;
  year: number | null;
  volume: string;
  issue: string;
  pages: string;
  /** A repository or web page: no Crossref DOI is expected. */
  software: boolean;
}

const LIGATURES: Record<string, string> = {
  "\ufb01": "fi", "\ufb02": "fl", "\ufb00": "ff", "\ufb03": "ffi", "\ufb04": "ffl", "\ufb05": "st", "\ufb06": "st",
};

/** Ligatures, soft hyphens, odd spaces and zero-width characters made plain. */
export function cleanText(text: string): string {
  return text
    .replace(/[ﬀ-ﬆ]/g, (c) => LIGATURES[c] ?? c)
    .replace(/\u00ad|\u200b|\u200c|\u200d|\ufeff/g, "")
    .replace(/\u00a0|\u2007|\u2009|\u202f/g, " ")
    .replace(/\r\n?/g, "\n");
}

const PAGE_HEADER = /^.{0,80}\bPage \d+ of \d+\b.{0,80}$/i;
const HEADING = /^\s*(?:references|bibliography|literature cited|works cited|reference list)\s*:?\s*$/i;
const NUMBERED = /^\s*(?:\[(\d{1,3})\]|\((\d{1,3})\)|(\d{1,3})[.)])\s+\S/;
const YEAR = /\b(?:19|20)\d{2}[a-z]?\b/;
/** "Smith, J." / "Smith, John" */
const SURNAME_FIRST = /^[\p{Lu}][\p{L}'’-]+(?:\s[\p{Lu}][\p{L}'’-]+)?,\s*(?:[\p{Lu}]\.|[\p{Lu}][\p{L}]+)/u;
/** "J. A. Smith," / "J. Smith and" */
const INITIALS_FIRST = /^(?:[\p{Lu}]\.\s*){1,3}[\p{Lu}][\p{L}'’-]+(?:,|\s+and\b|\s+&|;)/u;
/** "Smith JA," (Vancouver) */
const VANCOUVER = /^[\p{Lu}][\p{L}'’-]+\s+[\p{Lu}]{1,3}[,;]/u;

function startsLikeAuthor(line: string): boolean {
  const t = line.trim();
  return SURNAME_FIRST.test(t) || INITIALS_FIRST.test(t) || VANCOUVER.test(t);
}

/** Whether the text so far looks like a whole reference: it has a year and does not end part-way (a comma, a hyphen, an open bracket). */
function looksComplete(text: string): boolean {
  const t = text.trim();
  return YEAR.test(t) && /[.\d)\]]$/.test(t) && !/[,;:([\-–]$/.test(t);
}

/** Lines of one reference joined: a word broken at the end of a line is mended, page ranges broken by a space are closed up. */
function join(parts: readonly string[]): string {
  let out = "";
  for (const raw of parts) {
    const line = raw.trim();
    if (line === "") continue;
    if (out === "") out = line;
    else if (/[\p{L}]-$/u.test(out) && /^[\p{Ll}]/u.test(line)) out += line;
    else out += ` ${line}`;
  }
  return out
    .replace(/(\d)\s*[-–]\s+(\d)/g, "$1-$2")
    .replace(/(\d)\s+[-–]\s*(\d)/g, "$1-$2")
    .replace(/\s+/g, " ")
    .trim();
}

/** The list split into references, numbered 1, 2, … in order. */
export function splitReferences(raw: string): RawReference[] {
  const lines = cleanText(raw).split("\n").filter((l) => !PAGE_HEADER.test(l) || NUMBERED.test(l)).filter((l) => !HEADING.test(l));

  // Numbered lists first: a number starts a reference when it is the next one in the sequence.
  const numbered: string[][] = [];
  let current: string[] | null = null;
  for (const line of lines) {
    const m = NUMBERED.exec(line);
    const n = m ? Number(m[1] ?? m[2] ?? m[3]) : NaN;
    if (m && n === numbered.length + 1) {
      current = [line.replace(/^\s*(?:\[\d{1,3}\]|\(\d{1,3}\)|\d{1,3}[.)])\s+/, "")];
      numbered.push(current);
    } else if (current !== null && line.trim() !== "") {
      current.push(line);
    }
  }
  if (numbered.length >= 2) return numbered.map((parts, i) => ({ n: i + 1, text: join(parts) })).filter((r) => r.text !== "");

  // No numbering: a reference ends when the next line starts like an author list (or after a blank line) and the text so far looks whole.
  const out: string[][] = [];
  let acc: string[] = [];
  let blankBefore = false;
  for (const line of lines) {
    if (line.trim() === "") {
      blankBefore = true;
      continue;
    }
    const soFar = join(acc);
    if (acc.length > 0 && looksComplete(soFar) && (startsLikeAuthor(line) || blankBefore)) {
      out.push(acc);
      acc = [];
    }
    acc.push(line);
    blankBefore = false;
  }
  if (acc.length > 0) out.push(acc);
  return out.map((parts, i) => ({ n: i + 1, text: join(parts) })).filter((r) => r.text !== "");
}

/** The DOI inside a reference, bare and lower case, or "". */
export function doiInText(text: string): string {
  const m = /\b10\.\d{4,9}\/[^\s"<>]+/i.exec(text);
  return m ? m[0].replace(/[.,;:)\]}>'"]+$/, "").toLowerCase() : "";
}

/** The parts of a reference that are checked against a Crossref record. */
export function parseReference(text: string): ParsedReference {
  const body = text.replace(/^\s*(?:\[\d+\]|\(\d+\)|\d+[.)])\s+/, "").trim();
  const info: ParsedReference = { body, firstAuthor: "", year: null, volume: "", issue: "", pages: "", software: false };
  const first = /^([^,;]+)/.exec(body);
  if (first) info.firstAuthor = first[1].trim();
  if (/github\.com|gitlab\.com|zenodo\.org|\bsoftware\b.*\bv?\d+\.\d+/i.test(body)) info.software = true;

  // The year follows a space or a bracket (so the end of a page range such as "-2043." is not taken for it).
  const years = [...body.matchAll(/(?:(?<=\s)|(?<=\())((?:19|20)\d{2})(?=[,;.)])/g)];
  if (years.length > 0) {
    const y = years[years.length - 1];
    info.year = Number(y[1]);
    const rest = body.slice((y.index ?? 0) + y[0].length).replace(/^[\s,;.)]+/, "").trim();
    if (/^pp/i.test(rest)) {
      info.pages = rest.slice(2).replace(/^[\s.]+|[\s.]+$/g, "");
    } else {
      const r = /^(?<vol>[A-Za-z0-9]+)\s*(?:\((?<issue>[^)]*)\))?\s*(?:,\s*(?<pages>[^,]+?))?\s*\.?$/.exec(rest);
      if (r?.groups) {
        info.volume = r.groups.vol ?? "";
        info.issue = r.groups.issue ?? "";
        info.pages = (r.groups.pages ?? "").replace(/^[\s.]+|[\s.]+$/g, "");
      }
    }
  }
  if (info.volume === "") {
    // "Journal, 145(3), 22728-22734." (author-year styles put the volume after the title)
    const tail = /,\s*(\d{1,4})(?:\((\d+[^)]*)\))?,\s*([A-Za-z]?\d[\w–-]*)\.?$/.exec(body);
    if (tail) {
      info.volume = tail[1];
      info.issue = tail[2] ?? "";
      if (info.pages === "") info.pages = tail[3];
    }
  }
  return info;
}
