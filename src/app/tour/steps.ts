/**
 * What the guided tour says, and where it points.
 *
 * Pure data, deliberately separated from the machinery that renders it: the
 * wording of a product tour changes far more often than its behaviour, and
 * keeping it here means editing a sentence never means reading the positioning
 * code.
 *
 * Every step anchors to a CSS selector rather than to a React ref. That decision
 * is what keeps the tour from leaking into the pages it describes — no page has
 * to thread refs through its component tree, or even know a tour exists. The
 * cost is that a selector can go stale when markup changes, which is why a step
 * whose anchor is missing is *skipped* rather than shown floating or crashing:
 * a tour that quietly omits one point is a small problem, one that blocks the
 * console behind a popover aimed at nothing is a large one.
 *
 * Selectors therefore prefer things that exist for their own reasons — layout
 * containers, and the accessible names Playwright already depends on — over
 * classes added purely to be targeted here.
 */

export interface TourStep {
  /**
   * CSS selector for the element this step points at. Omit for a step that sits
   * in the middle of the screen with no anchor, which is how each tour opens.
   */
  anchor?: string;
  title: string;
  body: string;
  /** Preferred side of the anchor. Flipped automatically when there is no room. */
  placement?: 'top' | 'bottom' | 'left' | 'right';
}

export interface TourDefinition {
  /** Stable across releases — it is what "already seen this" is recorded against. */
  id: string;
  /** Shown in the tour's own header, so someone re-running it knows where they are. */
  title: string;
  steps: TourStep[];
}

/** Steps every page ends with, so the way back into help is always the last thing seen. */
const helpStep: TourStep = {
  anchor: '[data-tour="help"]',
  title: 'Replay this any time',
  body: 'Help reopens the tour for whichever page you are on. Nothing here is one-time — come back whenever something is unfamiliar.',
  placement: 'bottom',
};

const navStep: TourStep = {
  anchor: '.topbar__nav',
  title: 'Getting around',
  body: 'Boards is your home. Schedule plans matches ahead of time, and History keeps every finished game with its box score and play-by-play.',
  placement: 'bottom',
};

export const DASHBOARD_TOUR: TourDefinition = {
  id: 'dashboard',
  title: 'Boards',
  steps: [
    {
      title: 'Welcome to your scoreboard console',
      body: 'A two-minute look at what everything does. You can leave at any point and pick it up again from the Help button.',
    },
    navStep,
    {
      anchor: '.board-grid .board-card, .empty',
      title: 'One board per court',
      body: 'Each board is a single scoreboard, with its own control panel, a mirror display for a venue screen, and an overlay for streaming.',
      placement: 'top',
    },
    {
      anchor: '.board-card__row .btn--primary',
      title: 'Open the control panel',
      body: 'This is where a game is actually run — score, clocks, fouls and timeouts. Two people can have it open at once and neither will overwrite the other.',
      placement: 'top',
    },
    {
      anchor: '.page-head__actions',
      title: 'Add another court',
      body: 'Create a board for each court you are running. Boards you no longer need can be archived rather than deleted, so their match history survives.',
      placement: 'bottom',
    },
    {
      anchor: '[data-tour="members"]',
      title: 'Who can do what',
      body: 'Invite people by link and give them a role: operators run games, admins also manage boards and members, viewers can only watch.',
      placement: 'top',
    },
    helpStep,
  ],
};

export const CONTROL_TOUR: TourDefinition = {
  id: 'control',
  title: 'Control panel',
  steps: [
    {
      title: 'Running a game',
      body: 'Everything on this page writes straight to the live scoreboard — there is no save button and no lag.',
    },
    {
      anchor: '.control-board .team-panel',
      title: 'Score, fouls and timeouts',
      body: 'The +1 / +2 / +3 buttons add a basket, and "Correct −1" fixes a miscount. Fouls and timeouts sit below; timeouts refill automatically at half time.',
      placement: 'right',
    },
    {
      anchor: '.clock-console',
      title: 'The clocks',
      body: 'Start and stop the game clock and shot clock here, or set an exact time. Resetting the shot clock leaves it running, so play is never held up.',
      placement: 'left',
    },
    {
      anchor: '.clock-console__period',
      title: 'Period and possession',
      body: 'The +/− pair nudges the period if it goes wrong. Use "Start next period" for a real period change — it resets fouls and both clocks properly.',
      placement: 'left',
    },
    {
      anchor: '[data-tour="game-actions"] .card',
      title: 'Ending the game',
      body: '"Finish match" saves the result to History with its full box score. "New game" clears the board without keeping a record — use it for a false start.',
      placement: 'left',
    },
    {
      anchor: '[data-tour="shortcuts"]',
      title: 'Keyboard shortcuts',
      body: 'Every common action has a key, and they are the fastest way to score courtside. "Customise shortcuts" remaps any of them to whatever your fingers already know — saved in this browser, for you.',
      placement: 'left',
    },
    helpStep,
  ],
};

