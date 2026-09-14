/**
 * Renders board state into the original scoreboard markup.
 *
 * Shared by the operator scoreboard and the mirror so the two cannot drift.
 * Every rule here is a faithful port of `updateDisplay()` from the old
 * script.js — two-digit score padding, `Q{n}` for the period, the bonus class at
 * five team fouls, and the possession arrow's glyphs and sides.
 *
 * Two deliberate departures from the original, neither of them visible:
 *
 *   The old code destroyed and recreated both `.possession-arrow` divs on every
 *   update. They are absolutely positioned inside `.team-name`, which is why
 *   they had to be re-appended after the name changed; setting `nodeValue` on
 *   the text node instead leaves them alone entirely, so the CSS pulse animation
 *   no longer restarts on every render.
 *
 *   Writes are diffed against what is already on screen. At the timer rates a
 *   clock display needs, blindly reassigning `textContent` would dirty layout
 *   many times a second for no reason.
 */
import {
  formatGameClock,
  formatShotClock,
  msUntilDisplayChange,
  remainingAt,
} from '../../core/clock.js';
import { isInBonus, type BoardState, type Side } from '../../core/schema.js';

export interface ScoreboardElements {
  homeScore: HTMLElement | null;
  awayScore: HTMLElement | null;
  homeFouls: HTMLElement | null;
  awayFouls: HTMLElement | null;
  homeTimeouts: HTMLElement | null;
  awayTimeouts: HTMLElement | null;
  homeTeamName: HTMLElement | null;
  awayTeamName: HTMLElement | null;
  homeArrow: HTMLElement | null;
  awayArrow: HTMLElement | null;
  homeFoulLine: HTMLElement | null;
  awayFoulLine: HTMLElement | null;
  gameClock: HTMLElement | null;
  shotClock: HTMLElement | null;
  quarter: HTMLElement | null;
  controlsInfo: HTMLElement | null;
  logo: HTMLImageElement | null;
  /** The full-screen "TIMEOUT" takeover — see `state.timeoutClock`. */
  timeoutOverlay: HTMLElement | null;
  timeoutClock: HTMLElement | null;
  timeoutHomeName: HTMLElement | null;
  timeoutHomeScore: HTMLElement | null;
  timeoutAwayName: HTMLElement | null;
  timeoutAwayScore: HTMLElement | null;
}

export function queryScoreboardElements(
  root: Document | HTMLElement = document,
): ScoreboardElements {
  const byId = (id: string) =>
    root instanceof Document ? root.getElementById(id) : root.querySelector<HTMLElement>(`#${id}`);

  return {
    homeScore: byId('home-score'),
    awayScore: byId('away-score'),
    homeFouls: byId('home-fouls'),
    awayFouls: byId('away-fouls'),
    homeTimeouts: byId('home-timeouts'),
    awayTimeouts: byId('away-timeouts'),
    homeTeamName: byId('home-team-name'),
    awayTeamName: byId('away-team-name'),
    homeArrow: byId('home-possession-arrow'),
    awayArrow: byId('away-possession-arrow'),
    homeFoulLine: root.querySelector<HTMLElement>('.team.home .stat-line.foul'),
    awayFoulLine: root.querySelector<HTMLElement>('.team.away .stat-line.foul'),
    gameClock: byId('game-clock'),
    shotClock: byId('shot-clock'),
    quarter: byId('quarter-display'),
    controlsInfo: byId('controls-info'),
    logo: byId('board-logo') as HTMLImageElement | null,
    timeoutOverlay: byId('timeout-overlay'),
    timeoutClock: byId('timeout-clock'),
    timeoutHomeName: byId('timeout-home-name'),
    timeoutHomeScore: byId('timeout-home-score'),
    timeoutAwayName: byId('timeout-away-name'),
    timeoutAwayScore: byId('timeout-away-score'),
  };
}

function setText(element: HTMLElement | null, value: string): void {
  if (element && element.textContent !== value) element.textContent = value;
}

function setClass(element: HTMLElement | null, className: string, present: boolean): void {
  if (!element) return;
  if (element.classList.contains(className) !== present)
    element.classList.toggle(className, present);
}

/**
 * Updates the team name without disturbing the `.possession-arrow` child that
 * shares the element.
 */
function setTeamName(element: HTMLElement | null, name: string): void {
  if (!element) return;
  const first = element.firstChild;
  if (first && first.nodeType === Node.TEXT_NODE) {
    if (first.nodeValue !== name) first.nodeValue = name;
  } else {
    element.insertBefore(document.createTextNode(name), element.firstChild);
  }
}

