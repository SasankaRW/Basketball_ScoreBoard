/**
 * The cross-tenant overview, for the one operator account this is bound to —
 * see `src/server/siteAdmin.ts` for why that is an email check rather than a
 * tenant role. The shapes live here, once, so the server's Admin-SDK reads
 * and this page's rendering can never quietly drift apart.
 */
import { callApi } from './api.js';
import type { PeriodPoints } from './matchRecord.js';
import type { Clock, Side } from './schema.js';

export interface SiteAdminTenant {
  id: string;
  name: string;
  plan: string;
  memberCount: number;
  boardCount: number;
  activeBoardCount: number;
  createdAt: number;
}

/**
 * One board with a game in progress, at the moment the overview was fetched.
 *
 * `gameClock`/`shotClock` are handed over whole rather than pre-computed into
 * a display string, so this page can tick them locally with the same
 * `remainingAt` / `useNow` every other screen uses — the only thing that goes
 * stale between a refresh here is the clock reading, not the arithmetic that
 * renders it.
 */
export interface SiteAdminRunningGame {
  tenantId: string;
  tenantName: string;
  boardId: string;
  boardName: string;
  homeName: string;
  homeScore: number;
  homeFouls: number;
  homeTimeouts: number;
  awayName: string;
  awayScore: number;
  awayFouls: number;
  awayTimeouts: number;
  period: number;
  possession: Side;
  gameClock: Clock;
  shotClock: Clock;
}

/**
 * Every board in every organisation, active or not — what answers "which
 * boards actually have a game running right now" at a glance, separate from
 * `runningGames`' per-game detail.
 */
export interface SiteAdminBoard {
  tenantId: string;
  tenantName: string;
  boardId: string;
  boardName: string;
  active: boolean;
}

export interface SiteAdminOverview {
  tenants: SiteAdminTenant[];
  runningGames: SiteAdminRunningGame[];
  boards: SiteAdminBoard[];
}

/** A finished game, trimmed to what the site-admin history list shows — no play-by-play. */
export interface SiteAdminMatchSummary {
  id: string;
  homeTeamName: string;
  awayTeamName: string;
  homeScore: number;
  awayScore: number;
  periodsPlayed: number;
  periodScores: PeriodPoints[];
  startedAt: number;
  endedAt: number;
  durationMs: number;
}

export async function getSiteAdminOverview(): Promise<SiteAdminOverview> {
  return callApi<SiteAdminOverview>('siteAdmin', { op: 'overview' });
}

/**
 * Deletes a board in any organisation — live state, secrets, and its
 * `boardIndex` entry included, the same cleanup `deleteBoard` does for a
 * tenant's own admin, just parameterised by an explicit `tenantId` since the
 * caller is not that tenant's member.
 */
export async function deleteSiteAdminBoard(tenantId: string, boardId: string): Promise<void> {
  await callApi<{ deleted: true }>('siteAdmin', { op: 'deleteBoard', tenantId, boardId });
}

/** The most recent finished games on one board, newest first. */
export async function getSiteAdminBoardMatches(
  tenantId: string,
  boardId: string,
): Promise<SiteAdminMatchSummary[]> {
  const { matches } = await callApi<{ matches: SiteAdminMatchSummary[] }>('siteAdmin', {
    op: 'boardMatches',
    tenantId,
    boardId,
  });
  return matches;
}
