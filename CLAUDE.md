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

**Control-panel shortcuts are data, not a `switch`.** `src/core/keymap.ts` owns
the command catalog (`score.home.plus1`, …), the shipped defaults, and the
conflict rules; `ControlPanelPage` maps each command to what its button does.
One key drives exactly one command, so assigning a key that is in use _takes_ it
and the editor says which command lost it. Matching is exact on `code` +
`shift`, so `Shift+↑` no longer falls through to `↑` the way the old switch let
it — and the scoreboard display (`src/display/scoreboard/main.ts`) still has its
own hard-coded keys, so a remapped panel and the gym-wall board no longer agree.

Mouse buttons bind through the same `code`/`shift` pair, as a synthetic
`MouseN` (`N` is `MouseEvent.button`). `Mouse0` is the exception: the bare left
click is what presses every button on the page and dispatch listens on the
_document_, so it binds **only with Shift held** (`SHIFT_ONLY` in `keymap.ts`,
which is why `isBindableCode` takes `shift` and every caller must pass it).
`preventDefault` on a mousedown does not stop the `click` that follows, so
`ControlPanelPage` swallows that click separately — without it, a bound
`Shift`+click on a panel button would run the shortcut _and_ the button.

**The layout is a tenant setting, not a browser one.** It lives at
`settings.keymap` on the tenant document: every member reads it (`allow get: if
inTenant(tid)`), owner/admin alone write it, which is `canManageTenantSettings`.
It is on the tenant document rather than in a collection of its own precisely
because `settings` is _already_ in that document's `onlyChanges` allowlist — so
a shared keymap added no new rule and no new tenant-isolation surface to prove
(`tests/rules/firestore.test.ts` pins the inheritance anyway). Writes go through
the dotted path `settings.keymap` so they merge; a whole-`settings` write would
drop every other tenant setting. Command ids contain dots but appear only as map
_keys_ in the value, never in the path.

`src/app/keymapStorage.ts` is now a **cache**, keyed per tenant _and_ per uid
(`v2`): it is what the panel scores with before the first snapshot lands, and it
is the seed — a tenant that has never saved a layout adopts the cached one the
first time an admin opens the panel, guarded by a `seeded` ref so a tenant
deliberately reset to the defaults is not re-seeded. Reset therefore _writes_
the defaults rather than deleting the field, which would re-arm that adoption.

**Display surfaces are deliberately minimal.** `src/display/` is vanilla
TypeScript — no React, no Firestore — because a gym-wall screen and an OBS
Browser Source should load only what they need. `src/core/firebase.ts` keeps
Firestore and Storage out of the shared client for the same reason; both have
their own lazy `*Client.ts` modules. The mirror, the overlay and the two
single-clock screens (`/gameclock/:id`, `/shotclock/:id`) authenticate with a
viewer key (`?k=…`) exchanged for a board-scoped read-only token; that role
matches no write rule anywhere. The clock screens present the board's _mirror_
key rather than one of their own — same trust class, so a separate kind would
mean new roles in `database.rules.json` granting exactly what `mirror` already
grants. Adding a display surface means four edits in step: the entry pair under
`src/display/`, a `rollupOptions.input` entry and a `displayRoutes()` pattern in
`vite.config.ts`, and a rewrite in `vercel.json`.

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
- **The per-board tournament-logo upload goes through Cloudinary, not Firebase
  Storage.** Storage needs the paid Blaze plan, which blocked the feature
  outright; Cloudinary needs only a free account. `api/uploadLogo` and
  `api/removeLogo` (`src/server/logo.ts`, signing in `src/server/cloudinary.ts`)
  hold the API secret server-side, the same reason every other privileged
  write in this app goes through `api/*.ts` rather than straight from the
  browser. **Needs three environment variables that are not yet set anywhere**:
  `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` — in
  the Vercel dashboard for production, and in an untracked `.env` file for
  `vercel dev` locally. Without them, a route call fails with a 500 naming the
  missing variable rather than doing nothing silently.
  `tests/e2e/logo.spec.ts` skips itself when `CLOUDINARY_CLOUD_NAME` is absent
  from the process environment — there is no local emulator for a third-party
  SaaS the way there is for Firebase, so this is the one flow this codebase
  cannot verify without a real account. `storage.rules`, `storageClient.ts`,
  and `tests/rules/storage.test.ts` are unused leftovers from the Firebase
  Storage version — left in place rather than deleted, since nothing currently
  depends on removing them.
- **`onBoardStateWritten`** (the RTDB trigger that logged fine-grained live-game
  changes to the activity feed) was dropped in the migration; Vercel has no
  database-trigger equivalent. Action-level audit entries are unaffected — each
  is written explicitly by the operation that performs it.
