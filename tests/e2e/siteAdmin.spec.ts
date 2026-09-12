/**
 * The hidden, email-gated cross-tenant overview at /siteadmin.
 *
 * Not reachable from any link in the app — these go straight to the URL, the
 * same way the one real operator account would. The gate is entirely
 * server-side (an email allowlist independent of any tenant role), so the
 * meaningful check here is behavioural: the allow-listed email sees every
 * organisation's data, and every other signed-in account is turned away.
 */
import { test, expect } from '@playwright/test';
import { freshAccount, signUp, type TestAccount } from './fixtures.js';

test.describe.configure({ mode: 'serial' });

test('the allow-listed email sees every organisation and its activity', async ({ page }) => {
  const orgName = `Site Admin Org ${Date.now()}`;
  const account: TestAccount = {
    email: 'sasankarw@gmail.com',
    password: 'CourtSide-Pw-2026!',
    displayName: 'Site Admin',
    organisationName: orgName,
  };
  await signUp(page, account);

  await page.goto('/siteadmin');
  await expect(page.getByRole('heading', { name: 'Site admin' })).toBeVisible();
  await expect(page.getByText('Not authorised')).toBeHidden();

  await expect(page.locator('tr', { hasText: orgName }).first()).toBeVisible();

  const activityRow = page
    .locator('tr', { hasText: 'TENANT_PROVISIONED' })
    .filter({ hasText: orgName });
  await expect(activityRow.first()).toBeVisible();
});

test('every other account is turned away', async ({ page }) => {
  await signUp(page, freshAccount('siteadmin-guard'));

  await page.goto('/siteadmin');
  await expect(page.getByRole('heading', { name: 'Site admin' })).toBeVisible();
  await expect(page.getByText('Not authorised')).toBeVisible();
});
