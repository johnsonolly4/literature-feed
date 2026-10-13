// Writes a demo set into test-vault/Demo/ to try every feature without waiting for real papers:
//   npm run demo                (or: node scripts/make-demo.mjs --out some/folder, used by the tests)
// Four weekly inbox notes (this week, last week, one that ages out within days, one old enough to be archived), literature
// notes for the papers that count as read, and a guide with a checklist. Titles say "Demo", ids and DOIs are fake, nothing
// is sent anywhere. Dates are worked out from today, so run it again on another day to move the weeks along.
// The notes are made with the plugin's own note code (bundled from src/inbox/write.ts), so they have the real format.
import { build } from "esbuild";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const vault = new URL("../test-vault/", import.meta.url);
const outArg = process.argv.indexOf("--out") > -1 ? process.argv[process.argv.indexOf("--out") + 1] : undefined;
if (outArg === undefined && !existsSync(vault)) {
  console.error("test-vault/ not found. Run this from the repository folder.");
  process.exit(1);
}

const dir = mkdtempSync(join(tmpdir(), "literature-feed-demo-"));
const outfile = join(dir, "write.mjs");
await build({ entryPoints: ["src/inbox/write.ts"], bundle: true, format: "esm", platform: "node", outfile, logLevel: "error" });
const { renderNote, markSynced, setTick, noteName, weekLabel } = await import(pathToFileURL(outfile).href);
rmSync(dir, { recursive: true, force: true });

// ---- dates ---------------------------------------------------------------------------------------------------------

const today = new Date();
today.setHours(12, 0, 0, 0);
const dayMs = 86_400_000;
const daysAgo = (n) => new Date(today.getTime() - n * dayMs);
const isoDay = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
/** The Monday that falls in the seven days ending `from` days ago and starting `from + 6` days ago. */
const mondayIn = (from) => {
  for (let n = from; n < from + 7; n++) if (daysAgo(n).getDay() === 1) return daysAgo(n);
  throw new Error("no Monday in range");
};
// The default "mark papers done after" is 4 weeks: a note's papers age out from its Monday + 35 days.
const weeks = [
  { id: "now", date: today },
  { id: "last", date: daysAgo(7) },
  { id: "soon", date: mondayIn(29) }, // Monday + 35 falls in the next seven days: the red "ages out soon" marker
  { id: "old", date: mondayIn(50) },  // long past: every paper is read or aged out, so Update read state archives it
];

// ---- the demo papers -----------------------------------------------------------------------------------------------

const FEEDS = {
  "demo-polymers": "Demo polymers",
  "demo-catalysts": "Demo catalysts",
};

let counter = 0;
const ids = new Map();
function paper(feedId, state, tier, title, matched, topics, extra = {}) {
  const key = extra.same ?? title;
  if (!ids.has(key)) ids.set(key, ++counter);
  const n = ids.get(key);
  return {
    feedId, state, n, title,
    openalexId: `W${9_000_000_000 + n}`,
    zoteroKey: `DEMO${String(n).padStart(4, "0")}`,
    doi: `10.0000/demo.${n}`,
    authors: extra.authors ?? ["A. Demo", "B. Sample"],
    venue: extra.venue ?? "Journal of Demonstration",
    year: today.getFullYear(),
    tier, matched, topics,
    isPreprint: extra.preprint ?? false,
    noAbstract: extra.noAbstract ?? tier === "unchecked",
  };
}

