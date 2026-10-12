# Literature Feed

An Obsidian plugin that finds new papers on your topics each week, lists them in a reading-inbox note, and sends the ones you tick to Zotero.

> **Status: under development.** So far (Phase 3 of [the plan](docs/plans/literature-feed.md)) the plugin has a settings tab with feeds and a **Test** search; the weekly scan, the inbox note and the Zotero sync are not built yet. Everything below describes what it is being built to do, and it is not in the Obsidian community plugin store.

## What it does

1. **Scan.** Once a week the plugin searches [OpenAlex](https://openalex.org) for each feed you define (search topics, concept groups, exclusions, start year).
2. **Reading inbox.** The papers it finds go into one weekly note, a collapsible section per feed, each paper with a checkbox, ranked by tier (priority, strong, possible). The note has `kind: reading-inbox` in its properties.
3. **Sync.** You tick the papers you want and press **Sync**. They are created in your Zotero library, in an inbox collection for the feed and (optionally) a project collection, with a `feed/<name>` tag. Only ticked papers go to Zotero.
4. From there your usual Zotero → ZotLit → Obsidian reading workflow takes over. Making literature notes is not this plugin's job.

Feeds are set up in the plugin's settings. The scan is lexical (word and phrase matching); it does not use an AI model.

## Settings

Open **Settings → Literature Feed**. Needs Obsidian 1.14 or later.

- **Accounts:** OpenAlex API key, Zotero API key and Zotero user ID. Each key row is a picker for a secret in Obsidian's secret storage: you choose or create the secret there, and the plugin's data file keeps only its name (see Network use).
- **Folders:** inbox folder (weekly notes) and archive folder (finished notes).
- **Schedule:** the weekday of the weekly scan.
- **Feeds:** one row per feed with an on / off switch, edit, duplicate and export; **Add feed** and **Import feed** below. A feed has search topics (one OpenAlex search per line), concept groups, drop terms, lower terms, a start year, a Zotero collection and an optional project.
  - A concept group has a role. **Required:** a paper without a match is dropped. **Boost:** a match raises it to Strong. **Priority:** a match raises it to Priority. A paper counts as matching a group when any of the group's terms is in its title or abstract.
  - **Drop** terms remove a paper. **Lower** terms move it down one tier.
  - A paper with no abstract is judged on its title alone and ranks at most Possible; if its title does not show the required terms it goes to an Unchecked list instead of being dropped.
  - **Test** in the feed editor runs a real OpenAlex search (the last year) and shows how many papers fall into each tier and what the search cost. It asks first and writes nothing to your vault. Each request costs about $0.001.
  - **Export** writes `<feed>.feed.json` into the inbox folder (the vault root if none is set); **Import** reads such a file or pasted JSON and adds the feed switched off. Exports contain no keys. An example is in [`docs/feeds/`](docs/feeds/lipoic-acid-copolymers.json).

## Network use

The plugin talks to two services, and nothing else. There is no telemetry, no analytics and no other server.

| Service | Host | What is sent | What it is for |
|---|---|---|---|
| OpenAlex | `api.openalex.org` | Your search queries (the topic strings of your feeds), a date window, and your OpenAlex API key (in an `Authorization` header, not in the address) | Finding new papers. Paper metadata (title, authors, venue, year, DOI, abstract) comes back |
| Zotero | `api.zotero.org` | Your Zotero user ID and API key, and for each paper you tick: its metadata, plus the collection and tag names | Checking whether a paper is already in your library by DOI, then creating items, collections and tags in your library |

Your API keys are kept in Obsidian's secret storage, on your device and outside your vault. The plugin's settings file (`.obsidian/plugins/literature-feed/data.json`) holds only the name of each secret, never the key, so syncing or backing up your vault does not copy a key. For the same reason, you choose the secrets again on each device. Keys are sent only to the service they belong to. If an earlier version stored a key as plain text in the settings file, the plugin moves it into the secret storage the first time it loads and removes it from the file.

## Accounts needed

- **OpenAlex:** a free account and API key, from `openalex.org/settings/api`.
- **Zotero:** an API key with write access to your library, and your numeric user ID, both under the API keys part of your account settings on `zotero.org`.

## Works with Lab Kit

[Lab Kit](https://github.com/johnsonolly4/lab-kit) is a separate plugin for a chemistry lab notebook. Literature Feed works with it through note conventions only (the `reading-inbox` kind, and Lab Kit's styling classes when they are present) but does not need it. Without Lab Kit the inbox note uses the plain Obsidian look.

## Development

```bash
npm install
npm run dev     # watch build into test-vault/.obsidian/plugins/literature-feed/
npm run build   # type-check and build main.js
npm test        # vitest
npm run lint    # eslint
```

Open `test-vault/` as a vault in Obsidian to try the plugin. Never develop against your own vault. API keys go into the plugin's settings in `test-vault` only, never into code, tests or docs.

## Licence

MIT, see [LICENSE](LICENSE).
