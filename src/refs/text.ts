// Words such as DOI and Crossref are capitalised on purpose. The sentence-case lint rule reads string literals only, so the text of the
// reference tools that holds them is kept here.
export const TEXT = {
  command: "Find DOIs for a reference list",
  viewTitle: "Find DOIs for references",
  intro: "Paste references copied from a paper, however the lines break. They are split into one reference each and looked up on Crossref for their DOI. Crossref is asked about each reference's text (authors, title, journal, year) when you press the button; nothing else is sent.",
  run: "Tidy and find DOIs",
  copyList: "Copy list with DOIs",
  copiedList: "Copied the list with DOIs.",
  copiedCsv: "Copied as CSV (opens in Excel).",
  typeDoi: "Type a DOI first.",
} as const;
