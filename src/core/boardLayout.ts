/**
 * The scoreboard's editable layout.
 *
 * The gym-wall board has one fixed arrangement baked into
 * `display/scoreboard/style.css` — three flex columns, stats pushed to the
 * bottom of each team. That arrangement is pixel-locked (see the Constraints
 * section of CLAUDE.md) and is *not* what this module changes. What this adds
 * is a second, opt-in mode: a board may carry a layout document that places each
 * section itself, and only then does anything about the rendered page differ.
 *
 * The distinction is the whole design. A board with no layout document renders
 * byte-identically to the board that shipped, which is what keeps
 * `tests/e2e/visual.spec.ts` honest rather than merely re-baselined. "Reset to
 * defaults" deletes the document, and the stock layout comes back exactly — not
 * an approximation of itself.
 *
 * Geometry is **percentages of the board box**, never pixels. A layout is
 * authored in a small preview on someone's laptop and then rendered on a 4K
 * screen across a gym and on a 13" mirror in the scorer's booth; percentages are
 * the only unit that means the same thing in all three. Font sizes follow from
 * the section's own height for the same reason (`--sb-unit` in the stylesheet),
 * so making a box taller makes its digits bigger, which is what "change the
 * size" has to mean on a scoreboard.
 *
 * Pure and framework-free like the rest of `src/core/`: no DOM, no Firebase, no
 * React. `display/shared/layoutApply.ts` turns a layout into inline styles,
 * `core/liveLayout.ts` moves it over the wire, and `app/pages/BoardLayoutPage`
 * is the editor. Each of those is replaceable; the rules below are not.
 */

// ---------------------------------------------------------------------------
// The section catalog
// ---------------------------------------------------------------------------

export type SectionGroup = 'Home' | 'Away' | 'Centre';

export interface SectionDefinition {
  readonly id: string;
  readonly group: SectionGroup;
  readonly label: string;
  /**
   * Whether this section has a caption that can be turned off on its own
   * ("FOULS", "GAME TIME"). Sections without one ignore `showLabel` entirely,
   * so the editor knows not to offer a switch that would do nothing.
   */
  readonly hasLabel: boolean;
  readonly defaultBox: SectionBox;
}

/**
 * One section's box, in percent of the board.
 *
 * `x`/`y` are the top-left corner, `w`/`h` the size. `scale` multiplies the font
 * size the box would otherwise imply — the escape hatch for a section whose text
 * wants to be smaller than its box (a long team name) or larger (a period
 * indicator in a deliberately generous box).
 */
export interface SectionBox {
  x: number;
  y: number;
  w: number;
  h: number;
  scale: number;
  visible: boolean;
  showLabel: boolean;
}

const box = (
  x: number,
  y: number,
  w: number,
  h: number,
  extra: Partial<SectionBox> = {},
): SectionBox => ({ x, y, w, h, scale: 1, visible: true, showLabel: true, ...extra });

/**
 * Every movable piece of the scoreboard.
 *
 * The default boxes trace the stock stylesheet's arrangement closely enough that
 * switching a board to custom layout is not a jump — teams down the outside,
 * clocks stacked in the middle — but they are deliberately *not* claimed to
 * reproduce it pixel for pixel. The stock layout is fluid (`clamp()` against
 * viewport units); this one is proportional. Someone who wants the original back
 * resets, which removes the document rather than trying to re-derive it.
 */
