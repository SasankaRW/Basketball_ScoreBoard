/**
 * Membership management.
 *
 * Every write here updates two things that must never disagree: the auth
 * custom claim (which the security rules enforce) and the member document
 * (which the dashboard displays). The claim is written first — if the second
 * write fails, the result is a UI that under-reports someone's access rather
 * than a UI that promises access the backend will refuse.
 */
import { z } from 'zod';
import { generateInviteId } from '../core/ids.js';
import { MEMBER_ROLES, type MemberRole } from '../core/roles.js';
import {
  ApiError,
  auth,
  firestore,
  limitsForPlan,
  writeAudit,
  type Caller,
  type SignedInCaller,
} from './common.js';

const RoleSchema = z.enum(MEMBER_ROLES);
const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export const InviteMemberInput = z.object({
  email: z.string().trim().email().max(200),
  role: RoleSchema,
});

export async function inviteMember(
  caller: Caller,
  input: z.infer<typeof InviteMemberInput>,
): Promise<{ inviteId: string; inviteUrl: string }> {
  // Only an owner can create another owner; otherwise an admin could promote
  // themselves sideways into control of billing and tenant deletion.
  if (input.role === 'owner' && caller.role !== 'owner') {
    throw new ApiError(403, 'Only the owner can invite another owner.');
  }

  const tenantRef = firestore.collection('tenants').doc(caller.tenantId);
  const tenantSnapshot = await tenantRef.get();
  const limits = limitsForPlan(tenantSnapshot.data()?.['plan']);
  const memberCount = await tenantRef.collection('members').count().get();
  if (memberCount.data().count >= limits.members) {
    throw new ApiError(412, `Your plan allows ${limits.members} members.`);
  }

  const inviteId = generateInviteId();
  await firestore
    .collection('invites')
    .doc(inviteId)
    .set({
      tenantId: caller.tenantId,
      tenantName: tenantSnapshot.data()?.['name'] ?? '',
      email: input.email.toLowerCase(),
      role: input.role,
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
    detail: `${input.email} as ${input.role}`,
  });

  return { inviteId, inviteUrl: `/join/${inviteId}` };
}

export const AcceptInviteInput = z.object({ inviteId: z.string().min(8).max(40) });

export async function acceptInvite(
  caller: SignedInCaller,
  input: z.infer<typeof AcceptInviteInput>,
): Promise<{ tenantId: string; role: MemberRole }> {
  const { uid, email } = caller;

  const inviteRef = firestore.collection('invites').doc(input.inviteId);
  const invite = await inviteRef.get();
  if (!invite.exists) throw new ApiError(404, 'This invite does not exist.');

  const data = invite.data() ?? {};
  if (data['acceptedAt']) throw new ApiError(412, 'Invite already used.');
  if (typeof data['expiresAt'] === 'number' && data['expiresAt'] < Date.now()) {
    throw new ApiError(412, 'This invite has expired.');
  }
  // Binding the invite to an address stops a forwarded link from onboarding
  // someone the admin never intended to add.
  if (typeof data['email'] === 'string' && data['email'] !== email.toLowerCase()) {
    throw new ApiError(403, 'This invite was issued to a different email.');
  }

  const tenantId = data['tenantId'] as string;
  const role = data['role'] as MemberRole;

  await auth.setCustomUserClaims(uid, { tenantId, role });

  const now = Date.now();
  await firestore.runTransaction(async (tx) => {
    tx.set(firestore.collection('tenants').doc(tenantId).collection('members').doc(uid), {
      email,
      displayName: typeof caller.token['name'] === 'string' ? caller.token['name'] : '',
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
}

export const SetMemberRoleInput = z.object({ uid: z.string().min(1).max(128), role: RoleSchema });

export async function setMemberRole(
  caller: Caller,
  input: z.infer<typeof SetMemberRoleInput>,
): Promise<{ ok: true }> {
  const { uid: targetUid, role } = input;

  if (targetUid === caller.uid) {
    throw new ApiError(412, 'You cannot change your own role.');
  }

  const memberRef = firestore
    .collection('tenants')
    .doc(caller.tenantId)
    .collection('members')
    .doc(targetUid);
  const member = await memberRef.get();
  if (!member.exists) throw new ApiError(404, 'That member is not in your organisation.');

  const currentRole = member.data()?.['role'];
  // An admin may not create or demote an owner. Both directions are
  // owner-only, or an admin could strip the owner and take over the tenant.
  if ((role === 'owner' || currentRole === 'owner') && caller.role !== 'owner') {
    throw new ApiError(403, 'Only the owner can manage owner roles.');
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
}

export const RemoveMemberInput = z.object({ uid: z.string().min(1).max(128) });

export async function removeMember(
  caller: Caller,
  input: z.infer<typeof RemoveMemberInput>,
): Promise<{ ok: true }> {
  const targetUid = input.uid;

  if (targetUid === caller.uid) {
    throw new ApiError(412, 'You cannot remove yourself.');
  }

  const memberRef = firestore
    .collection('tenants')
    .doc(caller.tenantId)
    .collection('members')
    .doc(targetUid);
  const member = await memberRef.get();
  if (!member.exists) throw new ApiError(404, 'That member is not in your organisation.');
  if (member.data()?.['role'] === 'owner') {
    throw new ApiError(412, 'The owner cannot be removed.');
  }

  // Clearing the claims is what actually revokes access; the document update
  // is bookkeeping. Order matters.
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
}
