import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end and visual-regression tests.
 *
 * Runs against the Firebase Hosting emulator serving the real production
 * build (`dist/`), with Auth/Database/Firestore/Functions emulators alongside
 * it — the same `firebase emulators:exec` wrapper the unit rules/integration
 * suites use, so `npm run test:e2e` builds the app and functions once, then
 * runs Playwright inside the emulator session. See package.json's
 * `test:e2e` script for the exact sequence.
 *
 * Two projects:
 *   - `e2e`     functional flows: signup, board creation, control panel
 *               actions reflected on the scoreboard/mirror/overlay.
 *   - `visual`  screenshot regression for the scoreboard and overlay against
 *               the golden images captured before the Phase 3 rewrite. This is
 *               what makes "the scoreboard's appearance does not change" a
 *               machine-checked fact rather than a claim.
 */
export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: false, // shared emulator project — avoid cross-test data races
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',

  use: {
    baseURL: 'http://127.0.0.1:5000',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },

  expect: {
    toHaveScreenshot: {
      // This page is almost entirely large, glowing display digits — exactly
      // the content ClearType/sub-pixel anti-aliasing jitters hardest on
      // between two otherwise-identical renders, even on the same machine
      // back to back. `threshold` (0–1, pixelmatch's own per-pixel colour
      // tolerance) is the lever that actually absorbs that: it stops a pixel
      // that anti-aliased a fraction differently from being flagged as
      // "different" in the first place. `maxDiffPixelRatio` alone does not
      // help here, because the jitter touches nearly every glyph's edge at
      // once rather than a small isolated region — capping pixel *count*
      // doesn't help when the diff is spread thin across the whole page.
      threshold: 0.3,
      maxDiffPixelRatio: 0.02,
    },
  },

  projects: [
    {
      name: 'e2e',
      testMatch: /.*\.spec\.ts/,
      testIgnore: /visual\.spec\.ts/,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'visual',
      testMatch: /visual\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1920, height: 1080 } },
    },
  ],
});
