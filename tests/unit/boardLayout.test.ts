/**
 * The layout model's rules, pinned without a browser.
 *
 * Everything the editor feels like — a box that catches the guide next to it, a
 * corner drag that does not drag the whole section along with it, a saved
 * arrangement that survives a round trip through a database that strips things —
 * is decided by pure functions in `core/boardLayout.ts`. Testing them here means
 * a regression shows up in milliseconds rather than as "the dragging feels
 * wrong" three screens into a Playwright run.
 *
 * The first test is the one that matters most: a board with no layout document
 * must stay a board with no layout document, because that is what keeps the
 * pixel-locked scoreboard pixel-locked.
 */
import { describe, expect, it } from 'vitest';
import {
  LAYOUT_LIMITS,
  MOVE_ANCHORS,
  SECTIONS,
  SECTION_IDS,
  clampBox,
  defaultLayout,
  isDefaultLayout,
  layoutsEqual,
  parseBoardLayout,
  resizeBox,
  sectionDefinition,
  snapBox,
  withSection,
  type SectionBox,
} from '../../src/core/boardLayout.js';

const box = (patch: Partial<SectionBox> = {}): SectionBox => ({
  x: 10,
  y: 10,
  w: 20,
  h: 20,
  scale: 1,
  visible: true,
  showLabel: true,
  ...patch,
});

describe('absence of a layout', () => {
  /**
   * `null` is the stock scoreboard, and nothing may quietly turn it into an
   * arrangement. Every display surface reads this answer as "leave the
   * stylesheet alone", so a parser that invented a layout here would rearrange
   * every board that has never been touched.
   */
  it.each([
    ['null', null],
    ['undefined', undefined],
    ['a string', 'nope'],
    ['a number', 7],
    ['an object with no sections', { version: 1 }],
  ])('parses %s as no layout at all', (_name, raw) => {
    expect(parseBoardLayout(raw)).toBeNull();
  });

  it('refuses a document written by a version it does not understand', () => {
    expect(parseBoardLayout({ version: 2, sections: {} })).toBeNull();
  });
});

describe('parsing a stored layout', () => {
  it('round-trips a layout it wrote', () => {
    const layout = withSection(defaultLayout(), 'home-score', { x: 12.5, w: 33 });
    expect(layoutsEqual(parseBoardLayout(layout), layout)).toBe(true);
  });

  it('fills a section the document has never heard of from the catalog', () => {
    const partial = { version: 1, sections: { 'home-score': { x: 5, y: 5, w: 10, h: 10 } } };
    const parsed = parseBoardLayout(partial);

    expect(parsed).not.toBeNull();
    expect(parsed?.sections['home-score'].x).toBe(5);
    // Everything else is the default box, not a hole and not a zero.
    expect(parsed?.sections['away-score']).toEqual(sectionDefinition('away-score').defaultBox);
  });

  /**
   * The Realtime Database drops a child whose value is `null`, so a flag that
   * was never written comes back absent. Reading absent as `false` would take
   * the captions off a layout — and, worse, hide sections — the first time it
   * went through the database.
   */
  it('reads a missing flag as the default rather than as off', () => {
    const parsed = parseBoardLayout({
      version: 1,
      sections: { 'home-fouls': { x: 1, y: 2, w: 3, h: 4 } },
    });

    expect(parsed?.sections['home-fouls'].visible).toBe(true);
    expect(parsed?.sections['home-fouls'].showLabel).toBe(true);
    expect(parsed?.sections['home-fouls'].scale).toBe(1);
  });

  it('keeps a flag that was explicitly written false', () => {
    const parsed = parseBoardLayout({
      version: 1,
      sections: { 'home-fouls': { x: 1, y: 2, w: 3, h: 4, visible: false, showLabel: false } },
    });

    expect(parsed?.sections['home-fouls'].visible).toBe(false);
    expect(parsed?.sections['home-fouls'].showLabel).toBe(false);
  });

  it('repairs a section carrying nonsense instead of throwing', () => {
    const parsed = parseBoardLayout({
      version: 1,
      sections: { 'home-score': { x: 'left', y: Number.NaN, w: Infinity, h: 20 } },
    });

    const fallback = sectionDefinition('home-score').defaultBox;
    expect(parsed?.sections['home-score'].x).toBe(fallback.x);
    expect(parsed?.sections['home-score'].y).toBe(fallback.y);
    expect(parsed?.sections['home-score'].h).toBe(20);
  });
});

