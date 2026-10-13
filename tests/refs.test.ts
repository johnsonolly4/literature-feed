// Tidying a pasted reference list and checking Crossref matches: splitting numbered and unnumbered lists with ragged lines, reading the
// parts of a reference, and the OK / CHECK / NOT FOUND judgement. Nothing calls the network.
import { describe, expect, it } from "vitest";
import { authorsLine, chooseBest, compact, evaluate, longestCommonSubstring, titleScore, type CrossrefItem } from "../src/refs/match";
import { cleanText, doiInText, parseReference, splitReferences } from "../src/refs/split";

const R1 = "Veldmar, K. R.; Orrinson, P. T.; Fenwick de Laro, J.; Brennick, C. M.; Halvorn, C. J. Controlled-radical polymerization of lipoic acid: a general route to degradable vinyl copolymers. J. Am. Chem. Soc. 2023, 145, 22728-22734.";
const R2 = "Smith, J.; Doe, A. Degradable vinyl copolymers made with lipoic acid and RAFT agents. Macromolecules 2024, 57, 100-110.";
const R3 = "Lee, K. Dithiolane ring-opening polymerisation of thioctic acid for recyclable networks. Green Chem. 2022, 24, 5000-5010.";

describe("splitReferences: numbered lists", () => {
  it("splits on the numbers and joins ragged lines", () => {
    const text = ["1. Veldmar, K. R.; Orrinson, P. T.; Fenwick de Laro,", "J.; Brennick, C. M. Controlled-radical polymerization of", "", "lipoic acid. J. Am. Chem. Soc. 2023, 145, 22728-", "22734.", "2. Smith, J.; Doe, A. Degradable vinyl copolymers.", "Macromolecules 2024, 57, 100-110."].join("\n");
    const refs = splitReferences(text);
    expect(refs.map((r) => r.n)).toEqual([1, 2]);
    expect(refs[0].text).toBe("Veldmar, K. R.; Orrinson, P. T.; Fenwick de Laro, J.; Brennick, C. M. Controlled-radical polymerization of lipoic acid. J. Am. Chem. Soc. 2023, 145, 22728-22734.");
    expect(refs[1].text).toBe("Smith, J.; Doe, A. Degradable vinyl copolymers. Macromolecules 2024, 57, 100-110.");
  });

  it("understands [1] and (1) and 1) numbering", () => {
    for (const [a, b] of [["[1]", "[2]"], ["(1)", "(2)"], ["1)", "2)"]]) {
      const refs = splitReferences(`${a} ${R1}\n${b} ${R2}`);
      expect(refs).toHaveLength(2);
      expect(refs[0].text.startsWith("Veldmar")).toBe(true);
    }
  });

  it("drops page headers and a References heading, and only counts the next number in the sequence", () => {
    const text = ["References", "1. First reference text 2020.", "Journal of Things Page 3 of 9", "continued here.", "2. Second reference 2021.", "7. a stray number inside the second one"].join("\n");
    const refs = splitReferences(text);
    expect(refs).toHaveLength(2);
    expect(refs[0].text).toBe("First reference text 2020. continued here.");
    expect(refs[1].text).toBe("Second reference 2021. 7. a stray number inside the second one");
  });

  it("closes up page ranges broken by a space, and mends words broken at a line end", () => {
    const refs = splitReferences("1. Some authors. Controlled polymeri-\nzation of acids. J. Test 2020, 12, 219- 233.\n2. Other. Title. J. Test 2021, 5, 1 – 9.");
    expect(refs[0].text).toBe("Some authors. Controlled polymeri-zation of acids. J. Test 2020, 12, 219-233.");
    expect(refs[1].text).toContain("1-9");
  });

  it("cleans ligatures and soft hyphens", () => {
    expect(cleanText("ﬁnal ﬂow of­water")).toBe("final flow ofwater");
    expect(splitReferences("1. The ﬁrst study 2020.\n2. The second study 2021.")[0].text).toBe("The first study 2020.");
  });
});

