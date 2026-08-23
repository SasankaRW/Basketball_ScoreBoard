/**
 * Board settings reaching the live board.
 *
 * The regression test for a bug that shipped: settings were written to the
 * board's Firestore document, but live state carries its *own* snapshot of the
 * config and nothing refreshed it — so editing the shot clock changed a stored
 * number and nothing a player or operator could ever see. Asserting through the
 * real UI is the only level that catches it; every layer below was individually
 * correct.
 */
import { test, expect } from '@playwright/test';
import { createBoard, freshAccount, signUp } from './fixtures.js';

test.describe.configure({ mode: 'serial' });

test('a saved shot-clock length reaches the control panel', async ({ page }) => {
  await signUp(page, freshAccount('settings'));
  await createBoard(page, 'Court 1');

  // The board ships with the 24s default; the reset button is labelled with it.
  await page.getByRole('link', { name: 'Control panel' }).click();
  await expect(page.getByRole('button', { name: '24s', exact: true })).toBeVisible();

  await page.getByRole('banner').getByRole('link', { name: 'Dashboard' }).click();
  await page.getByRole('link', { name: 'Settings' }).click();
  await page.getByLabel('Shot clock (sec)').fill('20');
  await page.getByRole('button', { name: 'Save settings' }).click();
  await expect(page.getByText(/Saved\./)).toBeVisible({ timeout: 10_000 });

  // Back on the control panel the new length is live: the reset button offers
  // 20s, and pressing it actually puts 20 on the clock.
  await page.getByRole('link', { name: 'Control panel' }).click();
  await expect(page.getByRole('button', { name: '20s', exact: true })).toBeVisible({
    timeout: 10_000,
  });
  await page.getByRole('button', { name: '20s', exact: true }).click();
  await expect(page.locator('.clock-console__shot')).toHaveText('20', { timeout: 10_000 });
});

test('the tenths-of-a-second display setting takes effect without a new game', async ({ page }) => {
  await signUp(page, freshAccount('tenths'));
  await createBoard(page, 'Court 1');

  await page.getByRole('link', { name: 'Settings' }).click();
  await page.getByLabel('Show tenths of a second under one minute').check();
  await page.getByRole('button', { name: 'Save settings' }).click();
  await expect(page.getByText(/Saved\./)).toBeVisible({ timeout: 10_000 });

  // Put the game clock under a minute, where tenths are rendered at all.
  await page.getByRole('link', { name: 'Control panel' }).click();
  await page.getByRole('button', { name: 'Set time' }).click();
  await page.getByLabel('Minutes').fill('0');
  await page.getByLabel('Seconds').fill('30');
  await page.getByRole('dialog').getByRole('button', { name: 'Set time' }).click();

  // 30.0 rather than 00:30 — a display-only preference must not need a new game.
  await expect(page.locator('.clock-console__game')).toHaveText(/^\d{1,2}\.\d$/, {
    timeout: 10_000,
  });
});
