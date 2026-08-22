/**
 * Visual regression for the scoreboard, mirror, and overlay.
 *
 * This is what makes "the scoreboard's appearance does not change" a fact
 * Playwright checks rather than a promise in a commit message. The baseline
 * images under visual.spec.ts-snapshots/ were captured from this rebuilt
 * version rather than from the pre-refactor static HTML — there was no
 * automated screenshot tooling in place before this project started — but from
 * this point forward, any pixel drift on these three pages fails CI. Update the
 * baseline deliberately with `npm run baseline` when a visual change is
 * intentional; never as a way to make a failing run pass.
 *
 * Both clocks are left paused at hand-set values instead of running, so a
 * screenshot never has to race a countdown. `toHaveScreenshot` disables CSS
 * animations by default, which is what keeps the possession arrow's pulse and
 * the foul-bonus flash from producing a different frame on every run.
 */
import { test, expect, type Page } from '@playwright/test';
import { createBoard, freshAccount, signUp } from './fixtures.js';

test.describe.configure({ mode: 'serial' });

/**
 * Waits for every `@font-face` the stylesheet references (Orbitron above all)
 * to finish loading.
 *
 * Both scoreboard fonts load asynchronously via a Google Fonts `@import`. A
 * screenshot taken before they arrive captures the browser's fallback font
 * instead — different glyph widths, which reflows the whole layout and even
 * shifts which elements fit inside the page's `overflow: hidden` bounds. The
 * CSS Font Loading API's `document.fonts.ready` is the actual signal for "the
 * page is done reflowing for fonts," which no fixed delay can substitute for.
 */
async function waitForFonts(page: Page): Promise<void> {
  await page.evaluate(() => document.fonts.ready);
}

async function buildDeterministicBoard(page: import('@playwright/test').Page): Promise<string> {
  await signUp(page, freshAccount('visual'));
  await createBoard(page, 'Visual Baseline Court');

  await page.getByRole('link', { name: 'Control panel' }).click();
  const boardId = page.url().split('/').pop();
  if (!boardId) throw new Error('Could not read board id from the control panel URL');

  // Team names, via the real modal rather than a native prompt. Exact matching
  // is required here: substring matching would also catch the foul/timeout
  // buttons' own aria-labels ("Increase home fouls" etc., which contain "Home").
  await page.locator('.team-panel__name').first().click();
  await page.getByLabel('Home', { exact: true }).fill('River City Hawks');
  await page.getByLabel('Away', { exact: true }).fill('Bay Area Comets');
  await page.getByRole('button', { name: 'Save names' }).click();

  // Home 5, away 2 — deliberately asymmetric, so a regression that swapped the
  // two sides would show up immediately rather than hiding behind a tie.
  const scoreButtons = page.locator('.score-buttons .btn');
  await scoreButtons.nth(1).click(); // home +2
  await scoreButtons.nth(2).click(); // home +3
  await scoreButtons.nth(4).click(); // away +2

  // Fouls: kept under the bonus threshold (5) so the bonus-flash styling and
  // its keyframe animation never engage — nothing here needs a moving pixel.
  for (let i = 0; i < 3; i += 1) {
    await page.getByRole('button', { name: 'Increase home fouls' }).click();
  }
  await page.getByRole('button', { name: 'Increase away fouls' }).click();

  // One timeout spent on the home side, so the two teams' displays visibly differ.
  await page.getByRole('button', { name: 'Use home timeout' }).click();

  // Period 2, so the display reads something other than the Q1 default.
  await page.getByRole('button', { name: 'Increase period' }).click();

  // Possession to the away side.
  await page.getByRole('button', { name: 'Away ▶' }).click();

  // A fixed game clock, left paused. The trigger button and the modal's own
  // submit button share the name "Set time" and both stay in the DOM while the
  // modal is open, so the submit click is scoped to the dialog.
  await page.getByRole('button', { name: 'Set time' }).click();
  const setTimeDialog = page.getByRole('dialog');
  await setTimeDialog.getByLabel('Minutes').fill('7');
  await setTimeDialog.getByLabel('Seconds').fill('42');
  await setTimeDialog.getByRole('button', { name: 'Set time' }).click();

  return boardId;
}

test('capture the scoreboard baseline', async ({ page }) => {
  const boardId = await buildDeterministicBoard(page);

  await page.goto(`/board/${boardId}`);
  await expect(page.locator('#home-score')).toHaveText('05');
  await expect(page.locator('#game-clock')).toHaveText('07:42');
  await waitForFonts(page);

  await expect(page).toHaveScreenshot('scoreboard.png', { fullPage: true });
});

test('capture the mirror baseline', async ({ page, context }) => {
  const boardId = await buildDeterministicBoard(page);

  await page.goto(`/app/boards/${boardId}`);
  const mirrorUrl = await page.locator('#copy-settings-mirror').inputValue();

  const anonContext = await context.browser()!.newContext();
  try {
    const mirrorPage = await anonContext.newPage();
    await mirrorPage.goto(mirrorUrl);
    await expect(mirrorPage.locator('#home-score')).toHaveText('05', { timeout: 10_000 });
    await waitForFonts(mirrorPage);

    // The mirror shares the scoreboard's exact markup and stylesheet — this
    // baseline should be pixel-identical to the scoreboard's.
    await expect(mirrorPage).toHaveScreenshot('scoreboard.png', { fullPage: true });
  } finally {
    await anonContext.close();
  }
});

test('capture the overlay baseline', async ({ page, context }) => {
  const boardId = await buildDeterministicBoard(page);

  await page.goto(`/app/boards/${boardId}`);
  const overlayUrl = await page.locator('#copy-settings-overlay').inputValue();

  const anonContext = await context
    .browser()!
    .newContext({ viewport: { width: 900, height: 200 } });
  try {
    const overlayPage = await anonContext.newPage();
    await overlayPage.goto(overlayUrl);
    await expect(overlayPage.locator('#stream-home-score')).toHaveText('5', { timeout: 10_000 });
    await waitForFonts(overlayPage);

    // The overlay is transparent-background by design (an OBS Browser Source),
    // so it is screenshotted at its natural size rather than full-page.
    await expect(overlayPage.locator('.stream-bar')).toHaveScreenshot('overlay.png');
  } finally {
    await anonContext.close();
  }
});
