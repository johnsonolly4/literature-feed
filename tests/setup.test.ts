import { describe, expect, it } from "vitest";
import { INTEGRATIONS, endMarker, planIntegration, removeIntegration, startMarker, type IntegrationId } from "../src/setup/integrate";
import { LAB_KIT_LITERATURE_FOLDER, checkSetup, type SetupSnapshot } from "../src/setup/checks";
import { defaultSettings, type FeedConfig, type Settings } from "../src/settings/data";

function feed(overrides: Partial<FeedConfig> = {}): FeedConfig {
  return { id: "a", name: "Lipoic", enabled: true, topics: ["t"], groups: [], drop: [], lower: [], yearsFrom: null, zoteroCollection: "Inbox/Lipoic", project: "Projects/Lipoic hub", ...overrides };
}

function snapshot(overrides: { settings?: Partial<Settings>; keys?: [boolean, boolean]; folders?: string[]; notes?: string[]; installed?: string[]; enabled?: string[] } = {}): SetupSnapshot {
  const settings: Settings = { ...defaultSettings(), zoteroUserId: "123", inboxFolder: "Inbox", archiveFolder: "Archive", literatureFolder: "Lit", feeds: [feed()], ...overrides.settings };
  const folders = overrides.folders ?? ["Inbox", "Archive", "Lit"];
  const notes = overrides.notes ?? ["Lipoic hub"];
  const installed = overrides.installed ?? ["zotlit", "lab-kit"];
  const enabled = overrides.enabled ?? ["zotlit", "lab-kit"];
  const keys = overrides.keys ?? [true, true];
  return {
    settings, keyReadable: { openAlex: keys[0], zotero: keys[1] },
    folderExists: (p) => folders.includes(p), noteExists: (n) => notes.includes(n),
    pluginInstalled: (id) => installed.includes(id), pluginEnabled: (id) => enabled.includes(id),
  };
}

const row = (rows: ReturnType<typeof checkSetup>, id: string) => rows.find((r) => r.id === id);

describe("checkSetup", () => {
  it("is all ok for a complete setup (apart from the notes that only inform)", () => {
    const rows = checkSetup(snapshot());
    expect(rows.filter((r) => r.state === "todo")).toEqual([]);
    expect(rows.map((r) => r.id)).toEqual(["openalex-key", "zotero", "inbox-folder", "archive-folder", "literature-folder", "feeds", "project-a", "zotlit", "lab-kit", "zotero-addons"]);
  });

  it("asks for the keys and the user ID", () => {
    const rows = checkSetup(snapshot({ keys: [false, false], settings: { zoteroUserId: "" } }));
    expect(row(rows, "openalex-key")?.state).toBe("todo");
    expect(row(rows, "zotero")?.state).toBe("todo");
    expect(row(rows, "zotero")?.detail).toContain("the Zotero key and the Zotero user ID");
    expect(row(checkSetup(snapshot({ keys: [true, true], settings: { zoteroUserId: "" } })), "zotero")?.detail).toContain("the Zotero user ID");
  });

  it("offers to create a missing inbox or archive folder, and says nothing is wrong when they are not set", () => {
    const rows = checkSetup(snapshot({ folders: ["Lit"] }));
    expect(row(rows, "inbox-folder")?.fix).toEqual({ label: "Create it now", action: { kind: "create-folder", path: "Inbox" } });
    expect(row(rows, "archive-folder")?.fix?.action).toEqual({ kind: "create-folder", path: "Archive" });
    const unset = checkSetup(snapshot({ settings: { inboxFolder: "", archiveFolder: "" } }));
    expect(row(unset, "inbox-folder")).toMatchObject({ state: "info" });
    expect(row(unset, "inbox-folder")?.fix).toBeUndefined();
    expect(row(unset, "archive-folder")?.detail).toContain("stay in the inbox folder");
  });

  it("offers Lab Kit's ZotLit folder when the literature folder is not set and that folder exists", () => {
    const rows = checkSetup(snapshot({ settings: { literatureFolder: "" }, folders: [LAB_KIT_LITERATURE_FOLDER] }));
    expect(row(rows, "literature-folder")).toMatchObject({ state: "todo", fix: { label: "Use it", action: { kind: "set-literature-folder", path: LAB_KIT_LITERATURE_FOLDER } } });
    const none = checkSetup(snapshot({ settings: { literatureFolder: "" }, folders: [] }));
    expect(row(none, "literature-folder")?.state).toBe("todo");
    expect(row(none, "literature-folder")?.fix).toBeUndefined();
    expect(row(checkSetup(snapshot({ folders: [] })), "literature-folder")?.detail).toContain("does not exist");
  });

  it("wants a search switched on, and checks each one's project against the notes", () => {
    expect(row(checkSetup(snapshot({ settings: { feeds: [] } })), "feeds")?.state).toBe("todo");
    expect(row(checkSetup(snapshot({ settings: { feeds: [feed({ enabled: false })] } })), "feeds")?.state).toBe("todo");
    expect(row(checkSetup(snapshot({ notes: [] })), "project-a")).toMatchObject({ state: "todo" });
    expect(row(checkSetup(snapshot({ notes: [] })), "project-a")?.detail).toContain('No note named "Lipoic hub"');
    expect(row(checkSetup(snapshot({ settings: { feeds: [feed({ project: "Lipoic hub" })] } })), "project-a")?.state).toBe("ok");
    const bare = checkSetup(snapshot({ settings: { feeds: [feed({ project: "", zoteroCollection: "" })] } }));
    expect(row(bare, "project-a")?.state).toBe("info");
    expect(row(bare, "collection-a")?.state).toBe("info");
  });

  it("reports ZotLit and Lab Kit in each state", () => {
    expect(row(checkSetup(snapshot({ installed: [], enabled: [] })), "zotlit")?.state).toBe("info");
    expect(row(checkSetup(snapshot({ enabled: ["lab-kit"] })), "zotlit")?.state).toBe("todo");
    expect(row(checkSetup(snapshot({ enabled: ["zotlit"] })), "lab-kit")?.state).toBe("info");
    expect(row(checkSetup(snapshot()), "lab-kit")?.state).toBe("ok");
  });
});

