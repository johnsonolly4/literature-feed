import { Plugin } from "obsidian";

export default class LiteratureFeedPlugin extends Plugin {
  onload(): void {
    // Phase 0: the plugin only loads. Features start in Phase 1 (see docs/plans/literature-feed.md).
  }

  onunload(): void {
    // Nothing registered yet, so nothing to clean up.
  }
}
