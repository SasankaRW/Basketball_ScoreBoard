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
  body: 'Boards is your home and where each game gets run. Schedule plans matches before they start, and History keeps every finished one, box score and all — once a game is finished it moves itself there automatically.',
  placement: 'bottom',
};

export const DASHBOARD_TOUR: TourDefinition = {
  id: 'dashboard',
  title: 'Boards',
  steps: [
    {
      title: 'Welcome to your scoreboard console',
      body: 'A two-minute look at the whole flow: set up a board, run a game from its control panel, and find the result in History afterwards. Leave any time and pick it back up from the Help button.',
    },
    navStep,
    {
      anchor: '.board-grid .board-card, .empty',
      title: 'One board per court',
      body: 'Each card is a live miniature of the real scoreboard — score and clock update as the game happens, with a Live badge while the clock is running. Every board gets its own control panel, a mirror display for a venue screen, and an OBS overlay for streaming.',
      placement: 'top',
    },
    {
      anchor: '.board-card__row .btn--primary',
      title: 'Open the control panel',
      body: 'This is where a game is actually run — score, clocks, fouls and timeouts. Two people can have it open at once and neither will overwrite the other. "Scoreboard" opens the same board full-screen for anyone signed in here; "Share links" gets you the mirror and overlay URLs for people who are not.',
      placement: 'top',
    },
    {
      anchor: '.page-head__actions',
      title: 'Add another court',
      body: 'Set the period length, shot clock and timeouts once when you create a board — its own copy of those rules can be changed later from its Settings page without affecting any other board. Done with a court for the day? Archive its board rather than deleting it: its match history stays intact, and "Show archived" brings it back into view.',
      placement: 'bottom',
    },
    {
      anchor: '[data-tour="members"]',
      title: 'Who can do what',
      body: 'Invite someone by email and give them a role: operators run games, admins also manage boards and members, viewers can only watch. The invite link only works for that address, and expires after seven days if it goes unused.',
      placement: 'top',
    },
    {
      anchor: '[data-tour="audit"]',
      title: 'What happened, and when',
      body: 'A running log of every match started or finished across all your boards — useful for confirming a court actually started on time, or catching a game that was finished by mistake.',
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
      body: 'Everything on this page writes straight to the live scoreboard — there is no save button and no lag. "Open scoreboard", top right, shows you exactly what the venue screen or mirror is showing right now.',
    },
    {
      anchor: '.control-board .team-panel',
      title: 'Score, fouls and timeouts',
      body: 'The +1 / +2 / +3 buttons add a basket, and "Correct −1" fixes a miscount without it looking like a scored basket in the play-by-play. Fouls and timeouts sit below; a team goes into the bonus automatically once its fouls reach the threshold set in Settings, and timeouts refill on their own at half time.',
      placement: 'right',
    },
    {
      anchor: '.clock-console',
      title: 'The clocks',
      body: 'Start and stop the game clock and shot clock here, or set an exact time. Resetting the shot clock leaves it running if it already was, so a rebound or a shot off the rim never has to interrupt play — use the full reset after a made basket or a shooting foul, and the shorter one after an offensive rebound.',
      placement: 'left',
    },
    {
      anchor: '.clock-console__period',
      title: 'Period and possession',
      body: 'The +/− pair only nudges the period counter — use "Start next period" below for a real period change, since that also resets fouls and both clocks. The possession buttons set which team the arrow points to, for whenever a jump ball or an out-of-bounds call needs a manual call.',
      placement: 'left',
    },
    {
      anchor: '[data-tour="game-actions"] .card',
      title: 'Ending the game',
      body: '"Finish match" saves the result to History with its full box score and resets the board for the next game. "New game" also clears the board but keeps no record at all — use it to throw away a false start, not to end a real one.',
      placement: 'left',
    },
    {
      anchor: '[data-tour="clock-screens"]',
      title: 'Clock-only screens',
      body: 'Two more read-only links, alongside the mirror and overlay: one shows nothing but the game clock, the other nothing but the shot clock — handy for a shot-clock pole or a second monitor with room for only one number.',
      placement: 'left',
    },
    {
      anchor: '[data-tour="shortcuts"]',
      title: 'Keyboard shortcuts',
      body: 'Every common action has a key, and they are the fastest way to score courtside. Open this to see them all, then "Customise shortcuts" remaps any of them to whatever your fingers already know — saved in this browser, for you, so it follows you between boards but not to a different computer.',
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
      body: 'Set fixtures up in advance so a game can be started the moment a court frees up, instead of setting team names by hand at the table.',
    },
    {
      anchor: '.page-head__actions',
      title: 'Add a fixture',
      body: 'Give it two team names and a time. You do not have to pick a court yet — that happens when you start it, and the fixture can still be edited or cancelled from its row right up until then.',
      placement: 'bottom',
    },
    {
      anchor: '.card--flush .table, .empty',
      title: 'Starting one',
      body: 'Press Start and pick from your boards — each one shows Idle or In progress from its actual live state, and only an idle board can be selected, so you cannot start over a game that is still running. The two team names load onto that board automatically, and the fixture is marked completed the moment the game is finished from the control panel.',
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
      body: 'Pressing "Finish match" on a control panel is what lands a game here — never a manual save. The result is worked out from what actually happened on the board, not just typed in afterwards, so it is always the real final score.',
    },
    {
      anchor: '.match-card',
      title: 'The result at a glance',
      body: 'Each card shows the final score with the winner highlighted. The row above gives the date, which court it was played on, and how long the game ran from tip-off to the final whistle.',
      placement: 'bottom',
    },
    {
      anchor: '.match-card__toggle',
      title: 'Box score and play-by-play',
      body: 'Open a match for its period-by-period scoring and a full timeline of every basket, foul and timeout — home on the left, away on the right, in the order they actually happened during the game.',
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
      body: 'The rules this one board plays by, the links that put it on a screen, and the two ways to retire it when you are done.',
    },
    {
      anchor: '[data-tour="rules"]',
      title: 'Match rules',
      body: 'Period length, shot clock length, the shorter reset used for an offensive rebound, timeouts per half and the foul count that puts a team in the bonus. "Save settings" pushes these straight to the live board, but most only take hold from the next clock reset or new game — a shot clock already counting down keeps doing so on the old length. The one true exception is the clock display option, which changes how the time on screen is drawn and so takes effect the instant you save.',
      placement: 'top',
    },
    {
      anchor: '[data-tour="viewer-links"]',
      title: 'Display links',
      body: 'The mirror link goes on a venue screen or a second monitor; the overlay link goes into OBS as a Browser Source; the game-clock and shot-clock links each show one number full-screen. All four are read-only and need no sign-in — rotating a key kills every link built from it instantly, which is also how you recover from one that leaked.',
      placement: 'top',
    },
    {
      anchor: '[data-tour="danger-zone"]',
      title: 'Archive or delete',
      body: 'Archiving is the reversible one — it hides the board from the dashboard and stops its links working, but every match it ever finished stays in History exactly as it is. Deleting is not: it permanently destroys the board and whatever game is on it right now, so reach for Archive first and keep Delete for a board you are certain you will never need again.',
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
