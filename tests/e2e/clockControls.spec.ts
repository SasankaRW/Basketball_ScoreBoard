/**
 * Two control-panel additions that sit outside the ordinary reducer flow:
 * the "Reset to 2:00 & start" shortcut, and the one-minute timeout popup.
 *
 * Both are exercised through the real UI rather than at the reducer level.
 * The timeout popup's countdown lives in `state.timeoutClock` (RTDB), same
 * plane as the game/shot clocks, which is what lets the same "spend a
 * timeout" click also drive the full-screen takeover on the scoreboard and
 * mirror — a reducer test alone cannot see that propagation.
 */
import { test, expect } from '@playwright/test';
import { createBoard, freshAccount, signUp } from './fixtures.js';

test.describe.configure({ mode: 'serial' });

test('resetting to 2:00 asks first, then sets and starts the game clock in one step', async ({
  page,
}) => {
  await signUp(page, freshAccount('reset2min'));
  await createBoard(page, 'Court 1');
  await page.getByRole('link', { name: 'Control panel' }).click();

  const gameClock = page.locator('.clock-console__game');
  await expect(gameClock).toHaveText('10:00');

  // Cancelling leaves the clock untouched and stopped.
  await page.getByRole('button', { name: 'Reset to 2:00 & start' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();
  await expect(gameClock).toHaveText('10:00');
  await expect(gameClock).not.toHaveClass(/clock-console__game--live/);

  // Confirming sets it to 2:00 and starts it counting down in the same action.
  await page.getByRole('button', { name: 'Reset to 2:00 & start' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Reset & start' }).click();
  await expect(gameClock).toHaveClass(/clock-console__game--live/);
  await expect(gameClock).toHaveText(/^(01:59|02:00)$/);

  // And it is actually running down, not just showing 2:00 and paused.
  await page.waitForTimeout(1200);
  await expect(gameClock).toHaveText(/01:5[0-9]/);
});

test('works from a clock that was already running, ending up at 2:00 and still running', async ({
  page,
}) => {
  await signUp(page, freshAccount('reset2minlive'));
  await createBoard(page, 'Court 1');
  await page.getByRole('link', { name: 'Control panel' }).click();

  // "Start" alone is ambiguous — the shot clock has its own identically-named
  // button — but only the game clock's toggle is ever `.btn--primary`.
  await page.locator('button.btn--primary', { hasText: 'Start' }).click();
  const gameClock = page.locator('.clock-console__game');
  await expect(gameClock).toHaveClass(/clock-console__game--live/);

  await page.getByRole('button', { name: 'Reset to 2:00 & start' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Reset & start' }).click();

  // GAME_CLOCK_START is a no-op on an already-running clock, so this must not
  // have stopped it — the whole point is "ends up running", regardless of
  // what it was doing beforehand.
  await expect(gameClock).toHaveClass(/clock-console__game--live/);
  await expect(gameClock).toHaveText(/^(01:59|02:00)$/);
});

test('taking a timeout pops up a one-minute countdown that never touches the game clock, and takes over the scoreboard', async ({
  page,
  context,
}) => {
  await signUp(page, freshAccount('timeoutpopup'));
  await createBoard(page, 'Court 1');
  await page.getByRole('link', { name: 'Control panel' }).click();

  const gameClock = page.locator('.clock-console__game');
  await expect(gameClock).toHaveText('10:00');

  const popup = page.getByRole('status', { name: 'Timeout timer' });
  await expect(popup).toBeHidden();

  const boardId = page.url().split('/').pop();
  const scoreboardPage = await context.newPage();
  await scoreboardPage.goto(`/board/${boardId}`);
  const overlay = scoreboardPage.locator('#timeout-overlay');
  await expect(overlay).toBeHidden();

  await page.getByRole('button', { name: 'Use home timeout' }).click();
  await expect(popup).toBeVisible();
  await expect(popup).toContainText('1:00');

  // The game clock was never touched by taking the timeout.
  await expect(gameClock).toHaveText('10:00');
  await expect(gameClock).not.toHaveClass(/clock-console__game--live/);

  // The same countdown reaches the full-screen scoreboard takeover, with
  // both teams' names and scores duplicated onto it.
  await expect(overlay).toBeVisible({ timeout: 10_000 });
  await expect(scoreboardPage.locator('#timeout-clock')).toHaveText('01:00');
  await expect(scoreboardPage.locator('#timeout-home-name')).toHaveText('HOME');
  await expect(scoreboardPage.locator('#timeout-away-name')).toHaveText('AWAY');
  await expect(scoreboardPage.locator('#timeout-home-score')).toHaveText('00');
  await expect(scoreboardPage.locator('#timeout-away-score')).toHaveText('00');

  // It really counts down, on its own second, unrelated to any game/shot clock.
  await page.waitForTimeout(2200);
  await expect(popup).toContainText(/0:5[0-8]/);
  await expect(scoreboardPage.locator('#timeout-clock')).toHaveText(/00:5[0-8]/);

  // Manual dismiss closes it early, everywhere.
  await page.getByRole('button', { name: 'Dismiss timeout timer' }).click();
  await expect(popup).toBeHidden();
  await expect(overlay).toBeHidden({ timeout: 10_000 });
});

test('a second timeout restarts the popup at a full minute rather than stacking', async ({
  page,
}) => {
  await signUp(page, freshAccount('timeoutrestart'));
  await createBoard(page, 'Court 1');
  await page.getByRole('link', { name: 'Control panel' }).click();

  const popup = page.getByRole('status', { name: 'Timeout timer' });

  await page.getByRole('button', { name: 'Use home timeout' }).click();
  await expect(popup).toContainText('1:00');
  await page.waitForTimeout(2200);
  await expect(popup).toContainText(/0:5[0-8]/);

  await page.getByRole('button', { name: 'Use away timeout' }).click();
  await expect(popup).toContainText('1:00');
});
