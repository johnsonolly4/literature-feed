// Hand-written to the documented shape of GET /works (not recorded from the live API yet: see BACKLOG).
// No key, no personal data. Papers are invented.
import type { OpenAlexWork } from "../../src/openalex/client";

export const journalWork: OpenAlexWork = {
  id: "https://openalex.org/W1000000001",
  doi: "https://doi.org/10.1000/example.1",
  title: "Radical copolymerisation of lipoic acid with acrylamides",
  publication_year: 2026,
  publication_date: "2026-09-30",
  type: "article",
  abstract_inverted_index: { Lipoic: [0], acid: [1], copolymers: [2, 5], are: [3], reported: [4] },
  primary_location: { source: { display_name: "Example Polymer Journal", type: "journal" } },
  authorships: [
    { author: { display_name: "A. Author" } },
    { author: { display_name: "B. Writer" } },
  ],
};

export const preprintWork: OpenAlexWork = {
  id: "https://openalex.org/W1000000002",
  doi: "https://doi.org/10.1000/preprint.2",
  title: "Radical copolymerisation of lipoic acid with acrylamides",
  publication_year: 2026,
  publication_date: "2026-08-12",
  type: "preprint",
  abstract_inverted_index: null,
  primary_location: { source: { display_name: "Example Preprint Server", type: "repository" } },
  authorships: [{ author: { display_name: "A. Author" } }],
};

export const untitledWork: OpenAlexWork = {
  id: "https://openalex.org/W1000000003",
  doi: null,
  title: null,
  publication_year: 2026,
};

export const sparseWork: OpenAlexWork = {
  id: "https://openalex.org/W1000000004",
  title: "Thioctic acid in flow polymerisation",
  publication_year: 2026,
  authorships: null,
  primary_location: null,
};

/** Page of a list response. `count` is the total across pages. */
export function page(results: OpenAlexWork[], count: number, costUsd?: number): unknown {
  return {
    meta: { count, page: 1, per_page: 2, ...(costUsd === undefined ? {} : { cost_usd: costUsd }) },
    results,
  };
}
