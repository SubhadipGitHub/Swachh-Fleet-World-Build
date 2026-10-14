import { expect, test, type Page } from '@playwright/test';
import { clickCanvasAt, openApp } from './helpers';

// Requirements M3-1, M3-10 and architecture M3-D12 (M3 Dynamic routing). DOM contract:
// - Top bar: radio group "Routing policy" with radios "Static" and "Dynamic"
// - Routes table: a "Policy" column and a "Re-plans" column
// - Vehicle detail panel: a "Why this route" section listing planned streets with reasons, then "Deferred (n)"

async function at(page: Page, hhmm: string): Promise<void> {
  await page.evaluate((t) => window.__kasaflow!.skipTo(t), hhmm);
}

async function goDynamic(page: Page): Promise<void> {
  await page.getByRole('radiogroup', { name: 'Routing policy' }).getByRole('radio', { name: 'Dynamic' }).check();
  await expect(page.getByRole('radio', { name: 'Dynamic' })).toBeChecked();
}

test.describe('Dynamic routing', () => {
  test.beforeEach(async ({ page }) => {
    await openApp(page);
  });

  test('switching to Dynamic makes the KPIs move against the Static baseline', async ({ page }) => {
    await goDynamic(page);
    await at(page, '12:00');
    await expect
      .poll(async () => (await page.locator('.kpi-delta').allTextContents()).some((t) => !/same as baseline/i.test(t)), { timeout: 15_000 })
      .toBe(true);
  });

  test('the Routes table shows the policy and re-plans', async ({ page }) => {
    await goDynamic(page);
    await at(page, '09:00');
    await page.getByRole('tablist', { name: 'Live tables' }).getByRole('tab', { name: 'Routes' }).click();
    const panel = page.getByRole('tabpanel');
    await expect(panel.getByRole('button', { name: /^Policy/ })).toBeVisible();
    await expect(panel.getByRole('button', { name: /^Re-plans/ })).toBeVisible();
    await expect(panel.locator('td[data-col="policy"]').first()).toHaveText('Dynamic');
  });

  test('a tipper’s detail explains why each street is on its route', async ({ page }) => {
    await goDynamic(page);
    await at(page, '07:00');
    const id = (await page.evaluate(() => window.__kasaflow!.vehicleIds())).find((v) => v.startsWith('AT-'))!;
    expect(id).toBeDefined();
    const pos = (await page.evaluate((i) => window.__kasaflow!.screenPositionOf(i), id))!;
    await clickCanvasAt(page, pos);
    await expect.poll(() => page.evaluate(() => window.__kasaflow!.selectedId())).toBe(id);
    const details = page.getByRole('complementary', { name: 'Details' });
    const why = details.getByRole('region', { name: 'Why this route' });
    await expect(why).toBeVisible();
    await expect(why.getByRole('listitem').first()).toContainText(/backlog|beat|fairness|black-spot risk/i);
    await expect(why).toContainText(/Deferred \(\d+\)/);
  });
});
