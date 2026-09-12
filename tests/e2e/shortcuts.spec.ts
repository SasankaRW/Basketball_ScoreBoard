/**
 * Customisable keyboard shortcuts, end to end.
 *
 * `tests/unit/keymap.test.ts` already pins the model — conflicts, defaults,
 * round trips. What only a browser can show is the part in between: that a key
 * captured in the editor actually reaches the reducer afterwards, that the old
 * key stops working, and that the choice is still there after a reload. The
 * last one is the whole reason the keymap is persisted rather than kept in
 * component state.
 */
import { test, expect } from '@playwright/test';
import { createBoard, freshAccount, signUp } from './fixtures.js';

test.describe.configure({ mode: 'serial' });

const homeScore = '.team-panel__score';

async function openControlPanel(page: import('@playwright/test').Page, board: string) {
  await createBoard(page, board);
  await page.getByRole('link', { name: 'Control panel' }).click();
  await expect(page.getByRole('heading', { name: board })).toBeVisible();
  await expect(page.locator(homeScore).first()).toHaveText('00');
}

/**
 * The editor lives behind the "Keyboard shortcuts" reference popup rather
 * than being reachable directly from the sidebar, so every test opens the
 * popup before it can reach "Customise shortcuts".
 */
async function openShortcutEditor(page: import('@playwright/test').Page): Promise<void> {
  await page.getByRole('button', { name: 'Keyboard shortcuts' }).click();
  await page.getByRole('button', { name: 'Customise shortcuts' }).click();
}

/** Arms a row in the editor and presses the key that should take it over. */
async function rebind(
  page: import('@playwright/test').Page,
  command: string,
  key: string,
): Promise<void> {
  await page.getByRole('button', { name: `Change shortcut for ${command}` }).click();
  await expect(
    page.getByText(`Press a key or click a mouse button for “${command}”`),
  ).toBeVisible();
  await page.keyboard.press(key);
}

test('a remapped key scores, and the key it replaced stops scoring', async ({ page }) => {
  await signUp(page, freshAccount('keys-remap'));
  await openControlPanel(page, 'Keymap Court');

  // The shipped default, before anything is customised.
  await page.keyboard.press('ArrowUp');
  await expect(page.locator(homeScore).first()).toHaveText('01');

  await openShortcutEditor(page);
  await rebind(page, 'Home +1', 'p');
  await expect(page.getByLabel('Change shortcut for Home +1')).toBeVisible();
  await page.getByRole('button', { name: 'Done' }).click();

  // The new key works…
  await page.keyboard.press('p');
  await expect(page.locator(homeScore).first()).toHaveText('02');

  // …and the old one is genuinely unbound, not merely absent from the reference.
  await page.keyboard.press('ArrowUp');
  await page.waitForTimeout(300);
  await expect(page.locator(homeScore).first()).toHaveText('02');

  // The reference popup reads from the keymap, so it has to have followed.
  await page.getByRole('button', { name: 'Keyboard shortcuts' }).click();
  await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toContainText('P');
});

test('a customised shortcut survives a reload', async ({ page }) => {
  await signUp(page, freshAccount('keys-persist'));
  await openControlPanel(page, 'Persist Court');

  await openShortcutEditor(page);
  await rebind(page, 'Home +1', 'p');
  await page.getByRole('button', { name: 'Done' }).click();

  await page.reload();
  await expect(page.locator(homeScore).first()).toHaveText('00', { timeout: 10_000 });

  await page.keyboard.press('p');
  await expect(page.locator(homeScore).first()).toHaveText('01');
});

/**
 * One key runs one command, so assigning a key that is already taken has to
 * take it. The editor says which command lost it rather than leaving a silent
 * hole in someone's muscle memory.
 */
test('taking a key that is already in use reports what it was taken from', async ({ page }) => {
  await signUp(page, freshAccount('keys-conflict'));
  await openControlPanel(page, 'Conflict Court');

  await openShortcutEditor(page);
  await rebind(page, 'Home +2', 'ArrowUp');

  await expect(page.getByText(/was on “Home \+1”, which now has no shortcut/)).toBeVisible();
  await page.getByRole('button', { name: 'Done' }).click();

  // ArrowUp now adds two, and Home +1 has no key at all.
  await page.keyboard.press('ArrowUp');
  await expect(page.locator(homeScore).first()).toHaveText('02');
});

