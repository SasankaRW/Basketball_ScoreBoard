/**
 * Match scheduling, starting, and finishing — end to end against the real
 * build and the real emulators.
 *
 * The third test here is not a nice-to-have: it is the concrete regression
 * test for a real race condition found and fixed while building this feature
 * (see the comment on the `isBoardIdle` check inside `finishMatch`,
 * functions/src/matches.ts). Two "Finish match" clicks arriving close
 * together — genuinely simultaneous or merely sequential — must always
 * produce exactly one history record, never two and never zero.
 */
import { test, expect } from '@playwright/test';
import { createBoard, freshAccount, signUp } from './fixtures.js';

test.describe.configure({ mode: 'serial' });

test('scheduling, starting, playing, and finishing a match produces the right history record', async ({
  page,
}) => {
  await signUp(page, freshAccount('lifecycle'));
  await createBoard(page, 'Court 1');

  // Schedule a match.
  await page.getByRole('link', { name: 'Schedule' }).click();
  await expect(page.getByRole('heading', { name: 'Schedule', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Schedule a match' }).click();
  await page.getByLabel('Home team').fill('Hawks');
  await page.getByLabel('Away team').fill('Comets');
  await page.getByRole('button', { name: 'Schedule match' }).click();
  await expect(page.getByText('Hawks').first()).toBeVisible();

  // Start it onto the only board there is.
  await page.getByRole('button', { name: 'Start' }).click();
  await expect(page.getByRole('heading', { name: 'Start "Hawks vs Comets"' })).toBeVisible();
  await expect(page.getByText('Idle')).toBeVisible();
  await page.locator('input[type="radio"]').first().click();
  await page.getByRole('button', { name: 'Start match' }).click();

  // Lands on the control panel with the scheduled teams' names live.
  await expect(page).toHaveURL(/\/control\//);
  await expect(page.locator('.team-panel__name').first()).toHaveText('Hawks');

  // Play: home scores 3, away scores 1.
  const scoreButtons = page.locator('.score-buttons .btn');
  await scoreButtons.nth(2).click(); // home +3
  await scoreButtons.nth(3).click(); // away +1
  await expect(page.locator('.team-panel__score').first()).toHaveText('03');

  // Finish it.
  page.once('dialog', (dialog) => void dialog.accept());
  await page.getByRole('button', { name: 'Finish match' }).click();
  await expect(page.getByRole('heading', { name: 'Match finished' })).toBeVisible({
    timeout: 10_000,
  });
  await expect(page.getByText('Hawks 3 – 1 Comets')).toBeVisible();

  // History shows the finished game with the right box score.
  await page.getByRole('button', { name: 'View history' }).click();
  await expect(page).toHaveURL(/\/app\/history/);
  await expect(page.getByText('3–1')).toBeVisible({ timeout: 10_000 });
  await page.getByRole('button', { name: /Box score/ }).click();
  await expect(page.getByRole('columnheader', { name: 'Q1' })).toBeVisible();

  // The schedule entry that started it is now marked completed.
  await page.getByRole('link', { name: 'Schedule' }).click();
  await page.getByRole('button', { name: 'Show finished' }).click();
  await expect(page.getByText('Completed')).toBeVisible();
});

/**
 * The timeline's only honest test.
 *
 * Capture happens in the browser (core/liveState.ts), harvest happens in the
 * serverless function (server/matches.ts), and render happens on another page
 * entirely — three processes, none of which a unit test can hold together. The
 * events asserted here therefore have to survive being written to the Realtime
 * Database, moved into Firestore by `finishMatch`, and read back, in order.
 */
test('a played game produces a play-by-play in history', async ({ page }) => {
  await signUp(page, freshAccount('timeline'));
  await createBoard(page, 'Court 1');
  await page.getByRole('link', { name: 'Control panel' }).click();

  // Run the game clock before scoring. This is not incidental: a running clock
  // stores a deadline and leaves its `remainingMs` field frozen at the value it
  // started from, so an event recorded off that raw field claims to have
  // happened at the top of the period. Every event below is therefore captured
  // against a clock that has actually moved.
  const gameClock = page.locator('.clock-console__game');
  const fullPeriod = await gameClock.textContent();
  await page
    .locator('.clock-console .button-grid')
    .first()
    .getByRole('button', { name: 'Start' })
    .click();
  await expect(gameClock).not.toHaveText(fullPeriod!);

  // Play a first quarter: a basket each way, a foul, and a timeout.
  const scoreButtons = page.locator('.score-buttons .btn');
  await scoreButtons.nth(1).click(); // home +2
  await scoreButtons.nth(5).click(); // away +3
  await expect(page.locator('.team-panel__score').first()).toHaveText('02');
  await page.getByRole('button', { name: 'Increase home fouls' }).click();
  await page.getByRole('button', { name: 'Use away timeout' }).click();

  // Into the second, then one more basket, so the timeline has to group.
  page.once('dialog', (dialog) => void dialog.accept());
  await page.getByRole('button', { name: 'Start next period' }).click();
  await expect(page.locator('.clock-console__period')).toHaveText('Q2');
  await scoreButtons.nth(0).click(); // home +1
  await expect(page.locator('.team-panel__score').first()).toHaveText('03');

  page.once('dialog', (dialog) => void dialog.accept());
  await page.getByRole('button', { name: 'Finish match' }).click();
  await expect(page.getByRole('heading', { name: 'Match finished' })).toBeVisible({
    timeout: 10_000,
  });

  await page.goto('/app/history');
  await page.getByRole('button', { name: /Box score/ }).click();

  // Grouped under the period each event belongs to — the period change itself
  // heads Q2, because it is what started it.
  await expect(page.locator('.timeline__period-label')).toHaveText(['Q1', 'Q2']);

  await expect(page.locator('.timeline__what')).toHaveText([
    '+2',
    '+3',
    'Foul',
    'Timeout',
    'Start of Q2',
    '+1',
  ]);

  // Which team is carried by the column an entry lands in, so that is what has
  // to be asserted — a flat list of descriptions would pass even if every event
  // were attributed to the wrong side.
  await expect(page.locator('.timeline__row--home .timeline__what')).toHaveText([
    '+2',
    'Foul',
    '+1',
  ]);
  await expect(page.locator('.timeline__row--away .timeline__what')).toHaveText(['+3', 'Timeout']);

  // The clock each event was stamped with must be the clock as it actually
  // read, not the value it held when the period started.
  await expect(page.locator('.timeline__clock').first()).not.toHaveText(fullPeriod!);
  await expect(page.locator('.timeline__row--home .timeline__team').first()).toHaveText('HOME');
  await expect(page.locator('.timeline__row--away .timeline__team').first()).toHaveText('AWAY');

  // The running score is what makes it a story rather than a list; it must be
  // the score *after* each event, not the final one repeated.
  await expect(page.locator('.timeline__score')).toHaveText([
    '2–0',
    '2–3',
    '2–3',
    '2–3',
    '2–3',
    '3–3',
  ]);
});

test('starting a scheduled match is blocked if the board turns busy after the picker opens', async ({
  page,
  context,
}) => {
  await signUp(page, freshAccount('race-block'));
  await createBoard(page, 'Court 1');

  await page.getByRole('link', { name: 'Schedule' }).click();
  await page.getByRole('button', { name: 'Schedule a match' }).click();
  await page.getByLabel('Home team').fill('Eagles');
  await page.getByLabel('Away team').fill('Wolves');
  await page.getByRole('button', { name: 'Schedule match' }).click();
  await expect(page.getByText('Eagles').first()).toBeVisible();

  await page.getByRole('button', { name: 'Start' }).click();
  await expect(page.getByText('Idle')).toBeVisible();
  await page.locator('input[type="radio"]').first().click();

  // Without closing the picker, make the only board busy from a second tab in
  // the same session — the exact race the server-side check exists to catch,
  // since the picker's own "Idle" badge is now stale.
  const secondPage = await context.newPage();
  await secondPage.goto('/app');
  await secondPage.getByRole('link', { name: 'Control panel' }).click();
  await secondPage.locator('.score-buttons .btn').first().click();
  await expect(secondPage.locator('.team-panel__score').first()).toHaveText('01');
  await secondPage.close();

  await page.getByRole('button', { name: 'Start match' }).click();
  await expect(page.getByText(/already has a game in progress/i)).toBeVisible({ timeout: 10_000 });
});

test('two near-simultaneous Finish clicks on the same board produce exactly one history record', async ({
  page,
  context,
}) => {
  await signUp(page, freshAccount('double-finish'));
  await createBoard(page, 'Court 1');
  await page.getByRole('link', { name: 'Control panel' }).click();
  await page.locator('.score-buttons .btn').first().click(); // home +1
  await expect(page.locator('.team-panel__score').first()).toHaveText('01');

  const boardUrl = page.url();
  const secondPage = await context.newPage();
  await secondPage.goto(boardUrl);
  await expect(secondPage.locator('.team-panel__score').first()).toHaveText('01', {
    timeout: 10_000,
  });

  page.once('dialog', (dialog) => void dialog.accept());
  secondPage.once('dialog', (dialog) => void dialog.accept());

  await Promise.all([
    page.getByRole('button', { name: 'Finish match' }).click(),
    secondPage.getByRole('button', { name: 'Finish match' }).click(),
  ]);

  // At least one of the two tabs must have actually succeeded — give it time
  // to resolve, then require exactly one row in history, regardless of which
  // tab won or whether the two calls were truly concurrent or merely close.
  await page.goto('/app/history');
  const matchRows = page.locator('.stack > .card');
  await expect(matchRows).toHaveCount(1, { timeout: 10_000 });
});
