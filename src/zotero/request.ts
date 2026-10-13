// The plugin's HTTP function for ZoteroClient: Obsidian's requestUrl (desktop and mobile, no CORS limit).
import { requestUrl } from "obsidian";
import type { HttpRequester } from "./client";

/** Must not throw on a non-2xx status, must give `json: null` for a body that is not JSON, and lower-case header names. */
export const zoteroRequester: HttpRequester = async ({ url, method, headers, body }) => {
  // The content type goes in its own field, not twice.
  const { "Content-Type": contentType, ...rest } = headers;
  const res = await requestUrl({ url, method, headers: rest, body, contentType, throw: false });
  let json: unknown = null;
  try {
    json = res.json;
  } catch {
    // Obsidian's json getter throws on an empty or non-JSON body (a PATCH answers 204 with none); that is normal here.
  }
  const lower: Record<string, string> = {};
  for (const [name, value] of Object.entries(res.headers)) lower[name.toLowerCase()] = value;
  let text = "";
  try {
    text = res.text;
  } catch {
    // No readable body: the status alone is reported.
  }
  return { status: res.status, json, headers: lower, text };
};
