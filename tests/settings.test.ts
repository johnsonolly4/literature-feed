import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { scorePaper } from "../src/match/score";
import type { ScanResult } from "../src/openalex/client";
import {
  DEFAULT_SECRET_IDS, SEEN_CAP, checkFeed, cloneFeed, defaultSettings, duplicateFeed, feedToJson, migrateLegacyKeys, newFeed,
  normaliseFolder, normaliseSettings, parseFeedJson, parseLines, parseYear, slugify, type FeedConfig, type SecretStore,
} from "../src/settings/data";
import { runFeedTest, summariseScan, testWindowStart } from "../src/settings/test-feed";
import { lipoicFeed } from "./fixtures/lipoic-feed";
import { tierCases } from "./fixtures/lipoic-papers";

const feedFile = readFileSync(new URL("../docs/feeds/lipoic-acid-copolymers.json", import.meta.url), "utf8");

function feed(overrides: Partial<FeedConfig> = {}): FeedConfig {
  return {
    id: "f", name: "F", enabled: true, topics: ["lipoic"], yearsFrom: null, zoteroCollection: "", project: "", seedCollection: "", knownDois: [],
    groups: [{ name: "Lipoic acid", role: "required", terms: ["lipoic acid"] }], drop: [], lower: [], ...overrides,
  };
}

