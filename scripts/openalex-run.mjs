// One real run of the OpenAlex client (Phase 2 "done when"). Not part of the plugin; writes nothing.
//
//   OPENALEX_API_KEY=… node scripts/openalex-run.mjs [--from YYYY-MM-DD] [--form scoped|filter]
//   PowerShell: $env:OPENALEX_API_KEY="…"; node scripts/openalex-run.mjs
//
// Prints, per topic, the count OpenAlex reports, the cost and the first titles. The key is read from the
// environment only, sent as a Bearer header, and never printed.
import { build } from "esbuild";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";

// The four topics of the first feed (docs/plans/literature-feed.md, "First feed").
const TOPICS = [
  '("lipoic acid" OR "thioctic acid" OR lipoate) AND (copolymer OR copolymerization OR copolymerisation)',
  '("lipoic acid" OR "thioctic acid") AND (acrylate OR acrylamide OR methacrylate)',
  '("lipoic acid" OR "thioctic acid" OR dithiolane) AND ("radical ring-opening" OR "ring-opening polymerization" OR "ring-opening polymerisation")',
  '("lipoic acid" OR "thioctic acid") AND polymer AND (flow OR Bayesian OR "high-throughput" OR "machine learning")',
];

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const apiKey = process.env.OPENALEX_API_KEY;
if (!apiKey) {
  console.error("Set OPENALEX_API_KEY first (see the usage line at the top of this file).");
  process.exit(1);
}
const form = arg("form", "scoped");
if (form !== "scoped" && form !== "filter") {
  console.error('--form must be "scoped" or "filter"');
  process.exit(1);
}
const from = arg("from", new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10));

// Bundle the TypeScript client into a temp file so the script uses exactly the code the plugin will.
const dir = mkdtempSync(join(tmpdir(), "literature-feed-"));
const outfile = join(dir, "client.mjs");
await build({ entryPoints: ["src/openalex/client.ts"], bundle: true, format: "esm", platform: "node", outfile, logLevel: "error" });
const { OpenAlexClient } = await import(pathToFileURL(outfile).href);

const request = async ({ url, headers }) => {
  const res = await fetch(url, { headers });
  let json = null;
  try { json = await res.json(); } catch { /* not JSON: the client reports it */ }
  return { status: res.status, json };
};

const client = new OpenAlexClient({ request, apiKey, sleep });
console.log(`Query form: ${form}. Published since ${from}.\n`);
let total = 0;
for (const topic of TOPICS) {
  try {
    const r = await client.searchTopic(topic, { fromDate: from, form });
    total += r.costUsd;
    console.log(`${r.count} works, fetched ${r.papers.length}, cost $${r.costUsd.toFixed(5)}${r.truncated ? " (paging cap reached)" : ""}`);
    console.log(`  ${topic}`);
    for (const p of r.papers.slice(0, 3)) console.log(`  - ${p.title} (${p.year ?? "n.d."})`);
    console.log();
  } catch (e) {
    console.log(`FAILED: ${e instanceof Error ? e.message : String(e)}\n  ${topic}\n`);
  }
}
console.log(`Total cost $${total.toFixed(5)}`);
