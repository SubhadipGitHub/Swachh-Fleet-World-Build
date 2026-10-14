import { expect, test, type Page } from '@playwright/test';
import { openApp } from './helpers';

// Requirements D-2, D-3, D-5, D-6, D-8, D-9 (M2 Dashboard). DOM contract:
// - KPI cards: region "Key indicators" with three article[data-kpi] (overflowing, fuel, coverage), each with
//   .kpi-value, .kpi-delta ("… vs baseline" or "Same as baseline") and svg.sparkline
// - Tables: tablist "Live tables" (Bins & points, Fleet, Routes); rows are role=row inside the tabpanel; column
//   headers are buttons; a textbox "Filter rows"; clicking a row selects its object (first cell is its id)
// - Alerts: top-bar button named "Alerts…" opens list "Alerts" of listitems; clicking one selects its target
// - Tracker: region "Process tracker" with six listitems carrying data-step
// - Search: combobox "Search" with a listbox of options; Enter picks the first
// - Data sources: top-bar button "Data sources" opens dialog "Data sources"; Esc closes it

async function at(page: Page, hhmm: string): Promise<void> {
  await page.evaluate((t) => window.__kasaflow!.skipTo(t), hhmm);
}

test.describe('dashboard', () => {
  test.beforeEach(async ({ page }) => {
    await openApp(page);
    await at(page, '11:00');
  });

  test('shows three live KPI cards with values, deltas against the baseline and trends (D-3)', async ({ page }) => {
    const region = page.getByRole('region', { name: 'Key indicators' });
    await expect(region).toBeVisible();
    for (const kpi of ['overflowing', 'fuel', 'coverage']) {
      const card = region.locator(`article[data-kpi="${kpi}"]`);
      await expect(card).toBeVisible();
      await expect(card.locator('.kpi-value')).not.toHaveText('');
      await expect(card.locator('.kpi-delta')).toContainText(/baseline/i);
      await expect(card.locator('svg.sparkline')).toBeVisible();
    }
    await expect(region.locator('article[data-kpi="fuel"] .kpi-value')).toContainText(/L\/t/);
    await expect(region.locator('article[data-kpi="coverage"] .kpi-value')).toContainText('%');
  });

  test('has three sortable, filterable table tabs whose rows select objects (D-6)', async ({ page }) => {
    const tabs = page.getByRole('tablist', { name: 'Live tables' });
    for (const name of ['Bins & points', 'Fleet', 'Routes']) await expect(tabs.getByRole('tab', { name })).toBeVisible();
    await tabs.getByRole('tab', { name: 'Fleet' }).click();
    const panel = page.getByRole('tabpanel');
    await expect(panel.getByRole('row')).toHaveCount(74); // header + 73 vehicles
    await panel.getByRole('button', { name: /Km today/ }).click();
    await panel.getByRole('button', { name: /Km today/ }).click();
    const km = await panel.locator('tbody tr td[data-col="kmToday"]').allTextContents();
    const nums = km.map((s) => Number(s.replace(/[^\d.]/g, '')));
    for (let i = 1; i < nums.length; i++) expect(nums[i]!).toBeLessThanOrEqual(nums[i - 1]!);
    await page.getByRole('textbox', { name: 'Filter rows' }).fill('CP-BLR');
    await expect(panel.locator('tbody tr')).toHaveCount(6);
    const first = panel.locator('tbody tr').first();
    const id = (await first.locator('td').first().textContent())!.trim();
    await first.click();
    await expect.poll(() => page.evaluate(() => window.__kasaflow!.selectedId())).toBe(id);
  });

  test('lists alerts and selects an alert’s subject when clicked (D-8)', async ({ page }) => {
    await page.getByRole('button', { name: /^Alerts/ }).click();
    const list = page.getByRole('list', { name: 'Alerts' });
    await expect(list.getByRole('listitem').first()).toBeVisible();
    await list.getByRole('listitem').first().click();
    await expect.poll(() => page.evaluate(() => window.__kasaflow!.selectedId())).not.toBeNull();
  });

  test('shows the six-step process tracker, with IST times for a selected bin (D-5)', async ({ page }) => {
    const tracker = page.getByRole('region', { name: 'Process tracker' });
    await expect(tracker.getByRole('listitem')).toHaveCount(6);
    await expect(tracker.locator('[data-step="Collected"]')).toContainText(/\d/);
    await page.getByRole('tablist', { name: 'Live tables' }).getByRole('tab', { name: 'Bins & points' }).click();
    await page.getByRole('tabpanel').locator('tbody tr').first().click();
    await expect(tracker.locator('[data-step="Fill reported"]')).toContainText(/\d{2}:\d{2}/);
  });

  test('searches wards, vehicles and streets (D-2)', async ({ page }) => {
    const box = page.getByRole('combobox', { name: 'Search' });
    await box.fill('HSR');
    const options = page.getByRole('listbox').getByRole('option');
    await expect(options.filter({ hasText: 'HSR Layout' }).first()).toBeVisible();
    await expect(options.filter({ hasText: /^AT-HSR-/ }).first()).toBeVisible();
    await box.fill('AT-HSR-001');
    await box.press('Enter');
    await expect.poll(() => page.evaluate(() => window.__kasaflow!.selectedId())).toBe('AT-HSR-001');
    await box.fill('Main Road');
    await expect(page.getByRole('listbox').getByRole('option').first()).toContainText(/Main Road/);
  });

  test('opens the Data sources dialog with every figure tagged, and closes it with Esc (D-9)', async ({ page }) => {
    await page.getByRole('button', { name: 'Data sources' }).click();
    const dialog = page.getByRole('dialog', { name: 'Data sources' });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('ODbL');
    await expect(dialog).toContainText('2026-10-14');
    expect(await dialog.getByRole('row').count()).toBeGreaterThan(25);
    for (const tag of ['Real', 'Assumed', 'Derived', 'Simulated']) await expect(dialog.getByText(tag, { exact: true }).first()).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
  });
});
