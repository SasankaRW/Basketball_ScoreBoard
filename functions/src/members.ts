/**
 * Membership management.
 *
 * Every write here updates two things that must never disagree: the auth custom
 * claim (which the security rules enforce) and the member document (which the
 * dashboard displays). The claim is written first — if the second write fails,
 * the result is a UI that under-reports someone's access rather than a UI that
 * promises access the backend will refuse.
 */
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { z } from 'zod';
import { generateInviteId } from '../../src/core/ids.js';
import { MEMBER_ROLES, type MemberRole } from '../../src/core/roles.js';
import {
  auth,
  firestore,
  limitsForPlan,
  REGION,
  requireRole,
  requireSignedIn,
  writeAudit,
} from './common.js';

const RoleSchema = z.enum(MEMBER_ROLES);
const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const InviteInput = z.object({
  email: z.string().trim().email().max(200),
  role: RoleSchema,
});

export const inviteMember = onCall({ region: REGION, maxInstances: 10 }, async (request) => {
  const caller = requireRole(request, 'admin');

  const parsed = InviteInput.safeParse(request.data);
  if (!parsed.success) throw new HttpsError('invalid-argument', 'Provide a valid email and role.');

  // Only an owner can create another owner; otherwise an admin could promote
  // themselves sideways into control of billing and tenant deletion.
  if (parsed.data.role === 'owner' && caller.role !== 'owner') {
    throw new HttpsError('permission-denied', 'Only the owner can invite another owner.');
  }

  const tenantRef = firestore.collection('tenants').doc(caller.tenantId);
  const tenantSnapshot = await tenantRef.get();
  const limits = limitsForPlan(tenantSnapshot.data()?.['plan']);
  const memberCount = await tenantRef.collection('members').count().get();
  if (memberCount.data().count >= limits.members) {
    throw new HttpsError('failed-precondition', `Your plan allows ${limits.members} members.`);
  }

  const inviteId = generateInviteId();
  await firestore
    .collection('invites')
    .doc(inviteId)
    .set({
      tenantId: caller.tenantId,
      tenantName: tenantSnapshot.data()?.['name'] ?? '',
      email: parsed.data.email.toLowerCase(),
      role: parsed.data.role,
      invitedBy: caller.uid,
      createdAt: Date.now(),
      expiresAt: Date.now() + INVITE_TTL_MS,
      acceptedAt: null,
    });

  await writeAudit({
    tenantId: caller.tenantId,
    actorUid: caller.uid,
    actorEmail: caller.email,
    action: 'MEMBER_INVITED',
    detail: `${parsed.data.email} as ${parsed.data.role}`,
  });

  return { inviteId, inviteUrl: `/join/${inviteId}` };
});

export const acceptInvite = onCall({ region: REGION, maxInstances: 10 }, async (request) => {
  const { uid, email } = requireSignedIn(request);

  const parsed = z.object({ inviteId: z.string().min(8).max(40) }).safeParse(request.data);
  if (!parsed.success) throw new HttpsError('invalid-argument', 'Invalid invite.');

  const inviteRef = firestore.collection('invites').doc(parsed.data.inviteId);
  const invite = await inviteRef.get();
  if (!invite.exists) throw new HttpsError('not-found', 'This invite does not exist.');

  const data = invite.data() ?? {};
  if (data['acceptedAt']) throw new HttpsError('failed-precondition', 'Invite already used.');
  if (typeof data['expiresAt'] === 'number' && data['expiresAt'] < Date.now()) {
    throw new HttpsError('failed-precondition', 'This invite has expired.');
  }
  // Binding the invite to an address stops a forwarded link from onboarding
  // someone the admin never intended to add.
  if (typeof data['email'] === 'string' && data['email'] !== email.toLowerCase()) {
    throw new HttpsError('permission-denied', 'This invite was issued to a different email.');
  }

  const tenantId = data['tenantId'] as string;
  const role = data['role'] as MemberRole;

  await auth.setCustomUserClaims(uid, { tenantId, role });

  const now = Date.now();
  await firestore.runTransaction(async (tx) => {
    tx.set(firestore.collection('tenants').doc(tenantId).collection('members').doc(uid), {
      email,
      displayName: (request.auth?.token['name'] as string | undefined) ?? '',
      role,
      status: 'active',
      createdAt: now,
    });
    tx.set(firestore.collection('userIndex').doc(uid), { tenantId, createdAt: now });
    tx.update(inviteRef, { acceptedAt: now, acceptedBy: uid });
  });

  await writeAudit({
    tenantId,
    actorUid: uid,
    actorEmail: email,
    action: 'MEMBER_JOINED',
    detail: role,
  });

  return { tenantId, role };
});