const shared = "Demo: Radical ring-opening of dithiolane monomers";
const notes = {
  now: [
    paper("demo-polymers", "ticked", "priority", "Demo: Bayesian optimisation of lipoic acid copolymer synthesis in flow", ["flow", "bayesian", "polymer"], [1, 4]),
    paper("demo-polymers", "zotero", "priority", "Demo: High-throughput flow screening of degradable polymers", ["flow", "high-throughput", "degradable"], [3]),
    paper("demo-polymers", "read", "strong", "Demo: Acrylate copolymers with tunable degradation", ["acrylate", "copolymer", "degradable"], [2]),
    paper("demo-polymers", "processed", "strong", "Demo: Responsive polymer networks from dithiolanes", ["responsive", "polymer"], [1, 3]),
    paper("demo-polymers", "new", "strong", shared, ["polymer", "ring-opening"], [3]),
    paper("demo-polymers", "new", "possible", "Demo: Adhesive hydrogels from natural disulfides", ["adhesive", "polymer"], [2], { preprint: true, venue: "ChemRxiv" }),
    paper("demo-polymers", "new", "possible", "Demo: Polymer dynamics (judged on the title alone)", ["polymer"], [1], { noAbstract: true }),
    paper("demo-polymers", "new", "unchecked", "Demo: Conference record with no abstract", [], [2]),
    paper("demo-catalysts", "new", "strong", shared, ["catalyst", "ring-opening"], [1], { same: shared }),
    paper("demo-catalysts", "new", "priority", "Demo: Single-atom catalysts for ring-opening polymerisation", ["catalyst", "ring-opening"], [1]),
    paper("demo-catalysts", "ticked", "strong", "Demo: Zinc catalysts, kinetics and selectivity", ["catalyst", "kinetics"], [2]),
    paper("demo-catalysts", "resend", "possible", "Demo: Organocatalysis review", ["organocatalyst"], [2]),
    paper("demo-catalysts", "new", "possible", "Demo: Catalyst deactivation in flow reactors", ["catalyst", "flow"], [1, 2]),
  ],
  last: [
    paper("demo-polymers", "zotero", "strong", "Demo: Flow synthesis of poly(disulfide)s", ["flow", "polymer"], [1]),
    paper("demo-polymers", "read", "strong", "Demo: Self-immolative polymers for delivery", ["polymer", "responsive"], [1]),
    paper("demo-polymers", "new", "possible", "Demo: Adhesive coatings with gold nanoparticles", ["adhesive"], [2]),
    paper("demo-polymers", "zotero", "priority", "Demo: Bayesian design of experiments for polymers", ["bayesian", "polymer"], [4]),
    paper("demo-polymers", "ticked", "possible", "Demo: Acrylate monomers from renewable sources", ["acrylate"], [2]),
    paper("demo-catalysts", "zotero", "strong", "Demo: Palladium catalysed coupling", ["catalyst"], [1]),
    paper("demo-catalysts", "new", "strong", "Demo: Catalyst screening with machine learning", ["catalyst", "machine learning"], [2]),
    paper("demo-catalysts", "new", "possible", "Demo: Ligand design notes", ["ligand"], [1]),
  ],
  soon: [
    paper("demo-polymers", "new", "strong", "Demo: Older paper still waiting", ["polymer"], [1]),
    paper("demo-polymers", "zotero", "strong", "Demo: Queued for reading, ages out soon", ["flow"], [3]),
    paper("demo-polymers", "new", "possible", "Demo: Adhesive coating study", ["adhesive"], [2]),
    paper("demo-catalysts", "zotero", "possible", "Demo: Catalyst bench notes", ["catalyst"], [1]),
  ],
  old: [
    ...["A", "B", "C", "D"].map((s) => paper("demo-polymers", "zotero", "strong", `Demo: Bayesian polymer design ${s}`, ["bayesian", "polymer"], [4])),
    ...["A", "B", "C", "D"].map((s) => paper("demo-polymers", "new", "possible", `Demo: Adhesive tape study ${s}`, ["adhesive"], [2])),
    ...["A", "B", "C"].map((s) => paper("demo-catalysts", "new", "possible", `Demo: Ligand notes ${s}`, ["ligand"], [1])),
  ],
};

// ---- the notes -----------------------------------------------------------------------------------------------------

function inboxPaper(p) {
  return {
    openalexId: p.openalexId, title: p.title, authors: p.authors, venue: p.venue, year: p.year,
    publicationDate: `${p.year}-01-15`, doi: p.doi, isPreprint: p.isPreprint, noAbstract: p.noAbstract,
    tier: p.tier, matched: p.matched, topics: p.topics,
  };
}

function buildNote(week, list) {
  const sections = [];
  for (const [feedId, feedName] of Object.entries(FEEDS)) {
    const papers = list.filter((p) => p.feedId === feedId);
    if (papers.length > 0) sections.push({ feedId, feedName, papers: papers.map(inboxPaper) });
  }
  let text = renderNote({ week: weekLabel(week.date), scanned: isoDay(week.date), sections });
  const synced = [];
  for (const p of list) {
    if (p.state === "ticked") text = setTick(text, p.feedId, p.openalexId, true);
    else if (["zotero", "read", "processed", "resend"].includes(p.state)) synced.push({ feedId: p.feedId, openalexId: p.openalexId, key: p.zoteroKey });
  }
  text = markSynced(text, synced);
  for (const p of list) if (p.state === "resend") text = setTick(text, p.feedId, p.openalexId, false);
  return text;
}

function literatureNote(p) {
  const takeaway = p.state === "processed" ? "Demo takeaway: the idea in one line." : "";
  return [
    "---",
    `title: "${p.title}"`,
    "related: []",
    "collections:",
    "  - Inbox/Demo",
    `citekey: demo${p.n}`,
    `zotero-key: ${p.zoteroKey}`,
    "---",
    "",
    "> [!focus] Takeaway",
    `> [takeaway:: ${takeaway}]`,
    "",
    "## My notes",
    "",
  ].join("\n");
}

const root = outArg === undefined ? new URL("Demo/", vault) : pathToFileURL(`${resolve(outArg)}/`);
if (existsSync(root)) console.log("Demo/ already exists: files with the same names are overwritten, others stay. Delete the folder first for a clean start.");
for (const sub of ["Inbox", "Literature", "Archive"]) mkdirSync(new URL(`${sub}/`, root), { recursive: true });

