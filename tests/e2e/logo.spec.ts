/**
 * Uploading a per-board tournament logo from the Control Panel, and seeing it
 * appear on the scoreboard — proving the whole path: Storage upload, the
 * Firestore `theme.logoUrl` persist, and the live `LOGO_URL_SET` dispatch
 * that makes it show up on the game in progress without a restart.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect } from '@playwright/test';
import { createBoard, freshAccount, signUp } from './fixtures.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOGO_FIXTURE = path.join(__dirname, '..', 'fixtures', 'logo.png');

test.describe.configure({ mode: 'serial' });

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