describe("normaliseSettings", () => {
  it("gives the defaults for nothing, a string or an array", () => {
    for (const raw of [null, undefined, "x", 3, [], true]) expect(normaliseSettings(raw)).toEqual(defaultSettings());
  });

  it("defaults hold no secrets, no paths and no feeds", () => {
    expect(defaultSettings()).toEqual({
      openAlexKeySecret: "", zoteroKeySecret: "", zoteroUserId: "", inboxFolder: "", archiveFolder: "", scanDay: 1, feeds: [], lastScan: "", seen: [], lastScanResult: null, createInboxCollections: false, createProjectCollections: false,
      literatureFolder: "", archiveFinished: true, dismissAfterWeeks: 4, autoScan: true, autoSync: false, lastSync: "", reviewBudgetUsd: 0.05, reviewMonthlyLimitUsd: 0, crossrefEmail: "",
    });
  });

  it("keeps good values, trims strings and drops unknown fields", () => {
    const s = normaliseSettings({ openAlexKeySecret: " my-secret ", zoteroUserId: "123", inboxFolder: " Inbox ", scanDay: 5, extra: 1 });
    expect(s).toMatchObject({ openAlexKeySecret: "my-secret", zoteroUserId: "123", inboxFolder: "Inbox", scanDay: 5 });
    expect(s).not.toHaveProperty("extra");
  });

  it("reads the last scan date and the seen list, and ignores bad ones", () => {
    expect(normaliseSettings({ lastScan: "2026-10-12", seen: ["f/W1", "", 5, "f/W2", "f/W1"] })).toMatchObject({
      lastScan: "2026-10-12", seen: ["f/W1", "f/W2"],
    });
    expect(normaliseSettings({ lastScan: "yesterday", seen: "x" })).toMatchObject({ lastScan: "", seen: [] });
    const many = Array.from({ length: SEEN_CAP + 10 }, (_, i) => `f/W${i}`);
    const seen = normaliseSettings({ seen: many }).seen;
    expect(seen).toHaveLength(SEEN_CAP);
    expect(seen[seen.length - 1]).toBe(`f/W${SEEN_CAP + 9}`);
  });

  it("reads the result of the last scan and ignores a damaged one", () => {
    const row = { id: "a", name: "Feed A", priority: 0, strong: 2, possible: 1, unchecked: 0, dropped: 11, failed: false };
    const good = { at: "2026-10-12", priority: 0, strong: 2, possible: 1, unchecked: 0, dropped: 11, failed: 0, feeds: [row] };
    expect(normaliseSettings({ lastScanResult: good }).lastScanResult).toEqual(good);
    // An older file without the per-feed list still reads, with an empty list; damaged feed rows are dropped.
    const { feeds: _feeds, ...old } = good;
    expect(normaliseSettings({ lastScanResult: old }).lastScanResult).toEqual({ ...old, feeds: [] });
    expect(normaliseSettings({ lastScanResult: { ...good, feeds: [row, { ...row, id: "" }, { ...row, dropped: -1 }, "x", { ...row, failed: "no" }] } }).lastScanResult?.feeds).toEqual([row]);
    for (const bad of [null, "x", {}, { ...good, at: "today" }, { ...good, strong: -1 }, { ...good, dropped: 1.5 }, { ...good, failed: "0" }]) {
      expect(normaliseSettings({ lastScanResult: bad }).lastScanResult, JSON.stringify(bad)).toBeNull();
    }
  });

  it("reads the two collection-creation settings as on only when they are exactly true", () => {
    expect(normaliseSettings({})).toMatchObject({ createInboxCollections: false, createProjectCollections: false });
    expect(normaliseSettings({ createInboxCollections: true, createProjectCollections: false })).toMatchObject({ createInboxCollections: true, createProjectCollections: false });
    for (const bad of ["true", 1, "yes", null, [true]]) {
      expect(normaliseSettings({ createInboxCollections: bad, createProjectCollections: bad })).toMatchObject({ createInboxCollections: false, createProjectCollections: false });
    }
    const saved = normaliseSettings({ createProjectCollections: true });
    expect(normaliseSettings(JSON.parse(JSON.stringify(saved)))).toEqual(saved);
  });

  it("reads the literature review limits, with safe fallbacks", () => {
    expect(normaliseSettings({})).toMatchObject({ reviewBudgetUsd: 0.05, reviewMonthlyLimitUsd: 0 });
    expect(normaliseSettings({ reviewBudgetUsd: 0.2, reviewMonthlyLimitUsd: 3 })).toMatchObject({ reviewBudgetUsd: 0.2, reviewMonthlyLimitUsd: 3 });
    expect(normaliseSettings({ crossrefEmail: "me@example.org" }).crossrefEmail).toBe("me@example.org");
    expect(normaliseSettings({ crossrefEmail: "not an email" }).crossrefEmail).toBe("");
    expect(normaliseSettings({}).crossrefEmail).toBe("");
    for (const bad of [0, 0.001, 9, -1, "0.1", null, NaN]) expect(normaliseSettings({ reviewBudgetUsd: bad }).reviewBudgetUsd, String(bad)).toBe(0.05);
    for (const bad of [-1, 101, "5", null]) expect(normaliseSettings({ reviewMonthlyLimitUsd: bad }).reviewMonthlyLimitUsd, String(bad)).toBe(0);
  });

  it("reads the schedule settings: scan on by default, sync off by default, a bad day is ignored", () => {
    expect(normaliseSettings({})).toMatchObject({ autoScan: true, autoSync: false, lastSync: "" });
    expect(normaliseSettings({ autoScan: false, autoSync: true, lastSync: "2026-10-13" })).toMatchObject({ autoScan: false, autoSync: true, lastSync: "2026-10-13" });
    for (const odd of ["no", 0, null]) expect(normaliseSettings({ autoScan: odd }).autoScan, String(odd)).toBe(true);
    for (const odd of ["yes", 1, null]) expect(normaliseSettings({ autoSync: odd }).autoSync, String(odd)).toBe(false);
    for (const bad of ["yesterday", "2026-10-13T10:00", 3, null]) expect(normaliseSettings({ lastSync: bad }).lastSync, String(bad)).toBe("");
  });

  it("reads the read-state and archive settings, with safe fallbacks", () => {
    expect(normaliseSettings({ literatureFolder: " Lit/ZotLit ", archiveFinished: false, dismissAfterWeeks: 8 }))
      .toMatchObject({ literatureFolder: "Lit/ZotLit", archiveFinished: false, dismissAfterWeeks: 8 });
    for (const bad of [0, 53, 2.5, "4", null, -1]) expect(normaliseSettings({ dismissAfterWeeks: bad }).dismissAfterWeeks, String(bad)).toBe(4);
    for (const odd of ["no", 0, null]) expect(normaliseSettings({ archiveFinished: odd }).archiveFinished, String(odd)).toBe(true);
    expect(normaliseSettings({ literatureFolder: "/" }).literatureFolder).toBe("");
  });

  it("stores the vault root as an empty folder", () => {
    expect(normaliseSettings({ inboxFolder: "/", archiveFolder: " / " })).toMatchObject({ inboxFolder: "", archiveFolder: "" });
    expect(normaliseFolder("Literature/Inbox")).toBe("Literature/Inbox");
  });

  it("accepts only ids that Obsidian allows for a secret", () => {
    for (const bad of ["My Secret", "UPPER", "a_b", "-a", "a--b", "", 5, null]) {
      expect(normaliseSettings({ zoteroKeySecret: bad }).zoteroKeySecret, String(bad)).toBe("");
    }
    expect(normaliseSettings({ zoteroKeySecret: "zotero-2" }).zoteroKeySecret).toBe("zotero-2");
  });

  it("falls back on wrong types and a scan day out of range", () => {
    const s = normaliseSettings({ openAlexKeySecret: 5, inboxFolder: ["a"], scanDay: 9 });
    expect(s.openAlexKeySecret).toBe("");
    expect(s.inboxFolder).toBe("");
    expect(s.scanDay).toBe(1);
    expect(normaliseSettings({ scanDay: 2.5 }).scanDay).toBe(1);
    expect(normaliseSettings({ scanDay: 0 }).scanDay).toBe(0);
  });

  it("skips feeds without a name or that are not objects, and makes ids unique", () => {
    const s = normaliseSettings({ feeds: [null, "x", { name: "  " }, { name: "A" }, { name: "A" }, { name: "B", id: "a" }] });
    expect(s.feeds.map((f) => f.name)).toEqual(["A", "A", "B"]);
    expect(s.feeds.map((f) => f.id)).toEqual(["a", "a-2", "a-3"]);
  });

  it("cleans a feed's lists, roles and year", () => {
    const [f] = normaliseSettings({
      feeds: [{
        name: "X", enabled: "yes", topics: [" t ", "", 4, "t"], yearsFrom: 1800,
        groups: [{ name: "g", role: "boost", terms: [" a ", ""] }, { name: "bad", role: "huge", terms: [] }, "nope", { role: "required" }],
        drop: "not a list", lower: ["x"],
      }],
    }).feeds;
    expect(f).toMatchObject({ enabled: false, topics: ["t"], yearsFrom: null, drop: [], lower: ["x"] });
    expect(f.groups).toEqual([{ name: "g", role: "boost", terms: ["a"] }, { name: "Group 4", role: "required", terms: [] }]);
  });

  it("survives a save and a reload (JSON round trip)", () => {
    const settings = normaliseSettings({ openAlexKeySecret: "k", scanDay: 3, feeds: [JSON.parse(feedFile)] });
    settings.feeds[0].enabled = true;
    expect(normaliseSettings(JSON.parse(JSON.stringify(settings)))).toEqual(settings);
  });

  it("an external change to data.json is picked up by reading the new text again", () => {
    const before = normaliseSettings({ scanDay: 1, feeds: [{ name: "A" }] });
    const after = normaliseSettings({ ...before, scanDay: 4, feeds: [...before.feeds, { name: "B" }] });
    expect(after.scanDay).toBe(4);
    expect(after.feeds.map((f) => f.name)).toEqual(["A", "B"]);
  });
});

