// The integration step of Check setup: parts of this plugin that can be put into Lab Kit's standard notes, each only when the user
// chooses. Pure text work: a note's text goes in and comes out, with a preview of exactly what is added. An addition is found again
// (already added) and taken out without any marker comments: the two tiles are recognised by the link in their title
// (`obsidian://literature-feed-inbox?tile=<id>`), the addition to "How my vault works" by the words "added by the Literature Feed
// plugin" in its title. Lab Kit's own update merges edits to its notes line by line, so such an addition is kept as the user's edit,
// and when an update does replace a note, Check setup offers the addition again.

export type IntegrationId = "home-tile" | "literature-tile" | "how-vault-works";

export interface IntegrationInfo {
  id: IntegrationId;
  label: string;
  description: string;
  /** The name of the note it goes into (no folder, no extension). */
  noteName: string;
  /** Where in the note, in words. */
  where: string;
}

export const INTEGRATIONS: IntegrationInfo[] = [
  {
    id: "home-tile", noteName: "00 Home", where: "as the last tile of the columns",
    label: "Reading inbox tile on the Home note",
    description: "A Reading inbox tile (book icon, a title that opens the newest weekly note, papers to read with the first three titles, Scan now and Sync buttons) as the last tile of the Home note's columns, or at the end of the note when it has no columns.",
  },
  {
    id: "literature-tile", noteName: "Literature", where: "before the first columns callout",
    label: "Reading inbox tile on the Literature hub",
    description: "The same tile above the hub's To process and Key papers lists.",
  },
  {
    id: "how-vault-works", noteName: "How my vault works", where: "at the end of the Reading papers section",
    label: "Reading inbox steps in How my vault works",
    description: "A short callout, marked as an addition from the Literature Feed plugin, that says how the weekly reading inbox leads into the reading steps. It sits at the end of the Reading papers section, before the next heading.",
  },
];

/** Things this step does not do, because they would mean editing Lab Kit's queries or structure. */
export const BY_HAND = [
  "Changing Lab Kit's Dataview queries (for example hiding the feed/ and found-by/ tags in Papers by Zotero tag).",
  "Adding a toggle to the weekly review checklist (it needs a property in that note as well).",
  "Editing the Vault spec (the kit's own reference note).",
];

export interface IntegrationContext {
  /** The inbox folder setting ("" = the vault root). */
  inboxFolder: string;
}

/** Words in the title of the "How my vault works" addition; they are how it is found again. */
export const ADDED_BY = "(added by the Literature Feed plugin)";

/** The link in a tile's title: it opens the newest weekly note (the plugin handles this address); `tile` says which tile it is. */
function titleLink(id: IntegrationId): string {
  return `[Reading inbox](obsidian://literature-feed-inbox?tile=${id})`;
}

function tileMarker(id: IntegrationId): string {
  return `obsidian://literature-feed-inbox?tile=${id}`;
}

function block(id: IntegrationId, ctx: IntegrationContext): string[] {
  switch (id) {
    case "home-tile":
      return [`> [!reading-inbox] ${titleLink(id)}`, "> ```literature-feed", "> show: home", "> limit: 3", "> ```"];
    case "literature-tile":
      return [`> [!reading-inbox] ${titleLink(id)}`, "> ```literature-feed", "> show: home", "> limit: 5", "> ```"];
    case "how-vault-works": {
      const folder = ctx.inboxFolder === "" ? "the vault root" : `\`${ctx.inboxFolder}/\``;
      return [
        `> [!reading-inbox] Reading inbox ${ADDED_BY}`,
        `> Once a week the Literature Feed plugin lists the papers your saved searches found in a **Reading inbox** note (in ${folder}), ahead of step 1 below.`,
        "> - Open it from the **Reading inbox** tile on the homepage or the [[Literature]] page, or with the book icon in the ribbon.",
        "> - **Tick** the papers you want and press **Sync**: they are added to Zotero. Dismiss the ones you do not want with the red ✕.",
        "> - Then carry on with step 1. The inbox labels a paper **Read** once its literature note exists, and **Processed** once its takeaway is written.",
        "> - Added by **Check setup** in the Literature Feed settings. If a kit update replaces this note, run **Check setup** again to put it back.",
      ];
    }
  }
}

export interface IntegrationPlan {
  id: IntegrationId;
  /** addable: not there yet and the place was found; already-added: it is in the note; target-missing: no note or no place. */
  state: "addable" | "already-added" | "target-missing";
  /** The note's text with the block added (only when addable). */
  next?: string;
  /** The lines that would be added, and the line they go before or after, for the preview. */
  added: string[];
  anchor: string;
  /** For already-added: it was added here (so Remove can take it out), not made by hand. */
  removable?: boolean;
}

