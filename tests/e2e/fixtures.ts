/**
 * Shared helpers for the end-to-end suite.
 *
 * Every test signs up a brand-new account rather than reusing a shared fixture
 * user — the emulators are wiped between CI runs, accounts are free, and a
 * fresh signup exercises the exact path a real customer takes (which is the
 * point of an E2E suite; a seeded-in-advance account would skip the part most
 * worth testing).
 */
import { expect, type Page } from '@playwright/test';

export function uniqueEmail(label: string): string {
  return `${label}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}@example.test`;
}

export interface TestAccount {
  email: string;
  password: string;
  displayName: string;
  organisationName: string;
}

export function freshAccount(label: string): TestAccount {
  return {
    email: uniqueEmail(label),
    password: 'CourtSide-Pw-2026!',
    displayName: `${label} Operator`,
    organisationName: `${label} Basketball Club ${Date.now()}`,
  };
}

/**
 * Opts this browser context out of the guided tour.
 *
 * The tour auto-starts for anyone who has not seen it, which every test account
 * is by definition — it would put a scrim over the page a second after each
 * signup and swallow the next click. Suppressing it here mirrors what a
 * returning user's browser already holds, rather than adding a test-only escape
 * hatch to the tour itself.
 *
 * Registered on the *context* rather than the page, so the second tabs several
 * tests open — the concurrent-writer and rotated-key cases — are covered too,
 * including ones created after this call. It runs before the app's own code on
 * every navigation, so the flag is in place before the provider reads it.
 */
async function suppressTour(page: Page): Promise<void> {
  await page.context().addInitScript(() => {
    // The provider keys progress by uid, which the page does not know until
    // sign-in completes. Rather than guess it, shim the read: anything asking
    // for a tour key is told the tour has been dismissed.
    const real = Storage.prototype.getItem;
    Storage.prototype.getItem = function getItem(key: string) {
      if (key.startsWith('scoreboard.tour.')) return JSON.stringify({ dismissed: true, seen: [] });
      return real.call(this, key);
    };
  });
}

/** Signs up through the real UI and waits for the dashboard to render. */
export async function signUp(page: Page, account: TestAccount): Promise<void> {
  await suppressTour(page);
  await page.goto('/login');
  await page.getByRole('button', { name: 'Create an organisation' }).click();

  await page.getByLabel('Your name').fill(account.displayName);
  await page.getByLabel('Organisation name').fill(account.organisationName);
  await page.getByLabel('Email').fill(account.email);
  await page.getByLabel('Password').fill(account.password);
  await page.getByRole('button', { name: 'Create organisation' }).click();

  // Substring matching would also match the "No boards yet" empty-state
  // heading, so this needs an exact match against the page title itself.
  await expect(page.getByRole('heading', { name: 'Boards', exact: true })).toBeVisible({
    timeout: 15_000,
  });
}

/**
 * Creates a board from the dashboard and returns to the dashboard afterward.
 *
 * Only one of "Create your first board" (empty state) or "New board" (header)
 * is ever rendered at a time — never both — so matching either by name finds
 * exactly one button regardless of which dashboard state this is called from.
 */
export async function createBoard(page: Page, name: string): Promise<void> {
  const createButton = page.getByRole('button', { name: /create your first board|new board/i });
  await createButton.click();

  await page.getByLabel('Board name').fill(name);
  await page.getByRole('button', { name: 'Create board' }).click();

  await expect(page.getByText(`${name} is ready.`)).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByText(name, { exact: true }).first()).toBeVisible();
}

/** Reads the value out of one of the app's <CopyField> inputs. */
export async function copyFieldValue(page: Page, label: string): Promise<string> {
  const input = page.locator(`#copy-${label}`);
  await expect(input).toBeVisible();
  return input.inputValue();
}

/**
 * Waits for a <CopyField> to hold a value other than `previous`.
 *
 * The value arrives through a Firestore listener, asynchronously with respect
 * to whatever UI feedback (a toast, a button label) triggered the read — using
 * that feedback as a signal to read the field immediately is a race. Polling
 * the actual value is what genuinely closes it.
 */
export async function waitForCopyFieldChange(
  page: Page,
  label: string,
  previous: string,
): Promise<string> {
  const input = page.locator(`#copy-${label}`);
  await expect(input).not.toHaveValue(previous, { timeout: 10_000 });
  return input.inputValue();
}
