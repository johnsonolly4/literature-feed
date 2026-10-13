import { describe, expect, it } from "vitest";
import { buildNewFeedPrompt, buildReviewPrompt, buildTopicPrompt, describeFeed, titlesByVerdict, topicStatRows } from "../src/prompts/build";
import { emptyLedger, recordScan } from "../src/ledger/ledger";
import {
  NEW_FEED_EXAMPLE, REVIEW_EXAMPLE, TOPIC_EXAMPLE, checkReviewAnswer, checkTopicAnswer, extractJson, queryProblem, type Suggestion,
} from "../src/prompts/schemas";
import { parseFeedJson, type FeedConfig } from "../src/settings/data";

function feed(overrides: Partial<FeedConfig> = {}): FeedConfig {
  return {
    id: "a", name: "Polymers", enabled: true,
    topics: ["(\"lipoic acid\") AND polymer", "dithiolane AND \"ring-opening\""],
    groups: [{ name: "Polymerisation", role: "required", terms: ["polymer", "copolymer"] }, { name: "Flow", role: "priority", terms: ["flow"] }],
    drop: ["clinical trial"], lower: ["adhesive"], yearsFrom: 2020, zoteroCollection: "", project: "", ...overrides,
  };
}

describe("extractJson", () => {
  it("reads a bare object, a fenced block, and an object with prose around it", () => {
    expect(extractJson('{"a": 1}')).toEqual({ ok: true, value: { a: 1 } });
    expect(extractJson('Here you go:\n```json\n{"a": 2}\n```\nHope it helps!')).toEqual({ ok: true, value: { a: 2 } });
    expect(extractJson('```\n{"a": 3}\n```')).toEqual({ ok: true, value: { a: 3 } });
    expect(extractJson('Sure. {"a": 4} Done.')).toEqual({ ok: true, value: { a: 4 } });
  });

  it("falls back to the braces when the fenced block is not JSON", () => {
    expect(extractJson('```text\nnot json\n```\nand then {"a": 5}')).toEqual({ ok: true, value: { a: 5 } });
  });

  it("says plainly when there is no JSON or it is broken", () => {
    expect(extractJson("no braces here")).toMatchObject({ ok: false });
    const bad = extractJson('{"a": }');
    expect(bad).toMatchObject({ ok: false });
    expect(bad.ok ? "" : bad.errors[0]).toContain("could not be read");
  });
});

describe("queryProblem", () => {
  it("accepts a balanced string and names the problem otherwise", () => {
    expect(queryProblem('("a b" OR c) AND d')).toBeNull();
    expect(queryProblem("")).toContain("empty");
    expect(queryProblem("(a AND b")).toContain("brackets");
    expect(queryProblem('"a AND b')).toContain("quotation");
  });
});

describe("the examples in the prompts pass their own validators", () => {
  it("review example", () => {
    const r = checkReviewAnswer(REVIEW_EXAMPLE);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.map((s) => s.kind).sort()).toEqual(["add_group", "add_term", "add_topic", "remove_term", "remove_topic", "replace_topic", "set_group_role"]);
  });

  it("topic example: keep is dropped, the rest become suggestions", () => {
    const r = checkTopicAnswer(TOPIC_EXAMPLE);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.map((s) => s.kind)).toEqual(["replace_topic", "add_topic", "remove_topic"]);
  });

  it("new feed example imports as a feed and the notes field is ignored", () => {
    const parsed = parseFeedJson(JSON.stringify(NEW_FEED_EXAMPLE));
    expect(parsed.errors).toEqual([]);
    expect(parsed.feed?.name).toBe("Lipoic acid copolymers");
    expect(parsed.feed?.enabled).toBe(false);
    expect(parsed.feed).not.toHaveProperty("notes");
    expect(parsed.feed?.groups).toHaveLength(4);
  });

  it("and each prompt prints its example, so what the LLM copies is accepted", () => {
    const review = buildReviewPrompt({ feed: feed(), reportMarkdown: "# r", accepted: [], rejected: [] });
    const topics = buildTopicPrompt({ feed: feed(), stats: [], note: "" });
    const created = buildNewFeedPrompt({ description: "x", exampleCount: 2 });
    for (const [prompt, example] of [[review, REVIEW_EXAMPLE], [topics, TOPIC_EXAMPLE], [created, NEW_FEED_EXAMPLE]] as const) {
      const block = /```json\n([\s\S]*?)\n```/.exec(prompt)?.[1] ?? "";
      expect(JSON.parse(block)).toEqual(example);
    }
  });
});

