/**
 * Uploading a per-board tournament logo from the Control Panel, and seeing it
 * appear on the scoreboard — proving the whole path: the Cloudinary upload
 * (`api/uploadLogo`, `src/server/cloudinary.ts`), the Firestore
 * `theme.logoUrl` persist, and the live `LOGO_URL_SET` dispatch that makes it
 * show up on the game in progress without a restart.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect } from '@playwright/test';
import { createBoard, freshAccount, signUp } from './fixtures.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOGO_FIXTURE = path.join(__dirname, '..', 'fixtures', 'logo.png');

test.describe.configure({ mode: 'serial' });

// Skipped, not deleted, when this environment has no real Cloudinary account
// to upload to — there is no local emulator for a third-party SaaS the way
// there is for Firebase, so these need CLOUDINARY_CLOUD_NAME/API_KEY/
// API_SECRET actually set (see src/server/cloudinary.ts) to do anything.
// `vercel dev` (via scripts/with-vercel-dev.mjs) inherits this same process
// environment, so the two agree about whether the feature can work here.
test.skip(
  !process.env['CLOUDINARY_CLOUD_NAME'],
  'logo upload needs CLOUDINARY_* environment variables pointing at a real account',
);

test('an owner can upload a tournament logo and see it on the scoreboard', async ({ page }) => {
  await signUp(page, freshAccount('logo'));
  await createBoard(page, 'Court 1');
  await page.getByRole('link', { name: 'Control panel' }).click();
  await expect(page.getByRole('heading', { name: 'Court 1' })).toBeVisible();

  await expect(page.getByRole('heading', { name: 'Tournament logo' })).toBeVisible();
  await page.locator('input[type="file"]').setInputFiles(LOGO_FIXTURE);
  await page.getByRole('button', { name: 'Upload' }).click();
  await expect(page.locator('.logo-card__preview')).toBeVisible({ timeout: 10_000 });

  const boardId = page.url().split('/').pop();
  await page.goto(`/board/${boardId}`);
  const logo = page.locator('#board-logo');
  await expect(logo).toBeVisible({ timeout: 10_000 });
  await expect(logo).toHaveAttribute('src', /.+/);
});

test('removing a logo hides it again on the scoreboard', async ({ page }) => {
  await signUp(page, freshAccount('logo-remove'));
  await createBoard(page, 'Court 1');
  await page.getByRole('link', { name: 'Control panel' }).click();

  await page.locator('input[type="file"]').setInputFiles(LOGO_FIXTURE);
  await page.getByRole('button', { name: 'Upload' }).click();
  await expect(page.locator('.logo-card__preview')).toBeVisible({ timeout: 10_000 });

  page.once('dialog', (dialog) => void dialog.accept());
  await page.getByRole('button', { name: 'Remove' }).click();
  await expect(page.getByText('No logo set.')).toBeVisible({ timeout: 10_000 });

  const boardId = page.url().split('/').pop();
  await page.goto(`/board/${boardId}`);
  await expect(page.locator('#board-logo')).toBeHidden({ timeout: 10_000 });
});
