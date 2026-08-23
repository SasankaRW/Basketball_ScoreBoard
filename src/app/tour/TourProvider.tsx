/**
 * The tour's state machine, and the decision of when to start one unasked.
 *
 * Split from the rendering in `Tour.tsx` so that "which step are we on, and may
 * we auto-start" stays readable without the positioning arithmetic next to it.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '../AuthProvider.js';
import { readProgress, writeProgress } from './progress.js';
import { tourForPath, type TourDefinition, type TourStep } from './steps.js';

interface TourContextValue {
  /** The tour currently on screen, or null. */
  active: TourDefinition | null;
  /** Index into `steps` below — not into the definition, which may be longer. */
  index: number;
  /** Steps whose anchors actually exist on this page right now. */
  steps: TourStep[];
  /** True when a tour is on screen, which page-level key handlers must respect. */
  running: boolean;
  /** Whether the current page has a tour at all, so Help can disable itself. */
  available: boolean;
  start: () => void;
  next: () => void;
  back: () => void;
  /** Ends the tour, recording it as seen. */
  finish: () => void;
  /** Ends the tour and stops it offering itself anywhere again. */
  dismiss: () => void;
}

const TourContext = createContext<TourContextValue | null>(null);

/**
 * Drops steps whose anchor is not on the page.
 *
 * The dashboard is the case that forces this: a brand-new account sees the
 * empty state, so there is no board card and no members table to point at, and
 * the very first tour anyone runs would otherwise be mostly popovers aimed at
 * nothing. Resolved once when the tour starts rather than per render, so the
 * step count in the footer cannot change underneath someone mid-tour.
 */
function resolveSteps(definition: TourDefinition): TourStep[] {
  return definition.steps.filter((step) => {
    if (!step.anchor) return true;
    try {
      return document.querySelector(step.anchor) !== null;
    } catch {
      // A malformed selector is an authoring mistake, not a reason to break the
      // console — drop the step and carry on.
      return false;
    }
  });
}

export function TourProvider({ children }: { children: ReactNode }) {
  const { state } = useAuth();
  const location = useLocation();
  const uid = state.status === 'signed-in' ? state.session.uid : null;

  const definition = useMemo(() => tourForPath(location.pathname), [location.pathname]);

  const [active, setActive] = useState<TourDefinition | null>(null);
  const [steps, setSteps] = useState<TourStep[]>([]);
  const [index, setIndex] = useState(0);

  const start = useCallback(() => {
    if (!definition) return;
    const resolved = resolveSteps(definition);
    if (resolved.length === 0) return;
    setSteps(resolved);
    setIndex(0);
    setActive(definition);
  }, [definition]);

  const close = useCallback(
    (options: { seen?: string; dismiss?: boolean }) => {
      setActive(null);
      setSteps([]);
      setIndex(0);
      if (!uid) return;

      const progress = readProgress(uid);
      writeProgress(uid, {
        dismissed: progress.dismissed || options.dismiss === true,
        seen:
          options.seen && !progress.seen.includes(options.seen)
            ? [...progress.seen, options.seen]
            : progress.seen,
      });
    },
    [uid],
  );

  const finish = useCallback(() => close({ seen: active?.id }), [close, active]);
  const dismiss = useCallback(() => close({ dismiss: true, seen: active?.id }), [close, active]);

  // Advancing past the last step ends the tour, which is what makes the final
  // button read "Done" rather than dead-ending on a Next that does nothing.
  const next = useCallback(() => {
    if (index + 1 < steps.length) setIndex(index + 1);
    else finish();
  }, [index, steps.length, finish]);

  const back = useCallback(() => setIndex((current) => Math.max(0, current - 1)), []);

  /**
   * Auto-start, once per page per person.
   *
   * Deliberately delayed rather than run on mount. Every page here fills in from
   * a Firestore or Realtime Database listener, so at mount the board grid, the
   * schedule and the match list are all still empty — resolving anchors at that
   * moment would discard most of the tour as "not on the page". The delay lets
   * the first snapshot land. It is a timing compromise, not a guess at load
   * time: a step that is still missing afterwards is dropped, which is the same
   * outcome as any other stale anchor.
   */
  const startedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!uid || !definition) return;
    if (startedFor.current === definition.id) return;

    const progress = readProgress(uid);
    if (progress.dismissed || progress.seen.includes(definition.id)) {
      startedFor.current = definition.id;
      return;
    }

    const timer = setTimeout(() => {
      startedFor.current = definition.id;
      start();
    }, 600);
    return () => clearTimeout(timer);
  }, [uid, definition, start]);

  // Leaving the page abandons the tour rather than leaving a popover pointing
  // at markup that is no longer there. Not recorded as seen: it was not.
  const pathname = location.pathname;
  useEffect(() => {
    setActive(null);
    setSteps([]);
    setIndex(0);
  }, [pathname]);

  const value = useMemo<TourContextValue>(
    () => ({
      active,
      index,
      steps,
      running: active !== null,
      available: definition !== null,
      start,
      next,
      back,
      finish,
      dismiss,
    }),
    [active, index, steps, definition, start, next, back, finish, dismiss],
  );

  return <TourContext.Provider value={value}>{children}</TourContext.Provider>;
}

/**
 * Tour state for components that need it.
 *
 * Returns an inert value outside a provider rather than throwing, so a page
 * rendered on its own — the login screen, a test harness — is not required to
 * wrap itself in a tour it will never show.
 */
export function useTour(): TourContextValue {
  return useContext(TourContext) ?? INERT;
}

const INERT: TourContextValue = {
  active: null,
  index: 0,
  steps: [],
  running: false,
  available: false,
  start: () => undefined,
  next: () => undefined,
  back: () => undefined,
  finish: () => undefined,
  dismiss: () => undefined,
};