describe('the default layout', () => {
  it('covers every section in the catalog', () => {
    const layout = defaultLayout();
    expect(Object.keys(layout.sections).sort()).toEqual([...SECTION_IDS].sort());
  });

  it('recognises itself', () => {
    expect(isDefaultLayout(defaultLayout())).toBe(true);
    expect(isDefaultLayout(withSection(defaultLayout(), 'period', { x: 1 }))).toBe(false);
  });

  /**
   * Sections stacked on top of each other would open the editor on a pile,
   * which is not a starting point anyone can work from. Overlap is perfectly
   * legal in a layout an operator has built — this only pins what ships.
   */
  it('places every visible section without overlapping another', () => {
    const boxes = SECTIONS.map((section) => ({ id: section.id, ...section.defaultBox })).filter(
      (entry) => entry.visible,
    );

    for (let i = 0; i < boxes.length; i += 1) {
      for (let j = i + 1; j < boxes.length; j += 1) {
        const a = boxes[i]!;
        const b = boxes[j]!;
        const apart = a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y;
        expect(apart, `${a.id} overlaps ${b.id}`).toBe(true);
      }
    }
  });

  it('keeps every default section on the board', () => {
    for (const section of SECTIONS) {
      const { x, y, w, h } = section.defaultBox;
      expect(x).toBeGreaterThanOrEqual(0);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(x + w).toBeLessThanOrEqual(100);
      expect(y + h).toBeLessThanOrEqual(100);
    }
  });
});

describe('clamping', () => {
  it('holds every number inside the bounds the rules mirror', () => {
    const clamped = clampBox(box({ x: -9_999, y: 9_999, w: 0, h: 1e9, scale: 50 }));

    expect(clamped.x).toBe(LAYOUT_LIMITS.position.min);
    expect(clamped.y).toBe(LAYOUT_LIMITS.position.max);
    expect(clamped.w).toBe(LAYOUT_LIMITS.size.min);
    expect(clamped.h).toBe(LAYOUT_LIMITS.size.max);
    expect(clamped.scale).toBe(LAYOUT_LIMITS.scale.max);
  });

  it('rounds to two decimals, so a drag cannot write a long float', () => {
    expect(clampBox(box({ x: 12.345_678 })).x).toBe(12.35);
  });
});

describe('snapping', () => {
  const target = box({ x: 40, y: 40, w: 20, h: 20 });

  it('pulls a near-aligned edge onto its neighbour', () => {
    const moving = box({ x: 40.4, y: 5, w: 10, h: 10 });
    const result = snapBox(moving, [target], { tolerance: 0.8 });

    expect(result.box.x).toBe(40);
    expect(result.guides).toContainEqual(expect.objectContaining({ axis: 'x', at: 40 }));
  });

  it('leaves a box that is not close to anything exactly where it is', () => {
    const moving = box({ x: 12.5, y: 71.25, w: 10, h: 10 });
    const result = snapBox(moving, [target], { tolerance: 0.8 });

    expect(result.box.x).toBe(12.5);
    expect(result.box.y).toBe(71.25);
    expect(result.guides).toEqual([]);
  });

  it('aligns centres, not only edges', () => {
    // The target's centre is at 50; this box's centre is at 49.6.
    const moving = box({ x: 44.6, y: 5, w: 10, h: 10 });
    const result = snapBox(moving, [target], { tolerance: 0.8 });

    expect(result.box.x).toBe(45);
  });

  it('snaps to the board itself, so a section can be centred with nothing near it', () => {
    const moving = box({ x: 44.7, y: 5, w: 10, h: 10 });
    const result = snapBox(moving, [], { tolerance: 0.8 });

    expect(result.box.x).toBe(45);
    expect(result.guides).toContainEqual(expect.objectContaining({ axis: 'x', at: 50 }));
  });

  it('ignores a section that has been removed from the board', () => {
    const hidden = box({ x: 40, y: 40, w: 20, h: 20, visible: false });
    // Width 8, so this box's own three lines land at 40.4, 44.4 and 48.4 —
    // none of them within tolerance of the board's 0, 50 or 100. The hidden
    // section's left edge at 40 is the only thing in reach, and it does not count.
    const moving = box({ x: 40.4, y: 5, w: 8, h: 8 });

    expect(snapBox(moving, [hidden], { tolerance: 0.8 }).box.x).toBe(40.4);
  });

  /**
   * Alignment is a relationship someone means; the grid is only tidiness. A
   * grid that could override a guide would make it impossible to line two
   * sections up on any coordinate the grid does not happen to land on.
   */
  it('prefers an alignment to the grid', () => {
    const moving = box({ x: 40.4, y: 5, w: 10, h: 10 });
    const result = snapBox(moving, [target], { tolerance: 0.8, grid: 5 });

    expect(result.box.x).toBe(40);
  });

  it('falls back to the grid where nothing aligns', () => {
    const result = snapBox(box({ x: 12.4, y: 71.4, w: 10, h: 10 }), [], {
      tolerance: 0.2,
      grid: 5,
    });

    expect(result.box.x).toBe(10);
    expect(result.box.y).toBe(70);
    expect(result.guides).toEqual([]);
  });

  it('draws a guide long enough to reach both boxes it relates', () => {
    const moving = box({ x: 40.4, y: 5, w: 10, h: 10 });
    const [guide] = snapBox(moving, [target], { tolerance: 0.8 }).guides;

    // The moving box spans 5–15 and the target 40–60; the line has to cover both.
    expect(guide?.from).toBeLessThanOrEqual(5);
    expect(guide?.to).toBeGreaterThanOrEqual(60);
  });

  it('never resizes what it snaps', () => {
    const moving = box({ x: 40.4, y: 39.7, w: 13, h: 17 });
    const result = snapBox(moving, [target], { tolerance: 0.8, anchors: MOVE_ANCHORS });

    expect(result.box.w).toBe(13);
    expect(result.box.h).toBe(17);
  });

  it('only snaps the edges it was told are live', () => {
    // The east handle is being dragged, so the west edge must not catch a line
    // even though it is sitting right on one.
    const moving = box({ x: 40, y: 5, w: 10.4, h: 10 });
    const result = snapBox(moving, [target], {
      tolerance: 0.8,
      anchors: { x: ['end'], y: [] },
    });

    expect(result.box.y).toBe(5);
  });
});

