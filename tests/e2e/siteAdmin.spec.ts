/**
 * The hidden, email-gated cross-tenant overview at /siteadmin.
 *
 * Not reachable from any link in the app — these go straight to the URL, the
 * same way the one real operator account would. The gate is entirely
 * server-side (an email allowlist independent of any tenant role), so the
 * meaningful check here is behavioural: the allow-listed email sees every
 * organisation and every board mid-game, and every other signed-in account
 * is turned away.
 */
import { test, expect } from '@playwright/test';
import { createBoard, freshAccount, signUp, type TestAccount } from './fixtures.js';

test.describe.configure({ mode: 'serial' });

test('the allow-listed email sees every organisation and every running game', async ({ page }) => {
  // The overview scans every tenant and every board; this file runs late in
  // the full suite, behind everything every other spec file left in the same
  // emulator instance, so the default 30s budget is comfortable in isolation
  // but tight once dozens of boards have accumulated.
  test.setTimeout(60_000);

  const orgName = `Site Admin Org ${Date.now()}`;
  const account: TestAccount = {
    email: 'sasankarw@gmail.com',
    password: 'CourtSide-Pw-2026!',
    displayName: 'Site Admin',
    organisationName: orgName,
  };
  await signUp(page, account);
  await createBoard(page, 'Site Admin Court');

  // Score a point from the control panel, then check it surfaces on the
  // cross-tenant page without touching this board again.
  await page.getByRole('link', { name: 'Control panel' }).click();
  await page.getByRole('button', { name: '+1' }).first().click();
  await expect(page.locator('.team-panel__score').first()).toHaveText('01');

  await page.goto('/siteadmin');
  await expect(page.getByRole('heading', { name: 'Site admin' })).toBeVisible();
  await expect(page.getByText('Not authorised')).toBeHidden();

  await expect(page.locator('tr', { hasText: orgName }).first()).toBeVisible();

  const gameRow = page.locator('tr', { hasText: 'Site Admin Court' }).first();
  await expect(gameRow).toContainText('HOME');
  await expect(gameRow).toContainText('AWAY');
  await expect(gameRow).toContainText('Q1');

  // The board directory lists every board, active or not — this one shows up
  // there too, tagged Active rather than merely appearing in "Running games".
  const boardsSection = page.locator('section', {
    has: page.getByRole('heading', { name: /^Boards/ }),
  });
  const boardRow = boardsSection.locator('tr', { hasText: 'Site Admin Court' });
  await expect(boardRow.getByText('Active')).toBeVisible();

  // The organisation's own row reports the same thing as a fraction.
  const orgsSection = page.locator('section', {
    has: page.getByRole('heading', { name: /^Organisations/ }),
  });
  const orgRow = orgsSection.locator('tr', { hasText: orgName });
  await expect(orgRow).toContainText('1 / 1');

  // Finishing the match writes it to history — the site admin overview
  // should be able to read that record back for this board, and to delete
  // the board itself.
  await page.goto('/app');
  await page.getByRole('link', { name: 'Control panel' }).click();
  await page.getByRole('button', { name: 'Finish match' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Finish match' }).click();
  await expect(page.getByText(/saved to match history/i)).toBeVisible();

  // A fresh navigation already re-fetches the overview on mount — an extra
  // manual "Refresh" click here would just be a second, redundant fetch of
  // the same cross-tenant scan, which only makes this slower under load
  // (this file runs late in the full suite, behind every board every other
  // spec file left lying around in the same emulator instance).
  await page.goto('/siteadmin');
  const refreshedBoardRow = boardsSection.locator('tr', { hasText: 'Site Admin Court' });
  await expect(refreshedBoardRow).toBeVisible({ timeout: 20_000 });
  await refreshedBoardRow.getByRole('button', { name: 'History' }).click();

  const historyDialog = page.getByRole('dialog');
  await expect(historyDialog.getByText('1 – 0')).toBeVisible({ timeout: 20_000 });
  await page.keyboard.press('Escape');

  await refreshedBoardRow.getByRole('button', { name: 'Delete' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete board' }).click();
  await expect(boardsSection.locator('tr', { hasText: 'Site Admin Court' })).toHaveCount(0, {
    timeout: 20_000,
  });
});

test('every other account is turned away', async ({ page }) => {
  await signUp(page, freshAccount('siteadmin-guard'));

  await page.goto('/siteadmin');
  await expect(page.getByRole('heading', { name: 'Site admin' })).toBeVisible();
  await expect(page.getByText('Not authorised')).toBeVisible();
});