describe("checkReviewAnswer", () => {
  it("keeps the good suggestions and lists every problem with the bad ones", () => {
    const r = checkReviewAnswer({
      suggestions: [
        { kind: "add_term", list: "drop", term: "gold", reason: "r" },
        { kind: "add_term", list: "drop" },
        { kind: "set_group_role", group: "G", role: "mega" },
        { kind: "replace_topic", topic: 0, query: "a" },
        { kind: "replace_topic", topic: 1, query: "(a" },
        { kind: "add_group", group: "G", role: "boost", terms: [] },
        { kind: "sing" },
        "x",
      ],
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual([{ kind: "add_term", list: "drop", term: "gold", reason: "r" }]);
  });

  it("fails with the errors when nothing is usable", () => {
    const r = checkReviewAnswer({ suggestions: [{ kind: "sing" }, { kind: "add_topic", query: "(x" }] });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors).toHaveLength(2);
      expect(r.errors[0]).toContain("Suggestion 1");
      expect(r.errors[0]).toContain("add_term");
      expect(r.errors[1]).toContain("brackets");
    }
  });

  it("rejects the wrong shape and an empty list", () => {
    for (const bad of [null, [], "x", {}, { suggestions: "no" }]) expect(checkReviewAnswer(bad).ok).toBe(false);
    expect(checkReviewAnswer({ suggestions: [] }).ok).toBe(false);
  });
});

describe("checkTopicAnswer", () => {
  it("maps the actions and reports a missing or bad one", () => {
    const r = checkTopicAnswer({ topics: [{ action: "change", index: 2, query: "a AND b", reason: "x" }, { action: "dance" }, { action: "remove" }, { action: "keep", index: 1 }] });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual<Suggestion[]>([{ kind: "replace_topic", topic: 2, query: "a AND b", reason: "x" }]);
  });

  it("says when every topic is kept, and rejects the wrong shape", () => {
    const r = checkTopicAnswer({ topics: [{ action: "keep", index: 1 }] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]).toContain("every topic is marked keep");
    expect(checkTopicAnswer({ suggestions: [] }).ok).toBe(false);
  });
});