describe("moving old plain-text keys into the secret store", () => {
  // Made-up values: these are not keys of any service.
  const legacy = { openAlexKey: "oa-test-value", zoteroKey: "zo-test-value", scanDay: 2 };

  function fakeStore(initial: Record<string, string> = {}): SecretStore & { secrets: Map<string, string> } {
    const secrets = new Map(Object.entries(initial));
    return {
      secrets,
      getSecret: (id) => secrets.get(id) ?? null,
      setSecret: (id, secret) => { secrets.set(id, secret); },
    };
  }

  it("moves both keys under the default ids and records the ids", () => {
    const store = fakeStore();
    const settings = normaliseSettings(legacy);
    expect(migrateLegacyKeys(legacy, settings, store)).toBe(true);
    expect(store.secrets.get(DEFAULT_SECRET_IDS.openAlexKey)).toBe("oa-test-value");
    expect(store.secrets.get(DEFAULT_SECRET_IDS.zoteroKey)).toBe("zo-test-value");
    expect(settings).toMatchObject({ openAlexKeySecret: "literature-feed-openalex", zoteroKeySecret: "literature-feed-zotero", scanDay: 2 });
  });

  it("leaves no key text in the settings that are saved", () => {
    const settings = normaliseSettings(legacy);
    migrateLegacyKeys(legacy, settings, fakeStore());
    const saved = JSON.stringify(settings);
    expect(saved).not.toContain("oa-test-value");
    expect(saved).not.toContain("zo-test-value");
    expect(Object.keys(settings)).not.toContain("openAlexKey");
    expect(Object.keys(settings)).not.toContain("zoteroKey");
  });

  it("never overwrites a secret that already holds a value", () => {
    const store = fakeStore({ "literature-feed-openalex": "kept" });
    const settings = normaliseSettings(legacy);
    migrateLegacyKeys(legacy, settings, store);
    expect(store.secrets.get("literature-feed-openalex")).toBe("kept");
    expect(store.secrets.get("literature-feed-zotero")).toBe("zo-test-value");
  });

  it("uses the id that is already chosen", () => {
    const store = fakeStore();
    const raw = { ...legacy, openAlexKeySecret: "my-own" };
    const settings = normaliseSettings(raw);
    migrateLegacyKeys(raw, settings, store);
    expect(store.secrets.get("my-own")).toBe("oa-test-value");
    expect(settings.openAlexKeySecret).toBe("my-own");
  });

  it("does nothing when there is nothing to move", () => {
    for (const raw of [null, "x", {}, { openAlexKey: "", zoteroKey: "   " }, { openAlexKey: 5 }, { openAlexKeySecret: "a" }]) {
      const store = fakeStore();
      expect(migrateLegacyKeys(raw, normaliseSettings(raw), store), JSON.stringify(raw)).toBe(false);
      expect(store.secrets.size).toBe(0);
    }
  });

  it("moves only the key that is there", () => {
    const store = fakeStore();
    const raw = { zoteroKey: "zo-test-value" };
    const settings = normaliseSettings(raw);
    expect(migrateLegacyKeys(raw, settings, store)).toBe(true);
    expect(settings).toMatchObject({ openAlexKeySecret: "", zoteroKeySecret: "literature-feed-zotero" });
    expect([...store.secrets.keys()]).toEqual(["literature-feed-zotero"]);
  });

  it("the default ids are valid secret ids", () => {
    for (const id of Object.values(DEFAULT_SECRET_IDS)) expect(normaliseSettings({ zoteroKeySecret: id }).zoteroKeySecret).toBe(id);
  });
});

