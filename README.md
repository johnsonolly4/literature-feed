# Literature Feed

An Obsidian plugin that finds new papers on your topics each week, lists them in a reading-inbox note, and sends the ones you tick to Zotero.

> **Status: under development.** This is the repo scaffold (Phase 0 of [the plan](docs/plans/literature-feed.md)): the plugin loads and does nothing else yet. Everything below describes what it is being built to do, and it is not in the Obsidian community plugin store.

## What it does

1. **Scan.** Once a week the plugin searches [OpenAlex](https://openalex.org) for each feed you define (search topics, concept groups, exclusions, start year).
2. **Reading inbox.** The papers it finds go into one weekly note, a collapsible section per feed, each paper with a checkbox, ranked by tier (priority, strong, possible). The note has `kind: reading-inbox` in its properties.
3. **Sync.** You tick the papers you want and press **Sync**. They are created in your Zotero library, in an inbox collection for the feed and (optionally) a project collection, with a `feed/<name>` tag. Only ticked papers go to Zotero.
4. From there your usual Zotero → ZotLit → Obsidian reading workflow takes over. Making literature notes is not this plugin's job.

Feeds are set up in the plugin's settings. The scan is lexical (word and phrase matching); it does not use an AI model.

## Network use

The plugin talks to two services, and nothing else. There is no telemetry, no analytics and no other server.

| Service | Host | What is sent | What it is for |
|---|---|---|---|
| OpenAlex | `api.openalex.org` | Your search queries (the topic strings of your feeds), a date window, and your OpenAlex API key (in an `Authorization` header, not in the address) | Finding new papers. Paper metadata (title, authors, venue, year, DOI, abstract) comes back |
| Zotero | `api.zotero.org` | Your Zotero user ID and API key, and for each paper you tick: its metadata, plus the collection and tag names | Checking whether a paper is already in your library by DOI, then creating items, collections and tags in your library |

Your API keys are stored in the plugin's own settings file inside your vault (`.obsidian/plugins/literature-feed/data.json`). They are sent only to the service they belong to. If you sync your vault, that file syncs with it, so keep it out of any public sync or backup.

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
