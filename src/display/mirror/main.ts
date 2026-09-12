/**
 * Mirror display — the read-only scoreboard for a projector or second monitor.
 *
 * Same markup and stylesheet as the operator scoreboard, with three differences:
 * it authenticates from a URL key instead of a login, it binds no input at all,
 * and it holds no audio (the buzzer belongs at the scorer's table, not on the
 * wall). Its session carries `role: 'mirror'`, which matches no write rule in
 * database.rules.json, so read-only is enforced by the database and not merely
 * by the absence of buttons here.
 *
 * It is also the page the console's layout editor embeds, which is why it
 * mounts `layoutBridge` — inert unless this document is inside a frame. That
 * makes the editor's canvas the real display rather than a drawing of one; see
 * `display/shared/layoutBridge.ts` for why a mock was not good enough.
 */
import type { BoardLayout } from '../../core/boardLayout.js';
import { subscribeBoardLayout } from '../../core/liveLayout.js';
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
import { applyLayout } from '../shared/layoutApply.js';
import { mountLayoutBridge } from '../shared/layoutBridge.js';
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

  // -- Layout -------------------------------------------------------------

  /**
   * Two sources, and the editor wins.
   *
   * `stored` is what the board publishes to every screen; `preview` is a draft
   * the layout editor is dragging around in a frame and has not saved. Keeping
   * them apart is what lets an operator edit against the live board without
   * the half-finished arrangement reaching the gym wall — and lets a save
   * arriving from someone else land on `stored` without yanking the canvas out
   * from under the person editing.
   */
  let stored: BoardLayout | null = null;
  let preview: BoardLayout | null = null;
  let previewing = false;

  const paintLayout = () => applyLayout(document, previewing ? preview : stored);

  mountLayoutBridge({
    onApply: (layout) => {
      preview = layout;
      previewing = true;
      paintLayout();
    },
  });

  subscribeBoardLayout(
    db,
    tenantId,
    boardId,
    (snapshot) => {
      stored = snapshot.layout;
      paintLayout();
    },
    // A layout that cannot be read is not worth a banner on a wall display:
    // the stock arrangement is a perfectly good scoreboard, and the game is
    // what people are here to watch.
    () => undefined,
  );

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
