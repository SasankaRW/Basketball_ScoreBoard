/**
 * The self-scheduling render timer every display surface runs on.
 *
 * Its own module rather than a corner of `scoreboardView.ts` because of what
 * that costs downstream: the overlay and the two clock screens want the loop
 * and nothing else, and Rollup chunks by which entries can reach a module — so
 * while this lived alongside `renderScoreboard`, those three pages each
 * downloaded the full scoreboard renderer to call one twenty-line function.
 */

/**
 * Drives `render` on a self-scheduling timer.
 *
 * `setTimeout` rather than `requestAnimationFrame`: rAF is paused entirely in a
 * background tab, which would freeze the clock and — more importantly — swallow
 * the end-of-period buzzer whenever the operator tabbed away. Timers keep
 * running, throttled to about once a second, which is exactly the resolution a
 * clock display needs.
 *
 * `render` returns how long until the text it drew would next change, so an
 * idle display sleeps instead of polling.
 */
export function startDisplayLoop(render: () => number): () => void {
  let handle: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;

  const step = () => {
    if (stopped) return;
    const nextDelay = render();
    const delay = Math.max(16, Math.min(1_000, Number.isFinite(nextDelay) ? nextDelay : 1_000));
    handle = setTimeout(step, delay);
  };

  /**
   * Timers surviving a hidden tab is not the same as surviving it *on time*.
   * A backgrounded page's `setTimeout` is clamped to about a second, and after
   * a few minutes hidden Chrome cuts it to roughly once a minute — so a
   * surface coming back into view is still showing whatever frame its last
   * late tick drew, which on a clock reads as a stall followed by a jump. The
   * deadline arithmetic was right the whole time; nobody had asked it.
   *
   * Rendering on the transition replaces that frame before anyone reads it,
   * and re-arms the timer from now rather than leaving the throttled one to
   * expire in its own time.
   */
  const onVisibilityChange = () => {
    if (stopped || document.visibilityState !== 'visible') return;
    if (handle !== null) clearTimeout(handle);
    step();
  };

  document.addEventListener('visibilitychange', onVisibilityChange);

  step();

  return () => {
    stopped = true;
    document.removeEventListener('visibilitychange', onVisibilityChange);
    if (handle !== null) clearTimeout(handle);
  };
}
