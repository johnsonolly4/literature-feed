import type { Paper, Tier } from "../../src/match/feed";

// Hand-written, invented titles and abstracts (not real papers). Each has a known tier for lipoicFeed.
export interface Case extends Paper {
  id: string;
  abstract: string | null;
  tier: Tier;
  /** Names of the groups that must match. */
  groups: string[];
}

export const priorityFlow: Case = {
  id: "priority-flow",
  title: "Flow synthesis of lipoic acid copolymers with acrylamides",
  abstract:
    "Lipoic acid was copolymerised with N-isopropylacrylamide in a continuous flow reactor. Residence time and temperature were varied to tune molar mass.",
  tier: "priority",
  groups: ["Lipoic acid", "Polymerisation", "Comonomer class", "Flow or optimisation"],
};

// US spelling in the text; the feed's term is the British "optimisation" / "polymerisation".
export const priorityBayesian: Case = {
  id: "priority-bayesian",
  title: "Bayesian optimization of lipoic acid polymerization conditions",
  abstract:
    "A Bayesian optimization loop selected initiator loading and temperature for the polymerization of thioctic acid, and reached the target conversion in nine experiments.",
  tier: "priority",
  groups: ["Lipoic acid", "Polymerisation", "Flow or optimisation"],
};

export const strongComonomer: Case = {
  id: "strong-comonomer",
  title: "Lipoic acid–acrylamide copolymers as dynamic networks",
  abstract: "Copolymers of lipoic acid and N,N-dimethylacrylamide were prepared by radical polymerisation and characterised by SEC and NMR.",
  tier: "strong",
  groups: ["Lipoic acid", "Polymerisation", "Comonomer class"],
};

export const strongDegradable: Case = {
  id: "strong-degradable",
  title: "Degradable copolymers from thioctic acid",
  abstract: "Thioctic acid was polymerised thermally. The resulting polymers depolymerised on heating in solution.",
  tier: "strong",
  groups: ["Lipoic acid", "Polymerisation", "Responsive or degradable"],
};

export const possible: Case = {
  id: "possible",
  title: "Copolymers of lipoic acid with vinyl monomers",
  abstract: "Lipoic acid was copolymerised with styrene and vinyl acetate at 80 °C. Copolymer compositions were determined by NMR.",
  tier: "possible",
  groups: ["Lipoic acid", "Polymerisation"],
};

export const possibleTitleOnly: Case = {
  id: "possible-title-only",
  title: "Lipoic acid copolymers",
  abstract: null,
  tier: "possible",
  groups: ["Lipoic acid", "Polymerisation"],
};

export const droppedNoLipoic: Case = {
  id: "dropped-no-lipoic",
  title: "Flow synthesis of acrylamide copolymers",
  abstract: "Acrylamide copolymers were made in a flow reactor and their molar mass distributions compared.",
  tier: "dropped",
  groups: ["Polymerisation", "Comonomer class", "Flow or optimisation"],
};

export const droppedNoPolymer: Case = {
  id: "dropped-no-polymer",
  title: "Lipoic acid dosing in cell culture: Bayesian optimisation",
  abstract:
    "The effect of lipoic acid on cell growth was measured. Concentration was optimised with a Bayesian approach, and cells were counted by flow cytometry.",
  tier: "dropped",
  groups: ["Lipoic acid", "Flow or optimisation"],
};

export const tierCases: Case[] = [
  priorityFlow,
  priorityBayesian,
  strongComonomer,
  strongDegradable,
  possible,
  possibleTitleOnly,
  droppedNoLipoic,
  droppedNoPolymer,
];

// One sentence per term, appended to a base paper that would otherwise be Priority (drop) or Strong (lower).
export const dropSentences: Record<string, string> = {
  "gold nanoparticle": "The polymer was used to coat gold nanoparticles for sensing.",
  AuNP: "Binding to AuNP surfaces was followed by UV-vis.",
  "quantum dot": "Quantum dot ligands were also examined.",
  "self-assembled monolayer": "A self-assembled monolayer formed on gold within an hour.",
  supplementation: "Dietary supplementation is discussed in the final section.",
  "clinical trial": "A clinical trial is planned.",
  "diabetic neuropathy": "Relevance to diabetic neuropathy is discussed.",
};

export const lowerSentences: Record<string, string> = {
  "self-healing": "The networks show self-healing at room temperature.",
  adhesive: "The material was tested as a reusable adhesive on glass.",
  "ionic elastomer": "A supramolecular ionic elastomer was obtained.",
  "end group": "Chain end group analysis was done by NMR.",
  "end-functional": "End-functional chains were capped with a thiol.",
  "anchoring group": "The carboxylic acid acts as an anchoring group on surfaces.",
};

export function withSentence(base: Case, sentence: string): Case {
  return { ...base, abstract: `${base.abstract ?? ""} ${sentence}`.trim() };
}
