// The plugin's commands and the ribbon menu as data, grouped by what the owner is doing: Watch what is new, Discover what was
// missed on a subject, Expand what some papers rest on or miss, Improve a search, and the utilities. Pure: main.ts registers
// the commands from COMMANDS and draws the menu from buildMenu.

export type Group = "watch" | "discover" | "expand" | "improve" | "tools";

export const GROUPS: readonly { id: Group; label: string }[] = [
  { id: "watch", label: "Watch" },
  { id: "discover", label: "Discover" },
  { id: "expand", label: "Expand" },
  { id: "improve", label: "Improve" },
  { id: "tools", label: "Tools" },
];

export interface CommandSpec {
  id: string;
  group: Group;
  /** The name without its group. */
  title: string;
}

/** Every command the plugin registers, each under exactly one group. */
export const COMMANDS: readonly CommandSpec[] = [
  { id: "open-inbox", group: "watch", title: "Open reading inbox" },
  { id: "scan-now", group: "watch", title: "Scan now" },
  { id: "sync-ticked", group: "watch", title: "Sync ticked papers" },
  { id: "update-read-archive", group: "watch", title: "Update read state and archive" },
  { id: "literature-review", group: "discover", title: "Generate literature review" },
  { id: "resume-review", group: "discover", title: "Resume the last literature review" },
  { id: "repeat-review", group: "discover", title: "Repeat the review in this note" },
  { id: "citation-gaps", group: "expand", title: "Citation gaps of one paper" },
  { id: "search-effectiveness", group: "improve", title: "Show search effectiveness" },
  { id: "llm-review", group: "improve", title: "Review a search with an LLM" },
  { id: "llm-topics", group: "improve", title: "Tweak search terms with an LLM" },
  { id: "llm-compare", group: "improve", title: "Compare searches with an LLM" },
  { id: "llm-new-search", group: "improve", title: "New search from a description with an LLM" },
  { id: "find-dois", group: "tools", title: "Find DOIs for a reference list" },
  { id: "check-setup", group: "tools", title: "Check setup" },
  { id: "show-zotero-collections", group: "tools", title: "Show Zotero collections" },
  { id: "open-note-report", group: "tools", title: "Open this note's report view" },
];

/** The name shown in the command palette: the group, then the command. */
export function commandName(spec: CommandSpec): string {
  const group = GROUPS.find((g) => g.id === spec.group);
  return `${group?.label ?? spec.group}: ${spec.title}`;
}

/** The command's entry by id (throws on an id that is not listed, so a typo fails at load). */
export function commandSpec(id: string): CommandSpec {
  const spec = COMMANDS.find((c) => c.id === id);
  if (!spec) throw new Error(`Unknown command: ${id}`);
  return spec;
}

export type MenuAction =
  | "open-inbox" | "scan-now"
  | "review-new" | "review-resume" | "open-graph"
  | "gaps" | "gaps-last"
  | "improve"
  | "find-dois" | "check-setup";

export interface MenuEntry {
  action: MenuAction;
  title: string;
  icon: string;
}

export interface MenuSection {
  group: Group;
  label: string;
  entries: MenuEntry[];
}

export interface MenuState {
  /** Description of the saved review, or null when there is none. */
  resume: string | null;
  hasGraph: boolean;
  hasGapsReport: boolean;
}

/** The ribbon menu: a section per group, with the entries that apply now. */
export function buildMenu(state: MenuState): MenuSection[] {
  const sections: Record<Group, MenuEntry[]> = {
    watch: [
      { action: "open-inbox", title: "Open this week's inbox", icon: "book-open" },
      { action: "scan-now", title: "Scan now", icon: "refresh-cw" },
    ],
    discover: [{ action: "review-new", title: "New literature review", icon: "plus" }],
    expand: [{ action: "gaps", title: "Citation gaps of one paper", icon: "search-check" }],
    // Until the Improve tab exists this opens the search-effectiveness report.
    improve: [{ action: "improve", title: "Improve a search", icon: "sliders-horizontal" }],
    tools: [
      { action: "find-dois", title: "Find DOIs for a reference list", icon: "list-checks" },
      { action: "check-setup", title: "Check setup", icon: "circle-check" },
    ],
  };
  if (state.resume !== null) sections.discover.push({ action: "review-resume", title: `Resume: ${state.resume}`, icon: "history" });
  if (state.hasGraph) sections.discover.push({ action: "open-graph", title: "Open review graph", icon: "network" });
  if (state.hasGapsReport) sections.expand.push({ action: "gaps-last", title: "Open the last citation gaps report", icon: "search-check" });
  return GROUPS.map((g) => ({ group: g.id, label: g.label, entries: sections[g.id] }));
}
