/**
 * Guards the promise that the scoreboard's appearance does not change.
 *
 * Two things are pinned here. First, the mirror embeds a verbatim copy of the
 * scoreboard's markup — a copy that would otherwise rot the first time someone
 * edited one file and forgot the other. Second, the element IDs the shared
 * renderer looks up must actually exist in both pages: a typo'd ID fails
 * silently at runtime (`getElementById` just returns null) and would show up as
 * a scoreboard that mysteriously stops updating one field.
 *
 * These run in milliseconds and need no browser, so they catch the mistake long
 * before the Playwright visual suite does.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();

function read(relativePath: string): string {
  return readFileSync(resolve(root, relativePath), 'utf8');
}

function extractScoreboardBlock(html: string): string {
  const match = /( *<div class="scoreboard">[\s\S]*?\n {4}<\/div>)/.exec(html);
  if (!match?.[1]) throw new Error('No .scoreboard block found');
  return match[1];
}

const SCOREBOARD_HTML = read('src/display/scoreboard/index.html');
const MIRROR_HTML = read('src/display/mirror/index.html');
const OVERLAY_HTML = read('src/display/overlay/index.html');
const GAMECLOCK_HTML = read('src/display/gameclock/index.html');
const SHOTCLOCK_HTML = read('src/display/shotclock/index.html');

/** Every ID `queryScoreboardElements` resolves. */
const REQUIRED_IDS = [
  'home-score',
  'away-score',
  'home-fouls',
  'away-fouls',
  'home-timeouts',
  'away-timeouts',
  'home-team-name',
  'away-team-name',
  'home-possession-arrow',
  'away-possession-arrow',
  'game-clock',
  'shot-clock',
  'quarter-display',
  'controls-info',
  'board-logo',
];

describe('scoreboard and mirror markup', () => {
  it('share a byte-identical .scoreboard block', () => {
    expect(extractScoreboardBlock(MIRROR_HTML)).toBe(extractScoreboardBlock(SCOREBOARD_HTML));
  });

  it.each(REQUIRED_IDS)('both pages define #%s', (id) => {
    expect(SCOREBOARD_HTML).toContain(`id="${id}"`);
    expect(MIRROR_HTML).toContain(`id="${id}"`);
  });

  it.each(['.team.home .stat-line.foul', '.team.away .stat-line.foul'])(
    'both pages carry the foul line the bonus class attaches to (%s)',
    () => {
      for (const html of [SCOREBOARD_HTML, MIRROR_HTML]) {
        expect(html).toMatch(/class="team home"/);
        expect(html).toMatch(/class="team away"/);
        expect(html).toMatch(/class="stat-line foul"/);
      }
    },
  );

  /**
   * Absolute, not relative (`./main.ts`, `style.css`). These three pages are
   * served under rewritten URLs — `/board/:id`, `/mirror/:id`,
   * `/overlay/:id` — so a relative reference resolves against *that* path
   * (`/board/main.ts`) rather than the file's own directory, and 404s. The
   * production build rewrites relative paths to absolute hashed asset URLs,
   * which is why this only ever broke under the dev server.
   */
  it('share the stylesheet, so they cannot be styled apart', () => {
    expect(SCOREBOARD_HTML).toContain('href="/display/scoreboard/style.css"');
    expect(MIRROR_HTML).toContain('href="/display/scoreboard/style.css"');
  });

  it.each([
    ['scoreboard', 'src/display/scoreboard/index.html'],
    ['mirror', 'src/display/mirror/index.html'],
    ['overlay', 'src/display/overlay/index.html'],
    ['gameclock', 'src/display/gameclock/index.html'],
    ['shotclock', 'src/display/shotclock/index.html'],
  ])('%s references its entry script absolutely', (_name, path) => {
    expect(read(path)).toMatch(/<script type="module" src="\/display\//);
  });
});

describe('scoreboard page', () => {
  it('no longer ships the credential table the old script.js hardcoded', () => {
    expect(SCOREBOARD_HTML).not.toContain('username-input');
    expect(SCOREBOARD_HTML).not.toContain('password-input');
    expect(SCOREBOARD_HTML).not.toContain('login-modal');
  });

  it('no longer embeds the control panel, which is now its own page', () => {
    expect(SCOREBOARD_HTML).not.toContain('control-panel-modal');
  });

  it('keeps the help modal and its keyboard reference', () => {
    expect(SCOREBOARD_HTML).toContain('id="help-modal"');
    expect(SCOREBOARD_HTML).toContain('Start/Stop Game Clock');
  });

  it('loads its assets from the public directory', () => {
    expect(SCOREBOARD_HTML).toContain('/assets/ShotClockBuzzer.mp3');
    expect(SCOREBOARD_HTML).toContain('/assets/gameOverSound.mp3');
  });
});

describe('overlay page', () => {
  it.each([
    'stream-home-name',
    'stream-away-name',
    'stream-home-score',
    'stream-away-score',
    'stream-game-time',
    'stream-quarter',
    'stream-logo',
    'logo-section',
  ])('defines #%s', (id) => {
    expect(OVERLAY_HTML).toContain(`id="${id}"`);
  });

  it('keeps its own stylesheet rather than the scoreboard one', () => {
    expect(OVERLAY_HTML).toContain('stream-overlay.css');
  });
});

describe('clock screens', () => {
  it.each([
    ['gameclock', GAMECLOCK_HTML],
    ['shotclock', SHOTCLOCK_HTML],
  ])('%s defines the #clock-value node shared/clockScreen.ts writes into', (_name, html) => {
    expect(html).toContain('id="clock-value"');
  });

  /**
   * The body class is what picks the colour and the size of the digits — white
   * on dark for the game clock, red for the shot clock. Both pages load the
   * same stylesheet, so a missing modifier renders a correct clock in the
   * wrong skin rather than failing outright.
   */
  it('game-clock page carries its own body modifier', () => {
    expect(GAMECLOCK_HTML).toContain('class="clock-screen clock-screen--game"');
  });

  it('shot-clock page carries its own body modifier', () => {
    expect(SHOTCLOCK_HTML).toContain('class="clock-screen clock-screen--shot"');
  });

  /** Absolute, for the same reason the other display pages are — see above. */
  it.each([
    ['gameclock', GAMECLOCK_HTML],
    ['shotclock', SHOTCLOCK_HTML],
  ])('%s links the shared clock stylesheet absolutely', (_name, html) => {
    expect(html).toContain('href="/display/shared/clock-screen.css"');
  });

  /**
   * These are wall displays with no keyboard and no speakers, like the mirror.
   * Pulling in the scoreboard's stylesheet would also drag its layout onto a
   * page that has none of the elements it styles.
   */
  it.each([
    ['gameclock', GAMECLOCK_HTML],
    ['shotclock', SHOTCLOCK_HTML],
  ])('%s ships no audio and no scoreboard stylesheet', (_name, html) => {
    expect(html).not.toContain('<audio');
    expect(html).not.toContain('/display/scoreboard/style.css');
  });
});

describe('no page still points at the retired single-tenant code', () => {
  it.each([
    ['scoreboard', SCOREBOARD_HTML],
    ['mirror', MIRROR_HTML],
    ['overlay', OVERLAY_HTML],
  ])('%s does not reference script.js or stream-overlay.js', (_name, html) => {
    expect(html).not.toContain('src="script.js"');
    expect(html).not.toContain('src="stream-overlay.js"');
  });
});
