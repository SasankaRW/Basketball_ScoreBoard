/**
 * Boot and render loop shared by the two single-clock display surfaces.
 *
 * `/gameclock/:id` and `/shotclock/:id` are the mirror with everything except
 * one number removed — for a shot-clock pole, a courtside tablet, or a second
 * wall screen that should show the time and nothing else. Like the mirror they
 * authenticate from a URL key, bind no input, and hold no audio: the buzzer
 * belongs at the scorer's table, not on the wall.
 *
 * They present the board's *mirror* key, so their session carries
 * `role: 'mirror'` — read-only by the database's own rules rather than by the
 * absence of buttons here. See `buildGameClockUrl` in core/boards.ts for why
 * these surfaces reuse that key instead of carrying one of their own.
 */
import {
  formatGameClock,
  formatShotClock,
  msUntilDisplayChange,
  remainingAt,
} from '../../core/clock.js';
import { subscribeBoardState } from '../../core/liveState.js';
import type { BoardState } from '../../core/schema.js';
import { now } from '../../core/serverTime.js';
import {
  bootViewerSurface,
  DisplayBootError,
  mountStatusBanner,
  renderFatalError,
  watchConnection,
  type DisplayContext,
} from './displayBoot.js';
import { startDisplayLoop } from './displayLoop.js';

export type ClockKind = 'game' | 'shot';

/**
 * Which clock each page reads, and how it formats it — the only difference
 * between the two entry points, so the rest of this module is shared verbatim.
 */
const CLOCKS: Record<
  ClockKind,
  {
    pick: (state: BoardState) => BoardState['gameClock'];
    format: (ms: number, tenths: boolean) => string;
  }
> = {
  game: { pick: (state) => state.gameClock, format: formatGameClock },
  shot: { pick: (state) => state.shotClock, format: formatShotClock },
};

export async function startClockScreen(kind: ClockKind): Promise<void> {
  const banner = mountStatusBanner();

  let context: DisplayContext;
  try {
    context = await bootViewerSurface();
  } catch (error) {
    renderFatalError(
      error instanceof DisplayBootError ? error.message : 'Could not open this clock link.',
    );
    return;
  }

  const { db, tenantId, boardId } = context;
  const value = document.getElementById('clock-value');
  const { pick, format } = CLOCKS[kind];

  watchConnection(db, banner);

  let state: BoardState | null = null;

  subscribeBoardState(
    db,
    tenantId,
    boardId,
    (snapshot) => {
      state = snapshot.state;
    },
    () =>
      banner.set('error', 'This link is no longer valid. Get a fresh one from the control panel.'),
  );

  startDisplayLoop(() => {
    if (!state) return 250;

    const clock = pick(state);
    const showTenths = state.config.showTenthsUnderOneMinute;
    const remaining = remainingAt(clock, now());
    const text = format(remaining, showTenths);

    // Diffed rather than assigned: at tenths resolution this runs ten times a
    // second, and an unchanged write still dirties layout.
    if (value && value.textContent !== text) value.textContent = text;

    return clock.running ? msUntilDisplayChange(remaining, showTenths) : 1_000;
  });
}
