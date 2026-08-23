/**
 * The tour as it appears on screen: a dimmed page, one lit element, and a card
 * pointing at it.
 *
 * The positioning here is deliberately plain arithmetic over
 * `getBoundingClientRect` rather than a popover library. There is exactly one
 * popover in this product, it needs four placements and a clamp, and that is a
 * page of code — the same reasoning that keeps `components/icons.tsx` from
 * being a dependency.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { IconClose } from '../components/icons.js';
import { useTour } from './TourProvider.js';

/** Distance between the lit element and the card, and from the card to the viewport edge. */
const GAP = 14;
const MARGIN = 12;
/** How far the lit ring extends past the element it surrounds. */
const PAD = 6;

interface Box {
  top: number;
  left: number;
  width: number;
  height: number;
}

interface Placed {
  spotlight: Box | null;
  card: { top: number; left: number };
  /** Which side of the anchor the card ended up on, for the pointer arrow. */
  side: 'top' | 'bottom' | 'left' | 'right' | 'center';
}

export function Tour() {
  /*
   * Two ways out, and they mean different things.
   *
   * `finish` closes the tour and records this page as seen, so it stops
   * offering itself here but still introduces the other pages. That is what
   * every incidental exit does — Escape, the ✕, a click on the dimmed area —
   * because none of those are a considered decision about the whole product.
   *
   * `dismiss` additionally stops the tour auto-starting anywhere. It is reached
   * only from the explicit "Skip tour" button on the opening step, where
   * someone is answering the offer rather than getting a popover off their
   * screen.
   *
   * `next` calls `finish` itself once past the last step, which is why "Done"
   * is just Next with a different label.
   */
  const { active, steps, index, running, next, back, finish, dismiss } = useTour();
  const cardRef = useRef<HTMLDivElement>(null);
  const [placed, setPlaced] = useState<Placed | null>(null);

  const step = steps[index];

  const reposition = useCallback(() => {
    const node = cardRef.current;
    if (!node || !step) return;
    setPlaced(place(step.anchor, step.placement, node.offsetWidth, node.offsetHeight));
  }, [step]);

  // Bring the anchor into view before measuring, or a step below the fold gets
  // a card pinned to the bottom edge pointing at nothing.
  useEffect(() => {
    if (!running || !step?.anchor) return;
    let element: Element | null = null;
    try {
      element = document.querySelector(step.anchor);
    } catch {
      element = null;
    }
    element?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [running, step]);

  useLayoutEffect(() => {
    if (!running) return;
    reposition();
  }, [running, reposition]);

  useEffect(() => {
    if (!running) return;
    // Scroll is captured because `scrollIntoView` above animates: the position
    // has to follow the element rather than being computed once, mid-flight.
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, true);
    return () => {
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', reposition, true);
    };
  }, [running, reposition]);

  useEffect(() => {
    if (!running) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') finish();
      else if (event.key === 'ArrowRight' || event.key === 'Enter') next();
      else if (event.key === 'ArrowLeft') back();
      else return;
      // Stopped as well as prevented: the control panel scores on arrow keys
      // from its own document-level listener, and a tour that adds points while
      // explaining the buttons would be worse than no tour.
      event.preventDefault();
      event.stopPropagation();
    };
    // Capture phase, so this runs before the page's own handlers rather than
    // after they have already acted.
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [running, next, back, finish]);

  useEffect(() => {
    if (running) cardRef.current?.focus();
  }, [running, index]);

  if (!running || !active || !step) return null;

  const isFirst = index === 0;
  const isLast = index === steps.length - 1;

  return (
    <div className="tour" role="dialog" aria-modal="true" aria-label={`${active.title} tour`}>
      {/*
        Clicking away closes the tour, so the dimmed page is never a trap. It
        also swallows the click rather than letting it reach whatever is
        underneath, which stops "I want out of this" from doubling as an
        accidental press on a live control.
      */}
      <div
        className={`tour__scrim${placed?.spotlight ? '' : ' tour__scrim--dim'}`}
        onClick={finish}
        role="presentation"
      />

      {placed?.spotlight ? (
        <div
          className="tour__spotlight"
          style={{
            top: placed.spotlight.top,
            left: placed.spotlight.left,
            width: placed.spotlight.width,
            height: placed.spotlight.height,
          }}
        />
      ) : null}

      <div
        className={`tour__card tour__card--${placed?.side ?? 'center'}`}
        ref={cardRef}
        tabIndex={-1}
        style={placed ? { top: placed.card.top, left: placed.card.left } : { visibility: 'hidden' }}
      >
        <div className="tour__head">
          <span className="tour__eyebrow">{active.title}</span>
          <button type="button" className="tour__close" onClick={finish} aria-label="Close tour">
            <IconClose size={14} />
          </button>
        </div>

        <h3 className="tour__title">{step.title}</h3>
        <p className="tour__body">{step.body}</p>

        <div className="tour__foot">
          <span className="tour__count">
            {index + 1} of {steps.length}
          </span>
          <div className="tour__actions">
            {isFirst ? (
              <button type="button" className="btn btn--sm" onClick={dismiss}>
                Skip tour
              </button>
            ) : (
              <button type="button" className="btn btn--sm" onClick={back}>
                Back
              </button>
            )}
            <button type="button" className="btn btn--primary btn--sm" onClick={next}>
              {isLast ? 'Done' : 'Next'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Places the card against its anchor, falling back through the other sides when
 * the preferred one has no room, and centring when there is no anchor at all.
 */
function place(
  anchor: string | undefined,
  preferred: 'top' | 'bottom' | 'left' | 'right' | undefined,
  cardWidth: number,
  cardHeight: number,
): Placed {
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;

  const centred: Placed = {
    spotlight: null,
    card: {
      top: Math.max(MARGIN, (viewportHeight - cardHeight) / 2),
      left: Math.max(MARGIN, (viewportWidth - cardWidth) / 2),
    },
    side: 'center',
  };

  if (!anchor) return centred;

  let element: Element | null = null;
  try {
    element = document.querySelector(anchor);
  } catch {
    return centred;
  }
  // An anchor that vanished mid-tour — a list that emptied, a card that
  // collapsed — centres rather than pointing off-screen.
  if (!element) return centred;

  const rect = element.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return centred;

  const spotlight: Box = {
    top: rect.top - PAD,
    left: rect.left - PAD,
    width: rect.width + PAD * 2,
    height: rect.height + PAD * 2,
  };

  const fits = {
    bottom: viewportHeight - rect.bottom - GAP >= cardHeight,
    top: rect.top - GAP >= cardHeight,
    right: viewportWidth - rect.right - GAP >= cardWidth,
    left: rect.left - GAP >= cardWidth,
  };

  // Preferred first, then the rest in a fixed order so the choice is stable
  // between repositions — a card that flips sides as the page settles reads as
  // a glitch.
  const order: ('top' | 'bottom' | 'left' | 'right')[] = ['bottom', 'top', 'right', 'left'];
  const side = (preferred && fits[preferred] ? preferred : order.find((s) => fits[s])) ?? null;
  if (side === null) return { ...centred, spotlight };

  const clamp = (value: number, max: number) => Math.max(MARGIN, Math.min(value, max - MARGIN));
  const acrossX = clamp(rect.left + rect.width / 2 - cardWidth / 2, viewportWidth - cardWidth);
  const acrossY = clamp(rect.top + rect.height / 2 - cardHeight / 2, viewportHeight - cardHeight);

  switch (side) {
    case 'bottom':
      return { spotlight, side, card: { top: rect.bottom + GAP, left: acrossX } };
    case 'top':
      return { spotlight, side, card: { top: rect.top - GAP - cardHeight, left: acrossX } };
    case 'right':
      return { spotlight, side, card: { top: acrossY, left: rect.right + GAP } };
    case 'left':
      return { spotlight, side, card: { top: acrossY, left: rect.left - GAP - cardWidth } };
  }
}
