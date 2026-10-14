export type SearchKind = 'vehicle' | 'bin' | 'blackSpot' | 'facility' | 'street' | 'ward';

export interface SearchEntry {
  readonly kind: SearchKind;
  /** Display id or name, e.g. "AT-HSR-031", "27th Main Road", "South-72 HSR Layout". */
  readonly label: string;
  /** Extra words that should match (e.g. the ward number "72", the kind "auto-tipper"). */
  readonly keywords?: readonly string[];
  /** Opaque reference the caller uses to select or fly to the result. */
  readonly ref: number;
}

interface Prepared {
  readonly entry: SearchEntry;
  readonly label: string;
  readonly words: readonly string[];
  readonly keywords: readonly string[];
}

export interface SearchIndex {
  readonly entries: readonly SearchEntry[];
}

interface IndexWithPrep extends SearchIndex {
  readonly prepared: readonly Prepared[];
}

const words = (s: string): string[] => s.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 0);

export function buildSearchIndex(entries: readonly SearchEntry[]): SearchIndex {
  const prepared = entries.map((entry) => {
    const keywords = (entry.keywords ?? []).map((k) => k.toLowerCase());
    return { entry, label: entry.label.toLowerCase(), words: [...words(entry.label), ...keywords.flatMap(words)], keywords };
  });
  const index: IndexWithPrep = { entries, prepared };
  return index;
}

/**
 * M2-11: case-insensitive; ranked exact label, then label or any word or keyword starting with the query, then
 * substring; ties keep index order; at most `limit` results; an empty or blank query returns nothing.
 */
export function search(index: SearchIndex, query: string, limit = 8): SearchEntry[] {
  const q = query.trim().toLowerCase();
  if (q.length === 0) return [];
  const prepared = (index as IndexWithPrep).prepared;
  const ranked: { rank: number; i: number; entry: SearchEntry }[] = [];
  prepared.forEach((p, i) => {
    let rank = -1;
    if (p.label === q) rank = 0;
    else if (p.label.startsWith(q) || p.words.some((w) => w.startsWith(q)) || p.keywords.some((k) => k.startsWith(q))) rank = 1;
    else if (p.label.includes(q) || p.keywords.some((k) => k.includes(q))) rank = 2;
    if (rank >= 0) ranked.push({ rank, i, entry: p.entry });
  });
  return ranked
    .sort((a, b) => a.rank - b.rank || a.i - b.i)
    .slice(0, limit)
    .map((r) => r.entry);
}
