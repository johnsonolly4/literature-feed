// The integration step of Check setup: parts of this plugin that can be put into Lab Kit's standard notes, each only when the user
// chooses. Pure text work: a note's text goes in and comes out, with a preview of exactly what is added. An addition is found again
// (already added) and taken out without any marker comments: the two tiles are recognised by the link in their title
// (`obsidian://literature-feed-inbox?tile=<id>`), the Vault spec section by its heading. Lab Kit's own update merges edits to its
// notes line by line, so such an addition is kept as the user's edit.

export type IntegrationId = "home-tile" | "literature-tile" | "vault-spec";

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
    id: "home-tile", noteName: "00 Home", where: "at the end of the note",
    label: "Reading inbox tile on the Home note",
    description: "A Reading inbox tile (book icon, a title that opens the newest weekly note, papers to read with the first three titles, Scan now and Sync buttons) at the end of the Home note.",
  },
  {
    id: "literature-tile", noteName: "Literature", where: "before the first columns callout",
    label: "Reading inbox tile on the Literature hub",
    description: "The same tile above the hub's To process and Key papers lists.",
  },
  {
    id: "vault-spec", noteName: "Vault spec", where: "at the end of the note",
    label: "Reading inbox section in the Vault spec",
    description: "A short section that names the note kind reading-inbox, the folder the weekly notes live in, and how they differ from hand-made notes.",
  },
];

/** Things this step does not do, because they would mean editing Lab Kit's queries or structure. */
export const BY_HAND = [
  "Changing Lab Kit's Dataview queries (for example hiding the feed/ and found-by/ tags in Papers by Zotero tag).",
  "Adding a toggle to the weekly review checklist (it needs a property in that note as well).",
  "Moving the tile inside one of the Home note's columns.",
];

export interface IntegrationContext {
  /** The inbox folder setting ("" = the vault root). */
  inboxFolder: string;
}

/** The heading of the Vault spec section; it is how the section is found again. */
export const SPEC_HEADING = "## Reading inbox (Literature Feed)";

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
    case "vault-spec": {
      const folder = ctx.inboxFolder === "" ? "the vault root" : `\`${ctx.inboxFolder}/\``;
      return [
        SPEC_HEADING,
        `The Literature Feed plugin writes one note a week, named \`YYYY-Www Reading inbox\`, into ${folder}. Its properties have \`kind: reading-inbox\` and \`cssclasses\` including \`vt\`.`,
        "It is made and edited by the plugin (a table of the week's papers, ticked boxes, Sync to Zotero), not by hand: leave it where the plugin puts it, and do not file it with **Sort inbox**.",
        "Finished weeks move to the plugin's archive folder by themselves.",
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
  if (id === "vault-spec") return lines.findIndex((l) => l.trim() === SPEC_HEADING);
  return lines.findIndex((l) => l.startsWith(">") && l.includes(tileMarker(id)));
}

/** What adding one integration to a note would do. `text` is null when the note was not found. */
export function planIntegration(id: IntegrationId, text: string | null, ctx: IntegrationContext): IntegrationPlan {
  const added = block(id, ctx);
  if (text === null) return { id, state: "target-missing", added, anchor: "" };
  const { lines, eol } = split(text);
  if (startOf(lines, id) !== -1) return { id, state: "already-added", added, anchor: "", removable: true };
  // A reading-inbox card the user made by hand counts as already there, so a second one is not offered; it is not removed from here.
  if (id !== "vault-spec" && lines.some((l) => /^[>\s]*```literature-feed/.test(l))) return { id, state: "already-added", added, anchor: "", removable: false };

  if (id === "literature-tile") {
    const at = lines.findIndex((l) => /^>\s*\[!columns\]/.test(l));
    if (at === -1) return { id, state: "target-missing", added, anchor: "" };
    const next = [...lines.slice(0, at), ...added, "", ...lines.slice(at)].join("\n");
    return { id, state: "addable", next: next.replace(/\n/g, eol), added, anchor: `before: ${lines[at]}` };
  }
  // The others go at the end, after one empty line.
  const body = [...lines];
  while (body.length > 0 && body[body.length - 1].trim() === "") body.pop();
  const last = body.length > 0 ? body[body.length - 1] : "";
  const next = [...body, "", ...added, ""].join("\n");
  return { id, state: "addable", next: next.replace(/\n/g, eol), added, anchor: last === "" ? "at the start of the note" : `after: ${last}` };
}

/**
 * The note without the addition (and the empty line that went with it); the text unchanged when it is not there. A tile is the
 * title line and the quoted lines that follow it; the Vault spec section runs from its heading to the next heading or the end.
 */
export function removeIntegration(id: IntegrationId, text: string): string {
  const { lines, eol } = split(text);
  const from = startOf(lines, id);
  if (from === -1) return text;
  let to = from + 1; // exclusive end of the block
  if (id === "vault-spec") {
    while (to < lines.length && !/^#{1,6}\s/.test(lines[to])) to++;
    while (to > from + 1 && lines[to - 1].trim() === "") to--; // keep the empty lines that belong to what follows
  } else {
    while (to < lines.length && lines[to].startsWith(">")) to++;
  }
  const out = [...lines.slice(0, from), ...lines.slice(to)];
  // Drop one blank line left behind: before the block when it ended the note, after it otherwise.
  if (from > 0 && out[from - 1]?.trim() === "" && (from >= out.length || out[from]?.trim() === "")) out.splice(from - 1, 1);
  else if (out[from]?.trim() === "" && from > 0) out.splice(from, 1);
  return out.join("\n").replace(/\n/g, eol);
}
