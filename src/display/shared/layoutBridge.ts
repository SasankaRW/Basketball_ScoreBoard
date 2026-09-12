/**
 * Lets the console's layout editor drive a mirror it has embedded.
 *
 * The editor could have drawn its own mock scoreboard, and that was the obvious
 * design — but a mock is a second implementation of the layout, and the first
 * time the two disagreed the operator would have arranged a board that looks
 * like something else on the wall. So the editor embeds the **real mirror**, on
 * the real stylesheet, showing this board's real live state, and talks to it
 * over `postMessage`. What you drag is what the gym sees.
 *
 * `vw`/`vh` are the other reason it has to be an iframe rather than a scoped
 * copy of the markup: the stock scoreboard sizes almost everything with
 * `clamp()` against viewport units, and a viewport is exactly what a frame has
 * and an in-page preview box does not.
 *
 * Nothing here runs on a mirror that is not framed — a wall display takes no
 * instructions from anyone. When it *is* framed, messages are accepted only
 * from the embedding window and only from this same origin, so the worst a
 * hostile embedder achieves is rearranging the copy inside its own page.
 */
import { parseBoardLayout, type BoardLayout, type SectionId } from '../../core/boardLayout.js';
import { findBoardElement, measureSections } from './layoutApply.js';

/** Sent by the editor. */
const EDITOR_SOURCE = 'sb-layout-editor';
/** Sent by the framed display. */
const PREVIEW_SOURCE = 'sb-layout-preview';

export interface BoardRect {
  /** Pixels, relative to the framed document's viewport. */
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface SectionRect {
  x: number;
  y: number;
  w: number;
  h: number;
  visible: boolean;
}

export interface LayoutMetrics {
  board: BoardRect;
  /** Percent of the board — the same units a layout document stores. */
  sections: Partial<Record<SectionId, SectionRect>>;
}

export type EditorMessage =
  | { source: typeof EDITOR_SOURCE; type: 'apply'; layout: unknown }
  | { source: typeof EDITOR_SOURCE; type: 'measure' };

export type PreviewMessage =
  | { source: typeof PREVIEW_SOURCE; type: 'ready' }
  | ({ source: typeof PREVIEW_SOURCE; type: 'metrics' } & LayoutMetrics);

export interface LayoutBridgeHandlers {
  /**
   * A layout to render instead of the board's stored one. `null` means "show
   * the stock arrangement" — the editor's starting point before anything has
   * been placed — which is a different instruction from "stop overriding", and
   * the editor never gives the latter: once it is driving the preview, it
   * drives it until the frame goes away.
   */
  onApply: (layout: BoardLayout | null) => void;
}

/**
 * Starts listening, if this page is embedded.
 *
 * Returns the teardown, or `null` when the page is top-level — which is the
 * signal to callers that no bridge exists and nothing about their normal
 * behaviour changes. On a gym wall this function does nothing but one comparison
 * and a return.
 */
export function mountLayoutBridge(handlers: LayoutBridgeHandlers): (() => void) | null {
  if (window.parent === window) return null;

  const parent = window.parent;

  function reply(message: PreviewMessage): void {
    // Targeted at this exact origin rather than `*`: the metrics say where the
    // board is on screen, which is not much, but there is no reason to hand it
    // to a frame ancestor on another origin.
    parent.postMessage(message, window.location.origin);
  }

  function sendMetrics(): void {
    const board = findBoardElement(document);
    if (!board) return;
    const rect = board.getBoundingClientRect();
    reply({
      source: PREVIEW_SOURCE,
      type: 'metrics',
      board: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
      sections: measureSections(document),
    });
  }

  function onMessage(event: MessageEvent): void {
    if (event.origin !== window.location.origin) return;
    if (event.source !== parent) return;

    const message = event.data as Partial<EditorMessage> | null;
    if (!message || message.source !== EDITOR_SOURCE) return;

    if (message.type === 'apply') {
      handlers.onApply(parseBoardLayout((message as { layout: unknown }).layout));
      // Measure after the browser has actually laid the new boxes out. The
      // editor asks for metrics right after applying a layout, and reading
      // `getBoundingClientRect` in the same task would hand back the previous
      // frame's geometry.
      requestAnimationFrame(() => sendMetrics());
      return;
    }

    if (message.type === 'measure') {
      requestAnimationFrame(() => sendMetrics());
    }
  }

  window.addEventListener('message', onMessage);

  // The board is sized in `vw`/`vh`, so it moves whenever the frame does — and
  // the editor's drag handles are drawn *outside* the frame, in the console's
  // own document, where they have no way to notice.
  const board = findBoardElement(document);
  const observer = board ? new ResizeObserver(() => sendMetrics()) : null;
  if (board && observer) observer.observe(board);

  reply({ source: PREVIEW_SOURCE, type: 'ready' });

  return () => {
    window.removeEventListener('message', onMessage);
    observer?.disconnect();
  };
}

// ---------------------------------------------------------------------------
// The editor's half
// ---------------------------------------------------------------------------

/** Builds the message the editor posts into the frame. */
export function applyMessage(layout: BoardLayout | null): EditorMessage {
  return { source: EDITOR_SOURCE, type: 'apply', layout };
}

export function measureMessage(): EditorMessage {
  return { source: EDITOR_SOURCE, type: 'measure' };
}

/** Narrows a `message` event the editor received from its preview frame. */
export function readPreviewMessage(event: MessageEvent): PreviewMessage | null {
  if (event.origin !== window.location.origin) return null;
  const message = event.data as Partial<PreviewMessage> | null;
  if (!message || message.source !== PREVIEW_SOURCE) return null;
  if (message.type !== 'ready' && message.type !== 'metrics') return null;
  return message as PreviewMessage;
}
