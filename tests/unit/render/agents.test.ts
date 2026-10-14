import type { InstancedMesh, Points } from 'three';
import { Matrix4, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { buildAgents, facilityCentre } from '../../../src/render/agents';
import type { MapView } from '../../../src/workers/protocol';

// Regression: per-frame vehicle updates must reach the GPU attributes (a copied array once hid every fleet marker).

const VIEW: MapView = {
  startDate: '2026-10-14',
  facilities: [{ kind: 'depot', id: 0, displayId: 'DEPOT-S-01', name: 'Vehicle depot', x: 100, y: 200, location: 'assumed' }],
  bins: [{ id: 0, kind: 'market', displayId: 'HS-101', x: 0, y: 0, capacityKg: 240 }],
  blackSpots: [{ id: 0, displayId: 'GVP-HSR-001', x: 10, y: 10 }],
  vehicles: [
    { id: 0, kind: 'auto-tipper', displayId: 'AT-HSR-001', lengthM: 4.5 },
    { id: 1, kind: 'compactor', displayId: 'CP-BLR-S-01', lengthM: 9 },
  ],
  wards: [],
  households: 1000,
  fetchedAt: '2026-10-14',
  floodSpots: [],
};

describe('buildAgents', () => {
  it('writes vehicle positions into the marker geometry and the instanced meshes', () => {
    const agents = buildAgents(VIEW);
    agents.setVehicle(0, 123, 456, 0, true);
    agents.setVehicle(1, -50, 20, Math.PI / 2, false);
    agents.commit();
    const markers = agents.group.getObjectByName('vehicle-markers') as Points;
    const pos = markers.geometry.getAttribute('position');
    expect([pos.getX(0), pos.getY(0), pos.getZ(0)]).toEqual([123, 3, -456]);
    expect(pos.getY(1)).toBeLessThan(-1000);
    const tippers = agents.group.getObjectByName('vehicles-auto-tipper') as InstancedMesh;
    const m = new Matrix4();
    tippers.getMatrixAt(0, m);
    expect(new Vector3().setFromMatrixPosition(m).toArray()).toEqual([123, 0, -456]);
  });

  it('shows a black spot only while it has waste', () => {
    const agents = buildAgents(VIEW);
    const spots = agents.group.getObjectByName('black-spots') as InstancedMesh;
    const m = new Matrix4();
    spots.getMatrixAt(0, m);
    expect(m.determinant()).toBe(0);
    agents.setSpotSize(0, 80);
    spots.getMatrixAt(0, m);
    expect(m.determinant()).not.toBe(0);
  });

  it('draws facilities beside their node', () => {
    const c = facilityCentre(VIEW.facilities[0]!);
    expect(c.x).toBeLessThan(100);
    expect(c.y).toBeLessThan(200);
  });
});
