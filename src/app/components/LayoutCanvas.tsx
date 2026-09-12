/**
 * The drag surface of the scoreboard layout editor.
 *
 * Two layers, deliberately separated. Underneath is an `<iframe>` showing this
 * board's **real mirror** — the actual display page, the actual stylesheet, the
 * actual live score — driven by `postMessage` (see
 * `display/shared/layoutBridge.ts`). On top is this component's own overlay of
 * boxes and handles, in the console's document, where pointer events are easy
 * and nothing has to be injected into the display.
 *
 * The frame is rendered at a fixed 1280-wide viewport and then CSS-scaled to fit
 * whatever space the editor has. That is not cosmetic: the scoreboard stylesheet
 * carries `max-width: 900px` and `max-width: 768px` breakpoints, so a frame
 * merely *sized* to a narrow editor pane would render the phone layout and
 * measure it — handing back a starting arrangement nobody asked for. A fixed
 * viewport plus a transform gives a true miniature of a venue screen.
 *
 * Dragging never goes through React state. A pointer move writes to a ref,
 * schedules one animation frame, and that frame moves exactly one overlay box
 * and posts one message into the iframe. React hears about the change once, on
 * release. At 60Hz with thirteen sections and a live board behind them, the
 * difference between that and a re-render per move is the difference between a
 * layout tool and a slideshow.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  LAYOUT_LIMITS,
  MOVE_ANCHORS,
  SECTIONS,
  clampBox,
  mirrorBox,
  mirrorPartner,
  resizeBox,
  sectionDefinition,
  snapBox,
  type BoardLayout,
  type Guide,
  type ResizeHandle,
  type SectionBox,
  type SectionId,
  type SnapAnchors,
} from '../../core/boardLayout.js';
import {
  applyMessage,
  measureMessage,
  readPreviewMessage,
  type LayoutMetrics,
} from '../../display/shared/layoutBridge.js';

/** The viewport the preview frame always renders at, before scaling. */
const FRAME_WIDTH = 1280;

export type CanvasAspect = '16 / 9' | '21 / 9' | '4 / 3';

const FRAME_HEIGHT: Record<CanvasAspect, number> = {
  '16 / 9': 720,
  '21 / 9': 549,
  '4 / 3': 960,
};

export interface SnapSettings {
  enabled: boolean;
  /** Percent. 0 disables the grid while leaving alignment snapping on. */
  grid: number;
}

export interface LayoutCanvasProps {
  previewUrl: string | null;
  /**
   * `null` shows the board's stock arrangement with no overlay at all — the
   * state the editor opens in for a board nobody has customised, and the state
   * it returns to after a reset. Anything else is a draft being edited.
   */
  layout: BoardLayout | null;
  selected: SectionId | null;
  aspect: CanvasAspect;
  snap: SnapSettings;
  /**
   * While on, dragging or resizing a home/away section previews its mirrored
   * counterpart moving the same way, live, in this same gesture — not only
   * once the caller applies the committed change. The commit itself (and the
   * actual mirroring of the *data*) is `onChange`'s caller's job; this prop
   * only tells the canvas which section to also paint every frame.
   */
  linked: boolean;
  onSelect: (id: SectionId | null) => void;
  /** Fired once per gesture, on release — not per frame. */
  onChange: (id: SectionId, box: SectionBox) => void;
  /** Fired when the preview has measured the stock arrangement. */
  onMeasured?: (metrics: LayoutMetrics) => void;
}

/** One handle per corner and edge, in the order they are drawn. */
const HANDLES: readonly ResizeHandle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

/** Which of the moving box's edges may snap, per handle. */
const RESIZE_ANCHORS: Record<ResizeHandle, SnapAnchors> = {
  n: { x: [], y: ['start'] },
  s: { x: [], y: ['end'] },
  e: { x: ['end'], y: [] },
  w: { x: ['start'], y: [] },
  ne: { x: ['end'], y: ['start'] },
  nw: { x: ['start'], y: ['start'] },
  se: { x: ['end'], y: ['end'] },
  sw: { x: ['start'], y: ['end'] },
};

