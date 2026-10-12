---
paths:
  - "src/**"
  - "manifest.json"
  - "styles.css"
---
# Obsidian plugin rules (community store)
Source: docs/reference/plugin-guidelines.md. Check there before guessing.

- `this.app`, never the global `app`. Log only errors.
- No `innerHTML` / `outerHTML` / `insertAdjacentHTML`: use `createEl`, `createDiv`, `createSpan`, `el.empty()`.
- No inline styles (`el.style.x = …`): CSS classes in `styles.css` using Obsidian CSS variables.
- No regex lookbehind (breaks on iOS).
- Node/Electron APIs (`fs`, `path`, `crypto`, `electron`) only through `nodeModule()` in `src/node.ts`, the one place that calls `require()`. It returns `null` unless `hasNode()` (`src/platform.ts`; plain `Platform.isDesktopApp` stays true in mobile emulation). No `child_process`, no `Buffer` or `process` globals.
- `normalizePath()` on every path a user types.
- Prefer the Vault API (`vault.process`, `fileManager.processFrontMatter`) over the Adapter API; Adapter only for `.obsidian/` files.
- Look files up with `getAbstractFileByPath` / `getFileByPath`; don't iterate `getFiles()` unless unavoidable.
- Register everything (`registerEvent`, `registerMarkdownCodeBlockProcessor`, `addCommand`) so it cleans up on unload.
- No default hotkeys. Commands: `callback` / `checkCallback` / `editorCallback` as appropriate.
- Settings: sentence case, `setHeading()` only with several sections, no "settings" in headings.
- Avoid private APIs (`app.plugins`, `app.customCss`, other plugins' settings). If one is unavoidable, isolate it in one function with a comment.
- `manifest.json`: id has no "obsidian"; the description is one sentence ending in a period; keep `minAppVersion` accurate.
