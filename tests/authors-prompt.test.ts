// The authors audit prompt (what it asks and shows) and the check of the LLM's pasted answer.
import { describe, expect, it } from "vitest";
import { AUDIT_EXAMPLE, buildAuditPrompt, checkAuditAnswer, pickAuditAuthors, verdictFor } from "../src/review/authors-prompt";
import { authorShares, type WorkRef } from "../src/review/gaps-authors";
import { emptyGapsSession, normaliseGapsSession } from "../src/review/gaps-input";

const w = (id: string, year: number, authors: string[]): WorkRef => ({ id, title: `Title of ${id}`, year, doi: `10.1/${id}`, authors, authorIds: authors.map(() => ""), citedBy: 1 });

const citedWorks = [w("W1", 2015, ["Ann Lee"]), w("W2", 2016, ["Ann Lee"]), w("W3", 2017, ["Ann Lee"]), w("W4", 2018, ["Cy Poe"])];
const gapWorks = [w("W11", 2019, ["Bob Roe"]), w("W12", 2020, ["Bob Roe"]), w("W13", 2025, ["Bob Roe"]), w("W14", 2021, ["Cy Poe"])];
const table = authorShares(citedWorks.map((x) => x.authors), gapWorks.map((x) => x.authors), { min: 2, own: ["Ann Lee"] });

const input = { paper: { title: "The paper", year: 2022, doi: "10.9/p", authors: ["Ann Lee"] }, scope: "first-level gaps", rows: table.rows, citedWorks, gapWorks, citedTotal: table.citedWorks, uncitedTotal: table.uncitedWorks, minWorks: 2 };

describe("the audit prompt", () => {
  const text = buildAuditPrompt(input);

  it("says what the paper is, how the numbers were made, and who to check", () => {
    expect(text).toContain("The paper");
    expect(text).toContain("family name and first initial");
    expect(text).toContain("★ Ann Lee");
    expect(text).toContain("Bob Roe | flagged: under-cited");
  });

  it("lists each author's works with labels and marks one out after the paper", () => {
    expect(text).toMatch(/C1 \| 2015 \| Title of W1/);
    expect(text).toMatch(/G3 \| 2025 \| Title of W13.*out AFTER the paper/);
  });

  it("asks for web evidence, forbids inventing, and shows the answer format", () => {
    expect(text).toContain("never invent");
    expect(text).toContain('"verdict": "supported"');
    expect(text).toContain("Reply with JSON only");
  });

  it("puts flagged and own authors first and caps the number", () => {
    expect(pickAuditAuthors(table.rows, 1)).toHaveLength(1);
    const picked = pickAuditAuthors(table.rows, 5);
    const firstUnflagged = picked.findIndex((r) => r.label === "" && !r.own);
    expect(firstUnflagged === -1 || picked.slice(firstUnflagged).every((r) => r.label === "" && !r.own)).toBe(true);
  });
});

describe("checking the answer", () => {
  it("reads the example, also inside a fenced reply and as a bare list", () => {
    const json = JSON.stringify(AUDIT_EXAMPLE);
    const a = checkAuditAnswer("Here you go:\n```json\n" + json + "\n```\nHope that helps");
    expect(a.ok && a.value.authors[0]).toMatchObject({ author: "Ann Lee", claim: "under-cited", verdict: "supported" });
    const bare = checkAuditAnswer(JSON.stringify(AUDIT_EXAMPLE.authors).replace(/^\[/, "{\"authors\":[").concat("}"));
    expect(bare.ok).toBe(true);
  });

  it("names what is wrong", () => {
    const bad = checkAuditAnswer(JSON.stringify({ authors: [{ author: "X", claim: "maybe", verdict: "supported" }, { claim: "under-cited" }] }));
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.errors.join(" ")).toMatch(/X: "claim" must be.*Entry 2 has no "author"/);
    expect(checkAuditAnswer("no json here").ok).toBe(false);
    expect(checkAuditAnswer('{"summary": "x"}').ok).toBe(false);
  });

  it("matches an author's verdict by name, ignoring case and accents", () => {
    const ok = checkAuditAnswer(JSON.stringify({ authors: [{ author: "ann lée", claim: "over-cited", verdict: "refuted", evidence: [] }] }));
    expect(ok.ok && verdictFor(ok.value, "Ann Lee")?.verdict).toBe("refuted");
    expect(verdictFor(null, "Ann Lee")).toBeNull();
  });

  it("keeps the pasted answer and what it was read as in the saved session", () => {
    const ok = checkAuditAnswer(JSON.stringify(AUDIT_EXAMPLE));
    const s = { ...emptyGapsSession(), audit: { answer: "pasted", result: ok.ok ? ok.value : null } };
    expect(normaliseGapsSession(JSON.parse(JSON.stringify(s)))?.audit).toEqual({ answer: "pasted", result: AUDIT_EXAMPLE });
  });
});
