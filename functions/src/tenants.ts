/**
 * Tenant provisioning.
 *
 * This is the only path that creates a tenant, and it is a Function rather than
 * a client write for one reason: it has to set auth custom claims, which only
 * the Admin SDK can do. Those claims are what every security rule keys off, so
 * the moment a client could influence them the whole isolation model collapses.
 */
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { z } from 'zod';
import { generateTenantId, slugify } from '../../src/core/ids.js';
import { auth, firestore, REGION, requireSignedIn, writeAudit } from './common.js';

const ProvisionInput = z.object({
  organisationName: z.string().trim().min(1).max(80),
});

export const provisionTenant = onCall({ region: REGION, maxInstances: 10 }, async (request) => {
  const { uid, email } = requireSignedIn(request);

  const parsed = ProvisionInput.safeParse(request.data);
  if (!parsed.success) {
    throw new HttpsError('invalid-argument', 'Organisation name must be 1–80 characters.');
  }
  const organisationName = parsed.data.organisationName;

  const indexRef = firestore.collection('userIndex').doc(uid);

  /**
   * Idempotent by construction. Signup retries, a double-clicked button, and a
   * Function retried after a transient error all resolve to the same tenant
   * instead of leaving an orphan behind — the transaction claims `userIndex/{uid}`
   * first, and only the winner creates anything.
   */
  const tenantId = await firestore.runTransaction(async (tx) => {
    const existing = await tx.get(indexRef);
    if (existing.exists) {
      const known = existing.data()?.['tenantId'];
      if (typeof known === 'string') return known;
    }

    const newTenantId = generateTenantId();
    const now = Date.now();

    tx.set(firestore.collection('tenants').doc(newTenantId), {
      name: organisationName,
      slug: slugify(organisationName, 'organisation'),
      plan: 'free',
      status: 'active',
      ownerUid: uid,
      settings: {},
      createdAt: now,
      updatedAt: now,
    });

    tx.set(firestore.collection('tenants').doc(newTenantId).collection('members').doc(uid), {
      email,
      displayName: (request.auth?.token['name'] as string | undefined) ?? '',
      role: 'owner',
      status: 'active',
      createdAt: now,
    });

    tx.set(indexRef, { tenantId: newTenantId, createdAt: now });
    return newTenantId;
  });

  // Claims are set outside the transaction because they live in the Auth
  // service, not Firestore. Re-setting them on a retry is harmless.
  await auth.setCustomUserClaims(uid, { tenantId, role: 'owner' });

  await writeAudit({
    tenantId,
    actorUid: uid,
    actorEmail: email,
    action: 'TENANT_PROVISIONED',
    detail: organisationName,
  });

  return { tenantId };
});
