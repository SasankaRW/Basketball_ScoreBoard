#!/usr/bin/env node
/**
 * Runs the real local-dev stack for e2e/visual tests: `vercel dev` as a
 * pure API backend (so `/api/*` — src/server/ via api/*.ts — runs for
 * real, backed by whichever Firebase emulators `firebase emulators:exec`
 * already has up), and `vite` directly as the actual server tests hit,
 * proxying `/api/*` to that backend (see vite.config.ts).
 *
 * `vite` directly rather than through `vercel dev`'s own reverse proxy:
 * that proxy turned out not to honor `vercel.json`'s `rewrites` at all for
 * a project with a custom `devCommand` — it silently served the SPA shell
 * for every request, including source-module requests like
 * `/app/main.tsx`, which meant the app never actually booted under it. Vite
 * on its own, confirmed directly, serves everything correctly; only the
 * Vercel-specific `/api/*` routes need `vercel dev` at all.
 *
 * Node child-process job control rather than shell `&`/`kill` job control:
 * this needs to behave identically in the Windows Git Bash shell this repo
 * is developed in and in CI, and shell job control is exactly the kind of
 * thing that quietly differs between the two.
 */
import { spawn, spawnSync } from 'node:child_process';

const APP_PORT = 5000;
const API_PORT = 3001;
const APP_URL = `http://127.0.0.1:${APP_PORT}`;
const API_URL = `http://127.0.0.1:${API_PORT}`;
const READY_TIMEOUT_MS = 150_000;

const [, , ...command] = process.argv;
if (command.length === 0) {
  console.error('Usage: node scripts/with-vercel-dev.mjs <command> [args...]');
  process.exit(1);
}

const vercelDev = spawn('npx', ['vercel', 'dev', '--listen', String(API_PORT), '--yes'], {
  stdio: 'inherit',
  shell: true,
});

const vite = spawn('npx', ['vite'], {
  stdio: 'inherit',
  shell: true,
  env: { ...process.env, PORT: String(APP_PORT), VERCEL_API_PORT: String(API_PORT) },
});

/**
 * `child.kill()` only signals the immediate `npx` process — both `vercel
 * dev` and `vite` spawn further children, and on Windows a plain `.kill()`
 * does not reach them, leaving an orphaned server still bound to its port
 * after this script exits. `taskkill /t` kills the whole tree.
 *
 * `spawnSync`, not `spawn`: this runs right before `process.exit()`, and an
 * async kill fired without being awaited loses the race against the parent
 * exiting — the taskkill process would itself get orphaned mid-flight,
 * killing nothing. Blocking here is what makes cleanup actually happen
 * before the script's own process ends.
 */
function stop(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform === 'win32' && child.pid) {
    spawnSync('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore' });
  } else {
    child.kill();
  }
}

function stopAll() {
  stop(vercelDev);
  stop(vite);
}

/**
 * Confirms a real page loads cleanly, not just that the port accepts
 * connections.
 *
 * Vite's dev server opens its port and serves the HTML shell while still
 * mid-way through its first dependency pre-bundling pass — during that
 * window, requests for the modules that shell references intermittently
 * fail with a "500 Internal server error" overlay instead of the real app.
 * A bare TCP/HTTP-ready check doesn't catch this (it sees a fast 200 for
 * the shell itself); only an actual page load, checked for real app
 * content, does.
 */
async function waitForApp() {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      // Without a per-attempt timeout, one hung `fetch` blocks this loop
      // from ever rechecking the deadline, so the whole wait silently never
      // times out — `vercel dev` in particular can accept the connection
      // long before it answers.
      const response = await fetch(`${APP_URL}/login`, { signal: AbortSignal.timeout(5_000) });
      const body = await response.text();
      if (
        response.status < 500 &&
        body.includes('id="root"') &&
        !body.includes('Internal server error')
      ) {
        return;
      }
    } catch {
      // Not up yet — still starting, still pre-bundling, or this attempt
      // timed out.
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error(
    `vite did not serve a clean page at ${APP_URL}/login within ${READY_TIMEOUT_MS}ms`,
  );
}

/** The API backend has no unauthenticated GET route to check content on — a bare port check is enough here since every real /api/* call gets exercised for real once the tests run. */
async function waitForApi() {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      await fetch(API_URL, { signal: AbortSignal.timeout(5_000) });
      return;
    } catch {
      // Not up yet, or this attempt timed out.
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error(`vercel dev did not respond on ${API_URL} within ${READY_TIMEOUT_MS}ms`);
}

function runCommand() {
  return new Promise((resolve) => {
    const child = spawn(command[0], command.slice(1), { stdio: 'inherit', shell: true });
    child.on('exit', (code) => resolve(code ?? 1));
  });
}

try {
  await Promise.all([waitForApi(), waitForApp()]);
  const exitCode = await runCommand();
  stopAll();
  process.exit(exitCode);
} catch (error) {
  console.error(error);
  stopAll();
  process.exit(1);
}
