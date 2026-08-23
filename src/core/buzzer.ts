/**
 * Buzzer playback, shared by every surface that needs to sound one.
 *
 * The awkward part is not playing a sound, it is being *allowed* to. Browsers
 * reject programmatic playback until the page has seen a real user gesture,
 * and they reject it silently as a rejected promise — so a surface that never
 * gets clicked simply never buzzes, with nothing anywhere explaining why. That
 * bit the scoreboard, which is a passive display an operator may never touch.
 *
 * `unlock()` is the fix: called during a genuine gesture, it plays and
 * immediately pauses each element, which marks it user-activated so later
 * unattended playback is permitted. Wiring that (and the "still blocked"
 * reporting) once here keeps the two surfaces from drifting apart.
 */

export interface Buzzers {
  play(which: 'shotClock' | 'gameOver'): void;
  /** Safe to call on every gesture; does nothing once unlocked. */
  unlock(): void;
  /** Fires at most once, when playback is refused despite an unlock attempt. */
  onBlocked(handler: () => void): void;
}

export interface BuzzerSources {
  shotClock: HTMLAudioElement | null;
  gameOver: HTMLAudioElement | null;
}

/** Builds detached audio elements, for surfaces with no markup of their own. */
export function createBuzzerElements(): BuzzerSources {
  if (typeof Audio === 'undefined') return { shotClock: null, gameOver: null };
  const shotClock = new Audio('/assets/ShotClockBuzzer.mp3');
  const gameOver = new Audio('/assets/gameOverSound.mp3');
  for (const audio of [shotClock, gameOver]) audio.preload = 'auto';
  return { shotClock, gameOver };
}

/**
 * Relative levels carried over from the original scoreboard: the game-over
 * horn is a longer, fuller sample than the shot-clock buzzer and overpowers it
 * at equal gain.
 */
const VOLUME: Record<keyof BuzzerSources, number> = { shotClock: 0.8, gameOver: 0.7 };

export function createBuzzers(sources: BuzzerSources): Buzzers {
  const all = [sources.shotClock, sources.gameOver].filter(
    (audio): audio is HTMLAudioElement => audio !== null,
  );

  for (const key of ['shotClock', 'gameOver'] as const) {
    const audio = sources[key];
    if (audio) audio.volume = VOLUME[key];
  }

  let unlocked = false;
  let blockedReported = false;
  let blockedHandler: (() => void) | null = null;

  function reportBlocked(): void {
    if (blockedReported) return;
    blockedReported = true;
    blockedHandler?.();
  }

  return {
    unlock() {
      if (unlocked) return;
      unlocked = true;
      for (const audio of all) {
        void audio
          .play()
          .then(() => {
            audio.pause();
            audio.currentTime = 0;
          })
          // Still refused — drop the flag so the next gesture tries again
          // rather than assuming one failed attempt settles it forever.
          .catch(() => {
            unlocked = false;
          });
      }
    },

    play(which) {
      const audio = sources[which];
      if (!audio) return;
      audio.currentTime = 0;
      void audio.play().catch(reportBlocked);
    },

    onBlocked(handler) {
      blockedHandler = handler;
    },
  };
}
