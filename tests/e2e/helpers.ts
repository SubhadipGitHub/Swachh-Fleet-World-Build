import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect, type Page } from '@playwright/test';
import type {} from '../../src/app/debug-api';

/** The built single file (N-1), opened from disk. */
export const DIST_INDEX = resolve(import.meta.dirname, '../../dist/index.html');
export const APP_URL = `${pathToFileURL(DIST_INDEX).href}?debug=1`;

/** Opens the app with the debug hook and waits for the first full frame. */
export async function openApp(page: Page): Promise<void> {
  await page.goto(APP_URL);
  await expect.poll(() => page.evaluate(() => window.__kasaflow?.ready ?? false), { timeout: 45_000 }).toBe(true);
}

/** Clicks a point given in canvas CSS pixels. */
export async function clickCanvasAt(page: Page, p: { x: number; y: number }): Promise<void> {
  const box = await page.locator('canvas').first().boundingBox();
  if (!box) throw new Error('canvas not laid out');
  await page.mouse.click(box.x + p.x, box.y + p.y);
}
