import type { Paper } from "./feed";
import { normaliseText } from "./score";

type DedupeItem = Pick<Paper, "title" | "doi" | "isPreprint">;

/** Lower-case DOI without the `https://doi.org/` or `doi:` prefix; "" when there is none. */
export function normaliseDoi(doi?: string | null): string {
  if (!doi) return "";
  return doi
    .trim()
    .toLowerCase()
    .replace(/^(https?:\/\/(dx\.)?doi\.org\/|doi:\s*)/, "")
    .replace(/[\s.,;]+$/, "");
}

/**
 * One paper per DOI, then per normalised title (a preprint and its journal version have different DOIs
 * but the same title). The journal version is kept over a preprint, otherwise the first seen.
 * Output keeps the order in which each paper first appeared.
 */
export function dedupe<T extends DedupeItem>(items: readonly T[]): T[] {
  const parent = items.map((_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };

  const owner = new Map<string, number>();
  items.forEach((item, i) => {
    const doi = normaliseDoi(item.doi);
    const title = normaliseText(item.title);
    const keys: string[] = [];
    if (doi) keys.push(`doi:${doi}`);
    if (title) keys.push(`title:${title}`);
    for (const key of keys) {
      const seen = owner.get(key);
      if (seen === undefined) owner.set(key, i);
      else parent[find(i)] = find(seen);
    }
  });

  const clusters = new Map<number, T[]>();
  items.forEach((item, i) => {
    const root = find(i);
    const members = clusters.get(root);
    if (members) members.push(item);
    else clusters.set(root, [item]);
  });

  return [...clusters.values()].map((members) => members.find((m) => !m.isPreprint) ?? members[0]);
}
