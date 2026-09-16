/**
 * Membership invariants: this system is single-tenant, single-role per
 * account (`acceptInvite` calls `auth.setCustomUserClaims` with exactly
 * `{ tenantId, role }`, which *replaces* whatever the account already held).
 *
 * `inviteMember` and `acceptInvite` (src/server/members.ts) both guard against
 * an invite silently overwriting an existing membership — the concrete case
 * that motivated it: inviting an owner's email again at a lower role would,
 * on acceptance, demote them with no warning. This exercises the guard that
 * actually reaches a real UI: `inviteMember` refusing to create the invite in
 * the first place. `acceptInvite`'s own check is a backstop for invites that
 * predate a membership some other way, which nothing in the UI can provoke.
 */
import { test, expect } from '@playwright/test';
import { freshAccount, signUp } from './fixtures.js';

test.describe.configure({ mode: 'serial' });

test('inviting someone who already owns another organisation is refused', async ({ page }) => {
  const existingOwner = freshAccount('member-guard-existing');
  await signUp(page, existingOwner);
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/login/);

  const inviter = freshAccount('member-guard-inviter');
  await signUp(page, inviter);

  await page.getByRole('button', { name: 'Invite member' }).click();
  await page.getByLabel('Email address').fill(existingOwner.email);
  await page.getByRole('button', { name: 'Create invite' }).click();

  await expect(page.getByText(/already belongs to an organisation/i)).toBeVisible();
  // Refused before anything was created — no invite link to show.
  await expect(page.getByText(/send this link to/i)).toBeHidden();
});

test('inviting a brand-new email still works', async ({ page }) => {
  const inviter = freshAccount('member-guard-happy');
  await signUp(page, inviter);

  await page.getByRole('button', { name: 'Invite member' }).click();
  await page.getByLabel('Email address').fill('brand.new.teammate@example.test');
  await page.getByRole('button', { name: 'Create invite' }).click();

  await expect(page.getByText(/send this link to/i)).toBeVisible();
});