describe("helpers", () => {
  it("slugify", () => {
    expect(slugify("Lipoic acid copolymers")).toBe("lipoic-acid-copolymers");
    expect(slugify("  Café — Ünïcode!! ")).toBe("cafe-unicode");
    expect(slugify("???")).toBe("feed");
  });

  it("parseLines trims, drops empty lines and repeats, and accepts CRLF", () => {
    expect(parseLines(" a \r\n\r\nb\na\n")).toEqual(["a", "b"]);
    expect(parseLines("")).toEqual([]);
  });

  it("parseYear accepts four digits in range, nothing else", () => {
    expect(parseYear(" 2020 ")).toBe(2020);
    for (const v of ["", "20", "2020a", "1800", "2200", "-2020"]) expect(parseYear(v)).toBeNull();
  });

  it("newFeed and duplicateFeed give unique names and ids, switched off", () => {
    const a = newFeed([]);
    expect(a).toMatchObject({ name: "New feed", id: "new-feed", enabled: false });
    const b = newFeed([a]);
    expect(b).toMatchObject({ name: "New feed 2", id: "new-feed-2" });
    const copy = duplicateFeed(feed({ id: "f", name: "F" }), [feed()]);
    expect(copy).toMatchObject({ name: "F copy", id: "f-copy", enabled: false });
    expect(duplicateFeed(feed(), [feed(), copy]).name).toBe("F copy 2");
  });

  it("cloneFeed is deep", () => {
    const original = feed();
    const copy = cloneFeed(original);
    copy.groups[0].terms.push("x");
    copy.topics.push("y");
    expect(original.groups[0].terms).toEqual(["lipoic acid"]);
    expect(original.topics).toEqual(["lipoic"]);
  });

  it("cloneFeed and duplicateFeed share no list of known DOIs", () => {
    const original = { ...feed(), knownDois: ["10.1000/a"] };
    const copy = cloneFeed(original);
    copy.knownDois.push("10.1000/b");
    expect(original.knownDois).toEqual(["10.1000/a"]);
    const dup = duplicateFeed(original, [original]);
    dup.knownDois.push("10.1000/c");
    expect(original.knownDois).toEqual(["10.1000/a"]);
    expect(dup.seedCollection).toBe(original.seedCollection);
  });

  it("searches saved before the seed fields existed load with them empty", () => {
    const s = normaliseSettings({ feeds: [{ name: "Old", topics: ["t"], zoteroCollection: "Inbox/Old" }] });
    expect(s.feeds[0]).toMatchObject({ seedCollection: "", knownDois: [], zoteroCollection: "Inbox/Old" });
  });

  it("keeps a seed collection and known DOIs, and drops values of the wrong type", () => {
    const good = normaliseSettings({ feeds: [{ name: "A", seedCollection: " Lib/Known ", knownDois: [" 10.1000/a ", "", 4, "10.1000/a", "10.1000/b"] }] });
    expect(good.feeds[0]).toMatchObject({ seedCollection: "Lib/Known", knownDois: ["10.1000/a", "10.1000/b"] });
    const bad = normaliseSettings({ feeds: [{ name: "B", seedCollection: 5, knownDois: "10.1000/a" }] });
    expect(bad.feeds[0]).toMatchObject({ seedCollection: "", knownDois: [] });
  });
});

