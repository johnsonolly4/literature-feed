// One real run of the OpenAlex client (Phase 2 "done when"). Not part of the plugin; writes a file only with --out.
//
//   OPENALEX_API_KEY=… node scripts/openalex-run.mjs [--days N | --from YYYY-MM-DD] [--form scoped|filter] [--out run.json] [--sample sample.json]
//   PowerShell: $env:OPENALEX_API_KEY="…"; node scripts/openalex-run.mjs --days 365 --out run.json
//
// --days N      window = the last N days (default 30); --from YYYY-MM-DD sets the start day exactly and wins over --days
// --out FILE    write a run record (JSON): the criteria to repeat the search and the results (counts, cost, ids, DOIs,
//               titles, whether an abstract came back; abstract text is not saved)
// --sample FILE write one real work that has an abstract, as a one-page response, for tests/fixtures/ (author names are
//               replaced by "Author 1", "Author 2", …; no key, no address). Look at it before you commit it.
// Prints, per topic, the count OpenAlex reports, the cost, the request address (no key) and the first titles.
// The key is read from the environment only, sent as a Bearer header, and never printed or saved.
import { build } from "esbuild";
import { mkdtempSync, writeFileSync } from "node:fs";
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
const days = Number(arg("days", "30"));
if (!Number.isInteger(days) || days < 1) {
  console.error("--days must be a whole number of days, 1 or more");
  process.exit(1);
}
const from = arg("from", new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10));
if (!/^\d{4}-\d{2}-\d{2}$/.test(from)) {
  console.error("--from must look like 2026-01-31");
  process.exit(1);
}
const outFile = arg("out", "");
const sampleFile = arg("sample", "");

// Bundle the TypeScript client into a temp file so the script uses exactly the code the plugin will.
const dir = mkdtempSync(join(tmpdir(), "literature-feed-"));
const outfile = join(dir, "client.mjs");
await build({ entryPoints: ["src/openalex/client.ts"], bundle: true, format: "esm", platform: "node", outfile, logLevel: "error" });
const { OpenAlexClient, buildSearchUrl } = await import(pathToFileURL(outfile).href);

const rawWorks = [];
const request = async ({ url, headers }) => {
  const res = await fetch(url, { headers });
  let json = null;
  try { json = await res.json(); } catch { /* not JSON: the client reports it */ }
  if (sampleFile && Array.isArray(json?.results)) rawWorks.push(...json.results);
  return { status: res.status, json };
};

const client = new OpenAlexClient({ request, apiKey, sleep });
console.log(`Query form: ${form}. Published since ${from}.\n`);
let total = 0;
const record = {
  ranAt: new Date().toISOString(),
  criteria: { api: "https://api.openalex.org/works", queryForm: form, publishedFrom: from, perPage: 100, topics: TOPICS },
  results: [],
};
for (const topic of TOPICS) {
  try {
    const r = await client.searchTopic(topic, { fromDate: from, form });
    total += r.costUsd;
    console.log(`${r.count} works, fetched ${r.papers.length}, cost $${r.costUsd.toFixed(5)}${r.truncated ? " (paging cap reached)" : ""}`);
    console.log(`  ${topic}`);
    const address = buildSearchUrl(topic, { fromDate: from, form });
    console.log(`  ${address}`);
    record.results.push({
      topic,
      requestUrl: address,
      count: r.count,
      costUsd: r.costUsd,
      truncated: r.truncated,
      papers: r.papers.map((p) => ({
        openalexId: p.openalexId, doi: p.doi, title: p.title, year: p.year, publicationDate: p.publicationDate,
        venue: p.venue, isPreprint: p.isPreprint, hasAbstract: Boolean(p.abstract),
      })),
    });
    for (const p of r.papers.slice(0, 3)) console.log(`  - ${p.title} (${p.year ?? "n.d."})`);
    console.log();
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.log(`FAILED: ${message}\n  ${topic}\n`);
    record.results.push({ topic, error: message });
  }
}
console.log(`Total cost $${total.toFixed(5)}`);
const listed = record.results.flatMap((r) => r.papers ?? []);
console.log(`Abstract came back for ${listed.filter((p) => p.hasAbstract).length} of ${listed.length} papers listed (a paper found by two topics counts twice)`);
if (outFile) {
  record.totalCostUsd = total;
  writeFileSync(outFile, JSON.stringify(record, null, 2) + "\n", "utf8");
  console.log(`Run record written to ${outFile}`);
}
if (sampleFile) {
  const work = rawWorks.find((w) => w.abstract_inverted_index && w.title);
  if (!work) {
    console.log("No work with an abstract came back, so no sample was written.");
  } else {
    const authorships = (work.authorships ?? []).map((_, i) => ({ author: { display_name: `Author ${i + 1}` } }));
    const sample = { meta: { count: 1, page: 1, per_page: 100 }, results: [{ ...work, authorships }] };
    writeFileSync(sampleFile, JSON.stringify(sample, null, 2) + "\n", "utf8");
    console.log(`Sample written to ${sampleFile}: "${work.title}" (${work.doi ?? "no DOI"}). Check it before committing.`);
  }
}
