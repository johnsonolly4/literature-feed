// Runtime stand-in for the "obsidian" package (which ships types only). vitest aliases "obsidian" to this file.
// Add exports here as tests need them. The UI classes are empty shells: they exist so that modules which
// extend them can be imported; the UI itself is checked by hand in test-vault.
export class Component {
  load(): void { /* nothing */ }
  unload(): void { /* nothing */ }
}

export class Plugin extends Component {
  /** Only what the plugin touches: an in-memory secret storage. */
  app = (() => {
    const secrets = new Map<string, string>();
    return {
      workspace: { onLayoutReady: (_cb: () => void): void => { /* the schedule is not run in tests */ } },
      secretStorage: {
        getSecret: (id: string): string | null => secrets.get(id) ?? null,
        setSecret: (id: string, secret: string): void => { secrets.set(id, secret); },
      },
    };
  })();
  manifest: unknown = { id: "literature-feed" };
  async loadData(): Promise<unknown> { return null; }
  async saveData(_data: unknown): Promise<void> { /* ignored */ }
  addSettingTab(_tab: unknown): void { /* ignored */ }
  addCommand(_command: unknown): void { /* ignored */ }
  addRibbonIcon(_icon: string, _title: string, _callback: unknown): void { /* ignored */ }
  register(_cleanup: () => void): void { /* ignored */ }
  registerInterval(_id: number): number { return 0; }
  registerObsidianProtocolHandler(_action: string, _handler: unknown): void { /* ignored */ }
  registerMarkdownCodeBlockProcessor(_language: string, _handler: unknown): void { /* ignored */ }
}

export class MarkdownRenderChild extends Component {
  constructor(readonly containerEl: unknown) { super(); }
}

export class TFile {}

export class MarkdownView {}

export class PluginSettingTab {
  constructor(readonly app: unknown, readonly plugin: unknown) { /* nothing */ }
  update(): void { /* nothing */ }
}

export class Modal {
  constructor(readonly app: unknown) { /* nothing */ }
}

export class SecretComponent {}
export class Setting {}
export class Notice {}

export function debounce<T extends unknown[]>(cb: (...args: T) => unknown): (...args: T) => unknown {
  return cb;
}

export function normalizePath(path: string): string {
  return path.replace(/[\\/]+/g, "/").replace(/^\/|\/$/g, "");
}

export async function requestUrl(_request: unknown): Promise<never> {
  throw new Error("requestUrl is not available in tests");
}