export const SECTIONS = [
  // --- Home ---
  {
    id: 'home-name',
    group: 'Home',
    label: 'Home team name',
    hasLabel: false,
    defaultBox: box(2, 3, 24, 10),
  },
  {
    id: 'home-score',
    group: 'Home',
    label: 'Home score',
    hasLabel: false,
    defaultBox: box(2, 15, 24, 30),
  },
  {
    id: 'home-fouls',
    group: 'Home',
    label: 'Home fouls',
    hasLabel: true,
    defaultBox: box(2, 50, 24, 24),
  },
  {
    id: 'home-timeouts',
    group: 'Home',
    label: 'Home timeouts',
    hasLabel: true,
    defaultBox: box(2, 76, 24, 20),
  },

  // --- Centre ---
  {
    id: 'game-clock',
    group: 'Centre',
    label: 'Game clock',
    hasLabel: true,
    defaultBox: box(28, 4, 44, 30),
  },
  {
    id: 'shot-clock',
    group: 'Centre',
    label: 'Shot clock',
    hasLabel: true,
    defaultBox: box(34, 37, 32, 30),
  },
  {
    id: 'period',
    group: 'Centre',
    label: 'Period',
    hasLabel: false,
    defaultBox: box(42, 69, 16, 12),
  },
  {
    id: 'logo',
    group: 'Centre',
    label: 'Tournament logo',
    hasLabel: false,
    defaultBox: box(36, 82, 28, 12),
  },
  {
    id: 'hint',
    group: 'Centre',
    label: 'Help hint line',
    hasLabel: false,
    defaultBox: box(28, 95, 44, 4),
  },

  // --- Away ---
  {
    id: 'away-name',
    group: 'Away',
    label: 'Away team name',
    hasLabel: false,
    defaultBox: box(74, 3, 24, 10),
  },
  {
    id: 'away-score',
    group: 'Away',
    label: 'Away score',
    hasLabel: false,
    defaultBox: box(74, 15, 24, 30),
  },
  {
    id: 'away-fouls',
    group: 'Away',
    label: 'Away fouls',
    hasLabel: true,
    defaultBox: box(74, 50, 24, 24),
  },
  {
    id: 'away-timeouts',
    group: 'Away',
    label: 'Away timeouts',
    hasLabel: true,
    defaultBox: box(74, 76, 24, 20),
  },
] as const satisfies readonly SectionDefinition[];

export type SectionId = (typeof SECTIONS)[number]['id'];

export const SECTION_IDS: readonly SectionId[] = SECTIONS.map((section) => section.id);

/** The groups in presentation order, derived from the catalog. */
export const SECTION_GROUPS: readonly SectionGroup[] = [
  ...new Set(SECTIONS.map((section) => section.group)),
];

export function sectionDefinition(id: SectionId): SectionDefinition {
  // Non-null by construction: `SectionId` is the catalog's own union.
  return SECTIONS.find((section) => section.id === id) as SectionDefinition;
}

export function isSectionId(value: unknown): value is SectionId {
  return typeof value === 'string' && SECTION_IDS.includes(value as SectionId);
}

// ---------------------------------------------------------------------------
// Home/away linking
// ---------------------------------------------------------------------------

/**
 * Each home section's away counterpart, and back again.
 *
 * Only the four sections that actually come in a pair: the centre console has
 * nothing on "the other side" to stay consistent with. Built from a half-list
 * so the two directions can never drift apart from each other by a typo.
 */
const MIRROR_HALF: readonly [SectionId, SectionId][] = [
  ['home-name', 'away-name'],
  ['home-score', 'away-score'],
  ['home-fouls', 'away-fouls'],
  ['home-timeouts', 'away-timeouts'],
];

const MIRROR_PAIRS: ReadonlyMap<SectionId, SectionId> = new Map([
  ...MIRROR_HALF,
  ...MIRROR_HALF.map(([home, away]) => [away, home] as [SectionId, SectionId]),
]);

/** This section's home/away counterpart, or `null` for a centre section. */
export function mirrorPartner(id: SectionId): SectionId | null {
  return MIRROR_PAIRS.get(id) ?? null;
}

/**
 * Reflects a box across the board's vertical centre line.
 *
 * Every field but `x` carries straight across — same row, same size, same
 * type scale, same caption choice — because "linked" means the two sides stay
 * *identical apart from which edge they hang from*. Only the horizontal
 * position is mirrored, and mirrored through the box's own width rather than
 * its bare `x`, so a box's *right* edge on one side lands at the matching
 * distance from the *left* edge on the other: `x' = 100 − x − w`. Reflection
 * is its own inverse, so this needs no notion of which side is "the real one"
 * — dragging either half updates the other the same way.
 *
 * `visible` is deliberately absent: showing one side's fouls but not the
 * other's is a legitimate, one-sided content choice, not a placement one, and
 * linking is scoped to movement and resizing — never to what is on the board.
 */
export function mirrorBox(box: SectionBox): SectionBox {
  return clampBox({ ...box, x: 100 - box.x - box.w });
}

