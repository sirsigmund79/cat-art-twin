import path from 'node:path';
import { expect, test } from '@playwright/test';

const FIXTURE = path.join(import.meta.dirname, '..', 'fixtures', 'cat.jpg');
const HEIC_FIXTURE = path.join(import.meta.dirname, '..', 'fixtures', 'cat.heic');

test('landing page renders and promises privacy', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'What creature is your cat?' })).toBeVisible();
  await expect(page.getByText('Your photo never leaves your device.')).toBeVisible();
});

test('an iPhone HEIC photo opens in the crop step', async ({ page }) => {
  await page.goto('/');
  await page.locator('#file').setInputFiles(HEIC_FIXTURE);
  await expect(page.locator('#crop')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('.cropper-crop-box')).toBeVisible();
  const size = await page.locator('#crop-img').evaluate((img: HTMLImageElement) => [img.naturalWidth, img.naturalHeight]);
  expect(size).toEqual([451, 300]);
});

test('a cat photo gets a creature with a credit link and a share image', async ({ page }) => {
  // Needs the built index (site/public/meta.json, index.bin) and network access to huggingface.co.
  await page.goto('/');
  await page.locator('#file').setInputFiles(FIXTURE);
  await expect(page.locator('#crop')).toBeVisible();
  await expect(page.locator('.cropper-crop-box')).toBeVisible();
  await page.getByRole('button', { name: "Find my cat's creature" }).click();

  await expect(page.locator('#result')).toBeVisible({ timeout: 200_000 });
  await expect(page.locator('#twin-title')).not.toBeEmpty();
  const link = page.locator('#twin-link');
  await expect(link).toHaveAttribute('href', /^https:\/\//);
  await expect(page.locator('#twin-license')).toHaveText(/^(Public domain|CC0|CC BY(-NC)?(-SA)? \d\.\d)$/);
  const twin = page.locator('#twin-img');
  await expect.poll(() => twin.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth)).toBeGreaterThan(0);

  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download image' }).click();
  expect((await download).suggestedFilename()).toBe('what-creature-is-my-cat.png');
  const card = await page.locator('#share-card').evaluate((c: HTMLCanvasElement) => [c.width, c.height]);
  expect(card).toEqual([1200, 760]);

  await page.getByRole('button', { name: /See the next match/ }).click();
  await expect(page.locator('#twin-rank')).toHaveText(/^Match #2/);
});