function split(text: string): { lines: string[]; eol: string } {
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  return { lines: text.replace(/\r\n/g, "\n").split("\n"), eol };
}

/** Index of the line that starts the integration in the note, or -1. */
function startOf(lines: readonly string[], id: IntegrationId): number {
  if (id === "how-vault-works") return lines.findIndex((l) => l.startsWith(">") && l.includes(ADDED_BY));
  return lines.findIndex((l) => l.startsWith(">") && l.includes(tileMarker(id)));
}

/** What adding one integration to a note would do. `text` is null when the note was not found. */
export function planIntegration(id: IntegrationId, text: string | null, ctx: IntegrationContext): IntegrationPlan {
  const added = block(id, ctx);
  if (text === null) return { id, state: "target-missing", added, anchor: "" };
  const { lines, eol } = split(text);
  if (startOf(lines, id) !== -1) return { id, state: "already-added", added, anchor: "", removable: true };
  // A reading-inbox card the user made by hand counts as already there, so a second one is not offered; it is not removed from here.
  if (id !== "how-vault-works" && lines.some((l) => /^[>\s]*```literature-feed/.test(l))) return { id, state: "already-added", added, anchor: "", removable: false };

  if (id === "literature-tile") {
    const at = lines.findIndex((l) => /^>\s*\[!columns\]/.test(l));
    if (at === -1) return { id, state: "target-missing", added, anchor: "" };
    const next = [...lines.slice(0, at), ...added, "", ...lines.slice(at)].join("\n");
    return { id, state: "addable", next: next.replace(/\n/g, eol), added, anchor: `before: ${lines[at]}` };
  }
  if (id === "how-vault-works") {
    // At the end of the "Reading papers" section: before the next heading of the same or a higher level.
    const heading = lines.findIndex((l) => /^##\s+Reading papers\s*$/.test(l));
    if (heading !== -1) {
      let at = heading + 1;
      while (at < lines.length && !/^#{1,2}\s/.test(lines[at])) at++;
      if (at < lines.length) {
        const next = [...lines.slice(0, at), ...added, "", ...lines.slice(at)].join("\n");
        return { id, state: "addable", next: next.replace(/\n/g, eol), added, anchor: `before: ${lines[at]}` };
      }
    }
  }
  if (id === "home-tile") {
    // Inside the Home note's columns callout, as its last tile: after the callout's last quoted line, a separator, then the tile one level deeper.
    const columns = lines.findIndex((l) => /^>\s*\[!columns\]/.test(l));
    if (columns !== -1) {
      let end = columns + 1;
      while (end < lines.length && lines[end].startsWith(">")) end++;
      const nested = added.map((l) => `> ${l}`);
      const next = [...lines.slice(0, end), ">", ...nested, ...lines.slice(end)].join("\n");
      return { id, state: "addable", next: next.replace(/\n/g, eol), added: nested, anchor: `after the last tile in the columns: ${lines[end - 1]}` };
    }
  }
  // Otherwise at the end, after one empty line.
  const body = [...lines];
  while (body.length > 0 && body[body.length - 1].trim() === "") body.pop();
  const last = body.length > 0 ? body[body.length - 1] : "";
  const next = [...body, "", ...added, ""].join("\n");
  return { id, state: "addable", next: next.replace(/\n/g, eol), added, anchor: last === "" ? "at the start of the note" : `after: ${last}` };
}

/**
 * The note without the addition (and the empty line that went with it); the text unchanged when it is not there. An addition is
 * its title line and the lines after it that are quoted at least as deep (inside the columns callout that stops at its separator).
 */
export function removeIntegration(id: IntegrationId, text: string): string {
  const { lines, eol } = split(text);
  const from = startOf(lines, id);
  if (from === -1) return text;
  let to = from + 1; // exclusive end of the block
  const depth = (lines[from].match(/^(?:>\s?)+/)?.[0] ?? ">").trimEnd();
  const nested = depth.length > 1;
  while (to < lines.length && lines[to].startsWith(depth)) to++;
  const out = [...lines.slice(0, from), ...lines.slice(to)];
  if (nested) {
    // The separator that came with the tile goes too.
    if (out[from - 1]?.trim() === ">") out.splice(from - 1, 1);
    return out.join("\n").replace(/\n/g, eol);
  }
  // Drop one blank line left behind: before the block when it ended the note, after it otherwise.
  if (from > 0 && out[from - 1]?.trim() === "" && (from >= out.length || out[from]?.trim() === "")) out.splice(from - 1, 1);
  else if (out[from]?.trim() === "" && from > 0) out.splice(from, 1);
  return out.join("\n").replace(/\n/g, eol);
}
