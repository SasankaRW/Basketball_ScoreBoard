/**
 * Mirror display — the read-only scoreboard for a projector or second monitor.
 *
 * Same markup and stylesheet as the operator scoreboard, with three differences:
 * it authenticates from a URL key instead of a login, it binds no input at all,
 * and it holds no audio (the buzzer belongs at the scorer's table, not on the
 * wall). Its session carries `role: 'mirror'`, which matches no write rule in
 * database.rules.json, so read-only is enforced by the database and not merely
 * by the absence of buttons here.
 */
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
} from '../shared/displayBoot.js';
import { startDisplayLoop } from '../shared/displayLoop.js';
import { queryScoreboardElements, renderScoreboard } from '../shared/scoreboardView.js';

async function main(): Promise<void> {
  const banner = mountStatusBanner();

  let context: DisplayContext;
  try {
    context = await bootViewerSurface();
  } catch (error) {
    renderFatalError(
      error instanceof DisplayBootError ? error.message : 'Could not open this mirror link.',
    );
    return;
  }

  const { db, tenantId, boardId } = context;
  const elements = queryScoreboardElements();

  // The operator page uses this line for keyboard hints; on a wall display there
  // is no keyboard, so it stays empty rather than advertising shortcuts.
  if (elements.controlsInfo) elements.controlsInfo.textContent = '';

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
      banner.set(
        'error',
        'This mirror link is no longer valid. Get a fresh one from the dashboard.',
      ),
  );

  startDisplayLoop(() => (state ? renderScoreboard(elements, state, { now: now() }) : 250));
}

void main();
