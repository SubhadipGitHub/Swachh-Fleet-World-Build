import { expect, test, type Page } from '@playwright/test';
import { clickCanvasAt, openApp } from './helpers';

// Requirements I-1 to I-7 and D-4 (M1 Interaction): selecting, following and clearing.

async function selectFirstVehicle(page: Page): Promise<string> {
  await page.evaluate(() => window.__kasaflow!.skipTo('06:30'));
  const ids = await page.evaluate(() => window.__kasaflow!.vehicleIds());
  expect(ids.length).toBeGreaterThan(0);
  const id = ids[0]!;
  const pos = await page.evaluate((i) => window.__kasaflow!.screenPositionOf(i), id);
  expect(pos).not.toBeNull();
  await clickCanvasAt(page, pos!);
  return id;
}

test.describe('selection', () => {
  test.beforeEach(async ({ page }) => {
    await openApp(page);
  });

  test('clicking a vehicle selects it, labels it and opens its details (I-3, I-4)', async ({ page }) => {
    const id = await selectFirstVehicle(page);
    await expect.poll(() => page.evaluate(() => window.__kasaflow!.selectedId())).toBe(id);
    await expect(page.getByTestId('selection-label')).toContainText(id);
    const panel = page.getByRole('complementary', { name: 'Details' });
    await expect(panel).toBeVisible();
    await expect(panel).toContainText(id);
  });

  test('vehicle IDs follow the documented format (D-7)', async ({ page }) => {
    await page.evaluate(() => window.__kasaflow!.skipTo('06:30'));
    const ids = await page.evaluate(() => window.__kasaflow!.vehicleIds());
    for (const id of ids) expect(id).toMatch(/^(AT-[A-Z]{2,4}-\d{3}|CP-BLR-S-\d{2}|CR-BLR-S-\d{2})$/);
  });

  test('the camera follows the selected vehicle (I-2)', async ({ page }) => {
    const id = await selectFirstVehicle(page);
    await page.waitForTimeout(3000);
    const box = (await page.locator('canvas').first().boundingBox())!;
    const pos = await page.evaluate((i) => window.__kasaflow!.screenPositionOf(i), id);
    expect(pos).not.toBeNull();
    expect(Math.abs(pos!.x - box.width / 2)).toBeLessThan(box.width * 0.25);
    expect(Math.abs(pos!.y - box.height / 2)).toBeLessThan(box.height * 0.25);
  });

  test('Esc clears the selection (I-7)', async ({ page }) => {
    await selectFirstVehicle(page);
    await page.keyboard.press('Escape');
    await expect.poll(() => page.evaluate(() => window.__kasaflow!.selectedId())).toBeNull();
    await expect(page.getByRole('complementary', { name: 'Details' })).toBeHidden();
  });

  test('clicking empty ground clears the selection (I-7)', async ({ page }) => {
    await selectFirstVehicle(page);
    const ground = await page.evaluate(() => window.__kasaflow!.emptyGroundPoint());
    expect(ground).not.toBeNull();
    await clickCanvasAt(page, ground!);
    await expect.poll(() => page.evaluate(() => window.__kasaflow!.selectedId())).toBeNull();
  });
});

test.describe('navigation', () => {
  test('offers the five areas (I-5)', async ({ page }) => {
    await openApp(page);
    for (const name of ['Overview', 'HSR Layout', 'Koramangala', 'Transfer points', 'KCDC Kudlu Gate']) {
      await expect(page.getByRole('button', { name, exact: true })).toBeVisible();
    }
  });
});
