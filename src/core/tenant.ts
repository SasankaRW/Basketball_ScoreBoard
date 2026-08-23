/**
 * Tenant, membership, and audit records.
 *
 * Membership is Functions-only for writes. A member document is a *mirror* of an
 * auth custom claim, and letting a client edit it directly would let the UI
 * display a role the token does not actually carry — so `setMemberRole` sets the
 * claim and the document together, in that order, and nothing else may write here.
 */
import {
  collection,
  doc,
  limit as fsLimit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
  type Firestore,
} from 'firebase/firestore';
import { callApi } from './api.js';
import type { MemberRole } from './roles.js';

export interface Tenant {
  id: string;
  name: string;
  slug: string;
  plan: string;
  status: 'active' | 'suspended';
  ownerUid: string;
  createdAt: number;
}

export interface Member {
  uid: string;
  email: string;
  displayName: string;
  role: MemberRole;
  status: 'active' | 'invited' | 'removed';
  createdAt: number;
}

export interface AuditEvent {
  id: string;
  actorUid: string;
  actorEmail: string;
  action: string;
  boardId: string | null;
  detail: string;
  ts: number;
}

export function subscribeTenant(
  firestore: Firestore,
  tenantId: string,
  onChange: (tenant: Tenant | null) => void,
  onError?: (error: Error) => void,
): () => void {
  return onSnapshot(
    doc(firestore, 'tenants', tenantId),
    (snapshot) => {
      if (!snapshot.exists()) {
        onChange(null);
        return;
      }
      const data = snapshot.data();
      onChange({
        id: snapshot.id,
        name: typeof data['name'] === 'string' ? data['name'] : 'Untitled organisation',
        slug: typeof data['slug'] === 'string' ? data['slug'] : snapshot.id,
        plan: typeof data['plan'] === 'string' ? data['plan'] : 'free',
        status: data['status'] === 'suspended' ? 'suspended' : 'active',
        ownerUid: typeof data['ownerUid'] === 'string' ? data['ownerUid'] : '',
        createdAt: typeof data['createdAt'] === 'number' ? data['createdAt'] : 0,
      });
    },
    (error) => onError?.(error),
  );
}

export function subscribeMembers(
  firestore: Firestore,
  tenantId: string,
  onChange: (members: Member[]) => void,
  onError?: (error: Error) => void,
): () => void {
  return onSnapshot(
    query(
      collection(firestore, 'tenants', tenantId, 'members'),
      where('status', 'in', ['active', 'invited']),
    ),
    (snapshot) =>
      onChange(
        snapshot.docs.map((d) => {
          const data = d.data();
          return {
            uid: d.id,
            email: typeof data['email'] === 'string' ? data['email'] : '',
            displayName: typeof data['displayName'] === 'string' ? data['displayName'] : '',
            role: (data['role'] ?? 'viewer') as MemberRole,
            status: (data['status'] ?? 'active') as Member['status'],
            createdAt: typeof data['createdAt'] === 'number' ? data['createdAt'] : 0,
          };
        }),
      ),
    (error) => onError?.(error),
  );
}

/**
 * The audit actions that describe *play* rather than administration.
 *
 * The tenant audit log records both — provisioning, board and member changes,
 * key rotations — but the dashboard feed is read by someone asking "what
 * happened in the games", and admin noise buries that. Filtering in the query
 * rather than after it matters: filtering client-side would spend the row limit
 * on events that are then thrown away, so a busy tenant could show an empty
 * feed despite having played matches.
 */
export const MATCH_AUDIT_ACTIONS = ['MATCH_STARTED', 'MATCH_FINISHED'] as const;

export function subscribeAudit(
  firestore: Firestore,
  tenantId: string,
  onChange: (events: AuditEvent[]) => void,
  options: { boardId?: string; limit?: number; actions?: readonly string[] } = {},
  onError?: (error: Error) => void,
): () => void {
  const constraints = [
    ...(options.boardId ? [where('boardId', '==', options.boardId)] : []),
    ...(options.actions?.length ? [where('action', 'in', [...options.actions])] : []),
    orderBy('ts', 'desc'),
    fsLimit(options.limit ?? 100),
  ];

  return onSnapshot(
    query(collection(firestore, 'tenants', tenantId, 'audit'), ...constraints),
    (snapshot) =>
      onChange(
        snapshot.docs.map((d) => {
          const data = d.data();
          return {
            id: d.id,
            actorUid: typeof data['actorUid'] === 'string' ? data['actorUid'] : '',
            actorEmail: typeof data['actorEmail'] === 'string' ? data['actorEmail'] : '',
            action: typeof data['action'] === 'string' ? data['action'] : 'UNKNOWN',
            boardId: typeof data['boardId'] === 'string' ? data['boardId'] : null,
            detail: typeof data['detail'] === 'string' ? data['detail'] : '',
            ts: typeof data['ts'] === 'number' ? data['ts'] : 0,
          };
        }),
      ),
    (error) => onError?.(error),
  );
}

export async function renameTenant(
  firestore: Firestore,
  tenantId: string,
  name: string,
): Promise<void> {
  await updateDoc(doc(firestore, 'tenants', tenantId), {
    name: name.trim().slice(0, 80),
    updatedAt: serverTimestamp(),
  });
}

export async function inviteMember(input: {
  email: string;
  role: MemberRole;
}): Promise<{ inviteId: string; inviteUrl: string }> {
  return callApi<{ inviteId: string; inviteUrl: string }>('inviteMember', input);
}

export async function acceptInvite(
  inviteId: string,
): Promise<{ tenantId: string; role: MemberRole }> {
  return callApi<{ tenantId: string; role: MemberRole }>('acceptInvite', { inviteId });
}

export async function setMemberRole(input: { uid: string; role: MemberRole }): Promise<void> {
  await callApi<{ ok: boolean }>('setMemberRole', input);
}

export async function removeMember(uid: string): Promise<void> {
  await callApi<{ ok: boolean }>('removeMember', { uid });
}