/**
 * The glyphs and sides the original used: home shows `◀` on its right edge,
 * away shows `▶` on its left, so both point in toward the centre console.
 */
const ARROW_GLYPH: Record<Side, string> = { home: '◀', away: '▶' };

function setArrow(element: HTMLElement | null, side: Side, active: boolean): void {
  if (!element) return;
  // The inactive arrow is blanked rather than hidden: its CSS pulse animation
  // overrides `opacity: 0`, so an empty node is what actually keeps it invisible.
  setText(element, active ? ARROW_GLYPH[side] : '');
  setClass(element, 'active', active);
}

/** No logo uploaded for this board shows nothing, not a fallback image. */
function setLogo(element: HTMLImageElement | null, url: string | null): void {
  if (!element) return;
  if (url === null) {
    element.hidden = true;
    if (element.getAttribute('src')) element.removeAttribute('src');
    return;
  }
  if (element.src !== url) element.src = url;
  element.hidden = false;
}

export interface RenderOptions {
  /** Server-corrected time. Never `Date.now()`. */
  now: number;
}

/**
 * Paints one frame.
 *
 * Returns the number of milliseconds until the rendered text would next change,
 * so the caller can sleep exactly that long instead of polling.
 */
export function renderScoreboard(
  elements: ScoreboardElements,
  state: BoardState,
  { now }: RenderOptions,
): number {
  const showTenths = state.config.showTenthsUnderOneMinute;

  setText(elements.homeScore, String(state.home.score).padStart(2, '0'));
  setText(elements.awayScore, String(state.away.score).padStart(2, '0'));
  setText(elements.homeFouls, String(state.home.fouls));
  setText(elements.awayFouls, String(state.away.fouls));
  setText(elements.homeTimeouts, String(state.home.timeouts));
  setText(elements.awayTimeouts, String(state.away.timeouts));
  setText(elements.quarter, `Q${state.period}`);

  setTeamName(elements.homeTeamName, state.home.name);
  setTeamName(elements.awayTeamName, state.away.name);

  setArrow(elements.homeArrow, 'home', state.possession === 'home');
  setArrow(elements.awayArrow, 'away', state.possession === 'away');

  setClass(elements.homeFoulLine, 'bonus', isInBonus(state, 'home'));
  setClass(elements.awayFoulLine, 'bonus', isInBonus(state, 'away'));

  setLogo(elements.logo, state.logoUrl);

  const gameRemaining = remainingAt(state.gameClock, now);
  const shotRemaining = remainingAt(state.shotClock, now);
  const timeoutRemaining = remainingAt(state.timeoutClock, now);

  setText(elements.gameClock, formatGameClock(gameRemaining, showTenths));
  setText(elements.shotClock, formatShotClock(shotRemaining, showTenths));

  /**
   * The full-screen takeover, on for as long as `state.timeoutClock` says a
   * timeout is running *and* its own minute has not already run out —
   * `remainingAt` alone is what makes this self-clearing: nothing has to
   * write the board back to "no timeout" for every viewer to agree it is
   * over, the same reason `gameClock`/`shotClock` need no such write either.
   * Team names and scores are duplicated in here rather than left for the
   * board underneath to show through, because the whole point of this screen
   * is to be readable from the stands without the smaller, busier layout
   * behind it competing for attention.
   */
  const timeoutActive = state.timeoutClock.running && timeoutRemaining > 0;
  if (elements.timeoutOverlay) elements.timeoutOverlay.hidden = !timeoutActive;
  if (timeoutActive) {
    setText(elements.timeoutClock, formatGameClock(timeoutRemaining, false));
    setTeamName(elements.timeoutHomeName, state.home.name);
    setTeamName(elements.timeoutAwayName, state.away.name);
    setText(elements.timeoutHomeScore, String(state.home.score).padStart(2, '0'));
    setText(elements.timeoutAwayScore, String(state.away.score).padStart(2, '0'));
  }

  // Wake only for whichever clock changes first, and never sleep so long that a
  // freshly started clock looks frozen.
  return Math.min(
    state.gameClock.running ? msUntilDisplayChange(gameRemaining, showTenths) : 1_000,
    state.shotClock.running ? msUntilDisplayChange(shotRemaining, showTenths) : 1_000,
    timeoutActive ? msUntilDisplayChange(timeoutRemaining, false) : 1_000,
  );
}

/** Renders the blank board shown before the first snapshot arrives. */
export function renderPlaceholder(elements: ScoreboardElements, message: string): void {
  setText(elements.controlsInfo, message);
}
