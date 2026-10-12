// An OpenAlex work as a Zotero item (Web API v3 JSON). Pure. Fields that are empty or not valid for the item type are
// left out, because Zotero rejects an item that carries a field its type does not have.
import type { OpenAlexWork } from "../openalex/client";
import { rebuildAbstract } from "../openalex/client";

export type ZoteroItem = Record<string, unknown>;

export interface ZoteroCreator {
  creatorType: "author";
  firstName?: string;
  lastName?: string;
  name?: string;
}

/** `10.1021/x` from `https://doi.org/10.1021/X` (any case, with or without the prefix); "" when there is none. */
export function bareDoi(doi: string | null | undefined): string {
  return (doi ?? "").trim().replace(/^(?:https?:\/\/(?:dx\.)?doi\.org\/|doi:\s*)/i, "").toLowerCase();
}

/** "Ada Lovelace" gives first and last name; "Lovelace, Ada" too; one word is kept as a single-field name. */
export function toCreator(displayName: string): ZoteroCreator | null {
  const name = displayName.replace(/\s+/g, " ").trim();
  if (name === "") return null;
  const comma = name.indexOf(",");
  if (comma > 0) {
    const last = name.slice(0, comma).trim();
    const first = name.slice(comma + 1).trim();
    return first === "" ? { creatorType: "author", name: last } : { creatorType: "author", firstName: first, lastName: last };
  }
  const space = name.lastIndexOf(" ");
  if (space === -1) return { creatorType: "author", name };
  return { creatorType: "author", firstName: name.slice(0, space), lastName: name.slice(space + 1) };
}

export function itemTypeOf(work: OpenAlexWork): "journalArticle" | "preprint" | "thesis" {
  if (work.type === "preprint") return "preprint";
  if (work.type === "dissertation") return "thesis";
  return "journalArticle";
}

const VENUE_FIELD = { journalArticle: "publicationTitle", preprint: "repository", thesis: "university" } as const;

export function feedTag(feedId: string): string {
  return `feed/${feedId}`;
}

export function toZoteroItem(work: OpenAlexWork, feedId: string, collectionKeys: readonly string[]): ZoteroItem {
  const type = itemTypeOf(work);
  const doi = bareDoi(work.doi);
  const item: ZoteroItem = { itemType: type, title: (work.title ?? "").replace(/\s+/g, " ").trim() };
  const creators = (work.authorships ?? [])
    .map((a) => toCreator(a.author?.display_name ?? ""))
    .filter((c): c is ZoteroCreator => c !== null);
  if (creators.length > 0) item.creators = creators;
  const abstract = rebuildAbstract(work.abstract_inverted_index);
  if (abstract) item.abstractNote = abstract;
  const venue = work.primary_location?.source?.display_name?.trim();
  if (venue) item[VENUE_FIELD[type]] = venue;
  if (work.publication_date) item.date = work.publication_date;
  const id = /\/(W\d+)$/.exec(work.id)?.[1];
  const extra: string[] = id ? [`OpenAlex: ${id}`] : [];
  if (doi) {
    item.url = `https://doi.org/${doi}`;
    // A thesis may not have a DOI field in every Zotero version, and Zotero rejects a field its type lacks: Extra is safe.
    if (type === "thesis") extra.push(`DOI: ${doi}`);
    else item.DOI = doi;
  }
  if (extra.length > 0) item.extra = extra.join("\n");
  item.tags = [{ tag: feedTag(feedId) }];
  item.collections = [...collectionKeys];
  return item;
}
