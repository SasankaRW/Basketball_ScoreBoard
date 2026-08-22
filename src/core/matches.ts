/**
 * Match history — completed games.
 *
 * Read-only from the client's perspective plus one call: every record is
 * computed and written by the `finishMatch` server function
 * (src/server/matches.ts) from a board's actual live state, never
 * constructed here, so a client cannot fabricate a result no game produced.
 */
import {
  collection,
  doc,
  limit as fsLimit,
  onSnapshot,
  orderBy,
  query,
  type Firestore,
} from 'firebase/firestore';
import { callApi } from './api.js';
import type { PeriodPoints } from './matchRecord.js';

export interface MatchRecordDoc {
  id: string;
  boardId: string;
  boardName: string;
  homeTeamName: string;
  awayTeamName: string;
  homeScore: number;
  awayScore: number;
  homeFouls: number;
  awayFouls: number;
  homeTimeoutsUsed: number;
  awayTimeoutsUsed: number;
  periodsPlayed: number;
  periodScores: PeriodPoints[];
  startedAt: number;
  endedAt: number;
  durationMs: number;
  scheduleId: string | null;
  createdBy: string;
}

function toMatch(id: string, data: Record<string, unknown>): MatchRecordDoc {
  const num = (key: string): number => (typeof data[key] === 'number' ? (data[key] as number) : 0);
  const str = (key: string, fallback: string): string =>
    typeof data[key] === 'string' ? (data[key] as string) : fallback;

  return {
    id,
    boardId: str('boardId', ''),
    boardName: str('boardName', 'Board'),
    homeTeamName: str('homeTeamName', 'Home'),
    awayTeamName: str('awayTeamName', 'Away'),
    homeScore: num('homeScore'),
    awayScore: num('awayScore'),
    homeFouls: num('homeFouls'),
    awayFouls: num('awayFouls'),
    homeTimeoutsUsed: num('homeTimeoutsUsed'),
    awayTimeoutsUsed: num('awayTimeoutsUsed'),
    periodsPlayed: num('periodsPlayed'),
    periodScores: Array.isArray(data['periodScores'])
      ? (data['periodScores'] as PeriodPoints[])
      : [],
    startedAt: num('startedAt'),
    endedAt: num('endedAt'),
    durationMs: num('durationMs'),
    scheduleId: typeof data['scheduleId'] === 'string' ? data['scheduleId'] : null,
    createdBy: str('createdBy', ''),
  };
}

export function subscribeMatches(
  firestore: Firestore,
  tenantId: string,
  onChange: (matches: MatchRecordDoc[]) => void,
  options: { limit?: number } = {},
  onError?: (error: Error) => void,
): () => void {
  const matchesQuery = query(
    collection(firestore, 'tenants', tenantId, 'matches'),
    orderBy('endedAt', 'desc'),
    fsLimit(options.limit ?? 100),
  );
  return onSnapshot(
    matchesQuery,
    (snapshot) => onChange(snapshot.docs.map((d) => toMatch(d.id, d.data()))),
    (error) => onError?.(error),
  );
}

export function subscribeMatch(
  firestore: Firestore,
  tenantId: string,
  matchId: string,
  onChange: (match: MatchRecordDoc | null) => void,
  onError?: (error: Error) => void,
): () => void {
  return onSnapshot(
    doc(firestore, 'tenants', tenantId, 'matches', matchId),
    (snapshot) => onChange(snapshot.exists() ? toMatch(snapshot.id, snapshot.data()) : null),
    (error) => onError?.(error),
  );
}

export async function finishMatch(boardId: string): Promise<{ matchId: string }> {
  return callApi<{ matchId: string }>('finishMatch', { boardId });
}
