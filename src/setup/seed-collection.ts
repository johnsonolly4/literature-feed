// Making a search's seed collection in Zotero when its Check setup button is pressed. Pure: the Zotero client is passed in. The button
// is the consent for this one collection; it is never made by itself, and only its last name is created (its parent must exist).
import { pathParts, planCollection, type ZoteroClient } from "../zotero/client";

export interface SeedCollectionResult {
  /** "created": made now. "exists": it was already there (made meanwhile, or in Zotero desktop), nothing was sent. */
  outcome: "created" | "exists";
  key: string;
}

/** The message when a collection above the one asked for is missing as well. */
export const PARENT_MISSING = "Sync once first, or create the inbox collection in Zotero.";

export async function createSeedCollection(client: Pick<ZoteroClient, "listCollections" | "createCollection">, path: string): Promise<SeedCollectionResult> {
  if (pathParts(path).length === 0) throw new Error("There is no collection path to create.");
  // Read again: the list the window showed may be old, and a collection Zotero marks deleted does not count (listCollections leaves it out).
  const plan = planCollection(await client.listCollections(), path);
  if (plan.toCreate.length === 0 && plan.key !== null) return { outcome: "exists", key: plan.key };
  if (plan.toCreate.length > 1) throw new Error(`"${plan.toCreate[0]}" is missing in Zotero. ${PARENT_MISSING}`);
  return { outcome: "created", key: await client.createCollection(plan.toCreate[0], plan.parentKey) };
}
