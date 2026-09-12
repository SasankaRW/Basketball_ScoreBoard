/**
 * The layout editor, end to end.
 *
 * What is actually worth proving here is the seam, not the dragging. A layout is
 * edited in the console, written to the Realtime Database under the tenant, and
 * read back by a display page on a different machine with a different token —
 * three layers that are each individually plausible and only jointly useful. The
 * bug this suite exists to catch is the one where an arrangement saves
 * beautifully and the gym wall never hears about it.
 *
 * The other half is the promise in the opposite direction: a board nobody has
 * customised must render the stock scoreboard, and a reset must put it back.
 * `visual.spec.ts` pins what that looks like; these tests pin that the
 * *mechanism* which could disturb it stays out of the way.
 */
import { test, expect, type Page } from '@playwright/test';
import { createBoard, freshAccount, signUp } from './fixtures.js';

test.describe.configure({ mode: 'serial' });

async function openLayoutEditor(page: Page, boardName: string): Promise<string> {
  await signUp(page, freshAccount('layout'));
  await createBoard(page, boardName);

  await page.getByRole('link', { name: 'Settings' }).click();
  const boardId = page.url().split('/').pop();
  if (!boardId) throw new Error('Could not read the board id from the settings URL');

  await page.getByRole('link', { name: 'Layout', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Layout', exact: true })).toBeVisible();

  return boardId;
}

/** The editor's preview is an iframe of the board's own mirror. */
function preview(page: Page) {
  return page.frameLocator('iframe[title="Scoreboard preview"]');
}

test('a new board opens on the stock layout and nothing is overlaid', async ({ page }) => {
  await openLayoutEditor(page, 'Untouched Court');

  // The opt-in panel is the whole safety property: until someone presses this,
  // the board carries no layout document and renders exactly as it shipped.
  await expect(page.getByRole('button', { name: 'Customise layout' })).toBeVisible();

  const scoreboard = preview(page).locator('.scoreboard');
  await expect(scoreboard).toBeVisible({ timeout: 15_000 });
  await expect(scoreboard).not.toHaveClass(/sb-custom/);
});

test('customising, moving a section, and publishing reaches the display', async ({
  page,
  context,
}) => {
  const boardId = await openLayoutEditor(page, 'Arranged Court');

  await page.getByRole('button', { name: 'Customise layout' }).click();

  // The preview switches into custom mode as soon as there is a draft, before
  // anything has been published — the draft drives the frame directly.
  const scoreboard = preview(page).locator('.scoreboard');
  await expect(scoreboard).toHaveClass(/sb-custom/, { timeout: 15_000 });

  // Move the period readout somewhere unmistakable via the panel's own fields,
  // which exercises the same `withSection` path a drag commits through while
  // staying immune to pixel arithmetic.
  await page.getByRole('button', { name: 'Period', exact: true }).click();
  await page.getByLabel('X (%)').fill('70');
  await page.getByLabel('Y (%)').fill('4');

  await page.getByRole('button', { name: 'Publish layout' }).click();
  await expect(page.getByText(/Layout published/)).toBeVisible({ timeout: 15_000 });

  // The proof: a *different* browser context, holding only the operator's
  // session, loading the real scoreboard page, shows the published arrangement.
  const operatorPage = await context.newPage();
  await operatorPage.goto(`/board/${boardId}`);

  const board = operatorPage.locator('.scoreboard');
  await expect(board).toHaveClass(/sb-custom/, { timeout: 20_000 });
  await expect(operatorPage.locator('#quarter-display')).toHaveCSS('position', 'absolute');
  await expect(operatorPage.locator('#quarter-display')).toHaveAttribute('style', /--sb-x:\s*70/);
  await operatorPage.close();
});

test('a removed section disappears and can be added back', async ({ page }) => {
  await openLayoutEditor(page, 'Trimmed Court');
  await page.getByRole('button', { name: 'Customise layout' }).click();
  await expect(preview(page).locator('.scoreboard')).toHaveClass(/sb-custom/, { timeout: 15_000 });

  const shotClock = preview(page).locator('#shot-clock');
  await expect(shotClock).toBeVisible();

  await page.getByRole('button', { name: 'Remove Shot clock' }).click();
  await expect(shotClock).toBeHidden();

  // It leaves the board but not the editor: taking a section off has to be
  // reversible without resetting everything else that was arranged around it.
  await page.getByRole('button', { name: 'Add Shot clock' }).click();
  await expect(shotClock).toBeVisible();
});

test('reset returns the board to the scoreboard it shipped with', async ({ page, context }) => {
  const boardId = await openLayoutEditor(page, 'Reset Court');

  await page.getByRole('button', { name: 'Customise layout' }).click();
  await expect(preview(page).locator('.scoreboard')).toHaveClass(/sb-custom/, { timeout: 15_000 });
  await page.getByRole('button', { name: 'Publish layout' }).click();
  await expect(page.getByText(/Layout published/)).toBeVisible({ timeout: 15_000 });

  const operatorPage = await context.newPage();
  await operatorPage.goto(`/board/${boardId}`);
  await expect(operatorPage.locator('.scoreboard')).toHaveClass(/sb-custom/, { timeout: 20_000 });

  page.once('dialog', (dialog) => void dialog.accept());
  await page.getByRole('button', { name: 'Reset to default layout' }).click();
  await expect(page.getByText(/Back to the default layout/)).toBeVisible({ timeout: 15_000 });

  // Live, on the page already open: the class comes off and the inline geometry
  // goes with it, which is what returns the page to the stylesheet's own layout
  // rather than to a layout that merely resembles it.
  await expect(operatorPage.locator('.scoreboard')).not.toHaveClass(/sb-custom/, {
    timeout: 20_000,
  });
  await expect(operatorPage.locator('#quarter-display')).not.toHaveAttribute('style', /--sb-x/);
  await operatorPage.close();

  // And the editor is back to offering the opt-in.
  await expect(page.getByRole('button', { name: 'Customise layout' })).toBeVisible();
});
