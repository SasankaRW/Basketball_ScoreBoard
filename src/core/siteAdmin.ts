/**
 * The cross-tenant overview, for the one operator account this is bound to —
 * see `src/server/siteAdmin.ts` for why that is an email check rather than a
 * tenant role. The shapes live here, once, so the server's Admin-SDK reads
 * and this page's rendering can never quietly drift apart.
 */
import { callApi } from './api.js';
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

export async function getSiteAdminOverview(): Promise<SiteAdminOverview> {
  return callApi<SiteAdminOverview>('siteAdminOverview', {});
}