describe("the prompts", () => {
  it("print the search, the ranking rules, the query rules and the JSON-only instruction", () => {
    const text = buildTopicPrompt({ feed: feed(), stats: [{ topic: 1, returned: 40, listed: 5, dropped: 30, scans: 3 }], note: "I care about flow chemistry." });
    expect(text).toContain("Search name: Polymers");
    expect(text).toContain('  2. dithiolane AND "ring-opening"');
    expect(text).toContain("- Flow [priority]: flow");
    expect(text).toContain("Drop terms: clinical trial");
    expect(text).toContain("Only papers from this year on: 2020");
    expect(text).toContain("| 1 | 40 | 5 | 30 | 3 |");
    expect(text).toContain("I care about flow chemistry.");
    expect(text).toContain("British and American spellings");
    expect(text).toContain("Answer with JSON only");
    expect(text).toContain("say so in the JSON's reason or notes field");
  });

  it("the review prompt carries the report, the earlier decisions with their reasons, and titles only when given", () => {
    const base = {
      feed: feed(), reportMarkdown: "# Search effectiveness\n\n3 listed",
      accepted: [{ at: "2026-10-01", feedId: "a", kind: "add_term" as const, summary: 'add "gold" to the drop list', llmReason: "never wanted", verdict: "accepted" as const, userReason: "" }],
      rejected: [{ at: "2026-10-02", feedId: "a", kind: "remove_topic" as const, summary: "remove topic 2", llmReason: "low yield", verdict: "rejected" as const, userReason: "it is my main angle" }],
    };
    const without = buildReviewPrompt(base);
    expect(without).toContain("3 listed");
    expect(without).toContain('2026-10-01: add "gold" to the drop list (you said: never wanted)');
    expect(without).toContain("remove topic 2 (you said: low yield) (the user said: it is my main angle)");
    expect(without).not.toContain("TITLES OF WANTED PAPERS");
    const withTitles = buildReviewPrompt({ ...base, titles: { wanted: ["Good paper"], dismissed: ["Bad paper"] } });
    expect(withTitles).toContain("  - Good paper");
    expect(withTitles).toContain("  - Bad paper");
    expect(buildReviewPrompt({ ...base, accepted: [], rejected: [] })).toContain("(none yet)");
  });

  it("the new-feed prompt names the number of attached papers, once and many, and none", () => {
    expect(buildNewFeedPrompt({ description: "Polymers from lipoic acid", exampleCount: 3 })).toContain("3 example papers are attached to this chat");
    expect(buildNewFeedPrompt({ description: "x", exampleCount: 1 })).toContain("1 example paper is attached to this chat");
    expect(buildNewFeedPrompt({ description: "x", exampleCount: 0 })).toContain("I am not attaching example papers");
    expect(buildNewFeedPrompt({ description: "Polymers from lipoic acid", exampleCount: 2 })).toContain("Polymers from lipoic acid");
    expect(buildNewFeedPrompt({ description: "x", exampleCount: 2.9 })).toContain("2 example papers");
  });

  it("describeFeed copes with an empty search", () => {
    const text = describeFeed(feed({ topics: [], groups: [], drop: [], lower: [], yearsFrom: null }));
    expect(text).toContain("(none)");
    expect(text).toContain("no limit");
  });
});

describe("numbers from the ledger for the prompts", () => {
  it("sums what each topic did over one search's logged scans", () => {
    const ledger = emptyLedger();
    recordScan(ledger, "2026-10-05", [{ feedId: "a", topics: [{ returned: 10, listed: 2, dropped: 3 }, { returned: 4, listed: 0, dropped: 1 }] }, { feedId: "b", topics: [{ returned: 99, listed: 9, dropped: 9 }] }]);
    recordScan(ledger, "2026-10-12", [{ feedId: "a", topics: [{ returned: 6, listed: 1, dropped: 0 }] }]);
    expect(topicStatRows(ledger.scans, "a")).toEqual([
      { topic: 1, returned: 16, listed: 3, dropped: 3, scans: 2 },
      { topic: 2, returned: 4, listed: 0, dropped: 1, scans: 1 },
    ]);
    expect(topicStatRows(ledger.scans, "zzz")).toEqual([]);
  });

  it("lists titles of wanted and dismissed papers, newest weeks first, capped, leaving undecided ones out", () => {
    const ledger = emptyLedger();
    const base = { tier: "strong" as const, topics: [], terms: [], def: 0 };
    ledger.papers["a/W1"] = { ...base, title: "Old wanted", start: "2026-08-03", ticked: "2026-08-05" };
    ledger.papers["a/W2"] = { ...base, title: "New wanted", start: "2026-09-07", read: "2026-09-10" };
    ledger.papers["a/W3"] = { ...base, title: "Dismissed", start: "2026-08-03" };
    ledger.papers["a/W4"] = { ...base, title: "Undecided", start: "2026-10-12" };
    ledger.papers["b/W5"] = { ...base, title: "Other search", start: "2026-08-03", ticked: "2026-08-05" };
    const got = titlesByVerdict(ledger, "a", "2026-10-13", 4);
    expect(got).toEqual({ wanted: ["New wanted", "Old wanted"], dismissed: ["Dismissed"] });
    expect(titlesByVerdict(ledger, "a", "2026-10-13", 4, 1).wanted).toEqual(["New wanted"]);
  });
});
