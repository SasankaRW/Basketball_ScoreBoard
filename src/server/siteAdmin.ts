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
 * Every read and write here goes straight at Firestore/RTDB with the Admin
 * SDK, the same way `startScheduledMatch`/`finishMatch` do — it bypasses
 * `firestore.rules`/`database.rules.json` entirely, which is what makes a
 * *cross*-tenant operation possible at all: every per-tenant rule on those
 * trees only ever grants a client its own tenant's data, and this
 * deliberately never becomes a rule or a claim, so that boundary is not
 * weakened for anyone but this one server-side route.
 *
 * `op`-discriminated rather than one route per action for the same reason
 * `api/logo.ts` and `api/match.ts` are: Vercel's Hobby plan caps a deployment
 * at 12 serverless functions, and this project is already at that cap.
 */
import { z } from 'zod';
import { ApiError, database, firestore, writeAudit, type SignedInCaller } from './common.js';
import { isValidId } from '../core/ids.js';
import { isBoardIdle, parseLiveBoardState } from '../core/schema.js';
import type {
  SiteAdminBoard,
  SiteAdminMatchSummary,
  SiteAdminOverview,
  SiteAdminRunningGame,
  SiteAdminTenant,
} from '../core/siteAdmin.js';

const SITE_ADMIN_EMAILS = new Set(['sasankarw@gmail.com']);

function assertSiteAdmin(caller: SignedInCaller): void {
  if (!SITE_ADMIN_EMAILS.has(caller.email.toLowerCase())) {
    throw new ApiError(403, 'Not authorised.');
  }
}

