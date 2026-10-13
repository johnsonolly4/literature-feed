// The way a report note can be turned back into its interactive view: the note holds a compact snapshot in a
// ```literature-feed-report code block ({kind, version, data}), the plugin draws it as a button, and a command, the ribbon menu and the
// button open the view from it. Each search registers a kind (gaps, graph, …). Pure: no Obsidian.
export const REPORT_BLOCK = "literature-feed-report";

export interface ReportSnapshot {
  kind: string;
  version: 1;
  data: unknown;
  /** One line for the button's card ("Made 2026-10-13: 12 works, 40 authors"). */
  summary?: string;
}

/** The snapshot as a code block for a note. */
export function reportBlock(kind: string, data: unknown, summary?: string): string[] {
  const snap: ReportSnapshot = { kind, version: 1, data, ...(summary ? { summary } : {}) };
  return ["```" + REPORT_BLOCK, JSON.stringify(snap), "```"];
}

/** A snapshot from the text of a code block; null when it is not one. */
export function parseReportBlock(source: string): ReportSnapshot | null {
  try {
    const raw = JSON.parse(source) as Partial<ReportSnapshot> | null;
    if (raw && typeof raw === "object" && typeof raw.kind === "string" && raw.version === 1 && raw.data !== undefined) {
      return { kind: raw.kind, version: 1, data: raw.data, ...(typeof raw.summary === "string" ? { summary: raw.summary } : {}) };
    }
  } catch {
    // Not a report block.
  }
  return null;
}

/** Every snapshot in a note's text, in order (a note may hold more than one kind). */
export function reportsInNote(text: string): ReportSnapshot[] {
  const out: ReportSnapshot[] = [];
  for (const m of text.matchAll(new RegExp("```" + REPORT_BLOCK + "\\s*\\r?\\n([\\s\\S]*?)\\r?\\n```", "g"))) {
    const snap = parseReportBlock(m[1]);
    if (snap) out.push(snap);
  }
  return out;
}

/** What a search registers so its reports can be reopened. */
export interface ReportKind {
  /** The view's name in the button ("gaps view"). */
  label: string;
  /** Opens the view from the snapshot's data; false when the data is not usable. */
  open(data: unknown): Promise<boolean>;
}
