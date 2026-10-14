import { describe, expect, it } from 'vitest';
import { DAY_SEC, secondOfDay } from '../../src/sim/clock';
import { createWorld, drainEvents, runUntil, vehicles } from '../../src/sim/world';
import { buildTown, townConfig, townSpec } from '../fixtures/town';

// Requirements X-2 and architecture M2-7: black-spot clearance runs at night and finishes before midnight.

describe('night clearance', () => {
  it('clears black spots after 19:00 and has the crews idle by midnight', () => {
    const world = createWorld(buildTown(), townConfig({ blackSpotBaseChancePerHour: 0.9 }), townSpec({ levers: { tipperAbsenceRate: 1, breakdownChancePerShift: 0, skipChance: 0 } }));
    runUntil(world, DAY_SEC);
    const cleared = drainEvents(world).filter((e) => e.kind === 'BlackSpotCleared');
    expect(cleared.length).toBeGreaterThan(0);
    for (const e of cleared) {
      expect(secondOfDay(e.t)).toBeGreaterThanOrEqual(19 * 3600);
      expect(e.t).toBeLessThanOrEqual(DAY_SEC);
    }
    expect(vehicles(world).filter((v) => v.kind === 'crew').every((v) => v.state === 'Idle')).toBe(true);
  });
});
