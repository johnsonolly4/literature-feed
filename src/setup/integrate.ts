// The integration step of Check setup: parts of this plugin that can be put into Lab Kit's standard notes, each only when the user
// chooses. Pure text work: a note's text goes in and comes out, with a preview of exactly what is added. Every addition sits between
// two marker comments, so it can be found again (already added) and taken out cleanly. Lab Kit's own update merges edits to its
// notes line by line, so a block like this is kept as the user's edit.

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
    label: "Reading inbox card on the Home note",
    description: "The summary card (papers to read, the first three titles, Scan now and Sync buttons) as a block at the end of the Home note.",
  },
  {
    id: "literature-tile", noteName: "Literature", where: "before the first columns callout",
    label: "Reading inbox card on the Literature hub",
    description: "The same card, in a callout, above the hub's To process and Key papers lists.",
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
  "Moving the card inside one of the Home note's columns.",
];

export const startMarker = (id: IntegrationId): string => `%%literature-feed:${id}%%`;
export const endMarker = (id: IntegrationId): string => `%%/literature-feed:${id}%%`;

export interface IntegrationContext {
  /** The inbox folder setting ("" = the vault root). */
  inboxFolder: string;
}

function block(id: IntegrationId, ctx: IntegrationContext): string[] {
  switch (id) {
    case "home-tile":
      return [startMarker(id), "```literature-feed", "show: home", "limit: 3", "```", endMarker(id)];
    case "literature-tile":
      return [startMarker(id), "> [!focus] Reading inbox", "> ```literature-feed", "> show: home", "> limit: 5", "> ```", endMarker(id)];
    case "vault-spec": {
      const folder = ctx.inboxFolder === "" ? "the vault root" : `\`${ctx.inboxFolder}/\``;
      return [
        startMarker(id),
        "## Reading inbox (Literature Feed)",
        `The Literature Feed plugin writes one note a week, named \`YYYY-Www Reading inbox\`, into ${folder}. Its properties have \`kind: reading-inbox\` and \`cssclasses\` including \`vt\`.`,
        "It is made and edited by the plugin (a table of the week's papers, ticked boxes, Sync to Zotero), not by hand: leave it where the plugin puts it, and do not file it with **Sort inbox**.",
        "Finished weeks move to the plugin's archive folder by themselves.",
        endMarker(id),
      ];
    }
  }
}

export interface IntegrationPlan {
  id: IntegrationId;
  /** addable: not there yet and the place was found; already-added: the markers are in the note; target-missing: no note or no place. */
  state: "addable" | "already-added" | "target-missing";
  /** The note's text with the block added (only when addable). */
  next?: string;
  /** The lines that would be added, and the line they go before or after, for the preview. */
  added: string[];
  anchor: string;
}

function split(text: string): { lines: string[]; eol: string } {
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  return { lines: text.replace(/\r\n/g, "\n").split("\n"), eol };
}

const hasBlock = (lines: readonly string[], id: IntegrationId): boolean => lines.some((l) => l.trim() === startMarker(id));

/** What adding one integration to a note would do. `text` is null when the note was not found. */
export function planIntegration(id: IntegrationId, text: string | null, ctx: IntegrationContext): IntegrationPlan {
  const added = block(id, ctx);
  if (text === null) return { id, state: "target-missing", added, anchor: "" };
  const { lines, eol } = split(text);
  if (hasBlock(lines, id)) return { id, state: "already-added", added, anchor: "" };

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

/** The note without the block (and the empty line that went with it); the text unchanged when the block is not there. */
export function removeIntegration(id: IntegrationId, text: string): string {
  const { lines, eol } = split(text);
  const from = lines.findIndex((l) => l.trim() === startMarker(id));
  const to = lines.findIndex((l, i) => i > from && l.trim() === endMarker(id));
  if (from === -1 || to === -1) return text;
  const out = [...lines.slice(0, from), ...lines.slice(to + 1)];
  // Drop one blank line left behind: before the block when it ended the note, after it otherwise.
  if (from > 0 && out[from - 1]?.trim() === "" && (from >= out.length || out[from]?.trim() === "")) out.splice(from - 1, 1);
  else if (out[from]?.trim() === "" && from > 0) out.splice(from, 1);
  const joined = out.join("\n");
  return joined.replace(/\n/g, eol);
}
