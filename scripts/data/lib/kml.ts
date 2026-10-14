import { DOMParser, type Element } from '@xmldom/xmldom';
import type { WardKey } from '../../../src/config/calibration';

/** One ward from the OpenCity GBA final ward KML (data-sources §1). Rings are [lon, lat] pairs. */
export interface KmlWard {
  /** e.g. "South", from the KML's `Corporation` field. */
  readonly corporation: string;
  readonly wardId: number;
  readonly name: string;
  readonly population2011: number;
  readonly rings: readonly (readonly (readonly [lon: number, lat: number])[])[];
}

function elements(parent: Element, tag: string): Element[] {
  const list = parent.getElementsByTagName(tag);
  const out: Element[] = [];
  for (let i = 0; i < list.length; i++) out.push(list.item(i)!);
  return out;
}

function parseCoordinates(text: string): [number, number][] {
  return text
    .trim()
    .split(/\s+/)
    .filter((t) => t.length > 0)
    .map((t) => {
      const [lon, lat] = t.split(',').map(Number);
      if (!Number.isFinite(lon) || !Number.isFinite(lat)) throw new Error(`Bad KML coordinate: ${t}`);
      return [lon!, lat!];
    });
}

/** Parses every Placemark. Throws if a Placemark lacks Corporation, ward_id, ward_name or TOT_P. */
export function parseWardKml(xml: string): KmlWard[] {
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  return elements(doc.documentElement!, 'Placemark').map((pm, index) => {
    const fields = new Map<string, string>();
    for (const sd of elements(pm, 'SimpleData')) fields.set(sd.getAttribute('name') ?? '', (sd.textContent ?? '').trim());
    const need = (name: string): string => {
      const v = fields.get(name);
      if (v === undefined || v === '') throw new Error(`Placemark ${index} has no ${name}`);
      return v;
    };
    const rings = elements(pm, 'outerBoundaryIs').flatMap((ob) => elements(ob, 'coordinates').map((c) => parseCoordinates(c.textContent ?? '')));
    return {
      corporation: need('Corporation'),
      wardId: Number(need('ward_id')),
      name: need('ward_name'),
      population2011: Math.round(Number(need('TOT_P'))),
      rings,
    };
  });
}

const normalise = (s: string): string => s.trim().replace(/\s+/g, ' ').toLowerCase();

/**
 * Picks the cluster wards by `<corporation>-<ward id>` key (CLUSTER_WARDS) and checks their names. Throws listing
 * every key that is missing or whose name differs.
 */
export function selectClusterWards(all: readonly KmlWard[], keys: readonly { readonly key: WardKey; readonly name: string }[]): (KmlWard & { readonly key: WardKey })[] {
  const problems: string[] = [];
  const picked: (KmlWard & { readonly key: WardKey })[] = [];
  for (const { key, name } of keys) {
    const [corp, num] = key.split('-');
    const ward = all.find((w) => normalise(w.corporation) === normalise(corp!) && w.wardId === Number(num));
    if (!ward) problems.push(`${key} (${name}) is missing`);
    else if (normalise(ward.name) !== normalise(name)) problems.push(`${key} is named "${ward.name}", expected "${name}"`);
    else picked.push({ ...ward, key });
  }
  if (problems.length > 0) throw new Error(`Cluster wards do not match the KML: ${problems.join('; ')}`);
  return picked;
}
