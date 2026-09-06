/**
 * End-to-end flows against the real build, running behind the Firebase Hosting
 * emulator with Auth/Database/Firestore/Functions alongside it.
 *
 * This is the suite that actually exercises the promise this platform is built
 * on: an operator's action in the control panel reaches the scoreboard, the
 * mirror, and the overlay — three separate pages, two of them requiring no
 * login at all — through the live Realtime Database path, not a mock.
 */
import { test, expect } from '@playwright/test';
import {
  copyFieldValue,
  createBoard,
  freshAccount,
  signUp,
  waitForCopyFieldChange,
} from './fixtures.js';

test.describe.configure({ mode: 'serial' });

test('signup creates an organisation and lands on an empty dashboard', async ({ page }) => {
  const account = freshAccount('signup');
  await signUp(page, account);

  await expect(page.getByRole('heading', { name: 'No boards yet' })).toBeVisible();
  // The organisation name also appears in the freshly-created audit log entry
  // for "TENANT_PROVISIONED", so this is scoped to the topbar specifically
  // rather than matched ambiguously against the whole page.
  await expect(page.getByRole('banner').getByText(account.organisationName)).toBeVisible();
});

test('creating a board surfaces its control panel and scoreboard links', async ({ page }) => {
  await signUp(page, freshAccount('create'));
  await createBoard(page, 'Court 1');

  // "Court 1" also appears in the audit log's BOARD_CREATED entry, so this is
  // scoped to the board card specifically.
  await expect(page.locator('.board-card').getByText('Court 1', { exact: true })).toBeVisible();
  // The live miniature on the dashboard card renders from the same RTDB node
  // the gym-wall scoreboard reads — a fresh board should show HOME/AWAY at 0.
  await expect(page.getByText('HOME')).toBeVisible();
  await expect(page.getByText('AWAY')).toBeVisible();
});

test('a control-panel score change is reflected on the scoreboard, mirror, and overlay', async ({
  page,
  context,
}) => {
  await signUp(page, freshAccount('propagate'));
  await createBoard(page, 'Main Gym');

  await page.getByRole('link', { name: 'Control panel' }).click();
  await expect(page.getByRole('heading', { name: 'Main Gym' })).toBeVisible();

  // +2 for the home team, three times over, so the assertion below can't pass
  // by coincidence with whatever a fresh board happens to default to.
  const plusTwo = page.getByRole('button', { name: '+2' }).first();
  await plusTwo.click();
  await plusTwo.click();
  await plusTwo.click();
  await expect(page.locator('.team-panel__score').first()).toHaveText('06');

  const boardUrl = page.url();
  const boardId = boardUrl.split('/').pop();
  expect(boardId).toBeTruthy();

  // The keyboard-driven scoreboard requires the same signed-in session — opened
  // as a second tab in the SAME browser context so it carries that session,
  // exactly like an operator opening the board on a second monitor.
  const scoreboardPage = await context.newPage();
  await scoreboardPage.goto(`/board/${boardId}`);
  await expect(scoreboardPage.locator('#home-score')).toHaveText('06', { timeout: 10_000 });

  // Mirror and overlay are the whole point of a separate viewer-key: they must
  // work with NO session at all. A brand-new incognito context (no cookies, no
  // auth state) proves that, rather than merely asserting the link exists.
  await page.goto(boardUrl.replace(/\/control\/.*/, '') + `/app/boards/${boardId}`);
  const mirrorUrl = await copyFieldValue(page, `settings-mirror`);
  const overlayUrl = await copyFieldValue(page, `settings-overlay`);

  const anonBrowser = await context.browser()!.newContext();
  try {
    const mirrorPage = await anonBrowser.newPage();
    await mirrorPage.goto(mirrorUrl);
    await expect(mirrorPage.locator('#home-score')).toHaveText('06', { timeout: 10_000 });
    // The mirror is read-only: it must not carry the keyboard handlers that
    // would let a stray keypress on the venue PC change the game.
    await mirrorPage.keyboard.press('ArrowUp');
    await mirrorPage.waitForTimeout(300);
    await expect(mirrorPage.locator('#home-score')).toHaveText('06');

    const overlayPage = await anonBrowser.newPage();
    await overlayPage.goto(overlayUrl);
    await expect(overlayPage.locator('#stream-home-score')).toHaveText('6', { timeout: 10_000 });
  } finally {
    await anonBrowser.close();
  }
});

