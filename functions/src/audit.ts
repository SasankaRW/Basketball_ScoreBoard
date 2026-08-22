/**
 * Audit trail for live board changes.
 *
 * Fires on every committed write to a board's state. This is affordable only
 * because of the deadline clock: the original design wrote once per second, which
 * would have meant ~1,400 audit rows per period. Writes now happen once per
 * actual operator action, so the log reads as a record of decisions rather than
 * a record of seconds passing.
 */
import { onValueWritten } from 'firebase-functions/v2/database';
import { REGION, writeAudit } from './common.js';

/** Fields whose change is worth recording. `rev` and `updatedAt` move on every write. */
const TRACKED: readonly string[] = [
  'period',
  'possession',
  'home',
  'away',
  'gameClock',
  'shotClock',
  'config',
];

interface ClockLike {
  running?: boolean;
  remainingMs?: number;
}

function describeClock(label: string, before: unknown, after: unknown): string | null {
  const a = (before ?? {}) as ClockLike;
  const b = (after ?? {}) as ClockLike;
  if (a.running !== b.running) return `${label} ${b.running ? 'started' : 'stopped'}`;
  if (a.remainingMs !== b.remainingMs) {
    return `${label} set to ${Math.round((b.remainingMs ?? 0) / 1000)}s`;
  }
  return null;
}

function describeTeam(label: string, before: unknown, after: unknown): string[] {
  const a = (before ?? {}) as Record<string, unknown>;
  const b = (after ?? {}) as Record<string, unknown>;
  const notes: string[] = [];
  for (const field of ['score', 'fouls', 'timeouts', 'name'] as const) {
    if (a[field] !== b[field])
      notes.push(`${label} ${field}: ${String(a[field])} → ${String(b[field])}`);
  }
  return notes;
}

function summarise(before: Record<string, unknown>, after: Record<string, unknown>): string {
  const notes: string[] = [];

  notes.push(...describeTeam('home', before['home'], after['home']));
  notes.push(...describeTeam('away', before['away'], after['away']));

  const game = describeClock('game clock', before['gameClock'], after['gameClock']);
  if (game) notes.push(game);
  const shot = describeClock('shot clock', before['shotClock'], after['shotClock']);
  if (shot) notes.push(shot);

  if (before['period'] !== after['period']) {
    notes.push(`period: ${String(before['period'])} → ${String(after['period'])}`);
  }
  if (before['possession'] !== after['possession']) {
    notes.push(`possession: ${String(after['possession'])}`);
  }
  if (JSON.stringify(before['config']) !== JSON.stringify(after['config'])) {
    notes.push('board configuration changed');
  }

  return notes.slice(0, 6).join('; ');
}

export const onBoardStateWritten = onValueWritten(
  {
    ref: '/live/{tenantId}/{boardId}/state',
    region: REGION,
    maxInstances: 20,
  },
  async (event) => {
    const before = (event.data.before.val() ?? {}) as Record<string, unknown>;
    const after = event.data.after.val() as Record<string, unknown> | null;

    // Deletions are recorded by deleteBoard, which knows who asked.
    if (after === null) return;

    const changed = TRACKED.some(
      (field) => JSON.stringify(before[field]) !== JSON.stringify(after[field]),
    );
    if (!changed) return;

    const detail = summarise(before, after);
    if (detail === '') return;

    await writeAudit({
      tenantId: event.params['tenantId'] as string,
      actorUid: typeof after['updatedBy'] === 'string' ? after['updatedBy'] : 'unknown',
      action: 'BOARD_STATE_CHANGED',
      boardId: event.params['boardId'] as string,
      detail,
    });
  },
);
