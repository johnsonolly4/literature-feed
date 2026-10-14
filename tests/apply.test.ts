import { describe, expect, it } from "vitest";
import { applySuggestions, describeSuggestion } from "../src/prompts/apply";
import { DECISIONS_CAP, PROMPT_LIMIT, decisionsForPrompt, emptyDecisions, normaliseDecisions, recordDecisions, type Decision } from "../src/prompts/decisions";
import type { Suggestion } from "../src/prompts/schemas";
import type { FeedConfig } from "../src/settings/data";

function feed(): FeedConfig {
  return {
    id: "a", name: "A", enabled: true, topics: ["one", "two", "three"],
    groups: [{ name: "Poly", role: "required", terms: ["polymer"] }, { name: "Flow", role: "boost", terms: ["flow"] }],
    drop: ["gold"], lower: ["adhesive"], yearsFrom: null, zoteroCollection: "", project: "", seedCollection: "", knownDois: [],
  };
}

const r = "because";

describe("applySuggestions: terms and groups", () => {
  it("adds and removes terms in a group, drop and lower, ignoring case and not doubling a term", () => {
    const out = applySuggestions(feed(), [
      { kind: "add_term", list: "poly", term: "copolymer", reason: r },
      { kind: "add_term", list: "Poly", term: "POLYMER", reason: r },
      { kind: "add_term", list: "DROP", term: "quantum dot", reason: r },
      { kind: "remove_term", list: "lower", term: "Adhesive", reason: r },
      { kind: "remove_term", list: "Flow", term: "flow", reason: r },
    ]);
    expect(out.errors).toEqual([]);
    expect(out.feed.groups[0].terms).toEqual(["polymer", "copolymer"]);
    expect(out.feed.drop).toEqual(["gold", "quantum dot"]);
    expect(out.feed.lower).toEqual([]);
    expect(out.feed.groups[1].terms).toEqual([]);
  });

  it("sets a role and adds a group, and reports a missing group or a duplicate", () => {
    const out = applySuggestions(feed(), [
      { kind: "set_group_role", group: "flow", role: "priority", reason: r },
      { kind: "add_group", group: "Degradation", role: "boost", terms: ["degradable"], reason: r },
      { kind: "add_group", group: "poly", role: "boost", terms: ["x"], reason: r },
      { kind: "set_group_role", group: "Nope", role: "boost", reason: r },
      { kind: "add_term", list: "Nope", term: "x", reason: r },
      { kind: "remove_term", list: "drop", term: "not there", reason: r },
    ]);
    expect(out.feed.groups.map((g) => [g.name, g.role])).toEqual([["Poly", "required"], ["Flow", "priority"], ["Degradation", "boost"]]);
    expect(out.errors).toHaveLength(4);
    expect(out.errors.join("\n")).toContain('there is no group "Nope"');
    expect(out.errors.join("\n")).toContain("a group of that name exists");
    expect(out.errors.join("\n")).toContain("that term is not there");
  });

  it("does not change the feed it is given", () => {
    const original = feed();
    applySuggestions(original, [{ kind: "add_term", list: "drop", term: "x", reason: r }, { kind: "remove_topic", topic: 1, reason: r }]);
    expect(original).toEqual(feed());
  });
});

describe("applySuggestions: topics", () => {
  it("numbers refer to the topics as they are now, so a removal does not shift a replacement", () => {
    const out = applySuggestions(feed(), [
      { kind: "remove_topic", topic: 1, reason: r },
      { kind: "replace_topic", topic: 3, query: "THREE", reason: r },
      { kind: "add_topic", query: "four", reason: r },
    ]);
    expect(out.errors).toEqual([]);
    expect(out.feed.topics).toEqual(["two", "THREE", "four"]);
  });

  it("reports a topic number out of range, and does not add a topic twice", () => {
    const out = applySuggestions(feed(), [
      { kind: "replace_topic", topic: 9, query: "x", reason: r },
      { kind: "remove_topic", topic: 4, reason: r },
      { kind: "add_topic", query: "ONE", reason: r },
      { kind: "add_topic", query: "new", reason: r },
      { kind: "add_topic", query: "NEW", reason: r },
    ]);
    expect(out.errors).toHaveLength(2);
    expect(out.feed.topics).toEqual(["one", "two", "three", "new"]);
  });
});

describe("describeSuggestion", () => {
  it("is one readable line per kind", () => {
    const list: Suggestion[] = [
      { kind: "add_term", list: "drop", term: "gold", reason: r },
      { kind: "remove_term", list: "Flow", term: "flow", reason: r },
      { kind: "set_group_role", group: "Flow", role: "priority", reason: r },
      { kind: "add_group", group: "G", role: "boost", terms: ["a", "b"], reason: r },
      { kind: "replace_topic", topic: 2, query: "q", reason: r },
      { kind: "add_topic", query: "q", reason: r },
      { kind: "remove_topic", topic: 3, reason: r },
    ];
    expect(list.map(describeSuggestion)).toEqual([
      'add "gold" to the drop list', 'remove "flow" from group "Flow"', 'make group "Flow" priority', 'add group "G" (boost: a, b)',
      "replace topic 2 with: q", "add topic: q", "remove topic 3",
    ]);
  });
});

function decision(n: number, overrides: Partial<Decision> = {}): Decision {
  return { at: "2026-10-13", feedId: "a", kind: "add_term", summary: `s${n}`, llmReason: "", verdict: "accepted", userReason: "", ...overrides };
}

describe("decisions", () => {
  it("keeps the newest entries up to the cap", () => {
    const d = emptyDecisions();
    recordDecisions(d, Array.from({ length: DECISIONS_CAP + 3 }, (_, i) => decision(i)));
    expect(d.items).toHaveLength(DECISIONS_CAP);
    expect(d.items[DECISIONS_CAP - 1].summary).toBe(`s${DECISIONS_CAP + 2}`);
  });

  it("groups one feed's decisions by verdict, newest last, at most PROMPT_LIMIT each", () => {
    const d = emptyDecisions();
    recordDecisions(d, [
      ...Array.from({ length: PROMPT_LIMIT + 5 }, (_, i) => decision(i)),
      decision(900, { verdict: "rejected", userReason: "no" }), decision(901, { feedId: "b" }),
    ]);
    const got = decisionsForPrompt(d, "a");
    expect(got.accepted).toHaveLength(PROMPT_LIMIT);
    expect(got.accepted[PROMPT_LIMIT - 1].summary).toBe(`s${PROMPT_LIMIT + 4}`);
    expect(got.rejected.map((x) => x.summary)).toEqual(["s900"]);
  });

  it("reads a stored file tolerantly", () => {
    const stored = JSON.parse(JSON.stringify({ version: 1, items: [decision(1)] })) as unknown;
    expect(normaliseDecisions(stored).items).toEqual([decision(1)]);
    for (const raw of [null, undefined, 3, "x", [], {}, { items: "no" }]) expect(normaliseDecisions(raw)).toEqual(emptyDecisions());
    const mixed = normaliseDecisions({ items: [decision(1), { ...decision(2), kind: "sing" }, { ...decision(3), verdict: "maybe" }, { ...decision(4), at: "yesterday" }, 5, { ...decision(6), userReason: 7 }] });
    expect(mixed.items.map((x) => x.summary)).toEqual(["s1", "s6"]);
    expect(mixed.items[1].userReason).toBe("");
  });
});
