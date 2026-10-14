import { describe, expect, it } from 'vitest';
import { predictFullAt } from '../../../src/sim/forecast';

// M2-9: "predicted full at" in the Bins & points table (synthetic).

describe('predictFullAt', () => {
  it('extends the line through the last two readings to 100%', () => {
    expect(predictFullAt([{ t: 0, pct: 40 }, { t: 900, pct: 50 }])).toBe(5400);
  });

  it('uses only the last two readings', () => {
    expect(
      predictFullAt([
        { t: 0, pct: 90 },
        { t: 900, pct: 20 },
        { t: 1800, pct: 30 },
      ]),
    ).toBe(8100);
  });

  it('is null with fewer than two readings, a flat or falling fill, or a full bin', () => {
    expect(predictFullAt([])).toBeNull();
    expect(predictFullAt([{ t: 0, pct: 40 }])).toBeNull();
    expect(predictFullAt([{ t: 0, pct: 40 }, { t: 900, pct: 40 }])).toBeNull();
    expect(predictFullAt([{ t: 0, pct: 60 }, { t: 900, pct: 10 }])).toBeNull();
    expect(predictFullAt([{ t: 0, pct: 90 }, { t: 900, pct: 100 }])).toBeNull();
  });
});
