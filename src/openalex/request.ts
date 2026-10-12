// The plugin's HTTP function for OpenAlexClient: Obsidian's requestUrl (works on desktop and mobile, no CORS limit).
import { requestUrl } from "obsidian";
import type { Requester } from "./client";

/** Must not throw on a non-2xx status and must give `json: null` when the body is not JSON (the Requester contract). */
export const obsidianRequester: Requester = async ({ url, headers }) => {
  const res = await requestUrl({ url, headers, throw: false });
  let json: unknown = null;
  try {
    json = res.json;
  } catch {
    // Obsidian's json getter throws on a body that is not JSON; the client reports that case.
  }
  return { status: res.status, json };
};
