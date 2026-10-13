import { readdirSync, statSync } from 'node:fs';
import { dirname } from 'node:path';
import { expect, test } from '@playwright/test';
import { APP_URL, DIST_INDEX, openApp } from './helpers';

// Requirements N-1 (one offline file), N-6 (no runtime calls), N-8 (WebGL 2 message), W-7 (OSM attribution),
// P-5/D9 (disclaimer), N-2 (draw-call budget); architecture AD-13 (CSP), AD-14.

test.describe('the built single file', () => {
  test('is one self-contained index.html within the 15 MB budget', () => {
    expect(readdirSync(dirname(DIST_INDEX))).toEqual(['index.html']);
    expect(statSync(DIST_INDEX).size).toBeLessThanOrEqual(15 * 1024 * 1024);
  });

  test('renders the world from file:// with zero network requests', async ({ page }) => {
    const external: string[] = [];
    page.on('request', (r) => {
      if (!/^(file|data|blob|about):/.test(r.url())) external.push(r.url());
    });
    await openApp(page);
    await expect(page.locator('canvas').first()).toBeVisible();
    expect(external).toEqual([]);
  });

  test('ships a Content-Security-Policy that forbids network connections', async ({ page }) => {
    await page.goto(APP_URL);
    const csp = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content');
    expect(csp).toContain("connect-src 'none'");
    expect(csp).toContain("default-src 'none'");
  });

  test('always shows the OpenStreetMap attribution with a licence link', async ({ page }) => {
    await openApp(page);
    const link = page.getByRole('link', { name: /© OpenStreetMap contributors/ });
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute('href', /openstreetmap\.org\/copyright/);
  });

  test('always shows that it is an independent simulation', async ({ page }) => {
    await openApp(page);
    await expect(page.getByText(/Independent simulation/i).first()).toBeVisible();
  });

  test('stays within the laptop draw-call budget', async ({ page }) => {
    await openApp(page);
    const calls = await page.evaluate(() => window.__kasaflow!.drawCalls());
    expect(calls).toBeGreaterThan(0);
    expect(calls).toBeLessThanOrEqual(200);
  });

  test('explains clearly when WebGL 2 is missing', async ({ page }) => {
    await page.addInitScript(() => {
      type GetContext = (this: HTMLCanvasElement, type: string, ...rest: unknown[]) => unknown;
      const proto = HTMLCanvasElement.prototype as unknown as { getContext: GetContext };
      const original = proto.getContext;
      proto.getContext = function (type, ...rest) {
        return type === 'webgl2' ? null : original.call(this, type, ...rest);
      };
    });
    await page.goto(APP_URL);
    await expect(page.getByRole('alert')).toContainText(/WebGL 2/);
  });
});