describe("splitReferences: no numbering", () => {
  it("splits blank-line separated references", () => {
    const refs = splitReferences(`${R1}\n\n${R2}\n\n${R3}`);
    expect(refs.map((r) => r.text)).toEqual([R1, R2, R3]);
  });

  it("splits one reference per line with no blank lines", () => {
    const refs = splitReferences(`${R1}\n${R2}\n${R3}`);
    expect(refs.map((r) => r.text)).toEqual([R1, R2, R3]);
  });

  it("splits references broken over several lines when the next one starts like an author list", () => {
    const text = [
      "Veldmar, K. R.; Orrinson, P. T.; Fenwick de Laro, J.;", "Brennick, C. M.; Halvorn, C. J. Controlled-radical polymerization", "of lipoic acid. J. Am. Chem. Soc. 2023, 145,", "22728-22734.",
      "Smith, J.; Doe, A. Degradable vinyl copolymers made with", "lipoic acid. Macromolecules 2024, 57, 100-110.",
    ].join("\n");
    const refs = splitReferences(text);
    expect(refs).toHaveLength(2);
    expect(refs[0].text.endsWith("145, 22728-22734.")).toBe(true);
    expect(refs[1].text.startsWith("Smith, J.; Doe, A.")).toBe(true);
  });

  it("does not split in the middle of a reference at a stray blank line before the year", () => {
    const refs = splitReferences("Veldmar, K. R.; Orrinson, P. T. Controlled-radical\n\npolymerization of lipoic acid. J. Am. Chem. Soc. 2023, 145, 22728-22734.");
    expect(refs).toHaveLength(1);
  });

  it("copes with initials first and Vancouver styles", () => {
    const text = ["K. R. Veldmar, P. T. Orrinson and C. J. Halvorn, Controlled polymerization of lipoic acid, J. Am. Chem. Soc., 2023, 145, 22728.", "Smith JA, Doe B. Degradable copolymers of lipoic acid. Macromolecules. 2024;57:100-10."].join("\n");
    expect(splitReferences(text)).toHaveLength(2);
  });

  it("gives nothing for empty text and one reference for a single reference", () => {
    expect(splitReferences("  \n\n")).toEqual([]);
    expect(splitReferences(R1)).toHaveLength(1);
  });
});

describe("doiInText and parseReference", () => {
  it("finds a DOI and leaves the sentence punctuation out", () => {
    expect(doiInText("See https://doi.org/10.1021/JACS.3C08248.")).toBe("10.1021/jacs.3c08248");
    expect(doiInText("doi:10.1002/anie.202215329)")).toBe("10.1002/anie.202215329");
    expect(doiInText("no doi here")).toBe("");
  });

  it("reads the first author, year, volume and pages", () => {
    const p = parseReference(`1. ${R1}`);
    expect(p).toMatchObject({ firstAuthor: "Veldmar", year: 2023, volume: "145", pages: "22728-22734", software: false });
    expect(p.body.startsWith("Veldmar")).toBe(true);
  });

  it("reads issue numbers, pp. pages and a year in brackets", () => {
    expect(parseReference("Smith, J. Title of a paper. J. Test 2020, 12(3), 100-110.")).toMatchObject({ year: 2020, volume: "12", issue: "3", pages: "100-110" });
    expect(parseReference("Smith, J. Title of a book chapter. In Book. Pub 2019, pp. 10-20.")).toMatchObject({ year: 2019, pages: "10-20", volume: "" });
    expect(parseReference("Smith, J. (2021). A paper title here. Journal of Tests, 14(2), 55-60.")).toMatchObject({ year: 2021, volume: "14", pages: "55-60" });
  });

  it("flags software and repository references", () => {
    expect(parseReference("Doe, J. A tool for things. GitHub repository, https://github.com/doe/tool, 2022.").software).toBe(true);
    expect(parseReference(R2).software).toBe(false);
  });
});

