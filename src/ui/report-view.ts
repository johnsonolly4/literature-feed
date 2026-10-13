// The code block `literature-feed-report` in a report note: a small card with a button that opens the report's view (gaps, graph, …).
import { Notice } from "obsidian";
import { createReportBar } from "./report-bar";
import { parseReportBlock, type ReportKind } from "./report-block";

export function reportBlockProcessor(source: string, el: HTMLElement, kinds: ReadonlyMap<string, ReportKind>): void {
  const snap = parseReportBlock(source);
  if (snap === null) {
    el.createEl("p", { cls: "literature-feed-warning", text: "This report block is not valid." });
    return;
  }
  const kind = kinds.get(snap.kind);
  if (!kind) {
    el.createEl("p", { cls: "literature-feed-warning", text: `This note holds a ${snap.kind} report, which this version of the plugin cannot open.` });
    return;
  }
  createReportBar(el, [snap.summary ?? `A ${kind.label} report`], [{
    text: `Open in the ${kind.label}`, cta: true,
    onClick: () => { void kind.open(snap.data).then((ok) => { if (!ok) new Notice("The report in this note could not be read."); }); },
  }]);
}