/** Whether a patch touches placement — the properties linking propagates. */
export function isGeometryPatch(patch: Partial<SectionBox>): boolean {
  return ['x', 'y', 'w', 'h', 'scale'].some((key) => key in patch);
}

// ---------------------------------------------------------------------------
// The layout document
// ---------------------------------------------------------------------------

export const LAYOUT_VERSION = 1;

export interface BoardLayout {
  version: number;
  sections: Record<SectionId, SectionBox>;
}

/**
 * Bounds for every stored number.
 *
 * Hand-mirrored into `database.rules.json` under `live/$tenant/$board/layout`,
 * the same way `LIMITS` in `schema.ts` is — there is no codegen link, so a
 * change here is a change there. Positions are allowed to run past the board's
 * edges because a section parked half off-screen is a legitimate thing to want
 * mid-edit and the board clips it anyway; the range is bounded only to stop a
 * corrupt document painting a box a thousand screens wide.
 */
export const LAYOUT_LIMITS = {
  position: { min: -100, max: 200 },
  size: { min: 2, max: 200 },
  scale: { min: 0.2, max: 3 },
} as const;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Two decimals, which is finer than one pixel on a 4K board and keeps the
 * document small enough that the whole thing is one cheap RTDB write.
 */
function round(value: number): number {
  return Math.round(value * 100) / 100;
}

export function clampBox(candidate: SectionBox): SectionBox {
  const { position, size, scale } = LAYOUT_LIMITS;
  return {
    x: round(clamp(candidate.x, position.min, position.max)),
    y: round(clamp(candidate.y, position.min, position.max)),
    w: round(clamp(candidate.w, size.min, size.max)),
    h: round(clamp(candidate.h, size.min, size.max)),
    scale: round(clamp(candidate.scale, scale.min, scale.max)),
    visible: candidate.visible,
    showLabel: candidate.showLabel,
  };
}

export function defaultLayout(): BoardLayout {
  const sections = {} as Record<SectionId, SectionBox>;
  for (const section of SECTIONS) sections[section.id] = { ...section.defaultBox };
  return { version: LAYOUT_VERSION, sections };
}

export function isDefaultLayout(layout: BoardLayout): boolean {
  return SECTIONS.every((section) => boxesEqual(layout.sections[section.id], section.defaultBox));
}

export function boxesEqual(a: SectionBox, b: SectionBox): boolean {
  return (
    a.x === b.x &&
    a.y === b.y &&
    a.w === b.w &&
    a.h === b.h &&
    a.scale === b.scale &&
    a.visible === b.visible &&
    a.showLabel === b.showLabel
  );
}

export function layoutsEqual(a: BoardLayout | null, b: BoardLayout | null): boolean {
  if (a === null || b === null) return a === b;
  return SECTION_IDS.every((id) => boxesEqual(a.sections[id], b.sections[id]));
}

export function withSection(
  layout: BoardLayout,
  id: SectionId,
  patch: Partial<SectionBox>,
): BoardLayout {
  return {
    ...layout,
    sections: {
      ...layout.sections,
      [id]: clampBox({ ...layout.sections[id], ...patch }),
    },
  };
}

/**
 * Reads a layout out of whatever the database handed back.
 *
 * Tolerant on purpose, and in the same spirit as `parseKeymap`: a section the
 * document has never heard of falls back to its default box rather than
 * throwing, so shipping a *new* section (a period-by-period line, say) does not
 * strand every board that saved a layout before it existed. `null` is the answer
 * for "no layout here", which is the signal the display surfaces read as "render
 * the stock arrangement".
 *
 * Note what is *not* tolerated: a non-object, or a version this build does not
 * understand. Both mean the document was written by something other than this
 * code, and guessing at it would put an arbitrary arrangement on a gym wall.
 */
export function parseBoardLayout(raw: unknown): BoardLayout | null {
  if (raw === null || raw === undefined || typeof raw !== 'object') return null;

  const source = raw as { version?: unknown; sections?: unknown };
  if (typeof source.version === 'number' && source.version !== LAYOUT_VERSION) return null;

  const sectionsRaw =
    source.sections && typeof source.sections === 'object'
      ? (source.sections as Record<string, unknown>)
      : null;
  if (!sectionsRaw) return null;

  const sections = {} as Record<SectionId, SectionBox>;
  for (const section of SECTIONS) {
    sections[section.id] = parseBox(sectionsRaw[section.id], section.defaultBox);
  }
  return { version: LAYOUT_VERSION, sections };
}

