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

  const gameRow = page.locator('tr', { hasText: 'Site Admin Court' });
  await expect(gameRow).toContainText('HOME');
  await expect(gameRow).toContainText('AWAY');
  await expect(gameRow).toContainText('Q1');
});

test('every other account is turned away', async ({ page }) => {
  await signUp(page, freshAccount('siteadmin-guard'));

  await page.goto('/siteadmin');
  await expect(page.getByRole('heading', { name: 'Site admin' })).toBeVisible();
  await expect(page.getByText('Not authorised')).toBeVisible();
});