interface Gesture {
  id: SectionId;
  handle: ResizeHandle | null;
  origin: SectionBox;
  startX: number;
  startY: number;
  /** Set once the pointer has moved far enough to be a drag and not a click. */
  moved: boolean;
  current: SectionBox;
  /** Held while a modifier suspends snapping. */
  freehand: boolean;
}

export function LayoutCanvas({
  previewUrl,
  layout,
  selected,
  aspect,
  snap,
  linked,
  onSelect,
  onChange,
  onMeasured,
}: LayoutCanvasProps) {
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const shellRef = useRef<HTMLDivElement | null>(null);
  const boxRefs = useRef(new Map<SectionId, HTMLElement>());
  const guideRefs = useRef<{ x: HTMLElement | null; y: HTMLElement | null }>({ x: null, y: null });
  const readoutRef = useRef<HTMLElement | null>(null);

  const gesture = useRef<Gesture | null>(null);
  const frameHandle = useRef<number | null>(null);

  /** Where `.scoreboard` sits inside the frame, in frame pixels. */
  const [board, setBoard] = useState({ left: 0, top: 0, width: FRAME_WIDTH, height: 720 });
  const [scale, setScale] = useState(1);
  const [ready, setReady] = useState(false);

  const frameHeight = FRAME_HEIGHT[aspect];

  // Latest values, for handlers that must not be rebuilt on every render — the
  // pointer listeners are attached once per gesture and would otherwise capture
  // a stale layout the moment anything else on the page changed.
  const layoutRef = useRef<BoardLayout | null>(layout);
  const snapRef = useRef(snap);
  const linkedRef = useRef(linked);
  layoutRef.current = layout;
  snapRef.current = snap;
  linkedRef.current = linked;

  // -- Talking to the frame -----------------------------------------------

  const post = useCallback((message: unknown) => {
    frameRef.current?.contentWindow?.postMessage(message, window.location.origin);
  }, []);

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      if (event.source !== frameRef.current?.contentWindow) return;
      const message = readPreviewMessage(event);
      if (!message) return;

      if (message.type === 'ready') {
        setReady(true);
        return;
      }
      setBoard(message.board);
      onMeasured?.(message);
    }

    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [onMeasured]);

  // Push the layout whenever it changes from outside a drag — a numeric field
  // edited in the panel, a section switched back on, a reset.
  useEffect(() => {
    if (!ready) return;
    post(applyMessage(layout));
  }, [ready, layout, post]);

  useEffect(() => {
    if (ready) post(measureMessage());
  }, [ready, aspect, post]);

  // -- Fitting the frame into the page ------------------------------------

  useLayoutEffect(() => {
    const shell = shellRef.current;
    if (!shell) return;

    const fit = () => {
      const width = shell.clientWidth;
      if (width > 0) setScale(width / FRAME_WIDTH);
    };
    fit();

    const observer = new ResizeObserver(fit);
    observer.observe(shell);
    return () => observer.disconnect();
  }, []);

  // -- Geometry -----------------------------------------------------------

  /** Percent of the board -> pixels on the (unscaled) stage. */
  const toStage = useCallback(
    (box: SectionBox) => ({
      left: board.left + (box.x / 100) * board.width,
      top: board.top + (box.y / 100) * board.height,
      width: (box.w / 100) * board.width,
      height: (box.h / 100) * board.height,
    }),
    [board],
  );

  const placeBox = useCallback(
    (id: SectionId, box: SectionBox) => {
      const element = boxRefs.current.get(id);
      if (!element) return;
      const rect = toStage(box);
      element.style.left = `${rect.left}px`;
      element.style.top = `${rect.top}px`;
      element.style.width = `${rect.width}px`;
      element.style.height = `${rect.height}px`;
    },
    [toStage],
  );

  // Re-place every box whenever the layout or the board rect changes outside a
  // gesture. During one, the moving box is placed by the animation frame and
  // this effect does not run (layout state is untouched until release).
  useLayoutEffect(() => {
    if (!layout) return;
    for (const section of SECTIONS) placeBox(section.id, layout.sections[section.id]);
  }, [layout, placeBox]);

  const drawGuides = useCallback(
    (guides: Guide[]) => {
      for (const axis of ['x', 'y'] as const) {
        const element = guideRefs.current[axis];
        if (!element) continue;
        const guide = guides.find((candidate) => candidate.axis === axis);
        if (!guide) {
          element.hidden = true;
          continue;
        }
        element.hidden = false;
        if (axis === 'x') {
          element.style.left = `${board.left + (guide.at / 100) * board.width}px`;
          element.style.top = `${board.top + (guide.from / 100) * board.height}px`;
          element.style.height = `${((guide.to - guide.from) / 100) * board.height}px`;
        } else {
          element.style.top = `${board.top + (guide.at / 100) * board.height}px`;
          element.style.left = `${board.left + (guide.from / 100) * board.width}px`;
          element.style.width = `${((guide.to - guide.from) / 100) * board.width}px`;
        }
      }
    },
    [board],
  );

  const showReadout = useCallback(
    (box: SectionBox | null) => {
      const element = readoutRef.current;
      if (!element) return;
      if (!box) {
        element.hidden = true;
        return;
      }
      element.hidden = false;
      element.textContent = `${box.x.toFixed(1)} , ${box.y.toFixed(1)}  ·  ${box.w.toFixed(1)} × ${box.h.toFixed(1)}`;
      const rect = toStage(box);
      element.style.left = `${rect.left}px`;
      element.style.top = `${Math.max(board.top, rect.top - 26)}px`;
    },
    [toStage, board.top],
  );

  // -- Dragging -----------------------------------------------------------

  const commitFrame = useCallback(() => {
    frameHandle.current = null;
    const active = gesture.current;
    const current = layoutRef.current;
    if (!active || !current) return;

    placeBox(active.id, active.current);
    showReadout(active.current);

    // Live-preview the mirrored partner moving too — purely cosmetic during
    // the gesture itself. The actual data-side mirroring happens once, on
    // commit, in whatever `onChange`'s caller does with it; this only keeps
    // what the operator sees under the pointer honest with what release will
    // produce, rather than a box that visibly "catches up" afterward.
    const partnerId = linkedRef.current ? mirrorPartner(active.id) : null;
    const partnerBox = partnerId ? mirrorBox(active.current) : null;
    if (partnerId && partnerBox) placeBox(partnerId, partnerBox);

    // The preview is driven with the draft layout rather than the saved one, so
    // the board underneath moves with the handle instead of trailing it.
    post(
      applyMessage({
        ...current,
        sections: {
          ...current.sections,
          [active.id]: active.current,
          ...(partnerId && partnerBox ? { [partnerId]: partnerBox } : {}),
        },
      }),
    );
  }, [placeBox, post, showReadout]);

  const schedule = useCallback(() => {
    if (frameHandle.current !== null) return;
    frameHandle.current = requestAnimationFrame(commitFrame);
  }, [commitFrame]);

  const beginGesture = useCallback(
    (event: React.PointerEvent, id: SectionId, handle: ResizeHandle | null) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();

      const current = layoutRef.current;
      if (!current) return;

      onSelect(id);
      const origin = current.sections[id];
      gesture.current = {
        id,
        handle,
        origin,
        startX: event.clientX,
        startY: event.clientY,
        moved: false,
        current: origin,
        freehand: false,
      };
      (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    },
    [onSelect],
  );

  const onPointerMove = useCallback(
    (event: React.PointerEvent) => {
      const active = gesture.current;
      const current = layoutRef.current;
      if (!active || !current) return;

      // Pointer coordinates are page pixels; the stage is scaled, and the board
      // is a sub-rectangle of it. Both divisions are needed or a drag moves the
      // box by the wrong amount on every screen but one.
      const deltaX = ((event.clientX - active.startX) / scale / board.width) * 100;
      const deltaY = ((event.clientY - active.startY) / scale / board.height) * 100;

      // A press that has not travelled two pixels is still a click selecting
      // the section, not a drag nudging it a hundredth of a percent.
      if (
        !active.moved &&
        Math.abs(event.clientX - active.startX) < 2 &&
        Math.abs(event.clientY - active.startY) < 2
      ) {
        return;
      }
      active.moved = true;
      // Alt suspends snapping for as long as it is held, which is how every
      // design tool lets you place something one notch off a guide.
      active.freehand = event.altKey;

      const others = SECTIONS.filter((section) => section.id !== active.id).map(
        (section) => current.sections[section.id],
      );

      let next: SectionBox;
      let guides: Guide[] = [];

      if (active.handle) {
        const resized = resizeBox(active.origin, active.handle, deltaX, deltaY);
        if (snapRef.current.enabled && !active.freehand) {
          const trial = snapBox(resized, others, {
            grid: snapRef.current.grid,
            anchors: RESIZE_ANCHORS[active.handle],
          });
          // `snapBox` only ever translates — it is the *move* operation's tool.
          // During a resize the anchored edge must not move, so the translation
          // it proposes is re-read as a change of size on the edge being
          // dragged. Applying the translation as-is is what makes a box appear
          // to slide out from under the pointer when a corner catches a guide.
          next = applyResizeSnap(active.handle, resized, trial.box);
          guides = trial.guides;
        } else {
          next = resized;
        }
      } else {
        const moved: SectionBox = {
          ...active.origin,
          x: active.origin.x + deltaX,
          y: active.origin.y + deltaY,
        };
        if (snapRef.current.enabled && !active.freehand) {
          const trial = snapBox(moved, others, {
            grid: snapRef.current.grid,
            anchors: MOVE_ANCHORS,
          });
          next = trial.box;
          guides = trial.guides;
        } else {
          next = moved;
        }
      }

      active.current = next;
      drawGuides(guides);
      schedule();
    },
    [board.height, board.width, drawGuides, scale, schedule],
  );

  const endGesture = useCallback(
    (event: React.PointerEvent) => {
      const active = gesture.current;
      gesture.current = null;
      if (frameHandle.current !== null) {
        cancelAnimationFrame(frameHandle.current);
        frameHandle.current = null;
      }
      drawGuides([]);
      showReadout(null);

      try {
        (event.currentTarget as HTMLElement).releasePointerCapture(event.pointerId);
      } catch {
        // The capture is already gone when the pointer left the window; the
        // gesture has been ended either way.
      }

      if (active?.moved) onChange(active.id, active.current);
    },
    [drawGuides, onChange, showReadout],
  );

  // -- Keyboard -----------------------------------------------------------

  const onBoxKeyDown = useCallback(
    (event: React.KeyboardEvent, id: SectionId) => {
      const current = layoutRef.current;
      if (!current) return;
      const step = event.shiftKey ? 5 : 0.5;
      const box = current.sections[id];
      const nudge = (dx: number, dy: number) => {
        event.preventDefault();
        // Alt turns the arrows into a resize, matching what Alt does to a drag.
        if (event.altKey) {
          onChange(id, { ...box, w: box.w + dx, h: box.h + dy });
        } else {
          onChange(id, { ...box, x: box.x + dx, y: box.y + dy });
        }
      };

      switch (event.key) {
        case 'ArrowLeft':
          return nudge(-step, 0);
        case 'ArrowRight':
          return nudge(step, 0);
        case 'ArrowUp':
          return nudge(0, -step);
        case 'ArrowDown':
          return nudge(0, step);
        case 'Delete':
        case 'Backspace':
          event.preventDefault();
          onChange(id, { ...box, visible: false });
          return;
        default:
      }
    },
    [onChange],
  );

  const stageHeight = frameHeight * scale;

  return (
    <div className="layout-canvas" ref={shellRef}>
      <div className="layout-canvas__stage" style={{ height: `${stageHeight}px` }}>
        {previewUrl ? (
          <iframe
            ref={frameRef}
            className="layout-canvas__frame"
            src={previewUrl}
            title="Scoreboard preview"
            style={{
              width: `${FRAME_WIDTH}px`,
              height: `${frameHeight}px`,
              transform: `scale(${scale})`,
            }}
          />
        ) : (
          <div className="layout-canvas__placeholder">Preparing the preview…</div>
        )}

        <div
          className="layout-canvas__overlay"
          style={{
            width: `${FRAME_WIDTH}px`,
            height: `${frameHeight}px`,
            transform: `scale(${scale})`,
          }}
          onPointerDown={() => onSelect(null)}
        >
          {(layout ? SECTIONS : []).map((section) => {
            const box = layout!.sections[section.id];
            if (!box.visible) return null;
            const isSelected = selected === section.id;

            return (
              <div
                key={section.id}
                ref={(element) => {
                  if (element) boxRefs.current.set(section.id, element);
                  else boxRefs.current.delete(section.id);
                }}
                className={`layout-box${isSelected ? ' is-selected' : ''}`}
                role="button"
                tabIndex={0}
                aria-label={`Move ${sectionDefinition(section.id).label}`}
                aria-pressed={isSelected}
                onPointerDown={(event) => beginGesture(event, section.id, null)}
                onPointerMove={onPointerMove}
                onPointerUp={endGesture}
                onPointerCancel={endGesture}
                onKeyDown={(event) => onBoxKeyDown(event, section.id)}
                onFocus={() => onSelect(section.id)}
              >
                <span className="layout-box__tag">{sectionDefinition(section.id).label}</span>
                {isSelected
                  ? HANDLES.map((handle) => (
                      <span
                        key={handle}
                        className={`layout-handle layout-handle--${handle}`}
                        onPointerDown={(event) => beginGesture(event, section.id, handle)}
                        onPointerMove={onPointerMove}
                        onPointerUp={endGesture}
                        onPointerCancel={endGesture}
                      />
                    ))
                  : null}
              </div>
            );
          })}

          <div
            className="layout-guide layout-guide--x"
            hidden
            ref={(element) => {
              guideRefs.current.x = element;
            }}
          />
          <div
            className="layout-guide layout-guide--y"
            hidden
            ref={(element) => {
              guideRefs.current.y = element;
            }}
          />
          <div
            className="layout-readout"
            hidden
            ref={(element) => {
              readoutRef.current = element;
            }}
          />
        </div>
      </div>
    </div>
  );
}