test('Escape cancels a capture without binding anything or closing the editor', async ({
  page,
}) => {
  await signUp(page, freshAccount('keys-escape'));
  await openControlPanel(page, 'Escape Court');

  await openShortcutEditor(page);
  await page.getByRole('button', { name: 'Change shortcut for Home +1' }).click();
  await expect(page.getByText('Press a key or click a mouse button for “Home +1”')).toBeVisible();

  await page.keyboard.press('Escape');
  // The prompt is gone but the editor is not — Escape belongs to the capture
  // while one is armed, and only then.
  await expect(page.getByText('Press a key or click a mouse button for “Home +1”')).toBeHidden();
  await expect(page.getByRole('heading', { name: 'Keyboard shortcuts' })).toBeVisible();

  await page.getByRole('button', { name: 'Done' }).click();
  await page.keyboard.press('ArrowUp');
  await expect(page.locator(homeScore).first()).toHaveText('01');
});

test('clearing a shortcut leaves the control with no key, and reset restores it', async ({
  page,
}) => {
  await signUp(page, freshAccount('keys-clear'));
  await openControlPanel(page, 'Clear Court');

  await openShortcutEditor(page);
  await page.getByRole('button', { name: 'Clear shortcut for Home +1' }).click();
  await page.getByRole('button', { name: 'Done' }).click();

  await page.keyboard.press('ArrowUp');
  await page.waitForTimeout(300);
  await expect(page.locator(homeScore).first()).toHaveText('00');

  await openShortcutEditor(page);
  await page.getByRole('button', { name: 'Reset to defaults' }).click();
  await page.getByRole('button', { name: 'Done' }).click();

  await page.keyboard.press('ArrowUp');
  await expect(page.locator(homeScore).first()).toHaveText('01');
});

/**
 * The editor is full of single-letter shortcuts, so its own keystrokes must not
 * reach the board underneath — capturing `↑` for a command would otherwise
 * score the point it is being bound to.
 */
test('keys pressed while the editor is open do not reach the game', async ({ page }) => {
  await signUp(page, freshAccount('keys-shield'));
  await openControlPanel(page, 'Shield Court');

  await openShortcutEditor(page);
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('f');
  await page.waitForTimeout(300);

  await page.getByRole('button', { name: 'Done' }).click();
  await expect(page.locator(homeScore).first()).toHaveText('00');
  await expect(page.locator('.stat-row__value').first()).toHaveText('0');
});

/**
 * The left click is the one control that binds only with Shift held, because
 * the bare click is what presses every button on the page and dispatch listens
 * on the document. Three things only a browser can show: that the bare click
 * is refused *and* says why, that Shift + click is accepted, and that firing
 * the shortcut on top of one of the panel's own buttons runs the shortcut
 * alone — `preventDefault` on the mousedown does not stop the click that
 * follows it, so the panel kills that click separately.
 */
test('the left click binds with Shift held, and only with Shift held', async ({ page }) => {
  await signUp(page, freshAccount('keys-leftclick'));
  await openControlPanel(page, 'Click Court');

  // Dead space inside the editor: a paragraph, so a click on it is a click on
  // nothing that would clear the notice again.
  const editorProse = page.locator('.shortcut-editor__intro');

  await openShortcutEditor(page);
  await page.getByRole('button', { name: 'Change shortcut for Home +1' }).click();

  // A bare click still works the editor — the capture stays armed — but no
  // longer in silence, which is the whole hint.
  await editorProse.click();
  await expect(page.getByText(/hold Shift and click to bind it/)).toBeVisible();
  await expect(page.getByText('Press a key or click a mouse button for “Home +1”')).toBeVisible();

  // Shift + click on that same dead space is a binding.
  await editorProse.click({ modifiers: ['Shift'] });
  await expect(page.getByLabel('Change shortcut for Home +1')).toBeVisible();
  await expect(page.getByRole('dialog')).toContainText('Shift + Left click');
  await page.getByRole('button', { name: 'Done' }).click();

  // Shift + click on the panel's own dead space scores…
  await page.getByRole('heading', { name: 'Click Court' }).click({ modifiers: ['Shift'] });
  await expect(page.locator(homeScore).first()).toHaveText('01');

  // …and so does one on a panel button, which must not also fire its own
  // action: the away score stays where it was.
  const awayPlusOne = page
    .locator('.team-panel')
    .last()
    .getByRole('button', { name: '+1', exact: true });
  await awayPlusOne.click({ modifiers: ['Shift'] });
  await expect(page.locator(homeScore).first()).toHaveText('02');
  await expect(page.locator(homeScore).last()).toHaveText('00');

  // The bare click still just presses buttons.
  await awayPlusOne.click();
  await expect(page.locator(homeScore).last()).toHaveText('01');
  await expect(page.locator(homeScore).first()).toHaveText('02');
});
