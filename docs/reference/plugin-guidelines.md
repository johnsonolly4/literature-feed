# Obsidian plugin guidelines: saved summary

Saved 2026-10-03 from https://docs.obsidian.md/Plugins/Releasing/Plugin+guidelines and
https://docs.obsidian.md/Plugins/Getting+started/Build+a+plugin. Re-check the live pages before submitting to the store.

## Build a plugin (getting started)
- Start from https://github.com/obsidianmd/obsidian-sample-plugin (TypeScript, esbuild, `npm run dev` watches and rebuilds `main.js`).
- Needs Git, Node.js and a code editor.
- **Never develop in your main vault**: use a separate dev vault.
- Reload: "Reload app without saving", toggle the plugin, or the Hot-Reload plugin (https://github.com/pjeby/hot-reload).
- `manifest.json`: unique `id`, `name`, `description`, `version`, `minAppVersion`, `author`, `isDesktopOnly`.

## General
- Use `this.app`, not the global `app`.
- Keep console logging to errors only.
- Organise multi-file plugins into folders; rename placeholder class names (`MyPlugin`, `SampleSettingTab`).

## Mobile
- Avoid Node and Electron APIs (else `isDesktopOnly: true`).
- No regex lookbehind (unsupported on older iOS).

## UI text
- Headings in settings only with more than one section; don't put "settings" in headings.
- Sentence case everywhere.
- `new Setting(el).setName(...).setHeading()` instead of `<h1>`/`<h2>`.

## Security
- Don't build DOM from user input with `innerHTML`, `outerHTML` or `insertAdjacentHTML`; use `createEl()`, `createDiv()`, `createSpan()`; clear with `el.empty()`.

## Resource management
- Clean up on unload: use `registerEvent()`, `registerDomEvent()`, `registerInterval()`, `addCommand()`.
- Don't detach leaves in `onunload`.

## Commands
- No default hotkeys.
- `callback` (always available), `checkCallback` (conditional), `editorCallback` / `editorCheckCallback` (needs an editor).

## Workspace
- `getActiveViewOfType()` instead of `workspace.activeLeaf`.
- Don't keep references to custom views; use `getLeavesOfType()`.

## Vault
- Active file: prefer the Editor API over `Vault.modify()`.
- Background edits: `Vault.process()`, not `Vault.modify()`.
- Frontmatter: `FileManager.processFrontMatter()`.
- Prefer the Vault API over the Adapter API.
- Don't iterate all files to find one: `getFileByPath()`, `getFolderByPath()`, `getAbstractFileByPath()`.
- `normalizePath()` on user-defined paths.

## Editor
- Change editor extensions with `updateOptions()`.

## Styling
- No hard-coded styles (`el.style.color = ...`); use CSS classes and Obsidian CSS variables.

## TypeScript
- `const`/`let`, not `var`; async/await over promise chains.

## Store submission
Checked live 2026-10-03 (https://docs.obsidian.md/Plugins/Releasing/Submit+your+plugin). **The process changed: no PR to `obsidianmd/obsidian-releases` any more.**
- Repo needs `README.md` (excerpt shows on the listing), `LICENSE`, `manifest.json` (HEAD must match, committed).
- Release: `manifest.json` `version` is `x.y.z`; GitHub release tag equals it (no "v"); attach `main.js`, `manifest.json`, optional `styles.css`.
- Submit at https://community.obsidian.md: sign in with an Obsidian account, link GitHub to prove ownership, add the plugin.
- Plugin `id` must be unique and must not contain `obsidian`.
- Automated review reports problems: fix, publish a new release with a higher version; installable once errors are gone.
- Not saved (page missing at the old URL): the detailed "submission requirements" list. Re-read it on the portal before submitting.
- Old advice kept as good practice: the description shouldn't say "Obsidian" or "This plugin".
- A plugin that downloads or installs code from elsewhere is likely to be questioned in review: keep the kit updater optional and clearly described.
