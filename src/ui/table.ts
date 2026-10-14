export type Cell = string | number | null;
export type Row = Readonly<Record<string, Cell>>;
export type SortDir = 'asc' | 'desc';

function compare(a: Cell, b: Cell): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b), 'en', { numeric: true, sensitivity: 'base' });
}

/**
 * Stable sort by one column (D-6). Numbers compare numerically, strings with numeric-aware locale compare
 * ("AT-HSR-2" before "AT-HSR-10"), and nulls always sort last in either direction. Does not mutate its input.
 */
export function sortRows<R extends Row>(rows: readonly R[], key: string, dir: SortDir): R[] {
  const sign = dir === 'asc' ? 1 : -1;
  return rows
    .map((row, i) => ({ row, i }))
    .sort((x, y) => {
      const a = x.row[key] ?? null;
      const b = y.row[key] ?? null;
      if (a === null || b === null) return a === b ? x.i - y.i : a === null ? 1 : -1;
      return sign * compare(a, b) || x.i - y.i;
    })
    .map((x) => x.row);
}

/** Rows where any cell contains every whitespace-separated term of `text`, ignoring case. Blank text keeps all. */
export function filterRows<R extends Row>(rows: readonly R[], text: string): R[] {
  const terms = text.toLowerCase().split(/\s+/).filter((t) => t.length > 0);
  if (terms.length === 0) return [...rows];
  return rows.filter((row) => {
    const cells = Object.values(row).map((c) => (c === null ? '' : String(c).toLowerCase()));
    return terms.every((t) => cells.some((c) => c.includes(t)));
  });
}
