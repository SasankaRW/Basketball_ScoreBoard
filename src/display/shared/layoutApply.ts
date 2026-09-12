/**
 * Paints a `BoardLayout` onto the scoreboard markup.
 *
 * The hard requirement this is built around: **the markup does not change.**
 * `tests/unit/markup.test.ts` asserts the scoreboard and the mirror ship a
 * byte-identical `.scoreboard` block, and `tests/e2e/visual.spec.ts` asserts the
 * rendered result has not drifted a pixel. So a custom layout is expressed
 * entirely as a class on `.scoreboard` plus CSS custom properties on elements
 * that already exist — no nodes inserted, none moved, none removed.
 *
 * Which means the "off" path is genuinely off. `applyLayout(root, null)` strips
 * the class and the properties and leaves the DOM exactly as the HTML file
 * declares it, so a board nobody has customised renders from the stock
 * stylesheet with nothing of this module's doing in the way.
 *
 * How the positioning works, since it is not obvious from the property names:
 * `.scoreboard.sb-custom` becomes a **size container**, so `1cqw`/`1cqh` inside
 * it mean one percent of the board. Every section is then absolutely positioned
 * at `calc(var(--sb-x) * 1cqw)` and so on, with the stored numbers left
 * unitless. That is what makes one layout correct on a 4K gym screen and in a
 * 300px editor preview at once, with no JavaScript involved in the scaling and
 * nothing to recompute on resize.
 */
import {
  SECTIONS,
  sectionDefinition,
  type BoardLayout,
  type SectionId,
} from '../../core/boardLayout.js';

export type SectionRoot = Document | HTMLElement;

/** Marks the element as one the layout positions. */
const ITEM_CLASS = 'sb-item';
/** Marks a section whose own caption is switched off. */
const NO_LABEL_CLASS = 'sb-no-label';
/** Set on `.scoreboard` for as long as a custom layout is in force. */
const CUSTOM_CLASS = 'sb-custom';

const CUSTOM_PROPERTIES = ['--sb-x', '--sb-y', '--sb-w', '--sb-h', '--sb-s'] as const;

/**
 * Where each section lives in the existing markup.
 *
 * Two of them are found by walking up from an element with an ID rather than by
 * a positional selector: `.clock-container` appears twice with nothing to tell
 * the two apart but their contents, and `:nth-of-type` would silently pick the
 * wrong one the day someone adds a third clock.
 */
function locate(root: SectionRoot, id: SectionId): HTMLElement | null {
  const query = (selector: string) => root.querySelector<HTMLElement>(selector);
  const byId = (elementId: string) =>
    root instanceof Document
      ? root.getElementById(elementId)
      : root.querySelector<HTMLElement>(`#${elementId}`);

  switch (id) {
    case 'home-name':
      return query('.team.home .team-name');
    case 'home-score':
      return query('.team.home .score');
    case 'home-fouls':
      return query('.team.home .stat-line.foul');
    case 'home-timeouts':
      return query('.team.home .stat-line.timeout');
    case 'away-name':
      return query('.team.away .team-name');
    case 'away-score':
      return query('.team.away .score');
    case 'away-fouls':
      return query('.team.away .stat-line.foul');
    case 'away-timeouts':
      return query('.team.away .stat-line.timeout');
    case 'game-clock':
      return byId('game-clock')?.closest<HTMLElement>('.clock-container') ?? null;
    case 'shot-clock':
      return byId('shot-clock')?.closest<HTMLElement>('.clock-container') ?? null;
    case 'period':
      return byId('quarter-display');
    case 'logo':
      return byId('board-logo');
    case 'hint':
      return byId('controls-info');
    default:
      return null;
  }
}

export function findSectionElement(root: SectionRoot, id: SectionId): HTMLElement | null {
  return locate(root, id);
}

export function findBoardElement(root: SectionRoot = document): HTMLElement | null {
  return root.querySelector<HTMLElement>('.scoreboard');
}

/**
 * Puts a layout on screen, or takes one off.
 *
 * Safe to call on every snapshot: it writes only what differs, so a board whose
 * layout has not changed costs a handful of string comparisons rather than a
 * relayout. That matters because the mirror calls this from the same subscribe
 * callback that the live state arrives on.
 */