function parseBox(raw: unknown, fallback: SectionBox): SectionBox {
  if (!raw || typeof raw !== 'object') return { ...fallback };
  const source = raw as Partial<Record<keyof SectionBox, unknown>>;

  const num = (value: unknown, spare: number) =>
    typeof value === 'number' && Number.isFinite(value) ? value : spare;
  // RTDB strips a child whose value is `null`, and a boolean that was never
  // written comes back absent rather than false — so an absent flag has to mean
  // the default, not "off". Anything else would make a saved layout lose its
  // captions the first time it round-tripped through the database.
  const bool = (value: unknown, spare: boolean) => (typeof value === 'boolean' ? value : spare);

  return clampBox({
    x: num(source.x, fallback.x),
    y: num(source.y, fallback.y),
    w: num(source.w, fallback.w),
    h: num(source.h, fallback.h),
    scale: num(source.scale, fallback.scale),
    visible: bool(source.visible, fallback.visible),
    showLabel: bool(source.showLabel, fallback.showLabel),
  });
}

// ---------------------------------------------------------------------------
// Snapping and alignment guides
// ---------------------------------------------------------------------------

/**
 * A line the editor draws while something is being dragged.
 *
 * `at` is the coordinate on `axis`; `from`/`to` bound the line on the *other*
 * axis, spanning far enough to touch both the dragged section and whatever it
 * lined up with — a guide that stops short of one of them does not read as a
 * relationship between the two.
 */
export interface Guide {
  axis: 'x' | 'y';
  at: number;
  from: number;
  to: number;
}

/** Which edges of the moving box are allowed to snap. */
export interface SnapAnchors {
  x: readonly ('start' | 'centre' | 'end')[];
  y: readonly ('start' | 'centre' | 'end')[];
}

export const MOVE_ANCHORS: SnapAnchors = {
  x: ['start', 'centre', 'end'],
  y: ['start', 'centre', 'end'],
};

export interface SnapOptions {
  /** Percent of the board within which two lines are treated as aligned. */
  tolerance?: number;
  /** Grid step in percent, or 0 for no grid. Applied only where nothing aligns. */
  grid?: number;
  anchors?: SnapAnchors;
}

export interface SnapResult {
  box: SectionBox;
  guides: Guide[];
}

interface Candidate {
  /** Where the moving edge currently is. */
  value: number;
  /** Which edge it is, so the caller knows what to move. */
  anchor: 'start' | 'centre' | 'end';
}

/**
 * Nudges a box onto whatever it very nearly lines up with.
 *
 * Three families of target, in priority order: the other sections' edges and
 * centres, the board's own edges and centre, then a plain grid. Alignment beats
 * the grid because "level with the away score" is a thing an operator means and
 * "on a 1% grid" is not — the grid is only there to keep free-floating sections
 * from landing on ragged fractions.
 *
 * Snapping moves the box; it never resizes it. During a resize the caller passes
 * the single live edge in `anchors`, and the size follows from where that edge
 * lands, which is why the resize path in the editor applies the delta itself and
 * asks this only about the edge it is dragging.
 *
 * Pure, so the tolerance and priority rules are pinned by unit tests rather than
 * by dragging things around in a browser.
 */
export function snapBox(
  moving: SectionBox,
  others: readonly SectionBox[],
  { tolerance = 0.8, grid = 0, anchors = MOVE_ANCHORS }: SnapOptions = {},
): SnapResult {
  const guides: Guide[] = [];

  const targetsX = alignmentTargets(others, 'x');
  const targetsY = alignmentTargets(others, 'y');

  const x = snapAxis(candidates(moving.x, moving.w, anchors.x), targetsX, tolerance, grid);
  const y = snapAxis(candidates(moving.y, moving.h, anchors.y), targetsY, tolerance, grid);

  const snapped: SectionBox = {
    ...moving,
    x: round(moving.x + x.delta),
    y: round(moving.y + y.delta),
  };

  // Guides are drawn only for a real alignment. A grid landing is a convenience,
  // not a relationship, and a line pointing at nothing would say otherwise.
  if (x.aligned !== null) {
    guides.push({ axis: 'x', at: x.aligned, ...spanOn('y', snapped, others) });
  }
  if (y.aligned !== null) {
    guides.push({ axis: 'y', at: y.aligned, ...spanOn('x', snapped, others) });
  }

  return { box: snapped, guides };
}

