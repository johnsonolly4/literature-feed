import type { Feed } from "../../src/match/feed";

// Test data. Group and term lists are my reading of "First feed" in docs/plans/literature-feed.md
// (the plan gives the topics and the drop / lower terms in full, but names the groups only).
// The drop and lower lists are the plan's, word for word.
export const lipoicFeed: Feed = {
  name: "Lipoic acid copolymers",
  groups: [
    { name: "Lipoic acid", role: "required", terms: ["lipoic acid", "thioctic acid", "lipoate", "dithiolane"] },
    {
      name: "Polymerisation",
      role: "required",
      terms: ["polymer", "copolymer", "polymerisation", "copolymerisation", "radical ring-opening", "ring-opening polymerisation"],
    },
    { name: "Comonomer class", role: "boost", terms: ["acrylate", "acrylamide", "methacrylate"] },
    { name: "Responsive or degradable", role: "boost", terms: ["responsive", "degradable", "depolymerisation"] },
    { name: "Flow or optimisation", role: "priority", terms: ["flow", "bayesian", "high-throughput", "machine learning", "optimisation"] },
  ],
  drop: [
    "gold nanoparticle",
    "AuNP",
    "quantum dot",
    "self-assembled monolayer",
    "supplementation",
    "clinical trial",
    "diabetic neuropathy",
  ],
  lower: ["self-healing", "adhesive", "ionic elastomer", "end group", "end-functional", "anchoring group"],
};
