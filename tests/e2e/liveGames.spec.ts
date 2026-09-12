/**
 * The admin-only live games overview: every board with a game in progress,
 * on one screen, with no need to open any one board's control panel.
 *
 * Purely a read of state the control panel already writes — this exercises
 * that a score change surfaces here without any action of its own, and that
 * a board drops back out the moment it returns to idle.
 */
import { test, expect } from '@playwright/test';
import { createBoard, freshAccount, signUp } from './fixtures.js';

test.describe.configure({ mode: 'serial' });

test('lists a board only while its game is in progress', async ({ page }) => {
  await signUp(page, freshAccount('live-games'));
  await createBoard(page, 'Live Court');

  await page.getByRole('link', { name: 'Live' }).click();
  await expect(page.getByRole('heading', { name: 'Live games' })).toBeVisible();
  await expect(page.getByText('No games in progress')).toBeVisible();

  // Score a point from the control panel, then come back here without
  // touching this board again — the row has to reflect it on its own.
  await page.getByRole('link', { name: 'Dashboard' }).click();
  await page.getByRole('link', { name: 'Control panel' }).click();
  await page.getByRole('button', { name: '+1' }).first().click();
  await expect(page.locator('.team-panel__score').first()).toHaveText('01');

  await page.getByRole('link', { name: 'Live' }).click();
  await expect(page.getByText('No games in progress')).toBeHidden();
  const row = page.locator('tr', { hasText: 'Live Court' });
  await expect(row).toContainText('HOME');
  await expect(row).toContainText('AWAY');
  await expect(row).toContainText('Q1');

  // Discarding the game resets the board to idle, and the row should follow.
  await row.getByRole('link', { name: 'Open' }).click();
  await expect(page.getByRole('heading', { name: 'Live Court' })).toBeVisible();
  page.once('dialog', (dialog) => void dialog.accept());
  await page.getByRole('button', { name: 'New game (discard, no history)' }).click();
  await expect(page.locator('.team-panel__score').first()).toHaveText('00');

  await page.getByRole('link', { name: 'Live' }).click();
  await expect(page.getByText('No games in progress')).toBeVisible();
});
