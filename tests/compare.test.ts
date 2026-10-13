import { describe, expect, it } from "vitest";
import { buildComparePrompt, buildTopicPrompt } from "../src/prompts/build";
import { COMPARE_EXAMPLE, checkCompareAnswer } from "../src/prompts/schemas";
import type { FeedConfig } from "../src/settings/data";

function feed(id = "a", name = "Polymers"): FeedConfig {
  return {
    id, name, enabled: true, topics: ["one", "two"], groups: [{ name: "Poly", role: "required", terms: ["polymer"] }],
    drop: [], lower: [], yearsFrom: null, zoteroCollection: "", project: "",
  };
}

const input = { feeds: [feed(), feed("b", "Catalysts")], summary: "- Polymers: 10 papers listed", overlapMarkdown: "## Overlap\n\nBoth list 3 papers" };

describe("the compare prompt and its answer", () => {
  it("the example passes the validator and is the one the prompt prints", () => {
    const r = checkCompareAnswer(COMPARE_EXAMPLE);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.map((a) => a.action)).toEqual(["narrow", "merge", "keep"]);
    const block = /```json\n([\s\S]*?)\n```/.exec(buildComparePrompt(input))?.[1] ?? "";
    expect(JSON.parse(block)).toEqual(COMPARE_EXAMPLE);
  });

  it("carries every search, the numbers and the overlap, and says it is advice", () => {
    const prompt = buildComparePrompt(input);
    expect(prompt).toContain("Search name: Polymers");
    expect(prompt).toContain("Search name: Catalysts");
    expect(prompt).toContain("- Polymers: 10 papers listed");
    expect(prompt).toContain("Both list 3 papers");
    expect(prompt).toContain("I will make the changes by hand");
    expect(prompt).toContain("Answer with JSON only");
    expect(buildComparePrompt({ feeds: [feed()], summary: "", overlapMarkdown: "" })).toContain("(no overlap data yet)");
  });

  it("validates advice: keeps good entries, lists problems, rejects the wrong shape", () => {
    const r = checkCompareAnswer({
      advice: [{ search: "A", action: "merge", with: "B", advice: "do it", reason: "x" }, { search: "A", action: "dance", advice: "x" }, { action: "keep", advice: "x" }, "no"],
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual([{ search: "A", action: "merge", with: "B", advice: "do it", reason: "x" }]);
    const bad = checkCompareAnswer({ advice: [{ search: "A", action: "dance", advice: "x" }] });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.errors[0]).toContain("Advice 1");
    for (const x of [null, [], {}, { advice: "no" }, { advice: [] }]) expect(checkCompareAnswer(x).ok).toBe(false);
  });

  it("the tweak prompt carries the topic overlap when there is some", () => {
    const withOverlap = buildTopicPrompt({ feed: feed(), stats: [], note: "", topicOverlap: "### Between the topics of Polymers\n\nTopic 2 adds nothing" });
    expect(withOverlap).toContain("HOW THE TOPICS OVERLAP");
    expect(withOverlap).toContain("Topic 2 adds nothing");
    expect(buildTopicPrompt({ feed: feed(), stats: [], note: "" })).not.toContain("HOW THE TOPICS OVERLAP");
    expect(buildTopicPrompt({ feed: feed(), stats: [], note: "", topicOverlap: "  " })).not.toContain("HOW THE TOPICS OVERLAP");
  });
});
