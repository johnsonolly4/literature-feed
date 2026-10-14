// Putting a list of titles into the reference tidy-up (Find DOIs) from elsewhere, for example the seed papers that have no DOI.
// Pure; the plugin decides whether to ask first and opens the tab.
import { emptyRefsSession, type RefsSession } from "./panel";

/** Titles as a numbered list, which the splitter reads back as one reference each. */
export function referenceTextFromTitles(titles: readonly string[]): string {
  return titles.map((t) => t.replace(/\s+/g, " ").trim()).filter((t) => t !== "").map((t, i) => `${i + 1}. ${t}`).join("\n");
}

/** The session with the titles as its text and no results; `replaces` is true when the open list had text that would be lost. */
export function prefillSession(current: RefsSession | null, titles: readonly string[]): { session: RefsSession; replaces: boolean } {
  const text = referenceTextFromTitles(titles);
  const replaces = (current?.text.trim() ?? "") !== "" && current?.text.trim() !== text;
  return { session: { ...emptyRefsSession(), text }, replaces };
}
