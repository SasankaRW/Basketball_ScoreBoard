/**
 * Shot-clock display — the board's shot clock alone, full screen, for a pole
 * mount or a second monitor above the basket.
 *
 * Everything is in `shared/clockScreen.ts`; this file exists only to name
 * which of the two clocks the page shows.
 */
import { startClockScreen } from '../shared/clockScreen.js';

void startClockScreen('shot');
