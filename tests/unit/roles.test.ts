/**
 * Role predicates against the rules clauses they stand in for.
 *
 * `src/core/roles.ts` decides what the UI *offers*; the security rules decide
 * what the backend *allows*. When the two disagree the UI either hides
 * something a member may do or offers something that will fail at the boundary
 * — so each predicate here is pinned to the clause it mirrors, quoted in the
 * test name. The rules themselves are proved against real emulators in
 * `tests/rules/`; this is the cheap half that runs in milliseconds.
 */
import { describe, expect, it } from 'vitest';
import {
  atLeast,
  canControlBoard,
  canManageBoards,
  canManageBilling,
  canManageMembers,
  canManageTenantSettings,
  canViewAudit,
  canViewBoard,
  isMachineRole,
  isMemberRole,
  MEMBER_ROLES,
  type MemberRole,
} from '../../src/core/roles.js';

/** Every member role, weakest first, so a predicate's cut-off is visible. */
const LADDER: MemberRole[] = ['viewer', 'operator', 'admin', 'owner'];

/** The roles a predicate should admit, as a set, for an exact comparison. */
function admits(predicate: (role: MemberRole) => boolean): MemberRole[] {
  return LADDER.filter(predicate);
}

describe('member role ladder', () => {
  it('covers every declared role', () => {
    expect([...LADDER].sort()).toEqual([...MEMBER_ROLES].sort());
  });

  it('is ordered, and a machine role sits outside it entirely', () => {
    expect(atLeast('owner', 'viewer')).toBe(true);
    expect(atLeast('viewer', 'owner')).toBe(false);
    // A board-scoped token is not a weak member; it is not a member at all.
    expect(atLeast('mirror', 'viewer')).toBe(false);
    expect(isMemberRole('mirror')).toBe(false);
    expect(isMachineRole('mirror')).toBe(true);
  });

  it('treats a missing or unknown role as no role', () => {
    for (const role of [null, undefined, '', 'superuser'] as const) {
      expect(atLeast(role as never, 'viewer')).toBe(false);
    }
  });
});

describe('predicates mirror their rules clause', () => {
  /**
   * `settings` is in the tenant document's `onlyChanges` allowlist, guarded by
   * `hasRole(tid, ['owner', 'admin'])` — the clause the shared shortcut keymap
   * rides on, since it lives at `settings.keymap`. This predicate is what
   * decides whether the shortcut editor is editable or read-only, so a drift
   * here would offer an operator a Change button the rules then refuse.
   */
  it("canManageTenantSettings === hasRole(['owner', 'admin'])", () => {
    expect(admits(canManageTenantSettings)).toEqual(['admin', 'owner']);
  });

  it("canManageBoards === hasRole(['owner', 'admin'])", () => {
    expect(admits(canManageBoards)).toEqual(['admin', 'owner']);
  });

  it("canManageMembers === hasRole(['owner', 'admin'])", () => {
    expect(admits(canManageMembers)).toEqual(['admin', 'owner']);
  });

  it("canViewAudit === hasRole(['owner', 'admin'])", () => {
    expect(admits(canViewAudit)).toEqual(['admin', 'owner']);
  });

  /** The RTDB `.write` clause on `live/{tid}/{bid}/state`. */
  it('canControlBoard === operator and above', () => {
    expect(admits(canControlBoard)).toEqual(['operator', 'admin', 'owner']);
  });

  it('canManageBilling === owner alone', () => {
    expect(admits(canManageBilling)).toEqual(['owner']);
  });

  /** Reading the live board is every member role, plus the machine tokens. */
  it('canViewBoard === every member role and both machine roles', () => {
    expect(admits(canViewBoard)).toEqual(LADDER);
    expect(canViewBoard('overlay')).toBe(true);
    expect(canViewBoard('mirror')).toBe(true);
    expect(canViewBoard(null)).toBe(false);
  });
});
