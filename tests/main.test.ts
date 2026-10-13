import { describe, expect, it } from "vitest";
import LiteratureFeedPlugin from "../src/main";

// The stub Plugin has an in-memory secret storage and a loadData / saveData that do nothing; this subclass records them.
class TestPlugin extends LiteratureFeedPlugin {
  stored: unknown = null;
  saves: string[] = [];
  async loadData(): Promise<unknown> { return this.stored; }
  async saveData(data: unknown): Promise<void> {
    this.saves.push(JSON.stringify(data));
    this.stored = JSON.parse(JSON.stringify(data));
  }
  secrets(): { getSecret(id: string): string | null; setSecret(id: string, secret: string): void } {
    return (this.app as unknown as { secretStorage: ReturnType<TestPlugin["secrets"]> }).secretStorage;
  }
}

describe("API keys and the plugin's data file", () => {
  // Made-up values: these are not keys of any service.
  const legacy = { openAlexKey: "oa-test-value", zoteroKey: "zo-test-value", scanDay: 4, inboxFolder: "/" };

  it("moves old plain-text keys to the secret storage and rewrites data.json without them", async () => {
    const plugin = new TestPlugin();
    plugin.stored = legacy;
    await plugin.onload();

    expect(plugin.saves).toHaveLength(1);
    expect(plugin.saves[0]).not.toContain("oa-test-value");
    expect(plugin.saves[0]).not.toContain("zo-test-value");
    expect(plugin.getSecret("openAlexKey")).toBe("oa-test-value");
    expect(plugin.getSecret("zoteroKey")).toBe("zo-test-value");
    expect(plugin.settings).toMatchObject({ scanDay: 4, inboxFolder: "", openAlexKeySecret: "literature-feed-openalex" });
  });

  it("does not save again on the next load", async () => {
    const plugin = new TestPlugin();
    plugin.stored = legacy;
    await plugin.onload();
    const again = new TestPlugin();
    again.stored = plugin.stored;
    await again.onload();
    expect(again.saves).toHaveLength(0);
    expect(again.settings.openAlexKeySecret).toBe("literature-feed-openalex");
  });

  it("gives an empty key when no secret is chosen or the secret is missing", async () => {
    const plugin = new TestPlugin();
    await plugin.onload();
    expect(plugin.getSecret("openAlexKey")).toBe("");
    plugin.settings.zoteroKeySecret = "not-stored";
    expect(plugin.getSecret("zoteroKey")).toBe("");
  });

  it("leaves data.json alone and loads without keys when the secret storage fails", async () => {
    const plugin = new TestPlugin();
    plugin.stored = legacy;
    plugin.secrets().setSecret = () => { throw new Error("no keychain"); };
    await plugin.onload();
    expect(plugin.saves).toHaveLength(0);
    expect(plugin.stored).toEqual(legacy);
    expect(plugin.settings.openAlexKeySecret).toBe("");
    expect(plugin.settings.scanDay).toBe(4);
  });

  it("reads data.json again after an external change", async () => {
    const plugin = new TestPlugin();
    await plugin.onload();
    plugin.stored = { scanDay: 6, feeds: [{ name: "Changed outside" }] };
    await plugin.onExternalSettingsChange();
    expect(plugin.settings.scanDay).toBe(6);
    expect(plugin.settings.feeds.map((f) => f.name)).toEqual(["Changed outside"]);
  });
});