export const SCHEDULE_TOUR: TourDefinition = {
  id: 'schedule',
  title: 'Schedule',
  steps: [
    {
      title: 'Planning matches',
      body: 'Set fixtures up in advance so a game can be started the moment a court frees up.',
    },
    {
      anchor: '.page-head__actions',
      title: 'Add a fixture',
      body: 'Give it two team names and a time. You do not have to pick a court yet — that happens when you start it.',
      placement: 'bottom',
    },
    {
      anchor: '.card--flush .table, .empty',
      title: 'Starting one',
      body: 'Press Start on a fixture and choose a free court. The team names load onto that board automatically, and the fixture is marked completed once the game is finished.',
      placement: 'top',
    },
    helpStep,
  ],
};

export const HISTORY_TOUR: TourDefinition = {
  id: 'history',
  title: 'Match history',
  steps: [
    {
      title: 'Every finished game',
      body: 'Anything finished from a control panel lands here, with the result worked out from what actually happened on the board.',
    },
    {
      anchor: '.match-card',
      title: 'The result at a glance',
      body: 'Each card shows the final score with the winner highlighted. The row above gives the date, the court, and how long the game ran.',
      placement: 'bottom',
    },
    {
      anchor: '.match-card__toggle',
      title: 'Box score and play-by-play',
      body: 'Open a match for its quarter-by-quarter scoring and a timeline of every basket, foul and timeout — home on the left, away on the right.',
      placement: 'left',
    },
    helpStep,
  ],
};

export const SETTINGS_TOUR: TourDefinition = {
  id: 'settings',
  title: 'Board settings',
  steps: [
    {
      title: 'Board settings',
      body: 'The rules this board plays by, plus the links that put it on a screen.',
    },
    {
      anchor: '[data-tour="rules"]',
      title: 'Match rules',
      body: 'Period length, shot clock, timeouts per half and the bonus threshold. Most take effect on the next new game; the shot clock and display options apply immediately.',
      placement: 'top',
    },
    {
      anchor: '[data-tour="viewer-links"]',
      title: 'Display links',
      body: 'The mirror link goes on a venue screen; the overlay link goes into OBS as a Browser Source. Both are read-only, and rotating the key kills the old ones instantly.',
      placement: 'top',
    },
    helpStep,
  ],
};

const TOURS: TourDefinition[] = [
  DASHBOARD_TOUR,
  CONTROL_TOUR,
  SCHEDULE_TOUR,
  HISTORY_TOUR,
  SETTINGS_TOUR,
];

/**
 * The tour for a route, or null where there is nothing worth explaining.
 *
 * Matched on the path rather than wired into the route table so that the router
 * and the tour stay independent — a page can be moved or renamed without the
 * tour needing to be re-registered, and an unrecognised path simply has no tour
 * rather than breaking the page.
 */
export function tourForPath(pathname: string): TourDefinition | null {
  if (pathname === '/app') return DASHBOARD_TOUR;
  if (pathname.startsWith('/app/schedule')) return SCHEDULE_TOUR;
  if (pathname.startsWith('/app/history')) return HISTORY_TOUR;
  if (pathname.startsWith('/app/boards/')) return SETTINGS_TOUR;
  if (pathname.startsWith('/control/')) return CONTROL_TOUR;
  return null;
}

export function tourById(id: string): TourDefinition | null {
  return TOURS.find((tour) => tour.id === id) ?? null;
}
