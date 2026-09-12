import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { defaultLayout, type BoardLayout } from '../../src/core/boardLayout.js';
import { createInitialState, DEFAULT_CONFIG, type BoardState } from '../../src/core/schema.js';
import type { TimelineEvent } from '../../src/core/timeline.js';

export const TENANT_A = 'tnt_aaaaaaaaaaaa';
export const TENANT_B = 'tnt_bbbbbbbbbbbb';

export const BOARD_A1 = 'brd_a1aaaaaaaaa';
export const BOARD_A2 = 'brd_a2aaaaaaaaa';
export const BOARD_B1 = 'brd_b1bbbbbbbbb';

export const UID_OWNER_A = 'uid_owner_a';
export const UID_ADMIN_A = 'uid_admin_a';
export const UID_OPERATOR_A = 'uid_operator_a';
export const UID_VIEWER_A = 'uid_viewer_a';
export const UID_OPERATOR_B = 'uid_operator_b';

export type Role = 'owner' | 'admin' | 'operator' | 'viewer' | 'overlay' | 'mirror';

export function claims(tenantId: string, role: Role, boardId?: string) {
  return boardId ? { tenantId, role, boardId } : { tenantId, role };
}

export function statePath(tenantId: string, boardId: string): string {
  return `live/${tenantId}/${boardId}/state`;
}

export function eventsPath(tenantId: string, boardId: string): string {
  return `live/${tenantId}/${boardId}/events`;
}

export function layoutPath(tenantId: string, boardId: string): string {
  return `live/${tenantId}/${boardId}/layout`;
}

/**
 * A layout document that satisfies every `.validate` rule.
 *
 * Built from `defaultLayout()` rather than hand-written, so the bounds in
 * `database.rules.json` are tested against the shape the app actually writes —
 * the two are hand-mirrored, and this is where a drift between them surfaces.
 */
export function validLayout(overrides: Partial<BoardLayout> = {}): Record<string, unknown> {
  return {
    ...defaultLayout(),
    updatedAt: Date.now(),
    updatedBy: UID_OPERATOR_A,
    ...overrides,
  };
}

/** A timeline entry that satisfies every `.validate` rule. */
export function validEvent(overrides: Partial<TimelineEvent> = {}): Record<string, unknown> {
  const base: TimelineEvent = {
    ts: Date.now(),
    period: 1,
    clockMs: 480_000,
    type: 'score',
    side: 'home',
    delta: 2,
    home: 2,
    away: 0,
    actor: UID_OPERATOR_A,
  };
  // Null is how `side` is absent for a period change, and the Realtime Database
  // strips such keys on write — dropping it here matches what production
  // actually stores rather than testing a shape that never reaches the rules.
  const merged: Record<string, unknown> = { ...base, ...overrides };
  if (merged['side'] === null) delete merged['side'];
  return merged;
}

/**
 * A board state that satisfies every `.validate` rule.
 *
 * `updatedAt` uses real wall-clock time because the rules bound it against the
 * emulator's `now`, and `rev` defaults to 1 so a first write onto an empty node
 * is not mistaken for a skipped revision.
 */
export function validState(overrides: Partial<BoardState> = {}): BoardState {
  const base = createInitialState(DEFAULT_CONFIG, Date.now(), UID_OPERATOR_A);
  return { ...base, rev: 1, updatedAt: Date.now(), ...overrides };
}

export async function createTestEnv(): Promise<RulesTestEnvironment> {
  const root = process.cwd();
  return initializeTestEnvironment({
    projectId: 'scoreboard-rules-test',
    firestore: {
      rules: readFileSync(resolve(root, 'firestore.rules'), 'utf8'),
      host: '127.0.0.1',
      // 8085 rather than the Firebase default of 8080, which Docker Desktop
      // commonly occupies. Kept in step with the `emulators` block in firebase.json.
      port: 8085,
    },
    database: {
      rules: readFileSync(resolve(root, 'database.rules.json'), 'utf8'),
      host: '127.0.0.1',
      port: 9010,
    },
    storage: {
      rules: readFileSync(resolve(root, 'storage.rules'), 'utf8'),
      host: '127.0.0.1',
      port: 9199,
    },
  });
}