describe("checkFeed", () => {
  it("has nothing to say about a good feed", () => {
    expect(checkFeed(feed())).toEqual([]);
  });

  it("warns about no topics, no required group, an empty group and unbalanced topics", () => {
    const warnings = checkFeed(feed({
      topics: ['("a" OR b', 'c "d'],
      groups: [{ name: "Empty", role: "boost", terms: [] }],
    }));
    expect(warnings).toEqual(expect.arrayContaining([
      expect.stringContaining("Unbalanced brackets"),
      expect.stringContaining("Unbalanced quotation marks"),
      expect.stringContaining("No required group"),
      expect.stringContaining('"Empty" has no terms'),
    ]));
    expect(checkFeed(feed({ topics: [] }))).toEqual([expect.stringContaining("No search topics")]);
  });
});

describe("feed JSON", () => {
  it("the first feed file imports cleanly, switched off, with the fixture's groups and terms", () => {
    const { feed: f, errors } = parseFeedJson(feedFile);
    expect(errors).toEqual([]);
    expect(f).toMatchObject({ name: "Lipoic acid copolymers", id: "lipoic-acid-copolymers", enabled: false, yearsFrom: null });
    expect(f?.topics).toHaveLength(4);
    expect(f?.groups).toEqual(lipoicFeed.groups);
    expect(f?.drop).toEqual(lipoicFeed.drop);
    expect(f?.lower).toEqual(lipoicFeed.lower);
    expect(checkFeed(f as FeedConfig)).toEqual([]);
  });

  it("scores the fixture papers by their known tiers with the imported feed", () => {
    const f = parseFeedJson(feedFile).feed as FeedConfig;
    for (const c of tierCases) expect(scorePaper(c, f).tier, c.id).toBe(c.tier);
  });

  it("strips a code fence", () => {
    const { feed: f, errors } = parseFeedJson("```json\n" + feedFile.trim() + "\n```");
    expect(errors).toEqual([]);
    expect(f?.name).toBe("Lipoic acid copolymers");
  });

  it("renames an import that clashes with an existing feed and keeps the ids unique", () => {
    const existing = [feed({ id: "lipoic-acid-copolymers", name: "Lipoic acid copolymers" })];
    const { feed: f } = parseFeedJson(feedFile, existing);
    expect(f?.name).toBe("Lipoic acid copolymers 2");
    expect(f?.id).toBe("lipoic-acid-copolymers-2");
  });

  it("says what is wrong", () => {
    expect(parseFeedJson("{nope").errors[0]).toMatch(/not valid JSON/);
    expect(parseFeedJson("[1]").errors[0]).toMatch(/JSON object/);
    expect(parseFeedJson("{}").errors).toEqual(['The feed needs a "name".']);
    const errors = parseFeedJson(JSON.stringify({
      name: "x", topics: "a", drop: 1, groups: [{ role: "huge" }, 3, { role: "boost", terms: "a" }], yearsFrom: 1800,
    })).errors;
    expect(errors).toEqual(expect.arrayContaining([
      expect.stringContaining('"topics"'),
      expect.stringContaining('"drop"'),
      expect.stringContaining("Group 1 needs a role"),
      expect.stringContaining("Group 2 must be an object"),
      expect.stringContaining("Group 3"),
      expect.stringContaining('"yearsFrom"'),
    ]));
    expect(parseFeedJson(JSON.stringify({ name: "x", groups: "no" })).errors).toEqual(['"groups" must be a list.']);
  });

  it("an import carries the seed collection and known DOIs, and refuses them with the wrong type", () => {
    const ok = parseFeedJson(JSON.stringify({ name: "x", seedCollection: "Lib/Known", knownDois: ["10.1000/a"] }));
    expect(ok.feed).toMatchObject({ seedCollection: "Lib/Known", knownDois: ["10.1000/a"] });
    expect(parseFeedJson(JSON.stringify({ name: "x", knownDois: "10.1000/a" })).errors).toEqual(['"knownDois" must be a list of DOIs.']);
    expect(parseFeedJson(JSON.stringify({ name: "x", seedCollection: ["a"] })).errors).toEqual(['"seedCollection" must be a collection path (text).']);
    expect(parseFeedJson(JSON.stringify({ name: "x" })).feed).toMatchObject({ seedCollection: "", knownDois: [] });
  });

  it("an import never switches itself on, whatever the file says", () => {
    expect(parseFeedJson(JSON.stringify({ name: "x", enabled: true, id: "evil" })).feed).toMatchObject({ enabled: false, id: "x" });
  });

  it("export round-trips and holds no key, id or switch", () => {
    const original = parseFeedJson(feedFile).feed as FeedConfig;
    const json = feedToJson({ ...original, enabled: true });
    expect(Object.keys(JSON.parse(json))).toEqual(["name", "topics", "groups", "drop", "lower", "yearsFrom", "zoteroCollection", "project", "seedCollection", "knownDois"]);
    expect(json).not.toMatch(/key|enabled|"id"/i);
    expect(parseFeedJson(json).feed).toEqual(original);
  });
});

