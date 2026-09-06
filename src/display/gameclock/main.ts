/**
 * Game-clock display — the board's game time alone, full screen.
 *
 * Everything is in `shared/clockScreen.ts`; this file exists only to name
 * which of the two clocks the page shows.
 */
import { startClockScreen } from '../shared/clockScreen.js';

void startClockScreen('game');
