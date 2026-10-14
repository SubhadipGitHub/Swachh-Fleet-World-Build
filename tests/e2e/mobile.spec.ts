import { expect, test } from '@playwright/test';
import { openApp } from './helpers';

// Requirements X-3 and N-2 (phone): panels collapse to a bottom sheet; touch works; draw calls stay within 120.

test.use({ viewport: { width: 390, height: 844 } });

test.describe('phone layout', () => {
  test('stays within the phone draw-call budget', async ({ page }) => {
    await openApp(page);
    const calls = await page.evaluate(() => window.__kasaflow!.drawCalls());
    expect(calls).toBeGreaterThan(0);
    expect(calls).toBeLessThanOrEqual(120);
  });

});

test.describe('phone touch', () => {
  // Skipped before the context is created: Playwright has no touch emulation for Firefox.
  test.skip(({ browserName }) => browserName === 'firefox', 'No touch emulation in Firefox');
  test.use({ hasTouch: true });

  test('shows details in a bottom sheet when a vehicle is tapped', async ({ page }) => {
    await openApp(page);
    await page.evaluate(() => window.__kasaflow!.skipTo('06:30'));
    const id = (await page.evaluate(() => window.__kasaflow!.vehicleIds()))[0]!;
    const pos = (await page.evaluate((i) => window.__kasaflow!.screenPositionOf(i), id))!;
    const box = (await page.locator('canvas').first().boundingBox())!;
    await page.touchscreen.tap(box.x + pos.x, box.y + pos.y);
    await expect.poll(() => page.evaluate(() => window.__kasaflow!.selectedId())).toBe(id);
    const details = page.getByRole('complementary', { name: 'Details' });
    await expect(details).toBeVisible();
    const sheet = (await details.boundingBox())!;
    expect(sheet.y).toBeGreaterThan(844 * 0.4);
    expect(sheet.width).toBeGreaterThan(390 * 0.9);
  });

  test('gathers details, tracker, tables and alerts into one tabbed bottom sheet (M2-14)', async ({ page }) => {
    await openApp(page);
    const tabs = page.getByRole('tablist', { name: 'Panel' });
    await expect(tabs).toBeVisible();
    for (const name of ['Details', 'Tracker', 'Tables', 'Alerts']) await expect(tabs.getByRole('tab', { name })).toBeVisible();
    await tabs.getByRole('tab', { name: 'Tables' }).click();
    await expect(page.getByRole('tablist', { name: 'Live tables' })).toBeVisible();
    const top = (await tabs.boundingBox())!.y;
    expect(top).toBeGreaterThan(844 * 0.4);
  });
});
