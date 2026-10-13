// Web search addresses for finding a paper by hand: Google and Google Scholar with the title (or the start of a reference) as the search
// words. Pure: the plugin only builds the address; the user's browser opens it.

/** The words to search for: the title when there is one, else the start of the text, tidied and cut at 200 characters. */
export function searchQuery(title: string, fallback = ""): string {
  const text = (title.trim() !== "" ? title : fallback).replace(/\s+/g, " ").replace(/<[^>]+>/g, "").trim();
  return text.length > 200 ? text.slice(0, 200).replace(/\s\S*$/, "") : text;
}

export function googleUrl(query: string): string {
  return `https://www.google.com/search?q=${encodeURIComponent(query)}`;
}

export function scholarUrl(query: string): string {
  return `https://scholar.google.com/scholar?q=${encodeURIComponent(query)}`;
}
