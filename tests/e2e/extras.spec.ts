import { expect, test, type Page } from '@playwright/test';
import { openApp } from './helpers';

// Requirements X-1, X-2, X-4 and D-2 (M2 Extras). DOM contract:
// - Weather: a select named "Weather" with clear, monsoon, haze, heatwave; the stage gets data-weather
// - Day/night: a button named "Day/night: Auto|Day|Night" that cycles; debug lighting() reports the phase on screen
// - Theme: a button named "Switch to light theme" / "Switch to dark theme"; <html data-theme>
// - The top bar shows a "Viewer" user chip and the routing policy switch (M3-1: radio group "Routing policy")

async function at(page: Page, hhmm: string): Promise<void> {
  await page.evaluate((t) => window.__kasaflow!.skipTo(t), hhmm);
}

test.describe('extras', () => {
  test.beforeEach(async ({ page }) => {
    await openApp(page);
  });

  test('switches the weather for both worlds, so under Static the KPIs match the baseline (X-1, M3-2)', async ({ page }) => {
    await page.getByRole('combobox', { name: 'Weather' }).selectOption('monsoon');
    await expect(page.locator('.stage')).toHaveAttribute('data-weather', 'monsoon');
    expect(await page.evaluate(() => window.__kasaflow!.weather())).toBe('monsoon');
    await at(page, '11:00');
    await expect.poll(async () => (await page.locator('.kpi-delta').allTextContents()).length).toBe(3);
    for (const t of await page.locator('.kpi-delta').allTextContents()) expect(t).toMatch(/same as baseline/i);
  });

  test('follows the real sun: night after sunset, day at noon (X-2)', async ({ page }) => {
    await at(page, '20:30');
    await expect.poll(() => page.evaluate(() => window.__kasaflow!.lighting().phase)).toBe('night');
    await at(page, '12:00');
    await expect.poll(() => page.evaluate(() => window.__kasaflow!.lighting().phase)).toBe('day');
  });

  test('can force day or night for viewing (D-2)', async ({ page }) => {
    await at(page, '20:30');
    const toggle = page.getByRole('button', { name: /^Day\/night/ });
    await expect(toggle).toHaveAccessibleName('Day/night: Auto');
    await toggle.click();
    await expect(toggle).toHaveAccessibleName('Day/night: Day');
    await expect.poll(() => page.evaluate(() => window.__kasaflow!.lighting())).toEqual({ phase: 'day', override: 'day' });
    await toggle.click();
    await expect(toggle).toHaveAccessibleName('Day/night: Night');
    await toggle.click();
    await expect(toggle).toHaveAccessibleName('Day/night: Auto');
  });

  test('remembers the light theme across a reload (X-4)', async ({ page }) => {
    await expect(page.locator('html')).not.toHaveAttribute('data-theme', 'light');
    await page.getByRole('button', { name: 'Switch to light theme' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await page.reload();
    await expect.poll(() => page.evaluate(() => window.__kasaflow?.ready ?? false), { timeout: 45_000 }).toBe(true);
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await page.getByRole('button', { name: 'Switch to dark theme' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  });

  test('shows the viewer chip and the routing policy (D-2)', async ({ page }) => {
    await expect(page.getByText('Viewer', { exact: true })).toBeVisible();
    const policy = page.getByRole('radiogroup', { name: 'Routing policy' });
    await expect(policy.getByRole('radio', { name: 'Static' })).toBeChecked();
    await expect(policy.getByRole('radio', { name: 'Dynamic' })).not.toBeChecked();
  });
});
