// The review pointer: invented works only.
import { describe, expect, it } from "vitest";
import { buildWorksByIdUrl, pageCount } from "../src/openalex/client";
import { reviewFlag } from "../src/review/review-flag";

describe("reviewFlag", () => {
  it("is sure for OpenAlex type review and for review journals", () => {
    expect(reviewFlag({ type: "review" })).toEqual({ level: "sure", reason: "OpenAlex type: review" });
    expect(reviewFlag({ type: "article", venue: "Annual Review of Polymer X" }).level).toBe("sure");
    expect(reviewFlag({ venue: "Angewandte Chemie" }).level).toBe("");
  });

  it("suspects many references, a long paper with many references, or a review-like title", () => {
    expect(reviewFlag({ title: "Plain study of widgets", referenceCount: 160 })).toEqual({ level: "suspect", reason: "160 references" });
    expect(reviewFlag({ title: "Plain study of widgets", referenceCount: 90, pages: 20 }).level).toBe("suspect");
    expect(reviewFlag({ title: "Plain study of widgets", referenceCount: 40, pages: 20 }).level).toBe("");
    expect(reviewFlag({ title: "Recent advances in widget chemistry", referenceCount: 40 }).level).toBe("suspect");
  });

  it("gives no flag for a plain paper", () => {
    expect(reviewFlag({ title: "Plain study of widgets", referenceCount: 40, type: "article", venue: "Journal of Widgets" })).toEqual({ level: "", reason: "" });
    expect(reviewFlag({})).toEqual({ level: "", reason: "" });
  });
});

describe("pageCount", () => {
  it("counts plain page ranges only", () => {
    expect(pageCount({ first_page: "101", last_page: "120" })).toBe(20);
    expect(pageCount({ first_page: "e123", last_page: "e130" })).toBeUndefined();
    expect(pageCount({ first_page: "5", last_page: null })).toBeUndefined();
    expect(pageCount({ first_page: "20", last_page: "10" })).toBeUndefined();
    expect(pageCount(null)).toBeUndefined();
  });
});

describe("review requests ask for biblio", () => {
  it("is in the extra field list", () => {
    expect(new URL(buildWorksByIdUrl(["W1"])).searchParams.get("select")).toContain("biblio");
  });
});
