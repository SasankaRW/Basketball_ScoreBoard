/**
 * The shared route-handler wrapper every `api/*.ts` file uses, so the
 * auth-check / body-parse / error-mapping boilerplate exists exactly once
 * instead of copy-pasted 11 times.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { ZodError, type ZodType } from 'zod';
import type { MemberRole } from '../core/roles.js';
import {
  ApiError,
  requireRole,
  requireSignedIn,
  type Caller,
  type SignedInCaller,
} from './common.js';

export type Access = MemberRole | 'signed-in' | 'public';

/** Maps an access level to the shape of `caller` a handler at that level receives. */
type CallerFor<A extends Access> = A extends 'public'
  ? null
  : A extends 'signed-in'
    ? SignedInCaller
    : Caller;

function toApiError(err: unknown): { status: number; message: string } {
  if (err instanceof ApiError) return { status: err.status, message: err.message };
  if (err instanceof ZodError) {
    return { status: 400, message: err.issues[0]?.message ?? 'Invalid request.' };
  }
  console.error(err);
  return { status: 500, message: 'Something went wrong.' };
}

async function resolveCaller<A extends Access>(
  access: A,
  req: VercelRequest,
): Promise<CallerFor<A>> {
  if (access === 'public') return null as CallerFor<A>;
  if (access === 'signed-in') return (await requireSignedIn(req)) as CallerFor<A>;
  return (await requireRole(req, access)) as CallerFor<A>;
}

export function withAuth<A extends Access, TInput, TOutput>(
  access: A,
  inputSchema: ZodType<TInput>,
  handler: (caller: CallerFor<A>, input: TInput, req: VercelRequest) => Promise<TOutput>,
) {
  return async (req: VercelRequest, res: VercelResponse): Promise<void> => {
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'Method not allowed' });
      return;
    }
    try {
      const caller = await resolveCaller(access, req);
      const input = inputSchema.parse(req.body);
      const result = await handler(caller, input, req);
      res.status(200).json(result);
    } catch (err) {
      const { status, message } = toApiError(err);
      res.status(status).json({ error: message });
    }
  };
}
