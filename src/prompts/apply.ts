// Applying an LLM's suggestions to a feed, and describing them in one line. Pure: no Obsidian.
import { cloneFeed, type FeedConfig } from "../settings/data";
import type { Suggestion } from "./schemas";

/** One line for a suggestion, for the review window and the decisions file. */
export function describeSuggestion(s: Suggestion): string {
  switch (s.kind) {
    case "add_term": return `add "${s.term}" to ${listLabel(s.list)}`;
    case "remove_term": return `remove "${s.term}" from ${listLabel(s.list)}`;
    case "set_group_role": return `make group "${s.group}" ${s.role}`;
    case "add_group": return `add group "${s.group}" (${s.role}: ${s.terms.join(", ")})`;
    case "replace_topic": return `replace topic ${s.topic} with: ${s.query}`;
    case "add_topic": return `add topic: ${s.query}`;
    case "remove_topic": return `remove topic ${s.topic}`;
  }
}

function listLabel(list: string): string {
  const key = list.trim().toLowerCase();
  return key === "drop" || key === "lower" ? `the ${key} list` : `group "${list}"`;
}

const sameText = (a: string, b: string): boolean => a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * The feed with the suggestions applied, and what could not be applied (a group that does not exist, a topic number out of
 * range). Topic numbers refer to the feed as it is now, so removing topic 1 does not shift the meaning of "replace topic 3".
 * The given feed is not changed.
 */
export function applySuggestions(feed: FeedConfig, suggestions: readonly Suggestion[]): { feed: FeedConfig; errors: string[] } {
  const next = cloneFeed(feed);
  const errors: string[] = [];
  const replaced = new Map<number, string>();
  const removed = new Set<number>();
  const added: string[] = [];

  const termList = (list: string): string[] | null => {
    const key = list.trim().toLowerCase();
    if (key === "drop") return next.drop;
    if (key === "lower") return next.lower;
    return next.groups.find((g) => sameText(g.name, list))?.terms ?? null;
  };

  for (const s of suggestions) {
    switch (s.kind) {
      case "add_term": {
        const terms = termList(s.list);
        if (terms === null) errors.push(`${describeSuggestion(s)}: there is no group "${s.list}".`);
        else if (!terms.some((t) => sameText(t, s.term))) terms.push(s.term);
        break;
      }
      case "remove_term": {
        const terms = termList(s.list);
        if (terms === null) errors.push(`${describeSuggestion(s)}: there is no group "${s.list}".`);
        else {
          const at = terms.findIndex((t) => sameText(t, s.term));
          if (at === -1) errors.push(`${describeSuggestion(s)}: that term is not there.`);
          else terms.splice(at, 1);
        }
        break;
      }
      case "set_group_role": {
        const group = next.groups.find((g) => sameText(g.name, s.group));
        if (!group) errors.push(`${describeSuggestion(s)}: there is no group "${s.group}".`);
        else group.role = s.role;
        break;
      }
      case "add_group":
        if (next.groups.some((g) => sameText(g.name, s.group))) errors.push(`${describeSuggestion(s)}: a group of that name exists.`);
        else next.groups.push({ name: s.group, role: s.role, terms: [...s.terms] });
        break;
      case "replace_topic":
        if (s.topic > feed.topics.length) errors.push(`${describeSuggestion(s)}: the search has only ${feed.topics.length} topics.`);
        else replaced.set(s.topic, s.query);
        break;
      case "remove_topic":
        if (s.topic > feed.topics.length) errors.push(`${describeSuggestion(s)}: the search has only ${feed.topics.length} topics.`);
        else removed.add(s.topic);
        break;
      case "add_topic":
        if (!feed.topics.some((t) => sameText(t, s.query)) && !added.some((t) => sameText(t, s.query))) added.push(s.query);
        break;
    }
  }

  const kept = feed.topics.flatMap((topic, i) => (removed.has(i + 1) ? [] : [replaced.get(i + 1) ?? topic]));
  next.topics = [...kept, ...added];
  return { feed: next, errors };
}