describe("feed test (summary)", () => {
  const f = parseFeedJson(feedFile).feed as FeedConfig;
  const scan: ScanResult = {
    perTopic: [{ topic: "t1", count: 8, papers: [], costUsd: 0.001, truncated: false }],
    papers: [
      ...tierCases.map((c, i) => ({ ...c, openalexId: `W${i}`, authors: [], venue: null, publicationDate: null })),
      { title: "Flow synthesis of acrylamide copolymers", abstract: null, openalexId: "Wx", authors: [], venue: null, publicationDate: null },
    ],
    costUsd: 0.004,
  };

  it("counts papers per tier, lists the best first and carries the cost", () => {
    const s = summariseScan(scan, f, "2025-10-13", 3);
    expect(s).toMatchObject({ windowStart: "2025-10-13", papers: 9, costUsd: 0.004 });
    expect(s.perTier).toEqual({ priority: 2, strong: 2, possible: 2, dropped: 2, unchecked: 1 });
    expect(s.top.map((t) => t.tier)).toEqual(["priority", "priority", "strong"]);
    expect(s.perTopic).toEqual([{ topic: "t1", count: 8 }]);
  });

  it("looks back one year, but not before the feed's years from", () => {
    const now = new Date("2026-10-12T12:00:00Z");
    expect(testWindowStart(f, now)).toBe("2025-10-12");
    expect(testWindowStart({ ...f, yearsFrom: 2026 }, now)).toBe("2026-01-01");
    expect(testWindowStart({ ...f, yearsFrom: 2010 }, now)).toBe("2025-10-12");
  });

  it("runFeedTest scans the feed's topics from the window start", async () => {
    const calls: string[] = [];
    const client = {
      scan: async (topics: readonly string[], opts: { fromDate?: string }) => {
        calls.push(`${topics.length} topics from ${opts.fromDate}`);
        return scan;
      },
    };
    const s = await runFeedTest(client as never, f, new Date("2026-10-12T12:00:00Z"));
    expect(calls).toEqual(["4 topics from 2025-10-12"]);
    expect(s.papers).toBe(9);
  });
});
