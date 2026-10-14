import { describe, expect, it } from 'vitest';
import { lightingFor } from '../../../src/render/lighting';
import { TRAIL_MIN_SPEED, TrailBuffer, trailsEnabled } from '../../../src/render/trails';

// Requirements X-2 (day and night) and AD-10 (trails at 120× and above).

describe('lightingFor', () => {
  it('splits day, twilight and night at ±6°', () => {
    expect(lightingFor(30).phase).toBe('day');
    expect(lightingFor(6.1).phase).toBe('day');
    expect(lightingFor(0).phase).toBe('twilight');
    expect(lightingFor(-6).phase).toBe('twilight');
    expect(lightingFor(-6.1).phase).toBe('night');
  });

  it('turns night lights on below the horizon, fully at night', () => {
    expect(lightingFor(10).nightLights).toBe(false);
    expect(lightingFor(2).nightLights).toBe(false);
    expect(lightingFor(-3).nightLights).toBe(true);
    expect(lightingFor(-20).nightLights).toBe(true);
  });

  it('never brightens as the sun sinks', () => {
    let prev = lightingFor(60);
    for (let alt = 59; alt >= -30; alt -= 1) {
      const l = lightingFor(alt);
      expect(l.sun).toBeLessThanOrEqual(prev.sun);
      expect(l.sky).toBeLessThanOrEqual(prev.sky);
      prev = l;
    }
    expect(lightingFor(-30).sky).toBeGreaterThan(0);
  });

  it('has no lit-window term now that buildings are not drawn (CR-1)', () => {
    expect(Object.keys(lightingFor(-20))).not.toContain('windowGlow');
  });

  it('can be forced to day or night for viewing', () => {
    expect(lightingFor(40, 'night')).toMatchObject({ phase: 'night', nightLights: true });
    expect(lightingFor(-20, 'day')).toMatchObject({ phase: 'day', nightLights: false });
    expect(lightingFor(-20, 'auto').phase).toBe('night');
  });
});

describe('trails', () => {
  it('switch on at 120×', () => {
    expect(TRAIL_MIN_SPEED).toBe(120);
    expect(trailsEnabled(60)).toBe(false);
    expect(trailsEnabled(120)).toBe(true);
    expect(trailsEnabled(240)).toBe(true);
  });

  it('keep the most recent points within a time window, oldest first', () => {
    const b = new TrailBuffer(3);
    for (let t = 0; t < 5; t++) b.push(t * 10, t, -t);
    expect(b.recent(40, 100)).toEqual([
      { t: 20, x: 2, y: -2 },
      { t: 30, x: 3, y: -3 },
      { t: 40, x: 4, y: -4 },
    ]);
    expect(b.recent(40, 15).map((p) => p.t)).toEqual([30, 40]);
  });

  it('clear on a jump back in time', () => {
    const b = new TrailBuffer(5);
    b.push(100, 1, 1);
    b.push(110, 2, 2);
    b.push(50, 9, 9);
    expect(b.recent(50, 100)).toEqual([{ t: 50, x: 9, y: 9 }]);
    b.clear();
    expect(b.recent(50, 100)).toEqual([]);
    expect(() => new TrailBuffer(1)).toThrow(RangeError);
  });
});