export function applyLayout(root: SectionRoot, layout: BoardLayout | null): void {
  const board = findBoardElement(root);
  if (!board) return;

  if (!layout) {
    clearLayout(root);
    return;
  }

  if (!board.classList.contains(CUSTOM_CLASS)) board.classList.add(CUSTOM_CLASS);

  for (const section of SECTIONS) {
    const element = locate(root, section.id);
    if (!element) continue;

    const box = layout.sections[section.id];
    element.classList.add(ITEM_CLASS);

    setProperty(element, '--sb-x', box.x);
    setProperty(element, '--sb-y', box.y);
    setProperty(element, '--sb-w', box.w);
    setProperty(element, '--sb-h', box.h);
    setProperty(element, '--sb-s', box.scale);

    // `hidden` rather than a class, so a removed section is removed from the
    // accessibility tree too — a screen reader on the mirror should not read out
    // a timeout count nobody can see.
    if (element.hidden !== !box.visible) element.hidden = !box.visible;

    const suppressLabel = section.hasLabel && !box.showLabel;
    element.classList.toggle(NO_LABEL_CLASS, suppressLabel);
  }
}

/** Returns the markup to the arrangement the stylesheet gives it. */
export function clearLayout(root: SectionRoot = document): void {
  const board = findBoardElement(root);
  board?.classList.remove(CUSTOM_CLASS);

  for (const section of SECTIONS) {
    const element = locate(root, section.id);
    if (!element) continue;
    element.classList.remove(ITEM_CLASS, NO_LABEL_CLASS);
    for (const property of CUSTOM_PROPERTIES) element.style.removeProperty(property);

    // The logo is the one section the renderer itself hides, whenever a board
    // has no tournament image. Restoring `hidden = false` here would show a
    // src-less `<img>`; `scoreboardView.setLogo` owns that flag and gets it
    // back untouched.
    if (section.id !== 'logo') element.hidden = false;
  }
}

function setProperty(element: HTMLElement, name: string, value: number): void {
  const next = String(value);
  if (element.style.getPropertyValue(name) !== next) element.style.setProperty(name, next);
}

/**
 * Measures the stock arrangement, in the same percentages a layout stores.
 *
 * This is what gives the editor an honest starting point: rather than opening on
 * a hand-authored approximation of the scoreboard, it opens on the board's
 * actual geometry, read off a real render at whatever size the preview happens
 * to be. Percentages make that reading size-independent, so measuring a small
 * preview yields a layout correct on the wall.
 *
 * Sections the renderer has hidden (a board with no logo) are reported as
 * invisible rather than omitted, so the editor can offer them in its "add"
 * tray with a sensible box already worked out.
 */
export function measureSections(
  root: SectionRoot = document,
): Partial<Record<SectionId, { x: number; y: number; w: number; h: number; visible: boolean }>> {
  const board = findBoardElement(root);
  if (!board) return {};

  const bounds = board.getBoundingClientRect();
  if (bounds.width === 0 || bounds.height === 0) return {};

  const measured: Partial<
    Record<SectionId, { x: number; y: number; w: number; h: number; visible: boolean }>
  > = {};

  for (const section of SECTIONS) {
    const element = locate(root, section.id);
    if (!element) continue;

    const rect = element.getBoundingClientRect();
    const visible = rect.width > 0 && rect.height > 0 && !element.hidden;

    // A hidden section has no box to measure, so it keeps its catalog default —
    // which is a deliberate arrangement rather than a zero-sized one at the
    // board's top-left corner.
    if (!visible) {
      const fallback = sectionDefinition(section.id).defaultBox;
      measured[section.id] = {
        x: fallback.x,
        y: fallback.y,
        w: fallback.w,
        h: fallback.h,
        visible: false,
      };
      continue;
    }

    measured[section.id] = {
      x: ((rect.left - bounds.left) / bounds.width) * 100,
      y: ((rect.top - bounds.top) / bounds.height) * 100,
      w: (rect.width / bounds.width) * 100,
      h: (rect.height / bounds.height) * 100,
      visible: true,
    };
  }

  return measured;
}