describe('resizing', () => {
  const origin = box({ x: 20, y: 20, w: 20, h: 20 });

  it('holds the opposite edge still when dragging east', () => {
    const resized = resizeBox(origin, 'e', 5, 0);
    expect(resized.x).toBe(20);
    expect(resized.w).toBe(25);
  });

  it('moves the origin when dragging west', () => {
    const resized = resizeBox(origin, 'w', 5, 0);
    expect(resized.x).toBe(25);
    expect(resized.w).toBe(15);
    // The right edge is where it was.
    expect(resized.x + resized.w).toBe(40);
  });

  it('holds both anchored edges when dragging a corner', () => {
    const resized = resizeBox(origin, 'se', 6, 8);
    expect(resized.x).toBe(20);
    expect(resized.y).toBe(20);
    expect(resized.w).toBe(26);
    expect(resized.h).toBe(28);
  });

  /**
   * Dragging a handle straight past its opposite edge is easy to do by accident
   * with a large box and a small preview. Stopping at the minimum is recoverable;
   * a box turned inside out is not.
   */
  it('stops at the minimum size instead of inverting the box', () => {
    const resized = resizeBox(origin, 'w', 999, 999);
    expect(resized.w).toBe(LAYOUT_LIMITS.size.min);
    expect(resized.h).toBe(origin.h);
    expect(resized.x + resized.w).toBe(40);
  });

  it('leaves the axis it was not dragged on alone', () => {
    const resized = resizeBox(origin, 'e', 5, 9);
    expect(resized.y).toBe(20);
    expect(resized.h).toBe(20);
  });
});

describe('editing a section', () => {
  it('clamps whatever the caller asks for', () => {
    const edited = withSection(defaultLayout(), 'period', { scale: 99 });
    expect(edited.sections.period.scale).toBe(LAYOUT_LIMITS.scale.max);
  });

  it('leaves every other section untouched', () => {
    const layout = defaultLayout();
    const edited = withSection(layout, 'period', { x: 1 });

    expect(edited.sections['home-score']).toEqual(layout.sections['home-score']);
    expect(layout.sections.period.x).not.toBe(1);
  });
});

describe('comparing layouts', () => {
  it('treats two absences as equal and an absence as unequal to a layout', () => {
    expect(layoutsEqual(null, null)).toBe(true);
    expect(layoutsEqual(defaultLayout(), null)).toBe(false);
    expect(layoutsEqual(null, defaultLayout())).toBe(false);
  });

  it('notices a single moved section', () => {
    const layout = defaultLayout();
    expect(layoutsEqual(layout, withSection(layout, 'hint', { y: 90 }))).toBe(false);
  });
});
