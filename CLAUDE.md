# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```sh
npm run dev            # Vite only — frontend work, /api/* unavailable
npm run dev:api        # vercel dev on :5000 — needed to exercise /api/*
npm run emulators      # Auth, Firestore, RTDB, Storage (data persists via .emulator-data)

npm run typecheck      # tsc --noEmit
npm run lint           # eslint, --max-warnings 0
npm run format:check   # prettier

npm run test:unit         # pure functions, no I/O, milliseconds
npm run test:rules        # security rules vs. real emulators — the tenant-isolation proof
npm run test:integration  # concurrent-writer safety vs. real RTDB
npm run test:e2e          # full flows: real build + emulators + vercel dev + Chromium
npm run test:visual       # screenshot regression for scoreboard/mirror/overlay
npm run baseline          # regenerate visual baselines after an intentional change
```

Single test:

```sh
npx vitest run --project unit tests/unit/reducer.test.ts
npx vitest run --project unit -t 'clamps adjustment'
npx playwright test --project=e2e tests/e2e/matches.spec.ts   # emulators must already be up
```

`test:e2e`, `test:visual`, and `baseline` build first and run inside
`firebase emulators:exec`, wrapped by `scripts/with-vercel-dev.mjs` — no separate
build or server step needed. They need a JDK (Java 21) for the emulators.

## Architecture

**Two planes.** The _live plane_ is the Realtime Database at
`live/{tenantId}/{boardId}/state` — every score change is a direct client write,
never an API call, which is what makes courtside scoring feel instant. The
_control plane_ is Firestore (tenants, boards, members, schedule, matches, audit)
plus the privileged operations in `api/`. Confusing the two is the most common
way to break this codebase: adding an API round-trip to live scoring would put
network latency in the operator's hot path.

**`src/core/` is shared by everything** — browser bundles and server routes both
import it, so a game action can never validate differently on the two sides.
It is framework-free and Firebase-free by design. `schema.ts` (data model,
`LIMITS`, `createInitialState`, `parseLiveBoardState`) and `reducer.ts` (every
gameplay rule, pure, reference-stable) are the two files worth reading first.

**Concurrency.** `BoardState.rev` must advance by exactly one per write, enforced
in `database.rules.json`, so a stale writer is rejected by the database rather
than silently clobbering a live operator. Two places implement the
capture-then-replace transaction idiom against this — `dispatchAction`
(`src/core/liveState.ts`) and `finishMatch` (`src/server/matches.ts`). Both carry
long comments explaining two non-obvious hazards found in production: RTDB
transaction updaters are invoked with an **unconfirmed `null` guess** before the
server responds (so `null` must mean "retry", not "absent"), and a _freshly
reset_ board is valid-but-idle rather than absent (so `isBoardIdle` is what
actually closes the double-finish race). Read those comments before touching
either.

**Three layers of server code:**

- `src/core/api.ts` — `callApi()`, the client half. Attaches the Firebase ID
  token as a bearer header explicitly. Every privileged operation goes through it.
- `api/*.ts` — one thin Vercel route per operation. Auth → parse → delegate.
  No business logic; each is 3 lines wrapping `withAuth()` from `src/server/http.ts`.
- `src/server/*.ts` — the Admin-SDK-privileged logic. Operations that exist
  because they need a privilege no client may hold: setting auth custom claims,
  hashing viewer keys, deriving match results from actual live state.

**Auth is claims-based.** `tenantId` and `role` are Firebase Auth custom claims,
written only by server code, read from the _verified_ ID token — never from a
request body. The same signed token the client reads is what the security rules
evaluate, so UI and backend can never disagree about who someone is.
`src/server/common.ts`'s `requireRole()` calls `verifyIdToken()` itself, since
plain HTTP functions get no equivalent of the callable-functions handshake.

**Display surfaces are deliberately minimal.** `src/display/` is vanilla
TypeScript — no React, no Firestore — because a gym-wall screen and an OBS
Browser Source should load only what they need. `src/core/firebase.ts` keeps
Firestore and Storage out of the shared client for the same reason; both have
their own lazy `*Client.ts` modules. The mirror and overlay authenticate with a
viewer key (`?k=…`) exchanged for a board-scoped read-only token; that role
matches no write rule anywhere.

Their asset paths must stay **absolute** (`/display/scoreboard/main.ts`). These
pages are served under rewritten URLs (`/board/:id`), so a relative path resolves
against _that_ path and 404s in dev.

## Constraints

- **Never change the scoreboard's appearance.** `src/display/scoreboard/`,
  `mirror/`, and `overlay/` are pixel-locked and machine-checked by
  `tests/e2e/visual.spec.ts`. The console (`src/app/`) is free to change.
- **The mirror embeds a verbatim copy of the scoreboard's `.scoreboard` block.**
  `tests/unit/markup.test.ts` asserts they stay byte-identical.
- **Playwright asserts on accessible names.** Button/label text in `src/app/` is
  load-bearing; renaming one silently breaks e2e. Check `tests/e2e/*.spec.ts`
  before changing user-visible strings.
- **`LIMITS` in `schema.ts` is hand-mirrored into `database.rules.json`.** No
  codegen link — change one, change the other.
- **RTDB strips `null` and `{}` on write.** Fields like `periodScores`,
  `scheduleId`, `logoUrl` come back _absent_, which is why `parseLiveBoardState`
  restores them and why they are excluded from the rules' required-children list.

## Deployment

Frontend and `/api/*` deploy to **Vercel** (push to `dev`, the production
branch). Firebase provides Auth, Firestore, RTDB, and Storage only.

```sh
npx firebase deploy --only firestore   # rules + indexes
npx firebase deploy --only database    # RTDB rules
```

Env var `FIREBASE_SERVICE_ACCOUNT` (full service-account JSON, Vercel dashboard
only) is what gives the API routes Admin SDK access — Vercel has no ambient GCP
identity. Changing it requires a redeploy to take effect.

`pin firebase-admin to ^13.x`: v14 pulls an ESM-only `jose`, which Vercel's
CommonJS function bundling cannot `require`.

## Known stale/blocked

- **`README.md` and `.github/workflows/ci.yml` still reference `functions/` and
  `npm --prefix functions`.** That directory was deleted when Cloud Functions
  migrated to Vercel (Cloud Functions require the paid Blaze plan). CI will fail
  on those steps until updated.
- **Firebase Storage is not provisioned** — it needs Blaze. The per-board
  tournament-logo upload is therefore hidden behind `LOGO_UPLOAD_ENABLED` in
  `src/core/storage.ts` (currently `false`), and `tests/e2e/logo.spec.ts` skips
  itself off the same flag. The feature is complete and tested — flipping the
  flag after provisioning Storage restores both the UI and its coverage.
- **`onBoardStateWritten`** (the RTDB trigger that logged fine-grained live-game
  changes to the activity feed) was dropped in the migration; Vercel has no
  database-trigger equivalent. Action-level audit entries are unaffected — each
  is written explicitly by the operation that performs it.
