/**
 * Stream overlay — the OBS browser source.
 *
 * Authenticates from the `?k=` viewer key, subscribes to one board, renders the
 * lower-third bar. Its session carries `role: 'overlay'`, which matches no write
 * rule anywhere, so it is read-only by construction rather than by omission.
 *
 * Deliberately quieter than the other surfaces: no reconnect banner and no
 * audio. Anything this page draws goes out on the broadcast, so a transient
 * network wobble must not put a yellow bar on air — and it does not need to,
 * because the deadline clock keeps counting down correctly right through a
 * disconnect. Only an unrecoverable error, where the overlay would otherwise sit
 * blank and silent, is worth showing.
 */
import { formatGameClock, msUntilDisplayChange, remainingAt } from '../../core/clock.js';
import { subscribeBoardState } from '../../core/liveState.js';
import type { BoardState } from '../../core/schema.js';
import { now } from '../../core/serverTime.js';
import {
  bootViewerSurface,
  DisplayBootError,
  renderFatalError,
  type DisplayContext,
} from '../shared/displayBoot.js';
import { startDisplayLoop } from '../shared/displayLoop.js';

function setText(element: HTMLElement | null, value: string): void {
  if (element && element.textContent !== value) element.textContent = value;
}

/**
 * No logo uploaded for this board hides the whole `.logo-section`, not just
 * the `<img>` — that section has its own fixed-height background box, so
 * hiding only the image would leave an empty dark rectangle on the broadcast.
 */
function setLogo(
  section: HTMLElement | null,
  image: HTMLImageElement | null,
  url: string | null,
): void {
  if (!section || !image) return;
  if (url === null) {
    section.hidden = true;
    if (image.getAttribute('src')) image.removeAttribute('src');
    return;
  }
  if (image.src !== url) image.src = url;
  section.hidden = false;
}

async function main(): Promise<void> {
  let context: DisplayContext;
  try {
    context = await bootViewerSurface();
  } catch (error) {
    renderFatalError(
      error instanceof DisplayBootError ? error.message : 'Could not open this overlay link.',
    );
    return;
  }

  const { db, tenantId, boardId } = context;

  const homeName = document.getElementById('stream-home-name');
  const awayName = document.getElementById('stream-away-name');
  const homeScore = document.getElementById('stream-home-score');
  const awayScore = document.getElementById('stream-away-score');
  const gameTime = document.getElementById('stream-game-time');
  const quarter = document.getElementById('stream-quarter');
  const logoSection = document.getElementById('logo-section');
  const logo = document.getElementById('stream-logo') as HTMLImageElement | null;

  let state: BoardState | null = null;

  subscribeBoardState(db, tenantId, boardId, (snapshot) => {
    state = snapshot.state;
  });

  startDisplayLoop(() => {
    if (!state) return 250;

    const showTenths = state.config.showTenthsUnderOneMinute;
    const remaining = remainingAt(state.gameClock, now());

    setText(homeName, state.home.name);
    setText(awayName, state.away.name);
    // Unpadded, as the original overlay rendered them — the broadcast bar is
    // narrow and a leading zero reads as clutter at that size.
    setText(homeScore, String(state.home.score));
    setText(awayScore, String(state.away.score));
    setText(quarter, `Q${state.period}`);
    setText(gameTime, formatGameClock(remaining, showTenths));
    setLogo(logoSection, logo, state.logoUrl);

    return state.gameClock.running ? msUntilDisplayChange(remaining, showTenths) : 1_000;
  });
}

void main();
