import { describe, expect, it } from 'vitest';
import { CLUSTER_WARDS } from '../../../src/config/calibration';
import { parseWardKml, selectClusterWards, type KmlWard } from '../../../scripts/data/lib/kml';

// Data-sources §1/§1a: wards come from the OpenCity GBA final ward KML (Dec 2025). The fixture mirrors its schema.

const placemark = (corp: string, id: number, name: string, pop: number, coords: string): string => `
  <Placemark>
    <ExtendedData><SchemaData schemaUrl="#wards">
      <SimpleData name="Corporation">${corp}</SimpleData>
      <SimpleData name="ward_id">${id}</SimpleData>
      <SimpleData name="ward_name">${name}</SimpleData>
      <SimpleData name="Ward_Name">${id} - ${name}</SimpleData>
      <SimpleData name="TOT_P">${pop}.0</SimpleData>
    </SchemaData></ExtendedData>
    <MultiGeometry><Polygon><outerBoundaryIs><LinearRing><coordinates>${coords}</coordinates></LinearRing></outerBoundaryIs></Polygon></MultiGeometry>
  </Placemark>`;

const SQUARE = '77.63,12.90 77.65,12.90 77.65,12.92 77.63,12.92 77.63,12.90';

const KML = `<?xml version="1.0" encoding="utf-8" ?>
<kml xmlns="http://www.opengis.net/kml/2.2"><Document id="root_doc"><Folder><name>wards</name>
${placemark('South', 72, 'HSR Layout', 18787, SQUARE)}
${placemark('South', 71, 'Agara', 18836, SQUARE)}
${placemark('East', 72, 'Somewhere Else', 20000, SQUARE)}
</Folder></Document></kml>`;

describe('parseWardKml', () => {
  it('reads corporation, ward id, name, 2011 population and rings as [lon, lat]', () => {
    const wards = parseWardKml(KML);
    expect(wards).toHaveLength(3);
    expect(wards[0]).toEqual({
      corporation: 'South',
      wardId: 72,
      name: 'HSR Layout',
      population2011: 18_787,
      rings: [[[77.63, 12.9], [77.65, 12.9], [77.65, 12.92], [77.63, 12.92], [77.63, 12.9]]],
    });
  });

  it('rejects a Placemark without TOT_P', () => {
    expect(() => parseWardKml(KML.replace('<SimpleData name="TOT_P">18787.0</SimpleData>', ''))).toThrow(/TOT_P/);
  });
});

describe('selectClusterWards', () => {
  const ward = (corporation: string, wardId: number, name: string): KmlWard => ({ corporation, wardId, name, population2011: 1, rings: [] });
  const ALL = CLUSTER_WARDS.map((w) => ward(w.corporation, w.ward, w.name)).concat([ward('East', 72, 'Somewhere Else')]);

  it('picks the 7 cluster wards by corporation and number, not by number alone', () => {
    const picked = selectClusterWards(ALL, CLUSTER_WARDS);
    expect(picked.map((w) => w.key).sort()).toEqual(CLUSTER_WARDS.map((w) => w.key).sort());
    expect(picked.find((w) => w.key === 'South-72')!.name).toBe('HSR Layout');
  });

  it('lists every missing or renamed ward in one error', () => {
    const broken = ALL.filter((w) => !(w.corporation === 'South' && w.wardId === 69)).map((w) => (w.wardId === 71 && w.corporation === 'South' ? { ...w, name: 'Agara Lake' } : w));
    expect(() => selectClusterWards(broken, CLUSTER_WARDS)).toThrow(/South-69[\s\S]*South-71|South-71[\s\S]*South-69/);
  });
});