test('the control panel hands out single-clock screens that run off the live board', async ({
  page,
  context,
}) => {
  await signUp(page, freshAccount('clock-screens'));
  await createBoard(page, 'Clock Court');

  await page.getByRole('link', { name: 'Control panel' }).click();
  await expect(page.getByRole('heading', { name: 'Clock Court' })).toBeVisible();

  // Move both clocks off the values the two pages ship as static markup (12:00
  // and 24). A fresh board sits on exactly those, so asserting against a
  // default would pass on a page that never reached the database at all.
  await page.getByRole('button', { name: /^Reset to 14s/ }).click();
  await page.getByRole('button', { name: 'Set time' }).click();
  const setTimeDialog = page.getByRole('dialog', { name: 'Set game time' });
  await setTimeDialog.getByLabel('Minutes').fill('7');
  await setTimeDialog.getByLabel('Seconds').fill('30');
  await setTimeDialog.getByRole('button', { name: 'Set time' }).click();
  await expect(page.locator('.clock-console__game')).toHaveText('07:30');

  const gameClockUrl = await copyFieldValue(page, `gameclock-${page.url().split('/').pop()}`);
  const shotClockUrl = await copyFieldValue(page, `shotclock-${page.url().split('/').pop()}`);

  // These carry the board's mirror key, so — like the mirror — they must open
  // with no session whatsoever. A brand-new context proves that rather than
  // merely asserting the control panel printed a URL.
  const anonBrowser = await context.browser()!.newContext();
  try {
    const gameClockPage = await anonBrowser.newPage();
    await gameClockPage.goto(gameClockUrl);
    await expect(gameClockPage.locator('#clock-value')).toHaveText('07:30', { timeout: 10_000 });

    const shotClockPage = await anonBrowser.newPage();
    await shotClockPage.goto(shotClockUrl);
    await expect(shotClockPage.locator('#clock-value')).toHaveText('14', { timeout: 10_000 });

    // Each screen shows its own clock and nothing else — a shot-clock panel
    // that also rendered the game time would be the wrong page entirely.
    await expect(gameClockPage.locator('#clock-value')).toHaveCount(1);
    await expect(gameClockPage.getByText('SHOT CLOCK')).toHaveCount(0);
    await expect(shotClockPage.getByText('GAME TIME')).toHaveCount(0);

    // Read-only, like the mirror: a stray keypress on the venue PC must not
    // reach the game.
    await shotClockPage.keyboard.press('Space');
    await shotClockPage.waitForTimeout(300);
    await expect(shotClockPage.locator('#clock-value')).toHaveText('14');
  } finally {
    await anonBrowser.close();
  }
});

test('a rotated viewer key immediately invalidates the old mirror link', async ({
  page,
  context,
}) => {
  await signUp(page, freshAccount('rotate'));
  await createBoard(page, 'Rotation Court');

  await page.getByRole('link', { name: 'Settings' }).click();
  await expect(page.getByRole('heading', { name: 'Share links' })).toBeVisible();

  const oldMirrorUrl = await copyFieldValue(page, 'settings-mirror');

  page.once('dialog', (dialog) => void dialog.accept());
  await page.getByRole('button', { name: 'Rotate mirror link' }).click();
  await expect(page.getByText(/mirror link has been rotated/i)).toBeVisible();

  const newMirrorUrl = await waitForCopyFieldChange(page, 'settings-mirror', oldMirrorUrl);
  expect(newMirrorUrl).not.toBe(oldMirrorUrl);

  const anonBrowser = await context.browser()!.newContext();
  try {
    const oldLinkPage = await anonBrowser.newPage();
    await oldLinkPage.goto(oldMirrorUrl);
    await expect(oldLinkPage.getByText(/no longer valid/i)).toBeVisible({ timeout: 10_000 });

    const newLinkPage = await anonBrowser.newPage();
    await newLinkPage.goto(newMirrorUrl);
    await expect(newLinkPage.locator('#home-score')).toHaveText('00', { timeout: 10_000 });
  } finally {
    await anonBrowser.close();
  }
});

test('two tenants cannot see each others boards', async ({ page, context }) => {
  const accountA = freshAccount('tenant-a');
  await signUp(page, accountA);
  await createBoard(page, 'Tenant A Court');
  await page.getByRole('link', { name: 'Control panel' }).click();
  const boardIdA = page.url().split('/').pop();

  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/login/);

  const accountB = freshAccount('tenant-b');
  await signUp(page, accountB);

  // Tenant B, signed in with a real session, must not be able to reach tenant
  // A's control panel by URL guessing — this is the isolation guarantee from
  // the security rules, observed end-to-end through the real UI.
  await page.goto(`/control/${boardIdA}`);
  await expect(page.getByText(/no longer exists|do not have access/i)).toBeVisible({
    timeout: 10_000,
  });

  void context;
});
