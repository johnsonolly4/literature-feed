import { describe, expect, it } from "vitest";
import { ADDED_BY, INTEGRATIONS, planIntegration, removeIntegration, type IntegrationId } from "../src/setup/integrate";
import { HOWTO_NAME, howtoText } from "../src/setup/howto";
import { LAB_KIT_LITERATURE_FOLDER, checkSetup, runFix, type FixAction, type FixHandlers, type SetupSnapshot } from "../src/setup/checks";
import { PARENT_MISSING, createSeedCollection } from "../src/setup/seed-collection";
import type { ZoteroCollection } from "../src/zotero/client";
import type { IndexedCollection } from "../src/zotero/library-index";
import { defaultSettings, type FeedConfig, type Settings } from "../src/settings/data";

function feed(overrides: Partial<FeedConfig> = {}): FeedConfig {
  return { id: "a", name: "Lipoic", enabled: true, topics: ["t"], groups: [], drop: [], lower: [], yearsFrom: null, zoteroCollection: "Inbox/Lipoic", project: "Projects/Lipoic hub", seedCollection: "", knownDois: [], ...overrides };
}

function snapshot(overrides: { settings?: Partial<Settings>; keys?: [boolean, boolean]; folders?: string[]; notes?: string[]; installed?: string[]; enabled?: string[]; zotero?: SetupSnapshot["zotero"] } = {}): SetupSnapshot {
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
    ...(overrides.zotero ? { zotero: overrides.zotero } : {}),
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

const coll = (key: string, name: string, parent: string | null = null, trashed = false): IndexedCollection => ({ key, name, parent, trashed });
const ZOTERO = { collections: [coll("INBX0001", "Inbox"), coll("LIPO0001", "Lipoic", "INBX0001"), coll("SEED0001", "seeds", "LIPO0001")] };

describe("seed collection rows", () => {
  it("adds none without Zotero's collections (no key or user ID)", () => {
    expect(checkSetup(snapshot()).some((r) => r.id.startsWith("seeds-") || r.id === "zotero-collections")).toBe(false);
  });

  it("is ok when Inbox/Lipoic/seeds exists, and sits after the other per-search rows", () => {
    const rows = checkSetup(snapshot({ zotero: ZOTERO }));
    expect(row(rows, "seeds-a")).toMatchObject({ state: "ok", title: "Lipoic: seed collection" });
    expect(row(rows, "seeds-a")?.fix).toBeUndefined();
    expect(rows.map((r) => r.id).indexOf("seeds-a")).toBeGreaterThan(rows.map((r) => r.id).indexOf("project-a"));
  });

  it("offers Create it when only the last name is missing, with near matches in the text", () => {
    const collections = [coll("INBX0001", "Inbox"), coll("LIPO0001", "Lipoic", "INBX0001"), coll("SEED0001", "Seeds", "LIPO0001")];
    const r = row(checkSetup(snapshot({ zotero: { collections } })), "seeds-a");
    expect(r?.state).toBe("todo");
    expect(r?.fix).toEqual({ label: "Create it", action: { kind: "create-zotero-collection", path: "Inbox/Lipoic/seeds" } });
    expect(r?.detail).toContain("Did you mean: Inbox/Lipoic/Seeds");
  });

  it("treats a collection in the Trash as missing", () => {
    const collections = [coll("INBX0001", "Inbox"), coll("LIPO0001", "Lipoic", "INBX0001"), coll("SEED0001", "seeds", "LIPO0001", true)];
    expect(row(checkSetup(snapshot({ zotero: { collections } })), "seeds-a")?.fix?.action).toEqual({ kind: "create-zotero-collection", path: "Inbox/Lipoic/seeds" });
  });

  it("offers no button when the inbox collection is missing too", () => {
    const r = row(checkSetup(snapshot({ zotero: { collections: [coll("INBX0001", "Inbox")] } })), "seeds-a");
    expect(r?.state).toBe("todo");
    expect(r?.fix).toBeUndefined();
    expect(r?.detail).toContain("Sync once first, or create the inbox collection in Zotero");
  });

  it("says not set without a Zotero collection, and uses an explicit path", () => {
    const none = checkSetup(snapshot({ settings: { feeds: [feed({ zoteroCollection: "" })] }, zotero: ZOTERO }));
    expect(row(none, "seeds-a")).toMatchObject({ state: "info" });
    expect(row(none, "seeds-a")?.fix).toBeUndefined();
    const explicit = checkSetup(snapshot({ settings: { feeds: [feed({ seedCollection: "Inbox/Lipoic/Known" })] }, zotero: ZOTERO }));
    expect(row(explicit, "seeds-a")?.fix?.action).toEqual({ kind: "create-zotero-collection", path: "Inbox/Lipoic/Known" });
  });

  it("warns when the seed collection is the inbox or the project collection", () => {
    const inbox = row(checkSetup(snapshot({ settings: { feeds: [feed({ seedCollection: " Inbox / Lipoic " })] }, zotero: ZOTERO })), "seeds-a");
    expect(inbox).toMatchObject({ state: "todo" });
    expect(inbox?.detail).toContain("same as the search's inbox collection");
    expect(inbox?.fix).toBeUndefined();
    const project = row(checkSetup(snapshot({ settings: { feeds: [feed({ seedCollection: "Projects/Lipoic hub" })] }, zotero: ZOTERO })), "seeds-a");
    expect(project?.detail).toContain("project collection");
  });

  it("covers searches that are switched off, but not those without topics", () => {
    const rows = checkSetup(snapshot({ settings: { feeds: [feed({ enabled: false }), feed({ id: "b", name: "Empty", topics: [] })] }, zotero: ZOTERO }));
    expect(row(rows, "seeds-a")?.state).toBe("ok");
    expect(row(rows, "seeds-b")).toBeUndefined();
  });

  it("gives one row when Zotero could not be read, not one per search", () => {
    const rows = checkSetup(snapshot({ settings: { feeds: [feed(), feed({ id: "b", name: "Two" })] }, zotero: { error: "Zotero refused the API key (HTTP 403)." } }));
    expect(rows.filter((r) => r.id.startsWith("seeds-"))).toEqual([]);
    expect(row(rows, "zotero-collections")).toMatchObject({ state: "todo" });
    expect(row(rows, "zotero-collections")?.detail).toContain("Could not read Zotero: Zotero refused the API key (HTTP 403).");
  });
});

describe("runFix", () => {
  function handlers() {
    const calls: string[] = [];
    const h: FixHandlers = {
      createFolder: async (p) => { calls.push(`folder ${p}`); },
      setLiteratureFolder: async (p) => { calls.push(`literature ${p}`); },
      createZoteroCollection: async (p) => { calls.push(`collection ${p}`); },
    };
    return { h, calls };
  }

  it("runs the handler of the fix's kind", async () => {
    const { h, calls } = handlers();
    await runFix({ kind: "create-folder", path: "A" }, h);
    await runFix({ kind: "set-literature-folder", path: "B" }, h);
    await runFix({ kind: "create-zotero-collection", path: "C/d" }, h);
    expect(calls).toEqual(["folder A", "literature B", "collection C/d"]);
  });

  it("does nothing for a kind it does not know, so it never sets the literature folder", async () => {
    const { h, calls } = handlers();
    await runFix({ kind: "something-new", path: "X" } as unknown as FixAction, h);
    expect(calls).toEqual([]);
  });
});

describe("createSeedCollection", () => {
  function fakeClient(collections: ZoteroCollection[]) {
    const created: { name: string; parent: string | null }[] = [];
    return {
      created,
      client: {
        listCollections: async () => collections,
        createCollection: async (name: string, parent: string | null) => { created.push({ name, parent }); return "NEWCOLL1"; },
      },
    };
  }
  const live: ZoteroCollection[] = [{ key: "INBX0001", name: "Inbox", parent: null }, { key: "LIPO0001", name: "Lipoic", parent: "INBX0001" }];

  it("creates only the last name, inside its parent", async () => {
    const { client, created } = fakeClient(live);
    expect(await createSeedCollection(client, "Inbox/Lipoic/seeds")).toEqual({ outcome: "created", key: "NEWCOLL1" });
    expect(created).toEqual([{ name: "seeds", parent: "LIPO0001" }]);
  });

  it("sends nothing when the collection exists now", async () => {
    const { client, created } = fakeClient([...live, { key: "SEED0001", name: "seeds", parent: "LIPO0001" }]);
    expect(await createSeedCollection(client, "Inbox/Lipoic/seeds")).toEqual({ outcome: "exists", key: "SEED0001" });
    expect(created).toEqual([]);
  });

  it("refuses when more than the last name is missing", async () => {
    const { client, created } = fakeClient([{ key: "INBX0001", name: "Inbox", parent: null }]);
    await expect(createSeedCollection(client, "Inbox/Lipoic/seeds")).rejects.toThrow(PARENT_MISSING);
    expect(created).toEqual([]);
  });

  it("refuses an empty path", async () => {
    const { client, created } = fakeClient(live);
    await expect(createSeedCollection(client, " / ")).rejects.toThrow("no collection path");
    expect(created).toEqual([]);
  });
});

const HOME = "---\nobsidianUIMode: preview\ncssclasses:\n  - home\n---\n\n# Home\n\n> [!columns]\n> > [!planning] This week\n";
const HUB = "---\nkind: hub\n---\n\n> [!note]- How I read\n> 1. Read in Zotero.\n\n> [!columns]\n> > [!focus] To process\n";
const SPEC = "---\nkind: guide\n---\n\n## Every day\n\nText.\n\n## Reading papers\n\n1. Read in Zotero.\n\n> [!tip] Linking a paper\n> Link it.\n\n## Meetings\n\nMore.\n";
const ctx = { inboxFolder: "Reading" };
const LINK = (id: string): string => `[Reading inbox](obsidian://literature-feed-inbox?tile=${id})`;

describe("planIntegration and removeIntegration", () => {
  it("adds the Home tile as the last tile of the columns callout, a reading-inbox callout with a title link, once, and no marker comments", () => {
    const plan = planIntegration("home-tile", HOME, ctx);
    expect(plan.state).toBe("addable");
    expect(plan.next).toBe(`${HOME.trimEnd()}\n>\n> > [!reading-inbox] ${LINK("home-tile")}\n> > \`\`\`literature-feed\n> > show: home\n> > limit: 3\n> > \`\`\`\n`);
    expect(plan.next).not.toContain("%%");
    expect(plan.anchor).toBe("after the last tile in the columns: > > [!planning] This week");
    expect(planIntegration("home-tile", plan.next ?? "", ctx).state).toBe("already-added");
  });

  it("adds the Home tile at the end of the note when there are no columns", () => {
    const plain = "---\ncssclasses:\n  - home\n---\n\n# Home\n\nSome text.\n";
    const plan = planIntegration("home-tile", plain, ctx);
    expect(plan.next).toBe(`${plain.trimEnd()}\n\n> [!reading-inbox] ${LINK("home-tile")}\n> \`\`\`literature-feed\n> show: home\n> limit: 3\n> \`\`\`\n`);
    expect(plan.anchor).toBe("after: Some text.");
    expect(removeIntegration("home-tile", plan.next ?? "")).toBe(plain);
  });

  it("keeps the columns' other tiles when a tile in the columns is removed, even ones added after it", () => {
    const added = planIntegration("home-tile", HOME, ctx).next ?? "";
    const withMore = added.replace("> > limit: 3\n> > ```\n", "> > limit: 3\n> > ```\n>\n> > [!question] Next meetings\n");
    const removed = removeIntegration("home-tile", withMore);
    expect(removed).toContain("> > [!question] Next meetings");
    expect(removed).not.toContain("reading-inbox");
    expect(removed).toContain("> > [!planning] This week");
  });

  it("puts the Literature tile, the same callout, before the first columns callout", () => {
    const plan = planIntegration("literature-tile", HUB, ctx);
    expect(plan.state).toBe("addable");
    const next = plan.next ?? "";
    expect(next.indexOf("> [!reading-inbox]")).toBeLessThan(next.indexOf("> [!columns]"));
    expect(next).toContain(`> [!reading-inbox] ${LINK("literature-tile")}\n> \`\`\`literature-feed\n> show: home\n> limit: 5\n> \`\`\`\n`);
    expect(next.indexOf("How I read")).toBeLessThan(next.indexOf("> [!reading-inbox]"));
    expect(plan.anchor).toBe("before: > [!columns]");
  });

  it("adds the how-my-vault-works callout at the end of the Reading papers section, before the next heading, marked as an addition", () => {
    const plan = planIntegration("how-vault-works", SPEC, ctx);
    expect(plan.state).toBe("addable");
    const next = plan.next ?? "";
    expect(plan.anchor).toBe("before: ## Meetings");
    expect(next).toContain(`> [!reading-inbox] Reading inbox ${ADDED_BY}`);
    expect(next).toContain("in `Reading/`)");
    expect(next.indexOf("> Link it.")).toBeLessThan(next.indexOf(ADDED_BY));
    expect(next.indexOf(ADDED_BY)).toBeLessThan(next.indexOf("## Meetings"));
    expect(next.indexOf("## Every day")).toBeLessThan(next.indexOf(ADDED_BY));
    expect(planIntegration("how-vault-works", SPEC, { inboxFolder: "" }).next).toContain("in the vault root)");
    expect(planIntegration("how-vault-works", next, ctx).state).toBe("already-added");
  });

  it("puts the how-my-vault-works callout at the end of the note when there is no Reading papers section", () => {
    const plan = planIntegration("how-vault-works", "## Other\n\nText.\n", ctx);
    expect(plan.anchor).toBe("after: Text.");
    expect(plan.next?.endsWith(`> - Added by **Check setup** in the Literature Feed settings. If a kit update replaces this note, run **Check setup** again to put it back.\n`)).toBe(true);
  });

  it("removes exactly what it added, giving back the original text", () => {
    for (const [id, text] of [["home-tile", HOME], ["literature-tile", HUB], ["how-vault-works", SPEC]] as [IntegrationId, string][]) {
      const next = planIntegration(id, text, ctx).next ?? "";
      expect(removeIntegration(id, next), id).toBe(text);
    }
    const noBlank = "> [!note]- x\n> text\n> [!columns]\n> > [!focus] a\n";
    expect(removeIntegration("literature-tile", planIntegration("literature-tile", noBlank, ctx).next ?? "")).toBe(noBlank);
    expect(removeIntegration("home-tile", HOME)).toBe(HOME);
  });

  it("removes a tile the user edited inside, and the callout the user edited, but not what follows", () => {
    const home = planIntegration("home-tile", HOME, ctx).next ?? "";
    expect(removeIntegration("home-tile", home.replace("limit: 3", "limit: 9"))).toBe(HOME);
    const spec = planIntegration("how-vault-works", SPEC, ctx).next ?? "";
    const edited = spec.replace("> - Open it from", "> - My own words: open it from");
    expect(removeIntegration("how-vault-works", edited)).toBe(SPEC);
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

  it("does not offer a second tile where the user already made a reading inbox card, and does not remove it", () => {
    const handMade = HOME + "> > [!summary] Reading inbox\n> > ```literature-feed\n> > show: home\n> > ```\n";
    expect(planIntegration("home-tile", handMade, ctx)).toMatchObject({ state: "already-added", removable: false });
    expect(removeIntegration("home-tile", handMade)).toBe(handMade);
    expect(planIntegration("home-tile", planIntegration("home-tile", HOME, ctx).next ?? "", ctx).removable).toBe(true);
    expect(planIntegration("how-vault-works", handMade, ctx).state).toBe("addable");
  });

  it("lists the three integrations with the notes they go into", () => {
    expect(INTEGRATIONS.map((i) => [i.id, i.noteName])).toEqual([["home-tile", "00 Home"], ["literature-tile", "Literature"], ["how-vault-works", "How my vault works"]]);
  });
});

describe("the stand-alone how-to note", () => {
  it("is named and says how the weekly inbox works, with the folder", () => {
    expect(HOWTO_NAME).toBe("Reading inbox how-to");
    const text = howtoText({ inboxFolder: "Reading" });
    expect(text.startsWith("---\nkind: guide\n---")).toBe(true);
    expect(text).toContain("in `Reading/`");
    expect(text).toContain("Sync N to Zotero");
    expect(text).toContain("Show search effectiveness");
    expect(howtoText({ inboxFolder: "" })).toContain("in the vault root");
  });
});
