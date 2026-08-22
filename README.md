# Basketball Scoreboard Platform

A multi-tenant basketball scoreboard: sign in, create one or more boards
(one per court), run each game from a control panel, and share two
login-free links per board — a **mirror** display for the venue screen and
a **stream overlay** for OBS.

- `/login` — sign in / create an organisation
- `/app` — dashboard: boards, members, activity log
- `/control/:boardId` — operator control panel
- `/board/:boardId` — keyboard-driven scoreboard (operator session required)
- `/mirror/:boardId?k=…` — read-only display, no login
- `/overlay/:boardId?k=…` — OBS browser source, no login

See [`src/core/schema.ts`](src/core/schema.ts) for the data model and
[`src/core/reducer.ts`](src/core/reducer.ts) for every rule a game action
follows — both are shared by the control panel, the keyboard shortcuts, and
the Cloud Functions, so there is exactly one place gameplay logic lives.

## Requirements

- Node.js 20+
- A JDK (Java 21 recommended) — required by the Firestore/Realtime Database
  emulators
- The Firebase CLI ships as a project dependency (`npx firebase …`); no
  global install needed

## Setup

```sh
npm install
npm --prefix functions install
```

## Local development

```sh
npm run emulators   # Auth, Firestore, Realtime Database, Functions, Hosting
npm run dev          # Vite dev server, in a second terminal
```

The app auto-detects `localhost`/`127.0.0.1` and connects to the emulators;
no extra configuration is needed. Emulator UI: http://127.0.0.1:4000.

## Testing

Five layers, cheapest first:

```sh
npm run test:unit          # pure functions: clock, reducer, schema — no I/O
npm run test:rules         # security rules vs. the real emulator — the tenant-isolation proof
npm run test:integration   # concurrent-writer safety vs. the real emulator
npm run test:e2e           # full user flows, real browser, real build
npm run test:visual        # screenshot regression for the scoreboard/mirror/overlay
npm test                   # unit + rules + integration + e2e, in that order
```

`test:e2e`, `test:visual`, and `baseline` each build the app and Functions
first, then run inside `firebase emulators:exec` — no separate build step
needed.

Visual-regression baselines are OS-specific (Playwright suffixes snapshot
filenames by platform). The committed baseline was captured on Windows; CI
runs on Linux and needs its own — see the `visual` job's comments in
[`.github/workflows/ci.yml`](.github/workflows/ci.yml) for how to generate
and commit it. To refresh the baseline after an intentional visual change:

```sh
npm run baseline
```

Other checks:

```sh
npm run typecheck   # tsc, app + functions
npm run lint
npm run format:check
```

## Deployment

```sh
npm run build
npm run build:functions
npx firebase deploy
```

Review `firebase.json`, `database.rules.json`, and `firestore.rules` before
deploying to a project other than the one configured in `.firebaserc` — the
Realtime Database URL is asia-southeast1-specific (see
[`src/core/firebaseConfig.ts`](src/core/firebaseConfig.ts)) and would need
updating for a different region.

## Architecture

- `src/core/` — framework-free TypeScript: the reducer, the deadline-based
  clock, schema/validation, Firebase wiring. Imported by both the React app
  and the vanilla display pages, and by the Cloud Functions (via a relative
  import — see `functions/tsconfig.json`), so client and server can never
  validate a game action differently.
- `src/app/` — the React console (login, dashboard, control panel, board
  settings).
- `src/display/` — vanilla TypeScript: the scoreboard, the mirror, and the
  OBS overlay. No React, no Firestore — kept to the minimum a gym-wall
  display or a Browser Source actually needs.
- `functions/` — Cloud Functions: tenant provisioning, board/viewer-key
  management, member invites, and the audit log. Everything here exists
  because it needs a privilege no client may hold (setting auth custom
  claims, hashing viewer keys, writing the append-only audit log).
- `database.rules.json` / `firestore.rules` — tenant isolation, enforced by
  the database itself and proven by `tests/rules/`.