function candidates(
  start: number,
  size: number,
  anchors: readonly ('start' | 'centre' | 'end')[],
): Candidate[] {
  const byAnchor = { start, centre: start + size / 2, end: start + size };
  return anchors.map((anchor) => ({ anchor, value: byAnchor[anchor] }));
}

/** Every line on `axis` that something could align to, the board included. */
function alignmentTargets(others: readonly SectionBox[], axis: 'x' | 'y'): number[] {
  const targets = [0, 50, 100];
  for (const other of others) {
    if (!other.visible) continue;
    const start = axis === 'x' ? other.x : other.y;
    const size = axis === 'x' ? other.w : other.h;
    targets.push(start, start + size / 2, start + size);
  }
  return targets;
}

function snapAxis(
  moving: Candidate[],
  targets: readonly number[],
  tolerance: number,
  grid: number,
): { delta: number; aligned: number | null } {
  let best: { delta: number; at: number } | null = null;

  for (const candidate of moving) {
    for (const target of targets) {
      const delta = target - candidate.value;
      if (Math.abs(delta) > tolerance) continue;
      if (best === null || Math.abs(delta) < Math.abs(best.delta)) best = { delta, at: target };
    }
  }

  if (best) return { delta: best.delta, aligned: best.at };

  if (grid > 0 && moving.length > 0) {
    // Grid-snap the box's own origin, not whichever anchor happened to be
    // listed first: the origin is what the operator sees in the X/Y fields.
    const origin = moving.find((candidate) => candidate.anchor === 'start') ?? moving[0];
    const snappedOrigin = Math.round((origin as Candidate).value / grid) * grid;
    return { delta: snappedOrigin - (origin as Candidate).value, aligned: null };
  }

  return { delta: 0, aligned: null };
}

/** How far a guide line has to reach to touch both boxes it relates. */
function spanOn(
  axis: 'x' | 'y',
  moving: SectionBox,
  others: readonly SectionBox[],
): { from: number; to: number } {
  const start = axis === 'x' ? moving.x : moving.y;
  const size = axis === 'x' ? moving.w : moving.h;
  let from = start;
  let to = start + size;

  for (const other of others) {
    if (!other.visible) continue;
    const otherStart = axis === 'x' ? other.x : other.y;
    const otherSize = axis === 'x' ? other.w : other.h;
    from = Math.min(from, otherStart);
    to = Math.max(to, otherStart + otherSize);
  }
  return { from: round(from), to: round(to) };
}

// ---------------------------------------------------------------------------
// Resizing
// ---------------------------------------------------------------------------

/** Which corner or edge a resize is being driven from. */
export type ResizeHandle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

/**
 * Applies a drag on one handle, in percent, to a box.
 *
 * The opposite edge is the anchor and does not move — dragging the east handle
 * of a box never shifts its left edge, which is the behaviour every design tool
 * has and the only one that lets two sections be lined up and then sized
 * independently. A drag that would invert the box stops at the minimum size
 * instead of flipping it inside out.
 */
export function resizeBox(
  origin: SectionBox,
  handle: ResizeHandle,
  deltaX: number,
  deltaY: number,
): SectionBox {
  const { min } = LAYOUT_LIMITS.size;
  let { x, y, w, h } = origin;

  if (handle.includes('e')) w = Math.max(min, origin.w + deltaX);
  if (handle.includes('w')) {
    w = Math.max(min, origin.w - deltaX);
    x = origin.x + origin.w - w;
  }
  if (handle.includes('s')) h = Math.max(min, origin.h + deltaY);
  if (handle.includes('n')) {
    h = Math.max(min, origin.h - deltaY);
    y = origin.y + origin.h - h;
  }

  return clampBox({ ...origin, x, y, w, h });
}