/**
 * Turns a snap translation back into a resize.
 *
 * `snapped` is `resized` shifted so its live edge lines up with something. Which
 * edge that was is what `handle` says, and moving *that* edge by the shift while
 * leaving the opposite one alone is the whole of the conversion — a west drag
 * that snaps 0.4% to the right has its left edge at the guide and is 0.4%
 * narrower, never 0.4% further along.
 */
function applyResizeSnap(
  handle: ResizeHandle,
  resized: SectionBox,
  snapped: SectionBox,
): SectionBox {
  const shiftX = snapped.x - resized.x;
  const shiftY = snapped.y - resized.y;
  const next = { ...resized };

  if (handle.includes('w')) {
    next.x = resized.x + shiftX;
    next.w = Math.max(LAYOUT_LIMITS.size.min, resized.w - shiftX);
  } else if (handle.includes('e')) {
    next.w = Math.max(LAYOUT_LIMITS.size.min, resized.w + shiftX);
  }

  if (handle.includes('n')) {
    next.y = resized.y + shiftY;
    next.h = Math.max(LAYOUT_LIMITS.size.min, resized.h - shiftY);
  } else if (handle.includes('s')) {
    next.h = Math.max(LAYOUT_LIMITS.size.min, resized.h + shiftY);
  }

  return clampBox(next);
}
