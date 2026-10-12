// Runtime stand-in for the "obsidian" package (which ships types only). vitest aliases "obsidian" to this file.
// Add exports here as tests need them.
export class Component {
  load(): void { /* nothing */ }
  unload(): void { /* nothing */ }
}

export class Plugin extends Component {
  app: unknown;
  manifest: unknown = { id: "literature-feed" };
  async loadData(): Promise<unknown> { return null; }
  async saveData(_data: unknown): Promise<void> { /* ignored */ }
}
