import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { DAY_SEC, at, dayIndex, formatIst, istDate, parseIsoDate, secondOfDay, toUtcMs } from '../../../src/sim/clock';

// Architecture AD-5: integer seconds since 00:00 IST on the start date. IST is UTC+05:30 with no DST.

describe('sim clock', () => {
  it('splits a time into day index and second of day', () => {
    expect(dayIndex(0)).toBe(0);
    expect(secondOfDay(0)).toBe(0);
    expect(dayIndex(DAY_SEC + 19_800)).toBe(1);
    expect(secondOfDay(DAY_SEC + 19_800)).toBe(19_800);
  });

  it('builds times from day, hour and minute', () => {
    expect(at(0, 5, 30)).toBe(19_800);
    expect(at(2, 0, 0)).toBe(2 * DAY_SEC);
    expect(() => at(0, 24, 0)).toThrow(RangeError);
    expect(() => at(0, 10, 60)).toThrow(RangeError);
  });

  it('formats IST wall-clock time', () => {
    expect(formatIst(0, '2026-10-14')).toBe('2026-10-14 00:00');
    expect(formatIst(at(1, 5, 30), '2026-10-14')).toBe('2026-10-15 05:30');
    expect(formatIst(at(0, 23, 59) + 59, '2026-10-14')).toBe('2026-10-14 23:59');
  });

  it('rolls over months, years and leap days', () => {
    expect(istDate(at(18, 0, 0), '2026-10-14')).toBe('2026-11-01');
    expect(istDate(at(1, 0, 0), '2026-12-31')).toBe('2027-01-01');
    expect(istDate(at(1, 0, 0), '2028-02-28')).toBe('2028-02-29');
    expect(istDate(at(1, 0, 0), '2027-02-28')).toBe('2027-03-01');
  });

  it('converts to UTC: 00:00 IST is 18:30 UTC the day before', () => {
    expect(toUtcMs(0, '2026-10-14')).toBe(Date.UTC(2026, 9, 13, 18, 30));
    expect(toUtcMs(at(0, 5, 30), '2026-10-14')).toBe(Date.UTC(2026, 9, 14, 0, 0));
  });

  it('agrees with the platform date library for any day within 10 years', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 3650 }), fc.integer({ min: 0, max: DAY_SEC - 1 }), (day, sec) => {
        const t = day * DAY_SEC + sec;
        const expected = new Date(Date.UTC(2026, 9, 14) + t * 1000).toISOString().slice(0, 10);
        expect(istDate(t, '2026-10-14')).toBe(expected);
      }),
    );
  });

  it('parses only real ISO dates', () => {
    expect(parseIsoDate('2026-10-14')).toBe('2026-10-14');
    expect(parseIsoDate('2028-02-29')).toBe('2028-02-29');
    for (const bad of ['2026-02-29', '2026-13-01', '2026-1-01', '14-10-2026', '']) expect(() => parseIsoDate(bad)).toThrow(RangeError);
  });
});
