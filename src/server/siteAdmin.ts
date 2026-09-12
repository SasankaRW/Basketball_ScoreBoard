/**
 * Cross-tenant oversight for a single operator — deliberately not a tenant
 * role, and not linked from anywhere in the UI; reaching it is knowing the
 * URL.
 *
 * Bound to an email rather than a custom claim on purpose. Every claim-writing
 * path in this codebase (`inviteMember` → `acceptInvite`, `setMemberRole`,
 * `removeMember`) calls `auth.setCustomUserClaims` with exactly `{ tenantId,
 * role }` — it *replaces* the claims object, not merges into it — so a
 * `siteAdmin` flag folded in there would be one ordinary role change away from
 * silently disappearing, on an account that legitimately also has (and keeps)
 * a normal tenant membership. A plain email check against the verified ID
 * token has no such failure mode, survives every one of those writes
 * untouched, and needs no bootstrap script to grant.
 *
 * The running-games read goes straight at the Realtime Database with the
 * Admin SDK, the same way `startScheduledMatch`/`finishMatch` do — it bypasses
 * `database.rules.json` entirely, which is what makes a *cross*-tenant read
 * possible at all: every per-tenant rule on that tree only ever grants a
 * client its own tenant's `live/{tenantId}` subtree, and this deliberately
 * never becomes a rule or a claim, so that boundary is not weakened for
 * anyone but this one server-side query.
 */
import { z } from 'zod';
import { ApiError, database, firestore, type SignedInCaller } from './common.js';
import { isBoardIdle, parseLiveBoardState } from '../core/schema.js';
import type {
  SiteAdminOverview,
  SiteAdminRunningGame,
  SiteAdminTenant,
} from '../core/siteAdmin.js';

const SITE_ADMIN_EMAILS = new Set(['sasankarw@gmail.com']);

export const SiteAdminOverviewInput = z.object({});

export async function getSiteAdminOverview(caller: SignedInCaller): Promise<SiteAdminOverview> {
  if (!SITE_ADMIN_EMAILS.has(caller.email.toLowerCase())) {
    throw new ApiError(403, 'Not authorised.');
  }

  const tenantsSnapshot = await firestore.collection('tenants').get();

  const perTenant = await Promise.all(
    tenantsSnapshot.docs.map(async (tenantDoc) => {
      const data = tenantDoc.data();
      const [membersCount, boardsSnapshot] = await Promise.all([
        tenantDoc.ref.collection('members').count().get(),
        tenantDoc.ref.collection('boards').get(),
      ]);

      const activeBoards = boardsSnapshot.docs
        .filter((boardDoc) => boardDoc.data()['archived'] !== true)
        .map((boardDoc) => ({
          id: boardDoc.id,
          name:
            typeof boardDoc.data()['name'] === 'string'
              ? (boardDoc.data()['name'] as string)
              : 'Untitled board',
        }));

      const tenant: SiteAdminTenant = {
        id: tenantDoc.id,
        name: typeof data['name'] === 'string' ? data['name'] : 'Untitled organisation',
        plan: typeof data['plan'] === 'string' ? data['plan'] : 'free',
        memberCount: membersCount.data().count,
        boardCount: boardsSnapshot.size,
        createdAt: typeof data['createdAt'] === 'number' ? data['createdAt'] : 0,
      };

      return { tenant, boards: activeBoards };
    }),
  );

  const tenants = perTenant.map((entry) => entry.tenant).sort((a, b) => b.createdAt - a.createdAt);

  // One read for the whole tree rather than one per board — `live/{tenantId}`
  // holds every board this tenant has, so this is the same number of round
  // trips regardless of how many tenants or boards exist.
  const liveSnapshot = await database.ref('live').get();
  const liveTree = (liveSnapshot.val() ?? {}) as Record<
    string,
    Record<string, { state?: unknown }> | undefined
  >;

  const runningGames: SiteAdminRunningGame[] = [];
  for (const { tenant, boards } of perTenant) {
    const tenantLive = liveTree[tenant.id];
    if (!tenantLive) continue;

    for (const board of boards) {
      const state = parseLiveBoardState(tenantLive[board.id]?.state);
      if (!state || isBoardIdle(state)) continue;

      runningGames.push({
        tenantId: tenant.id,
        tenantName: tenant.name,
        boardId: board.id,
        boardName: board.name,
        homeName: state.home.name,
        homeScore: state.home.score,
        awayName: state.away.name,
        awayScore: state.away.score,
        period: state.period,
        gameClock: state.gameClock,
      });
    }
  }

  return { tenants, runningGames };
}
