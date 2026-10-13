import { describe, expect, it } from 'vitest';
import { hashEvents, type SimEvent } from '../../../src/sim/events';

// Architecture AD-5: the determinism contract is checked by hashing the event stream.

const EVENTS: SimEvent[] = [
  { t: 21_600, kind: 'ShiftStarted', vehicleId: 3 },
  { t: 22_000, kind: 'StopServed', vehicleId: 3, target: { type: 'segment', id: 12 }, kg: 41.5 },
  { t: 23_000, kind: 'SensorReading', binId: 7, fillPct: null, status: 'offline' },
];

describe('hashEvents', () => {
  it('is 16 lower-case hex digits', () => {
    expect(hashEvents(EVENTS)).toMatch(/^[0-9a-f]{16}$/);
  });

  it('is the 64-bit FNV-1a offset basis for an empty stream', () => {
    expect(hashEvents([])).toBe('cbf29ce484222325');
  });

  it('depends on order and content', () => {
    expect(hashEvents([EVENTS[1]!, EVENTS[0]!, EVENTS[2]!])).not.toBe(hashEvents(EVENTS));
    expect(hashEvents([{ ...EVENTS[0]!, t: 21_601 }, EVENTS[1]!, EVENTS[2]!])).not.toBe(hashEvents(EVENTS));
  });

  it('ignores key order inside an event (canonical JSON)', () => {
    const reordered = { kg: 41.5, target: { id: 12, type: 'segment' }, vehicleId: 3, kind: 'StopServed', t: 22_000 } as unknown as SimEvent;
    expect(hashEvents([EVENTS[0]!, reordered, EVENTS[2]!])).toBe(hashEvents(EVENTS));
  });
});
