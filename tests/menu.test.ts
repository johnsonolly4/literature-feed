import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { COMMANDS, GROUPS, buildMenu, commandName, commandSpec } from "../src/menu";

describe("command list", () => {
  it("lists every command once, each under one known group", () => {
    const ids = COMMANDS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    const groups = new Set(GROUPS.map((g) => g.id));
    for (const c of COMMANDS) expect(groups.has(c.group)).toBe(true);
  });

  it("covers every command main.ts registers, and no removed one", () => {
    const source = readFileSync("src/main.ts", "utf8");
    const registered = [...source.matchAll(/addCommand\(\{\s*id: "([^"]+)"/g)].map((m) => m[1]);
    expect(registered.length).toBeGreaterThan(0);
    expect([...registered].sort()).toEqual(COMMANDS.map((c) => c.id).sort());
    expect(registered).not.toContain("open-review-graph");
    expect(registered).not.toContain("open-note-graph");
  });

  it("names a command by its group", () => {
    expect(commandName(commandSpec("scan-now"))).toBe("Watch: Scan now");
    expect(commandName(commandSpec("literature-review"))).toBe("Discover: Generate literature review");
    expect(commandName(commandSpec("citation-gaps"))).toBe("Expand: Citation gaps of one paper");
    expect(() => commandSpec("nope")).toThrow();
  });
});

describe("ribbon menu", () => {
  const sectionTitles = (m: ReturnType<typeof buildMenu>, group: string): string[] => m.find((s) => s.group === group)?.entries.map((e) => e.title) ?? [];

  it("has the five groups in order, none empty", () => {
    const menu = buildMenu({ resume: null, hasGraph: false, hasGapsReport: false });
    expect(menu.map((s) => s.label)).toEqual(["Watch", "Discover", "Expand", "Improve", "Tools"]);
    for (const s of menu) expect(s.entries.length).toBeGreaterThan(0);
  });

  it("shows resume, the graph and the last gaps report only when they exist", () => {
    const bare = buildMenu({ resume: null, hasGraph: false, hasGapsReport: false });
    expect(sectionTitles(bare, "discover")).toEqual(["New literature review"]);
    expect(sectionTitles(bare, "expand")).toEqual(["Citation gaps of one paper"]);
    const full = buildMenu({ resume: "SDL, 60 papers", hasGraph: true, hasGapsReport: true });
    expect(sectionTitles(full, "discover")).toEqual(["New literature review", "Resume: SDL, 60 papers", "Open review graph"]);
    expect(sectionTitles(full, "expand")).toEqual(["Citation gaps of one paper", "Open the last citation gaps report"]);
  });
});