async function getOverview(): Promise<SiteAdminOverview> {
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

      // `activeBoardCount` is filled in once the live tree has been read,
      // below — every other field is known from Firestore alone.
      const tenant: Omit<SiteAdminTenant, 'activeBoardCount'> = {
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

  // One read for the whole tree rather than one per board — `live/{tenantId}`
  // holds every board this tenant has, so this is the same number of round
  // trips regardless of how many tenants or boards exist.
  const liveSnapshot = await database.ref('live').get();
  const liveTree = (liveSnapshot.val() ?? {}) as Record<
    string,
    Record<string, { state?: unknown }> | undefined
  >;

  const runningGames: SiteAdminRunningGame[] = [];
  // Every non-archived board, active or not — `runningGames` above only ever
  // carries the active ones, which cannot answer "is this particular idle
  // board actually wired up correctly" the way a full directory can.
  const boards: SiteAdminBoard[] = [];
  const activeBoardCounts = new Map<string, number>();

  for (const { tenant, boards: tenantBoards } of perTenant) {
    const tenantLive = liveTree[tenant.id];

    for (const board of tenantBoards) {
      const state = parseLiveBoardState(tenantLive?.[board.id]?.state);
      const active = state !== null && !isBoardIdle(state);

      boards.push({
        tenantId: tenant.id,
        tenantName: tenant.name,
        boardId: board.id,
        boardName: board.name,
        active,
      });

      if (!active || !state) continue;
      activeBoardCounts.set(tenant.id, (activeBoardCounts.get(tenant.id) ?? 0) + 1);

      runningGames.push({
        tenantId: tenant.id,
        tenantName: tenant.name,
        boardId: board.id,
        boardName: board.name,
        homeName: state.home.name,
        homeScore: state.home.score,
        homeFouls: state.home.fouls,
        homeTimeouts: state.home.timeouts,
        awayName: state.away.name,
        awayScore: state.away.score,
        awayFouls: state.away.fouls,
        awayTimeouts: state.away.timeouts,
        period: state.period,
        possession: state.possession,
        gameClock: state.gameClock,
        shotClock: state.shotClock,
      });
    }
  }

  const tenants = perTenant
    .map(({ tenant }): SiteAdminTenant => ({
      ...tenant,
      activeBoardCount: activeBoardCounts.get(tenant.id) ?? 0,
    }))
    .sort((a, b) => b.createdAt - a.createdAt);

  return { tenants, runningGames, boards };
}

const BoardRefInput = z.object({ tenantId: z.string(), boardId: z.string() });

/**
 * Deletes a board in any organisation. Same cleanup order as the tenant-scoped
 * `deleteBoard` (`src/server/boards.ts`) — live state before the document, so
 * a lingering document never outlives the index that lets `exchangeViewerKey`
 * resolve it — just parameterised by an explicit `tenantId` since the caller
 * here is never that tenant's own member.
 *
 * Audited into the *tenant's own* log, not some separate site-admin trail —
 * an organisation's owner should be able to see that this happened to their
 * board and who did it, the same as any other deletion in their audit log.
 */
async function deleteBoard(
  caller: SignedInCaller,
  input: z.infer<typeof BoardRefInput>,
): Promise<{ deleted: true }> {
  if (!isValidId(input.boardId, 'brd')) throw new ApiError(400, 'Unknown board.');
  const { tenantId, boardId } = input;

  const boardRef = firestore.collection('tenants').doc(tenantId).collection('boards').doc(boardId);
  const snapshot = await boardRef.get();
  if (!snapshot.exists) throw new ApiError(404, 'Board not found.');

  await database.ref(`live/${tenantId}/${boardId}`).remove();
  await firestore.collection('boardIndex').doc(boardId).delete();
  await boardRef.delete();

  await writeAudit({
    tenantId,
    actorUid: caller.uid,
    actorEmail: caller.email,
    action: 'BOARD_DELETED',
    boardId,
    detail: `${(snapshot.data()?.['name'] as string | undefined) ?? ''} (via site admin)`,
  });

  return { deleted: true };
}

function toMatchSummary(id: string, data: Record<string, unknown>): SiteAdminMatchSummary {
  const num = (key: string): number => (typeof data[key] === 'number' ? (data[key] as number) : 0);
  const str = (key: string, fallback: string): string =>
    typeof data[key] === 'string' ? (data[key] as string) : fallback;

  return {
    id,
    homeTeamName: str('homeTeamName', 'Home'),
    awayTeamName: str('awayTeamName', 'Away'),
    homeScore: num('homeScore'),
    awayScore: num('awayScore'),
    periodsPlayed: num('periodsPlayed'),
    periodScores: Array.isArray(data['periodScores'])
      ? (data['periodScores'] as SiteAdminMatchSummary['periodScores'])
      : [],
    startedAt: num('startedAt'),
    endedAt: num('endedAt'),
    durationMs: num('durationMs'),
  };
}

/**
 * The most recent finished games on one board.
 *
 * Filters by `boardId` in memory rather than adding a `where('boardId', '==',
 * …).orderBy('endedAt', …)` composite index: this is an admin-only, on-demand
 * read with no latency budget to protect, and it is the only thing in this
 * codebase that would ever need that index, so skipping it also skips a
 * `firestore.indexes.json` deploy for a query nothing else uses. The single-field
 * `endedAt` index this relies on is one Firestore creates automatically.
 */
async function getBoardMatches(
  input: z.infer<typeof BoardRefInput>,
): Promise<{ matches: SiteAdminMatchSummary[] }> {
  const { tenantId, boardId } = input;

  const snapshot = await firestore
    .collection('tenants')
    .doc(tenantId)
    .collection('matches')
    .orderBy('endedAt', 'desc')
    .limit(200)
    .get();

  const matches = snapshot.docs
    .filter((doc) => doc.data()['boardId'] === boardId)
    .slice(0, 20)
    .map((doc) => toMatchSummary(doc.id, doc.data()));

  return { matches };
}

export const SiteAdminActionInput = z.discriminatedUnion('op', [
  z.object({ op: z.literal('overview') }),
  BoardRefInput.extend({ op: z.literal('deleteBoard') }),
  BoardRefInput.extend({ op: z.literal('boardMatches') }),
]);

export async function handleSiteAdminAction(
  caller: SignedInCaller,
  input: z.infer<typeof SiteAdminActionInput>,
): Promise<SiteAdminOverview | { deleted: true } | { matches: SiteAdminMatchSummary[] }> {
  assertSiteAdmin(caller);

  switch (input.op) {
    case 'overview':
      return getOverview();
    case 'deleteBoard':
      return deleteBoard(caller, input);
    case 'boardMatches':
      return getBoardMatches(input);
  }
}
