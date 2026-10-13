# Literature Feed

An Obsidian plugin that finds new papers on your topics each week, lists them in a reading-inbox note, and sends the ones you tick to Zotero.

> **Status: under development.** So far (Phase 6 of [the plan](docs/plans/literature-feed.md)) the plugin has a settings tab with feeds, a **Test** search, a **Scan now** command that writes the weekly reading-inbox note, and a **Sync ticked papers** command that sends the ticked papers to Zotero; the weekly schedule is not built yet. A paper with a literature note shows **Read**, and finished inbox notes move to an archive folder. Everything below describes what it is being built to do, and it is not in the Obsidian community plugin store.

## What it does

1. **Scan.** Once a week the plugin searches [OpenAlex](https://openalex.org) for each feed you define (search topics, concept groups, exclusions, start year).
2. **Reading inbox.** The papers it finds go into one weekly note, a collapsible section per feed, each paper with a checkbox, ranked by tier (priority, strong, possible). The note has `kind: reading-inbox` in its properties.
3. **Sync.** You tick the papers you want and press **Sync**. They are created in your Zotero library, in an inbox collection for the feed and (optionally) a project collection, with a `feed/<name>` tag. Only ticked papers go to Zotero.
4. From there your usual Zotero → ZotLit → Obsidian reading workflow takes over. Making literature notes is not this plugin's job.

Feeds are set up in the plugin's settings. The scan is lexical (word and phrase matching); it does not use an AI model.

## Reading inbox

Run the command **Scan now** (command palette). It searches OpenAlex for every feed that is switched on and writes, or adds to, this week's note `<inbox folder>/<year>-W<week> Reading inbox.md`. A paper already listed is not listed again; the first scan looks back 30 days, later scans start 14 days before the last one so late-indexed papers are caught. If a scan fails for a feed, the other feeds still run and the last-scan date does not move.

- Each paper line also carries a hidden marker with the numbers of the search topics that found it (the topics of the feed, counted from 1), used when you sync.
- **The table.** In the note, the block draws a table of every paper (all feeds), and the per-feed lists are hidden in reading view (their lines stay in the file; remove the class `literature-feed-table` from the note's `cssclasses` to show them again). Columns: a tick box, a status chip, the paper (title, authors, venue, year, `preprint`, `title only`), the tier, and links (DOI, Zotero, Read) with the feed and the topics that found it. Ticking in the table edits the same line a tick on the list line did (unticking a paper in the "In Zotero" list still asks for it to be sent again).
- **Status chips**, in Lab Kit's colours by meaning: **New** (slate), **Ticked** (blue, waiting to be sent to Zotero), **In Zotero** (amber, waiting to be read), **Read** (green, a literature note exists) and **Processed** (green with a tick: the note's `takeaway::` line is filled in, as in Lab Kit's weekly review). A red outline marks a paper that is New or In Zotero and will count as done by age within a week.
- **Cards, one per search.** Above the table the note shows a card for each search (Lab Kit's project-card look): the search's name, a badge (amber "3 to read", grey "nothing to read"), its topic count and what the last scan found for it, the first papers to read (`+ N more in the table` after them), the counts "3 to read · 2 new · 1 ticked · 4 read", a funnel line "listed 10 → ticked 4 → read 1" with a bar of the search's papers by status, and **Show in table**, which filters the table to that search (press again, or the "Feed" chip, to clear). Listed is the search's lines in this note; ticked counts papers you ticked, sent or read; read includes Processed.
- **The Home card.** A `literature-feed` block with `show: home` stays one summary card: the status line, the counts, the first papers to read (add `limit: 5` to the block for more; 3 by default, 20 at most) and the buttons; with more than one search switched on it also lists one line per search. It reads the latest note only.
- **Order and filters.** Papers to read come first, then Ticked, then New, then Read and Processed, and inside a group by tier. Click Status, Paper, Tier or Year to sort by it, again to reverse. The chips above the table (All, To read, Ticked, New, Read, Processed, each with a count) filter it. Your sort and filter are remembered in the vault (Obsidian's local storage), not in the plugin's settings.
- The note's properties are `kind: reading-inbox`, `week`, `scanned` and `cssclasses` with `vt` (Lab Kit's look), `literature-feed` and `literature-feed-table`; notes made earlier get the classes added the next time you scan, sync or update the read state.
- The note has a status line with **Scan now** and a **Sync** button, then one collapsible section per feed. Each paper is a checkbox line: title, authors, venue, year, DOI link, tier (Priority, Strong, Possible) and the terms that matched. Feeds with no Priority or Strong paper start collapsed.
- Papers with no abstract and no required term in the title are in a separate collapsed list per feed, "No abstract returned, matched by OpenAlex".
- The status block and card also say what the latest scan found, for example "Last scan 2026-10-12: 3 new (0 priority, 2 strong, 1 possible, 0 without abstract), 11 dropped by the feed rules."
- With more than one feed switched on, the block and card add one row per feed: what is waiting for that feed and what the latest scan found for it (new and dropped, or failed).
- A paper judged on its title alone because no abstract came back carries "title only".
- **Read:** when a literature note for a paper exists in your literature notes folder (a setting; for example the folder ZotLit writes to), the paper's line gets a `Read` link to it. The match does not depend on property names: a frontmatter value that holds the paper's Zotero item key (alone in a property whose name mentions "key" or "Zotero", or inside a `zotero://` link) or its DOI counts; failing both, so does a `title` property equal to the paper's title (letters and digits only, any case), which covers a literature note made from an item that was later re-created under a new key. Run by hand, the command says how many inbox and literature notes it checked and what it changed, and tells you if it finds no inbox notes in the inbox folder. It runs after **Scan now** and **Sync**, and with the command **Update read state and archive**.
- **Archive:** a weekly note is moved to the archive folder (a setting, empty by default; nothing moves until you set it) when every paper in it is read, or has aged out. A paper has aged out when its note's week ended at least N weeks ago (default 4, a setting) and it is unticked (dismissed) or in Zotero but still unread. So a paper that is in Zotero and not read keeps the note in the inbox as your reading queue, until you read it or N weeks pass. A ticked paper not yet in Zotero, or a paper unticked in the "In Zotero" list to be sent again, keeps the note open however old it is. The switch "Archive finished inbox notes" turns this off.
- Ticking a box changes only that line; scanning again keeps your ticks.
- The block `` ```literature-feed `` with the line `show: home` gives a small card (papers waiting, last scan, buttons) for another note, such as a home page. Put it inside a callout (for example a column of a Home note) and it drops its own box and title. It counts the unticked papers of the latest inbox note, each paper once even if two feeds found it; older weeks are not counted.
- Titles and names come from OpenAlex and are written as plain text with markdown characters escaped; links are rebuilt from the DOI.

## Search effectiveness
- The plugin keeps a small history of how each search does in `ledger.json` in its own folder (`.obsidian/plugins/literature-feed/`). It stays on your computer: nothing is sent anywhere, and Obsidian Sync or another sync service may or may not carry it to other devices. It holds, per listed paper, the title, tier, week, the search topics and terms that found it, and the first day a refresh saw it ticked, sent to Zotero or read; per scan, how many papers each topic returned, listed and had removed by the rules; and a numbered version of a search's rules each time they change. No abstracts. Delete the file to start again: the next refresh rebuilds what it can from the notes in your inbox and archive folders (topics and terms come from the lines; scan numbers cannot be rebuilt).
- The command **Show search effectiveness** opens a report for each search: papers listed, **wanted** (ticked, sent to Zotero or read), **dismissed** (not wanted and the note's week plus the "mark papers done after" weeks have passed), and **undecided** (still waiting; left out of the rates), then the same by tier, by search topic (with the returned and dropped numbers from the scans), by month and by version of the rules. It also lists feed terms and title words that do better or worse than the search's own average (at least four decided papers each) as candidates for a boost, priority, lower or drop term. These are suggestions: nothing changes a search by itself. **Copy as Markdown** puts the report on the clipboard. **Forget history of N removed searches** clears what the ledger holds about searches you have deleted from the settings.
- Rates are weak evidence until a search has about 20 decided papers, and papers ticked or read are counted from the day a refresh saw them, not the day you clicked.

## Sync to Zotero

Tick the papers you want, then press **Sync** in the status block or run the command **Sync ticked papers**. For every ticked paper in the inbox notes that has no "in Zotero" link yet:

- The plugin fetches the paper's full record from OpenAlex again (clean title, authors, abstract, DOI).
- If your library already has an item with that DOI (or, for a paper without a DOI, the same title), no copy is made: that item is added to the feed's collections and gets the `feed/<name>` tag, and nothing else about it changes.
- Otherwise a new item is created (journal article, preprint or thesis, by the OpenAlex type) in the feed's Zotero collection and, if set, its project collection, with the tags `feed/<name>` and `found-by/openalex`, and in Extra "OpenAlex: W..." and a line "Found by: OpenAlex search, feed ..., topic N" (so you can show where a paper came from in a ZotLit template and see how well the search does). An item that was already in your library only gets the feed's collection and `feed/<name>` tag: it was not found by the search first, so it gets no `found-by` tag.
- After writing, Sync reads each item back from Zotero and checks that it exists, is not in the Trash and is in the collections it was meant for. Only then does the paper count as synced; otherwise it is reported as failed, stays ticked and is tried again at the next Sync.
- A synced paper is ticked, gets a link "in Zotero" (`zotero://select/...`) and moves into a collapsed list "In Zotero" at the bottom of its feed. **To send it again** (for example after creating a missing collection), untick it in that list and press Sync: if the item already exists, the feed's collections and tag are added and no copy is made.
- The Notice says how many papers were added or already there, and which collections they were filed in (and whether Sync made them).
- The command **Show Zotero collections** lists the collections Zotero's server reports, with their keys and any that are in the Trash, so you can compare them with what Zotero shows.
- Sync saves a note you have open and edited before it reads it, so a tick or untick you made a moment ago is counted.
- A collection path such as `Inbox/Lipoic acid copolymers` means a collection inside another. **The plugin does not create Zotero collections unless you allow it**, because they may turn into folders in your vault. If a collection is missing, Sync stops before sending anything and the Notice says which one to create in Zotero (then press Sync again). Two settings allow creation, separately for inbox collections and project collections (both off by default); even then only the last name of a path is created, inside a parent that already exists.

Your Zotero desktop app picks the new items up at its next sync with zotero.org; ZotLit reads Zotero desktop's local database, so a synced paper shows up in ZotLit after that.

## Settings

Open **Settings → Literature Feed**. Needs Obsidian 1.14 or later.

- **Accounts:** OpenAlex API key, Zotero API key and Zotero user ID. Each key row is a picker for a secret in Obsidian's secret storage: you choose or create the secret there, and the plugin's data file keeps only its name (see Network use).
- **Folders:** inbox folder (weekly notes) and archive folder (finished notes).
- **Schedule:** the weekday of the weekly scan.
- **Zotero:** two switches, "Create missing inbox collections" and "Create missing project collections" (both off by default); see Sync to Zotero.
- **Feeds:** one row per feed with an on / off switch, edit, duplicate and export; **Add feed** and **Import feed** below. A feed has a name, a start year, a Zotero collection and an optional project (the first four fields of the editor), then search topics (one OpenAlex search per line), concept groups, drop terms and lower terms.
  - A concept group has a role. **Required:** a paper without a match is dropped. **Boost:** a match raises it to Strong. **Priority:** a match raises it to Priority. A paper counts as matching a group when any of the group's terms is in its title or abstract.
  - **Drop** terms remove a paper. **Lower** terms move it down one tier.
  - A paper with no abstract is judged on its title alone and ranks at most Possible; if its title does not show the required terms it goes to an Unchecked list instead of being dropped.
  - **Test** in the feed editor runs a real OpenAlex search (the last year) and shows how many papers fall into each tier and what the search cost. It asks first and writes nothing to your vault. Each request costs about $0.001.
  - **Export** writes `<feed>.feed.json` into the inbox folder (the vault root if none is set); **Import** reads such a file or pasted JSON and adds the feed switched off. Exports contain no keys. An example is in [`docs/feeds/`](docs/feeds/lipoic-acid-copolymers.json).

## Network use

The plugin talks to two services, and nothing else. There is no telemetry, no analytics and no other server.

| Service | Host | What is sent | What it is for |
|---|---|---|---|
| OpenAlex | `api.openalex.org` | Your search queries (the topic strings of your feeds), a date window, the OpenAlex id of each paper you sync, and your OpenAlex API key (in an `Authorization` header, not in the address) | Finding new papers. Paper metadata (title, authors, venue, year, DOI, abstract) comes back |
| Zotero | `api.zotero.org` | Your Zotero user ID and API key, and for each paper you tick: its title, authors, abstract, venue, date, DOI and link, plus the collection and tag names (and, to avoid duplicates, a search for the DOI or title in your library) | Checking whether a paper is already in your library by DOI, then creating items, collections and tags in your library |

Your API keys are kept in Obsidian's secret storage, on your device and outside your vault. The plugin's settings file (`.obsidian/plugins/literature-feed/data.json`) holds only the name of each secret, never the key, so syncing or backing up your vault does not copy a key. For the same reason, you choose the secrets again on each device. Keys are sent only to the service they belong to. If an earlier version stored a key as plain text in the settings file, the plugin moves it into the secret storage the first time it loads and removes it from the file.

## Accounts needed

- **OpenAlex:** a free account and API key, from `openalex.org/settings/api`.
- **Zotero:** an API key with write access to your library, and your numeric user ID, both under the API keys part of your account settings on `zotero.org`.

## Needed for PDFs

Sync adds a paper's **metadata** (title, authors, abstract, DOI, venue, date) to your Zotero library; it does not fetch PDFs. For full texts you need, alongside this plugin:

- **Zotero desktop** (7 or later; tried with 10), which pulls the new items from zotero.org at its own sync. ZotLit reads Zotero desktop's local database, so a paper reaches ZotLit only after that sync.
- **The Zotero Connector** browser extension, to save a paper's PDF from the publisher page while you are logged in through your library.
- **The Zotero add-on [Better Find Full Text](https://github.com/ppavlidis/better-find-full-text)** (its README lists Zotero 7.0, 8.x, 9.x and 10.x). Select the papers in Zotero, right-click, and use it: it tries Zotero's own PDF finder and the publisher's PDF link, and for a paywalled paper it opens the DOI page in your browser. After you log in and click the Connector, it moves the PDF onto the existing item and deletes the duplicate the Connector made, so the paper stays in its inbox collection. It is a separate project with no connection to this plugin, and a paywalled paper still needs your own click on the Connector.

## Works with Lab Kit

[Lab Kit](https://github.com/johnsonolly4/lab-kit) is a separate plugin for a chemistry lab notebook. Literature Feed works with it through note conventions only (the `reading-inbox` kind, and Lab Kit's styling classes when they are present) but does not need it. Without Lab Kit the inbox note uses the plain Obsidian look.

If you use Lab Kit's planning vault, set these folders so the two do not get in each other's way:

- **Inbox folder: not Lab Kit's `00 Inbox`.** That folder is for quick captures, and Lab Kit's **Sort inbox** command walks through every note in it and offers to move or delete it, which would take the reading-inbox note with it. Use a folder of its own, such as `04 Literature/Suggested`.
- **Archive folder:** for example `99 Archive/Suggested` (Lab Kit archives captured notes to `99 Archive/Inbox`).
- **Literature notes folder:** `04 Literature/ZotLit Imports`, where ZotLit writes the notes.
- The table uses Lab Kit's palette variables when its theme is on and the same colours otherwise, so New is slate, Ticked blue, In Zotero amber and Read green, and red appears only for papers about to age out.
- Papers you sync carry the Zotero tags `feed/<name>` and `found-by/openalex`. Lab Kit's ZotLit settings put Zotero tags into the literature note's `Zotero Tags` property, so those tags show up there after **Update literature note** and in Lab Kit's "Papers by Zotero tag" list, with no template change.
- The Zotero add-on and browser extension named under "Needed for PDFs" belong on the per-computer list in Lab Kit's `Setting up a computer` note.

## Development

```bash
npm install
npm run dev     # watch build into test-vault/.obsidian/plugins/literature-feed/
npm run build   # type-check and build main.js
npm test        # vitest
npm run lint    # eslint
npm run demo    # write a demo set (fake papers, notes and a guide) into test-vault/Demo/
```

Open `test-vault/` as a vault in Obsidian to try the plugin. `npm run demo` fills `test-vault/Demo/` with fake weekly notes, literature notes and a guide with a checklist for every feature (import `docs/feeds/demo-polymers.json` and `demo-catalysts.json` as searches). Never develop against your own vault. API keys go into the plugin's settings in `test-vault` only, never into code, tests or docs.

## Licence

MIT, see [LICENSE](LICENSE).
