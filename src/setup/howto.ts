// The stand-alone how-to note Check setup can make when Lab Kit is not there: how the weekly reading inbox works, in one page.
// Pure: the text only; the window creates the note when the user presses the button.
import type { IntegrationContext } from "./integrate";

/** The note's name (and file name without ".md"). */
export const HOWTO_NAME = "Reading inbox how-to";

export function howtoText(ctx: IntegrationContext): string {
  const folder = ctx.inboxFolder === "" ? "the vault root" : `\`${ctx.inboxFolder}/\``;
  return [
    "---",
    "kind: guide",
    "---",
    "",
    "> [!info] Made by the Literature Feed plugin (Check setup)",
    "> Edit or delete this note freely: the plugin does not read it.",
    "",
    "## Each week",
    `1. Once a week the plugin scans your saved searches and lists the new papers in a note named \`YYYY-Www Reading inbox\` in ${folder}. Open the newest one with the book icon in the ribbon or the command **Open reading inbox**.`,
    "2. At the top are one card per search (papers to read, counts, a bar of what you did with them); below is a table of the papers. **Show in table** on a card filters the table to that search.",
    "3. **Tick** the papers you want. **Sync N to Zotero** (above the table) adds the ticked papers to your Zotero library, in the search's inbox collection.",
    "4. Dismiss a paper you do not want with the red ✕: **Not relevant**, or **Can't get it** if you cannot get hold of it. This works at any stage, also after a paper is in Zotero; the ↩ undoes it.",
    "",
    "## What the labels mean",
    "- **New**: not ticked yet. **Ticked**: ticked and waiting to be sent. **In Zotero**: sent, waiting to be read.",
    "- **Read**: a literature note for the paper exists (made by ZotLit from Zotero). **Processed**: its takeaway line is written.",
    "- **Dismissed**: you rejected it. Papers you leave alone age out by themselves after a few weeks.",
    "",
    "## Improving a search",
    "- **Show search effectiveness** shows, per search, how many papers you wanted by tier, topic and month, which terms do well or badly, and how the searches overlap.",
    "- Under Settings → Literature Feed → LLM prompts, three commands copy a prompt for a chat LLM (review a search, tweak its search terms, write a new search, compare searches). You paste the answer back and accept or reject each suggestion. Nothing is sent by the plugin.",
    "",
  ].join("\n");
}
