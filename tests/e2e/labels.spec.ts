import { expect, test } from '@playwright/test';
import { clickCanvasAt, openApp } from './helpers';

// Requirements W-8 and CR-1/CR-2 (architecture §9): place names float as 3D signs; buildings are not drawn.

test.describe('floating place labels', () => {
  test.beforeEach(async ({ page }) => {
    await openApp(page);
  });

  test('replaces the flat ward text and shows only area names at the overview', async ({ page }) => {
    await expect(page.locator('.ward-label')).toHaveCount(0);
    await expect
      .poll(async () => (await page.evaluate(() => window.__kasaflow!.labels())).map((l) => l.text).sort())
      .toEqual(['HSR Layout', 'Koramangala']);
  });

  test('shows ward and transfer-point names after flying to HSR Layout', async ({ page }) => {
    await page.getByRole('navigation', { name: 'Areas' }).getByRole('button', { name: 'HSR Layout' }).click();
    // Ward names fade in during the glide (below 3,800 m); facility names once it settles at 2,200 m.
    await expect
      .poll(
        async () => {
          const labels = await page.evaluate(() => window.__kasaflow!.labels());
          return {
            ward: labels.some((l) => l.text === 'South-72 · HSR Layout'),
            transferPoint: labels.some((l) => l.group === 'facility' && /^TP-\d{2} · /.test(l.text)),
            area: labels.some((l) => l.group === 'area'),
          };
        },
        { timeout: 10_000 },
      )
      .toEqual({ ward: true, transferPoint: true, area: false });
  });

  test('never blocks clicks on the map', async ({ page }) => {
    await page.getByRole('navigation', { name: 'Areas' }).getByRole('button', { name: 'HSR Layout' }).click();
    await expect.poll(async () => (await page.evaluate(() => window.__kasaflow!.labels())).length, { timeout: 10_000 }).toBeGreaterThan(0);
    // Click right on a label: it is not pickable, so the click reaches the map (nothing within reach → nothing selected).
    const label = (await page.evaluate(() => window.__kasaflow!.labels()))[0]!;
    await clickCanvasAt(page, { x: label.x, y: label.y });
    const el = await page.evaluate(({ x, y }) => {
      const c = document.querySelector('canvas')!.getBoundingClientRect();
      return document.elementFromPoint(c.left + x, c.top + y)?.tagName ?? null;
    }, label);
    expect(el).toBe('CANVAS');
  });
});
