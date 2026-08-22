/**
 * Match scheduling — a tenant-wide list of planned games, not tied to any
 * board until started.
 *
 * Create / edit / cancel are plain rules-governed Firestore writes (see the
 * `schedule` match block in firestore.rules) — there is no secret or
 * cross-database consequence to protect, only who may plan a game. Starting
 * one onto a board is a server call (`startScheduledMatch`) because it must
 * read and validate the target board's live state, which a client cannot be
 * trusted to do honestly — see src/server/matches.ts.
 */
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  type Firestore,
} from 'firebase/firestore';
import { callApi } from './api.js';
import { LIMITS, type BoardConfig } from './schema.js';

export type ScheduleStatus = 'scheduled' | 'in_progress' | 'completed' | 'cancelled';

export interface ScheduleEntry {
  id: string;
  homeTeamName: string;
  awayTeamName: string;
  /** Planned start time, ms epoch — chosen by the operator, not a server clock. */
  scheduledAt: number;
  notes: string;
  config: Partial<BoardConfig> | null;
  status: ScheduleStatus;
  boardId: string | null;
  matchId: string | null;
  createdBy: string;
  createdAt: number;
}

function toScheduleEntry(id: string, data: Record<string, unknown>): ScheduleEntry {
  const status = data['status'];
  return {
    id,
    homeTeamName: typeof data['homeTeamName'] === 'string' ? data['homeTeamName'] : 'Home',
    awayTeamName: typeof data['awayTeamName'] === 'string' ? data['awayTeamName'] : 'Away',
    scheduledAt: typeof data['scheduledAt'] === 'number' ? data['scheduledAt'] : 0,
    notes: typeof data['notes'] === 'string' ? data['notes'] : '',
    config:
      data['config'] && typeof data['config'] === 'object'
        ? (data['config'] as Partial<BoardConfig>)
        : null,
    status:
      status === 'scheduled' ||
      status === 'in_progress' ||
      status === 'completed' ||
      status === 'cancelled'
        ? status
        : 'scheduled',
    boardId: typeof data['boardId'] === 'string' ? data['boardId'] : null,
    matchId: typeof data['matchId'] === 'string' ? data['matchId'] : null,
    createdBy: typeof data['createdBy'] === 'string' ? data['createdBy'] : '',
    createdAt: typeof data['createdAt'] === 'number' ? data['createdAt'] : 0,
  };
}

/** Every scheduled/in-progress/completed/cancelled entry, soonest-planned first. */
export function subscribeSchedule(
  firestore: Firestore,
  tenantId: string,
  onChange: (entries: ScheduleEntry[]) => void,
  onError?: (error: Error) => void,
): () => void {
  const scheduleQuery = query(
    collection(firestore, 'tenants', tenantId, 'schedule'),
    orderBy('scheduledAt', 'asc'),
  );
  return onSnapshot(
    scheduleQuery,
    (snapshot) => onChange(snapshot.docs.map((d) => toScheduleEntry(d.id, d.data()))),
    (error) => onError?.(error),
  );
}

export interface CreateScheduleInput {
  homeTeamName: string;
  awayTeamName: string;
  scheduledAt: number;
  notes?: string;
  config?: Partial<BoardConfig> | null;
  createdBy: string;
}

export async function createScheduleEntry(
  firestore: Firestore,
  tenantId: string,
  input: CreateScheduleInput,
): Promise<void> {
  const home = input.homeTeamName.trim().slice(0, LIMITS.teamName.maxLength);
  const away = input.awayTeamName.trim().slice(0, LIMITS.teamName.maxLength);

  await addDoc(collection(firestore, 'tenants', tenantId, 'schedule'), {
    homeTeamName: home || 'Home',
    awayTeamName: away || 'Away',
    scheduledAt: input.scheduledAt,
    notes: (input.notes ?? '').trim().slice(0, 500),
    config: input.config ?? null,
    status: 'scheduled',
    boardId: null,
    matchId: null,
    createdBy: input.createdBy,
    createdAt: Date.now(),
  });
}

export interface UpdateScheduleInput {
  homeTeamName?: string;
  awayTeamName?: string;
  scheduledAt?: number;
  notes?: string;
  config?: Partial<BoardConfig> | null;
}

/** Only valid while the entry is still `'scheduled'` — enforced by the rules. */
export async function updateScheduleEntry(
  firestore: Firestore,
  tenantId: string,
  scheduleId: string,
  patch: UpdateScheduleInput,
): Promise<void> {
  await updateDoc(doc(firestore, 'tenants', tenantId, 'schedule', scheduleId), {
    ...patch,
    updatedAt: serverTimestamp(),
  });
}

export async function cancelScheduleEntry(
  firestore: Firestore,
  tenantId: string,
  scheduleId: string,
): Promise<void> {
  await updateDoc(doc(firestore, 'tenants', tenantId, 'schedule', scheduleId), {
    status: 'cancelled',
    updatedAt: serverTimestamp(),
  });
}

/** Only valid while the entry is `'scheduled'` or `'cancelled'` — enforced by the rules. */
export async function deleteScheduleEntry(
  firestore: Firestore,
  tenantId: string,
  scheduleId: string,
): Promise<void> {
  await deleteDoc(doc(firestore, 'tenants', tenantId, 'schedule', scheduleId));
}

export async function startScheduledMatch(input: {
  scheduleId: string;
  boardId: string;
}): Promise<{ boardId: string }> {
  return callApi<{ boardId: string }>('startScheduledMatch', input);
}
