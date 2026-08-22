/**
 * Roles and the permissions derived from them.
 *
 * These predicates decide what the UI *offers*. The security rules decide what
 * the backend *allows*, and they are the real boundary — this module exists so a
 * viewer is not shown a Start Clock button that would fail, not to keep anyone
 * out. The two must agree; `tests/unit/roles.test.ts` pins each predicate to the
 * corresponding clause in firestore.rules and database.rules.json.
 */

/** Roles a human member of a tenant can hold. */
export const MEMBER_ROLES = ['owner', 'admin', 'operator', 'viewer'] as const;
export type MemberRole = (typeof MEMBER_ROLES)[number];

/**
 * Roles carried by tokens minted from a viewer key. They are scoped to a single
 * board and can only ever read.
 */
export const MACHINE_ROLES = ['overlay', 'mirror'] as const;
export type MachineRole = (typeof MACHINE_ROLES)[number];

export type Role = MemberRole | MachineRole;

const RANK: Record<MemberRole, number> = {
  viewer: 0,
  operator: 1,
  admin: 2,
  owner: 3,
};

export function isMemberRole(role: unknown): role is MemberRole {
  return typeof role === 'string' && (MEMBER_ROLES as readonly string[]).includes(role);
}

export function isMachineRole(role: unknown): role is MachineRole {
  return typeof role === 'string' && (MACHINE_ROLES as readonly string[]).includes(role);
}

/** True when `role` sits at or above `minimum` in the hierarchy. */
export function atLeast(role: Role | null | undefined, minimum: MemberRole): boolean {
  if (!isMemberRole(role)) return false;
  return RANK[role] >= RANK[minimum];
}

/** Run a game: score, fouls, clocks. Mirrors the RTDB `.write` clause. */
export function canControlBoard(role: Role | null | undefined): boolean {
  return atLeast(role, 'operator');
}

/** Create, rename, archive boards and rotate their viewer keys. */
export function canManageBoards(role: Role | null | undefined): boolean {
  return atLeast(role, 'admin');
}

export function canManageMembers(role: Role | null | undefined): boolean {
  return atLeast(role, 'admin');
}

export function canViewAudit(role: Role | null | undefined): boolean {
  return atLeast(role, 'admin');
}

export function canManageTenantSettings(role: Role | null | undefined): boolean {
  return atLeast(role, 'admin');
}

/** Billing, plan changes, and deleting the tenant. Owner alone. */
export function canManageBilling(role: Role | null | undefined): boolean {
  return atLeast(role, 'owner');
}

/** Read the live board. Every member role, plus board-scoped machine tokens. */
export function canViewBoard(role: Role | null | undefined): boolean {
  return isMemberRole(role) || isMachineRole(role);
}

export const ROLE_LABELS: Record<MemberRole, string> = {
  owner: 'Owner',
  admin: 'Admin',
  operator: 'Operator',
  viewer: 'Viewer',
};

export const ROLE_DESCRIPTIONS: Record<MemberRole, string> = {
  owner: 'Full control, including billing and deleting the organisation.',
  admin: 'Manage boards, members and settings. Can run games.',
  operator: 'Run games on any board. Cannot change settings or members.',
  viewer: 'Read-only access to the dashboard and boards.',
};
