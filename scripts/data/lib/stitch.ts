/** Joins open way geometries that share end points into closed rings (OSM multipolygon outers). Unclosable parts are dropped. */
export function stitchRings<P extends { readonly lat: number; readonly lon: number }>(parts: readonly (readonly P[])[]): P[][] {
  const same = (a: P, b: P): boolean => a.lat === b.lat && a.lon === b.lon;
  const pending = parts.filter((p) => p.length >= 2).map((p) => [...p]);
  const rings: P[][] = [];
  while (pending.length > 0) {
    let ring = pending.shift()!;
    let grew = true;
    while (!same(ring[0]!, ring[ring.length - 1]!) && grew) {
      grew = false;
      for (let i = 0; i < pending.length; i++) {
        const s = pending[i]!;
        const head = ring[0]!;
        const tail = ring[ring.length - 1]!;
        if (same(s[0]!, tail)) ring = ring.concat(s.slice(1));
        else if (same(s[s.length - 1]!, tail)) ring = ring.concat([...s].reverse().slice(1));
        else if (same(s[s.length - 1]!, head)) ring = s.slice(0, -1).concat(ring);
        else if (same(s[0]!, head)) ring = [...s].reverse().slice(0, -1).concat(ring);
        else continue;
        pending.splice(i, 1);
        grew = true;
        break;
      }
    }
    if (ring.length >= 4 && same(ring[0]!, ring[ring.length - 1]!)) rings.push(ring);
  }
  return rings;
}
