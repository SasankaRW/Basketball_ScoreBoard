/**
 * The cross-tenant overview, for the one operator account this is bound to —
 * see `src/server/siteAdmin.ts` for why that is an email check rather than a
 * tenant role. The shapes live here, once, so the server's Admin-SDK query
 * and this page's rendering can never quietly drift apart.
 */
import { callApi } from './api.js';

export interface SiteAdminTenant {
  id: string;
  name: string;
  plan: string;
  memberCount: number;
  boardCount: number;
  createdAt: number;
}

export interface SiteAdminActivity {
  id: string;
  tenantId: string;
  tenantName: string;
  action: string;
  detail: string;
  actorEmail: string;
  ts: number;
}

export interface SiteAdminOverview {
  tenants: SiteAdminTenant[];
  /** Most recent first, across every tenant. */
  activity: SiteAdminActivity[];
}

export async function getSiteAdminOverview(): Promise<SiteAdminOverview> {
  return callApi<SiteAdminOverview>('siteAdminOverview', {});
}
