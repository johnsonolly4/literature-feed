import { describe, expect, it } from "vitest";
import LiteratureFeedPlugin from "../src/main";
import manifest from "../manifest.json";
import pkg from "../package.json";
import versions from "../versions.json";

describe("smoke", () => {
  it("the plugin loads and unloads", async () => {
    const plugin = new LiteratureFeedPlugin();
    await expect(plugin.onload()).resolves.toBeUndefined();
    expect(() => plugin.unload()).not.toThrow();
    expect(plugin.settings.feeds).toEqual([]);
  });

  it("manifest, package and versions.json agree", () => {
    expect(manifest.id).toBe("literature-feed");
    expect(pkg.version).toBe(manifest.version);
    expect(versions[manifest.version as keyof typeof versions]).toBe(manifest.minAppVersion);
  });
});
