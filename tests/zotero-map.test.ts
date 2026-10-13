import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { OpenAlexWork } from "../src/openalex/client";
import { FOUND_BY_TAG, bareDoi, feedTag, foundByLine, itemTypeOf, toCreator, toZoteroItem } from "../src/zotero/map";

// One real work (authors replaced by "Author n"): tests/fixtures/openalex-recorded.json.
const recorded = (JSON.parse(readFileSync(new URL("./fixtures/openalex-recorded.json", import.meta.url), "utf8")) as { results: OpenAlexWork[] }).results[0];

function work(overrides: Partial<OpenAlexWork> = {}): OpenAlexWork {
  return {
    id: "https://openalex.org/W42", title: "A title", doi: "https://doi.org/10.1000/ABC", publication_date: "2026-05-08", type: "article",
    abstract_inverted_index: { Some: [0], abstract: [1] },
    primary_location: { source: { display_name: "Journal of Tests", type: "journal" } },
    authorships: [{ author: { display_name: "Ada Lovelace" } }],
    ...overrides,
  };
}

describe("names and DOIs", () => {
  it("splits author names", () => {
    expect(toCreator("Ada Lovelace")).toEqual({ creatorType: "author", firstName: "Ada", lastName: "Lovelace" });
    expect(toCreator("Ada Byron King  Lovelace")).toEqual({ creatorType: "author", firstName: "Ada Byron King", lastName: "Lovelace" });
    expect(toCreator("Lovelace, Ada")).toEqual({ creatorType: "author", firstName: "Ada", lastName: "Lovelace" });
    expect(toCreator("Lovelace,")).toEqual({ creatorType: "author", name: "Lovelace" });
    expect(toCreator("Plato")).toEqual({ creatorType: "author", name: "Plato" });
    expect(toCreator("   ")).toBeNull();
  });

  it("makes a DOI bare and lower case", () => {
    expect(bareDoi("https://doi.org/10.1021/JACS.6C02848")).toBe("10.1021/jacs.6c02848");
    expect(bareDoi("doi: 10.1000/x")).toBe("10.1000/x");
    expect(bareDoi(null)).toBe("");
  });
});

describe("toZoteroItem", () => {
  it("maps the recorded journal article", () => {
    const item = toZoteroItem(recorded, "lipoic-acid-copolymers", ["COLL0001", "COLL0002"]);
    expect(item).toMatchObject({
      itemType: "journalArticle",
      title: "Biodegradability of Acrylate-Lipoic Acid Copolymers",
      publicationTitle: "Journal of the American Chemical Society",
      date: "2026-05-08",
      DOI: "10.1021/jacs.6c02848",
      url: "https://doi.org/10.1021/jacs.6c02848",
      extra: "OpenAlex: W7160516760",
      tags: [{ tag: "feed/lipoic-acid-copolymers" }],
      collections: ["COLL0001", "COLL0002"],
    });
    expect((item.creators as unknown[]).length).toBe(7);
    expect(String(item.abstractNote).startsWith("Lipoic acid has attracted a great deal of attention")).toBe(true);
    expect(item).not.toHaveProperty("repository");
    expect(item).not.toHaveProperty("university");
  });

  it("uses the field name that fits the item type", () => {
    expect(toZoteroItem(work({ type: "preprint" }), "f", [])).toMatchObject({ itemType: "preprint", repository: "Journal of Tests" });
    expect(toZoteroItem(work({ type: "preprint" }), "f", [])).not.toHaveProperty("publicationTitle");
    expect(toZoteroItem(work({ type: "dissertation" }), "f", [])).toMatchObject({ itemType: "thesis", university: "Journal of Tests" });
    expect(toZoteroItem(work({ type: "dissertation" }), "f", [])).not.toHaveProperty("publicationTitle");
    // The thesis type may lack a DOI field: the DOI goes into Extra instead (the link stays).
    const thesis = toZoteroItem(work({ type: "dissertation" }), "f", []);
    expect(thesis).not.toHaveProperty("DOI");
    expect(thesis.extra).toBe("OpenAlex: W42" + String.fromCharCode(10) + "DOI: 10.1000/abc");
    expect(thesis.url).toBe("https://doi.org/10.1000/abc");
    for (const other of ["article", "review", "book-chapter", "letter", null]) {
      expect(itemTypeOf(work({ type: other })), String(other)).toBe("journalArticle");
    }
  });

  it("leaves out what is missing, so Zotero has nothing to reject", () => {
    const item = toZoteroItem({ id: "https://openalex.org/W7", title: "  Only   a title " }, "f", []);
    expect(item).toEqual({ itemType: "journalArticle", title: "Only a title", extra: "OpenAlex: W7", tags: [{ tag: "feed/f" }], collections: [] });
  });

  it("does not link a DOI it does not have, and skips authors without a name", () => {
    const item = toZoteroItem(work({ doi: null, authorships: [{ author: { display_name: " " } }, { author: null }] }), "f", []);
    expect(item).not.toHaveProperty("DOI");
    expect(item).not.toHaveProperty("url");
    expect(item).not.toHaveProperty("creators");
  });

  it("tags with feed/<id>", () => {
    expect(feedTag("lipoic-acid-copolymers")).toBe("feed/lipoic-acid-copolymers");
  });
});

describe("where the item was found", () => {
  const nl = String.fromCharCode(10);

  it("words the Extra line with one, two or three topics, or none", () => {
    expect(foundByLine({ feedName: "Lipoic acid copolymers", topics: [] })).toBe('Found by: OpenAlex search, feed "Lipoic acid copolymers"');
    expect(foundByLine({ feedName: "F", topics: [2] })).toBe('Found by: OpenAlex search, feed "F", topic 2');
    expect(foundByLine({ feedName: "F", topics: [1, 3] })).toBe('Found by: OpenAlex search, feed "F", topics 1 and 3');
    expect(foundByLine({ feedName: "F", topics: [1, 2, 4] })).toBe('Found by: OpenAlex search, feed "F", topics 1, 2 and 4');
    expect(foundByLine({ feedName: "  A   B ", topics: [] })).toContain('feed "A B"');
  });

  it("adds the found-by tag and the Extra line after the OpenAlex id, next to the feed tag", () => {
    const item = toZoteroItem(work(), "f", ["C1"], { feedName: "Feed", topics: [1] });
    expect(item.tags).toEqual([{ tag: feedTag("f") }, { tag: FOUND_BY_TAG }]);
    expect(item.extra).toBe(["OpenAlex: W42", 'Found by: OpenAlex search, feed "Feed", topic 1'].join(nl));
  });

  it("keeps a thesis's DOI line in Extra between the id and the found-by line", () => {
    const item = toZoteroItem(work({ type: "dissertation" }), "f", [], { feedName: "Feed", topics: [] });
    expect(item.extra).toBe(["OpenAlex: W42", "DOI: 10.1000/abc", 'Found by: OpenAlex search, feed "Feed"'].join(nl));
  });

  it("adds neither without provenance (as for an item that was already in the library)", () => {
    const item = toZoteroItem(work(), "f", []);
    expect(item.tags).toEqual([{ tag: "feed/f" }]);
    expect(String(item.extra)).not.toContain("Found by");
  });
});