const SetRoleInput = z.object({ uid: z.string().min(1).max(128), role: RoleSchema });

export const setMemberRole = onCall({ region: REGION, maxInstances: 10 }, async (request) => {
  const caller = requireRole(request, 'admin');

  const parsed = SetRoleInput.safeParse(request.data);
  if (!parsed.success) throw new HttpsError('invalid-argument', 'Provide a valid member and role.');
  const { uid: targetUid, role } = parsed.data;

  if (targetUid === caller.uid) {
    throw new HttpsError('failed-precondition', 'You cannot change your own role.');
  }

  const memberRef = firestore
    .collection('tenants')
    .doc(caller.tenantId)
    .collection('members')
    .doc(targetUid);
  const member = await memberRef.get();
  if (!member.exists) throw new HttpsError('not-found', 'That member is not in your organisation.');

  const currentRole = member.data()?.['role'];
  // An admin may not create or demote an owner. Both directions are owner-only,
  // or an admin could strip the owner and take over the tenant.
  if ((role === 'owner' || currentRole === 'owner') && caller.role !== 'owner') {
    throw new HttpsError('permission-denied', 'Only the owner can manage owner roles.');
  }

  await auth.setCustomUserClaims(targetUid, { tenantId: caller.tenantId, role });
  await memberRef.update({ role, updatedAt: Date.now() });

  await writeAudit({
    tenantId: caller.tenantId,
    actorUid: caller.uid,
    actorEmail: caller.email,
    action: 'MEMBER_ROLE_CHANGED',
    detail: `${targetUid} -> ${role}`,
  });

  return { ok: true };
});

export const removeMember = onCall({ region: REGION, maxInstances: 10 }, async (request) => {
  const caller = requireRole(request, 'admin');

  const parsed = z.object({ uid: z.string().min(1).max(128) }).safeParse(request.data);
  if (!parsed.success) throw new HttpsError('invalid-argument', 'Unknown member.');
  const targetUid = parsed.data.uid;

  if (targetUid === caller.uid) {
    throw new HttpsError('failed-precondition', 'You cannot remove yourself.');
  }

  const memberRef = firestore
    .collection('tenants')
    .doc(caller.tenantId)
    .collection('members')
    .doc(targetUid);
  const member = await memberRef.get();
  if (!member.exists) throw new HttpsError('not-found', 'That member is not in your organisation.');
  if (member.data()?.['role'] === 'owner') {
    throw new HttpsError('failed-precondition', 'The owner cannot be removed.');
  }

  // Clearing the claims is what actually revokes access; the document update is
  // bookkeeping. Order matters.
  await auth.setCustomUserClaims(targetUid, {});
  await auth.revokeRefreshTokens(targetUid);
  await memberRef.update({ status: 'removed', role: 'viewer', updatedAt: Date.now() });
  await firestore.collection('userIndex').doc(targetUid).delete();

  await writeAudit({
    tenantId: caller.tenantId,
    actorUid: caller.uid,
    actorEmail: caller.email,
    action: 'MEMBER_REMOVED',
    detail: targetUid,
  });

  return { ok: true };
});
