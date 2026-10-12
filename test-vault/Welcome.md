
# Test vault

This vault is for developing Literature Feed. It is not a real vault: never point the dev build at your own vault.

1. Run `npm run dev` in the repo; it builds the plugin into `.obsidian/plugins/literature-feed/`.
2. Open this folder as a vault in Obsidian and enable Literature Feed under Community plugins.
3. Only this file is tracked by git; everything else in the folder stays local, including the plugin's `data.json` (API keys go in the plugin settings, nowhere else).
