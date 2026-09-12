/**
 * The cross-tenant overview, for the one operator account this is bound to —
 * see `src/server/siteAdmin.ts` for why that is an email check rather than a
 * tenant role. The shapes live here, once, so the server's Admin-SDK reads
 * and this page's rendering can never quietly drift apart.
 */
import { callApi } from './api.js';
import type { Clock } from './schema.js';

export interface SiteAdminTenant {
  id: string;
  name: string;
  plan: string;
  memberCount: number;
  boardCount: number;
  createdAt: number;
}

/**
 * One board with a game in progress, at the moment the overview was fetched.
 *
 * `gameClock` is handed over whole rather than pre-computed into a display
 * string, so this page can tick it locally with the same `remainingAt` /
 * `useNow` every other screen uses — the only thing that goes stale between
 * a refresh here is the clock reading, not the arithmetic that renders it.
 */
export interface SiteAdminRunningGame {
  tenantId: string;
  tenantName: string;
  boardId: string;
  boardName: string;
  homeName: string;
  homeScore: number;
  awayName: string;
  awayScore: number;
  period: number;
  gameClock: Clock;
}

export interface SiteAdminOverview {
  tenants: SiteAdminTenant[];
  runningGames: SiteAdminRunningGame[];
}

export async function getSiteAdminOverview(): Promise<SiteAdminOverview> {
  return callApi<SiteAdminOverview>('siteAdminOverview', {});
}
