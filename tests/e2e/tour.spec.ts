/**
 * The guided tour.
 *
 * Worth testing at this level specifically because the tour's whole job is
 * timing and placement: it has to appear unprompted for someone who has never
 * seen it, point at elements that only exist once live data has loaded, stay
 * away from everyone else, and come back on demand. None of that is visible to
 * a unit test.
 *
 * These tests deliberately do *not* use the `signUp` fixture's tour
 * suppression — they sign up by hand so the tour behaves as it does for a real
 * first-time user.
 */
import { test, expect, type Page } from '@playwright/test';
import { createBoard, freshAccount, type TestAccount } from './fixtures.js';

test.describe.configure({ mode: 'serial' });

/** `signUp` without the tour opt-out, so the tour runs as a new user sees it. */
async function signUpWithTour(page: Page, account: TestAccount): Promise<void> {
  await page.goto('/login');
  await page.getByRole('button', { name: 'Create an organisation' }).click();
  await page.getByLabel('Your name').fill(account.displayName);
  await page.getByLabel('Organisation name').fill(account.organisationName);
  await page.getByLabel('Email').fill(account.email);
  await page.getByLabel('Password').fill(account.password);
  await page.getByRole('button', { name: 'Create organisation' }).click();
  await expect(page.getByRole('heading', { name: 'Boards', exact: true })).toBeVisible({
    timeout: 15_000,
  });
}

const card = (page: Page) => page.locator('.tour__card');

/**
 * Asserts the tour does not appear.
 *
 * Auto-start is deliberately delayed so that live data has landed before
 * anchors are resolved, which means a bare `toBeHidden()` passes simply by
 * running first — it would hold just as well against a tour that was about to
 * pop up. Outlasting that window is what gives the assertion its meaning.
 */
async function expectNoTour(page: Page): Promise<void> {
  await page.waitForTimeout(1500);
  await expect(card(page)).toBeHidden();
}

test('the tour introduces itself to a brand-new account and can be stepped through', async ({
  page,
}) => {
  await signUpWithTour(page, freshAccount('tour-new'));

  // Unprompted, shortly after the dashboard settles.
  await expect(card(page)).toBeVisible({ timeout: 10_000 });
  await expect(card(page)).toContainText('Welcome to your scoreboard console');
  await expect(page.locator('.tour__count')).toContainText('1 of');

  // The opening step has no anchor, so there is nothing lit yet; stepping
  // forward both advances the counter and lights something up.
  await expect(page.locator('.tour__spotlight')).toHaveCount(0);
  await page.getByRole('button', { name: 'Next' }).click();
  await expect(page.locator('.tour__count')).toContainText('2 of');
  await expect(page.locator('.tour__spotlight')).toBeVisible();

  await page.getByRole('button', { name: 'Back' }).click();
  await expect(page.locator('.tour__count')).toContainText('1 of');

  // Skipping closes it.
  await page.getByRole('button', { name: 'Skip tour' }).click();
  await expect(card(page)).toBeHidden();
});

test('a skipped tour stays gone, on this page and the next', async ({ page }) => {
  await signUpWithTour(page, freshAccount('tour-skip'));

  await expect(card(page)).toBeVisible({ timeout: 10_000 });
  await page.getByRole('button', { name: 'Skip tour' }).click();
  await expect(card(page)).toBeHidden();

  // "Not now" has to mean "stop offering", not "stop offering on this screen" —
  // otherwise the same refusal reappears on every page in the app.
  await page.getByRole('link', { name: 'Schedule' }).click();
  await expect(page.getByRole('heading', { name: 'Schedule', exact: true })).toBeVisible();
  await expectNoTour(page);

  // And it survives a reload, which is the part that proves the refusal was
  // actually written down rather than just held in memory.
  await page.getByRole('banner').getByRole('link', { name: 'Dashboard' }).click();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Boards', exact: true })).toBeVisible({
    timeout: 15_000,
  });
  await expectNoTour(page);
});

test('Help reopens the tour after it has been dismissed', async ({ page }) => {
  await signUpWithTour(page, freshAccount('tour-help'));

  await expect(card(page)).toBeVisible({ timeout: 10_000 });
  await page.getByRole('button', { name: 'Skip tour' }).click();
  await expect(card(page)).toBeHidden();

  await page.getByRole('button', { name: 'Help' }).click();
  await expect(card(page)).toBeVisible();
  await expect(card(page)).toContainText('Welcome to your scoreboard console');

  // Escape is the other way out.
  await page.keyboard.press('Escape');
  await expect(card(page)).toBeHidden();
});

test('each page has its own tour, pointing at that page', async ({ page }) => {
  await signUpWithTour(page, freshAccount('tour-pages'));
  await expect(card(page)).toBeVisible({ timeout: 10_000 });
  await page.getByRole('button', { name: 'Skip tour' }).click();

  await page.getByRole('link', { name: 'History' }).click();
  await page.getByRole('button', { name: 'Help' }).click();
  await expect(card(page)).toContainText('Every finished game');

  // The dimmed page is not a trap: clicking away closes the tour and leaves the
  // console usable again.
  await page.locator('.tour__scrim').click({ position: { x: 5, y: 5 } });
  await expect(card(page)).toBeHidden();

  await page.getByRole('link', { name: 'Schedule' }).click();
  await page.getByRole('button', { name: 'Help' }).click();
  await expect(card(page)).toContainText('Planning matches');
});

/**
 * The tour steps with the arrow keys; the control panel scores with them. Both
 * listen on the document, so without the tour explicitly standing down, walking
 * through the explanation of the scoring buttons would score points.
 */
test('stepping through the control-panel tour does not score points', async ({ page }) => {
  await signUpWithTour(page, freshAccount('tour-keys'));
  await expect(card(page)).toBeVisible({ timeout: 10_000 });
  await page.getByRole('button', { name: 'Skip tour' }).click();

  await createBoard(page, 'Court 1');
  await page.getByRole('link', { name: 'Control panel' }).click();
  await expect(page.locator('.team-panel__score').first()).toHaveText('00');

  await page.getByRole('button', { name: 'Help' }).click();
  await expect(card(page)).toBeVisible();

  await page.keyboard.press('ArrowRight');
  await expect(page.locator('.tour__count')).toContainText('2 of');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowLeft');

  await expect(page.locator('.team-panel__score').first()).toHaveText('00');
  await expect(page.locator('.team-panel__score').last()).toHaveText('00');

  // And the shortcuts come back once the tour is out of the way.
  await page.keyboard.press('Escape');
  await expect(card(page)).toBeHidden();
  await page.keyboard.press('ArrowUp');
  await expect(page.locator('.team-panel__score').first()).toHaveText('01');
});