function item(over: Partial<CrossrefItem> = {}): CrossrefItem {
  return {
    DOI: "10.1021/jacs.3c08248", title: ["Controlled-Radical Polymerization of Lipoic Acid: A General Route to Degradable Vinyl Copolymers"],
    author: [{ given: "Kestrel R.", family: "Veldmar", ORCID: "https://orcid.org/0000-0000-0000-0001" }, { given: "Piers T.", family: "Orrinson" }, { given: "Corin J.", family: "Halvorn" }],
    volume: "145", page: "22728-22734", issued: { "date-parts": [[2023, 11, 2]] }, "container-title": ["Journal of the American Chemical Society"], ...over,
  };
}

describe("matching a Crossref record", () => {
  const info = parseReference(R1);

  it("measures a title by the longest run it shares with the citation", () => {
    expect(longestCommonSubstring("abcdef", "xxcdexx")).toBe(3);
    expect(longestCommonSubstring("", "abc")).toBe(0);
    expect(compact("Résumé: α-Lipoic Acid!")).toBe("resumelipoicacid");
    expect(titleScore(R1, item().title?.[0] ?? "")).toBeGreaterThan(0.95);
    expect(titleScore(R1, "A completely different paper about hydrogels")).toBeLessThan(0.4);
  });

  it("calls it OK when title, author, year, volume and page agree", () => {
    const e = evaluate(info, item());
    expect(e.status).toBe("OK");
    expect(e.reasons).toEqual([]);
  });

  it("calls it CHECK, with the reasons, when something differs", () => {
    const e = evaluate(info, item({ volume: "146", page: "5000-5010", author: [{ given: "X", family: "Someone" }] }));
    expect(e.status).toBe("CHECK");
    expect(e.reasons).toEqual(expect.arrayContaining(["first author differs", "volume differs (145 vs 146)", "pages differ (22728-22734 vs 5000-5010)"]));
  });

  it("tolerates a year one off (online against print) but not two", () => {
    expect(evaluate(info, item({ issued: { "date-parts": [[2024]] } })).status).toBe("OK");
    const far = evaluate(info, item({ issued: { "date-parts": [[2019]] } }));
    expect(far.status).toBe("CHECK");
    expect(far.reasons.join()).toContain("year differs");
  });

  it("uses the article number when there is no page", () => {
    const art = parseReference("Smith, J. A study of lipoic polymers number five. Sci. Adv. 2024, 10, eadk1234.");
    const e = evaluate(art, { DOI: "10.1/x", title: ["A study of lipoic polymers number five"], author: [{ family: "Smith" }], issued: { "date-parts": [[2024]] }, volume: "10", "article-number": "eadk1234" });
    expect(e.status).toBe("OK");
  });

  it("calls it NOT FOUND when nothing resembles the title", () => {
    const e = evaluate(info, item({ title: ["Hydrogels for wound healing in diabetic mice"] }));
    expect(e.status).toBe("NOT FOUND");
  });

  it("chooses the best of several candidates, and null for none", () => {
    const wrong = item({ DOI: "10.1/wrong", title: ["Lipoic acid"], author: [{ family: "Other" }] });
    const best = chooseBest(info, [wrong, item(), item({ DOI: "10.1/third", volume: "1" })]);
    expect(best?.item.DOI).toBe("10.1021/jacs.3c08248");
    expect(chooseBest(info, [])).toBeNull();
  });

  it("writes the authors as family name and initials", () => {
    expect(authorsLine(item())).toBe("Veldmar KR; Orrinson PT; Halvorn CJ");
    expect(authorsLine({ DOI: "x", author: Array.from({ length: 10 }, (_, i) => ({ given: "A", family: `F${i}` })) }, 3)).toBe("F0 A; F1 A; F2 A; et al.");
    expect(authorsLine({ DOI: "x" })).toBe("");
    expect(authorsLine({ DOI: "x", author: [{ name: "The Consortium" }] })).toBe("The Consortium");
  });
});
