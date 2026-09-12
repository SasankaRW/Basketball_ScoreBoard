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
 */
import { z } from 'zod';
import { ApiError, firestore, type SignedInCaller } from './common.js';
import type { SiteAdminActivity, SiteAdminOverview, SiteAdminTenant } from '../core/siteAdmin.js';

const SITE_ADMIN_EMAILS = new Set(['sasankarw@gmail.com']);

/** How many of the most recent cross-tenant events to bring back at once. */
const ACTIVITY_LIMIT = 100;

export const SiteAdminOverviewInput = z.object({});

export async function getSiteAdminOverview(caller: SignedInCaller): Promise<SiteAdminOverview> {
  if (!SITE_ADMIN_EMAILS.has(caller.email.toLowerCase())) {
    throw new ApiError(403, 'Not authorised.');
  }

  const tenantsSnapshot = await firestore.collection('tenants').get();
  const tenants: SiteAdminTenant[] = await Promise.all(
    tenantsSnapshot.docs.map(async (tenantDoc) => {
      const data = tenantDoc.data();
      const [members, boards] = await Promise.all([
        tenantDoc.ref.collection('members').count().get(),
        tenantDoc.ref.collection('boards').count().get(),
      ]);
      return {
        id: tenantDoc.id,
        name: typeof data['name'] === 'string' ? data['name'] : 'Untitled organisation',
        plan: typeof data['plan'] === 'string' ? data['plan'] : 'free',
        memberCount: members.data().count,
        boardCount: boards.data().count,
        createdAt: typeof data['createdAt'] === 'number' ? data['createdAt'] : 0,
      };
    }),
  );
  tenants.sort((a, b) => b.createdAt - a.createdAt);

  const tenantNames = new Map(tenants.map((tenant) => [tenant.id, tenant.name]));

  // `tenants/{tenantId}/audit/{auditId}` — the collection group has no
  // tenantId field of its own, so it comes from the document's grandparent
  // rather than its data.
  const activitySnapshot = await firestore
    .collectionGroup('audit')
    .orderBy('ts', 'desc')
    .limit(ACTIVITY_LIMIT)
    .get();

  const activity: SiteAdminActivity[] = activitySnapshot.docs.map((auditDoc) => {
    const data = auditDoc.data();
    const tenantId = auditDoc.ref.parent.parent?.id ?? '';
    return {
      id: auditDoc.id,
      tenantId,
      tenantName: tenantNames.get(tenantId) ?? tenantId,
      action: typeof data['action'] === 'string' ? data['action'] : '',
      detail: typeof data['detail'] === 'string' ? data['detail'] : '',
      actorEmail: typeof data['actorEmail'] === 'string' ? data['actorEmail'] : '',
      ts: typeof data['ts'] === 'number' ? data['ts'] : 0,
    };
  });

  return { tenants, activity };
}