const written = [];
for (const week of weeks) {
  const list = notes[week.id];
  const name = `${noteName(week.date)}.md`;
  writeFileSync(new URL(`Inbox/${name}`, root), buildNote(week, list));
  written.push(name);
  for (const p of list) {
    if (p.state !== "read" && p.state !== "processed") continue;
    const file = `demo${p.n} ${p.title.replace(/[:\\/*?"<>|]/g, "").slice(0, 60)}.md`;
    writeFileSync(new URL(`Literature/${file}`, root), literatureNote(p));
  }
}

const guide = `---
cssclasses:
  - vt
---

# Demo guide

Made by \`npm run demo\`. To move the weeks on, delete this \`Demo\` folder and run it again on the day you want (files with the same names are overwritten, others stay). Everything here is fake: titles say "Demo", ids and DOIs do not exist, nothing is sent anywhere.

## Set up (once; put the settings back afterwards)

> [!warning] Do this first
> In **Settings → Literature Feed**:
> 1. **Inbox folder**: \`Demo/Inbox\`
> 2. **Literature notes folder**: \`Demo/Literature\`
> 3. **Archive folder**: \`Demo/Archive\`, and **Archive finished notes** on.
> 4. Import the two search files \`docs/feeds/demo-polymers.json\` and \`docs/feeds/demo-catalysts.json\` (feed list → Import → paste the file's text). Leave them switched **off**: switched on they would search OpenAlex for demo queries.
>
> Do not press **Sync** in this setup. The ticked demo papers have fake ids, so Sync fails at the OpenAlex lookup and creates nothing in Zotero, but it shows failures. To test a real sync use a real scan.

Then reload Obsidian and open the newest note in \`Demo/Inbox\`.

## Checklist: the inbox note (${written[0]})

1. **Cards.** Above the table, two cards: Demo polymers and Demo catalysts. A card's badge is amber and says "N to read" when the search has papers In Zotero that are not read, grey "nothing to read" otherwise: check each against the table's In Zotero rows. Each card has the first papers to read (+ N more), the counts line, a funnel line (listed → ticked → read) and a bar (amber to read, blue ticked, grey new, green read).
2. **Show in table** on a card filters the table to that search; a "Feed: … ✕" chip appears; press the card button again or the chip to clear. Close and reopen the note: the filter is remembered.
3. **Table.** Status chips: Ticked (blue), In Zotero (amber), New (grey). Papers to read come first. Click Status, Paper, Tier, Year headers to sort, again to reverse. The filter chips (All, To read, Ticked, New, Read, Processed) show counts.
4. **Shared paper.** "Radical ring-opening of dithiolane monomers" is listed under both searches: two rows, one per search.
5. **Marks.** One paper is marked \`preprint\`, one \`title only\`, and one sits in the "No abstract" list (Unchecked).
6. **Ticking.** Tick a New paper in the table: the chip turns Ticked and the cards update. (To see the stored line, remove \`literature-feed-table\` from the note's \`cssclasses\`: the line now starts with \`[x]\`.)
7. **Resend request.** "Organocatalysis review" is in the In Zotero list but unticked: it shows Ticked, which means "will be sent again".
8. **Colours.** Check light and dark themes and Lab Kit's theme on and off.

## Checklist: read state and archive

9. Run **Update read state and archive** (command palette). The Notice says what it checked. Two papers from this week and one from last week get a **Read** link (matched by Zotero key, DOI or title to the notes in \`Demo/Literature\`); "Responsive polymer networks…" shows **Processed** (its takeaway is filled), the others Read.
10. The oldest note (${written[3]}) moves to \`Demo/Archive\`: every paper in it is in Zotero or aged out. The other three stay.
11. In ${written[2]} the papers still New or In Zotero carry a red outline: they age out within days.

## Checklist: search effectiveness

12. Run **Show search effectiveness**. Demo polymers: the term "bayesian" does well (every decided paper with it was wanted) and "adhesive" does badly (none was). Topic table, tier table, month table and rule versions are filled; topic "Returned" and "Dropped" show "–" because the demo has no scans. The note says rates are weak under 20 decided papers.
13. **Copy as Markdown** puts the report on the clipboard.
14. When you are done: remove the two demo searches in the settings, run the command again and press **Forget history of 2 removed searches**, so the demo does not stay in your real history. Then put the three folder settings back.

## The Home card

The block below is what a Home note would hold. Add \`limit: 5\` to list five papers.

\`\`\`literature-feed
show: home
limit: 5
\`\`\`
`;
writeFileSync(new URL("Demo guide.md", root), guide);

console.log(`Wrote ${written.length} inbox notes, the literature notes and a guide to ${outArg === undefined ? "test-vault/Demo/" : outArg}:`);
for (const name of written) console.log(`  Inbox/${name}`);
console.log("Open test-vault/Demo/Demo guide.md in Obsidian and follow it.");