const HOME = "---\nobsidianUIMode: preview\ncssclasses:\n  - home\n---\n\n# Home\n\n> [!columns]\n> > [!planning] This week\n";
const HUB = "---\nkind: hub\n---\n\n> [!note]- How I read\n> 1. Read in Zotero.\n\n> [!columns]\n> > [!focus] To process\n";
const SPEC = "---\nkind: guide\n---\n\n## Folders\n\n| Folder | What |\n";
const ctx = { inboxFolder: "Reading" };

describe("planIntegration and removeIntegration", () => {
  it("adds the Home card at the end of the note, once, with the markers", () => {
    const plan = planIntegration("home-tile", HOME, ctx);
    expect(plan.state).toBe("addable");
    expect(plan.next).toBe(`${HOME.trimEnd()}\n\n${startMarker("home-tile")}\n\`\`\`literature-feed\nshow: home\nlimit: 3\n\`\`\`\n${endMarker("home-tile")}\n`);
    expect(plan.anchor).toBe("after: > > [!planning] This week");
    expect(planIntegration("home-tile", plan.next ?? "", ctx).state).toBe("already-added");
  });

  it("puts the Literature card in a callout before the first columns callout", () => {
    const plan = planIntegration("literature-tile", HUB, ctx);
    expect(plan.state).toBe("addable");
    const next = plan.next ?? "";
    expect(next.indexOf(startMarker("literature-tile"))).toBeLessThan(next.indexOf("> [!columns]"));
    expect(next).toContain("> [!focus] Reading inbox\n> ```literature-feed\n> show: home\n> limit: 5\n> ```\n");
    expect(next.indexOf("How I read")).toBeLessThan(next.indexOf(startMarker("literature-tile")));
    expect(plan.anchor).toBe("before: > [!columns]");
  });

  it("writes the Vault spec section with the folder it was given, or the vault root", () => {
    const plan = planIntegration("vault-spec", SPEC, ctx);
    expect(plan.next).toContain("into `Reading/`.");
    expect(plan.next).toContain("kind: reading-inbox");
    expect(planIntegration("vault-spec", SPEC, { inboxFolder: "" }).next).toContain("into the vault root.");
  });

  it("removes exactly what it added, giving back the original text", () => {
    for (const [id, text] of [["home-tile", HOME], ["literature-tile", HUB], ["vault-spec", SPEC]] as [IntegrationId, string][]) {
      const next = planIntegration(id, text, ctx).next ?? "";
      expect(removeIntegration(id, next), id).toBe(text);
    }
    const noBlank = "> [!note]- x\n> text\n> [!columns]\n> > [!focus] a\n";
    expect(removeIntegration("literature-tile", planIntegration("literature-tile", noBlank, ctx).next ?? "")).toBe(noBlank);
    expect(removeIntegration("home-tile", HOME)).toBe(HOME);
  });

  it("reports a missing note or a missing place, and keeps every other line and the line endings", () => {
    expect(planIntegration("home-tile", null, ctx).state).toBe("target-missing");
    expect(planIntegration("literature-tile", "no columns here\n", ctx).state).toBe("target-missing");
    const crlf = HOME.replace(/\n/g, "\r\n");
    const next = planIntegration("home-tile", crlf, ctx).next ?? "";
    expect(next.replace(/\r\n/g, "")).not.toContain("\n");
    expect(next.startsWith(crlf.trimEnd())).toBe(true);
    expect(removeIntegration("home-tile", next)).toBe(crlf);
  });

  it("lists the three integrations with the notes they go into", () => {
    expect(INTEGRATIONS.map((i) => [i.id, i.noteName])).toEqual([["home-tile", "00 Home"], ["literature-tile", "Literature"], ["vault-spec", "Vault spec"]]);
  });
});
