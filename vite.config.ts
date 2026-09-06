import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

const at = (path: string) => resolve(process.cwd(), path);

/**
 * Replicates, for local dev, the same path rewrites `vercel.json`'s
 * `rewrites` apply in production (and the same ones `firebase.json`'s Hosting
 * config applied before that): `/board/:id`, `/mirror/:id`, `/overlay/:id`,
 * `/gameclock/:id` and `/shotclock/:id` all serve their respective display
 * entry's HTML while leaving the browser's address bar untouched, so the
 * client-side code that reads the board ID back out of
 * `window.location.pathname` (`readBoardIdFromPath` in
 * `display/shared/displayBoot.ts`) keeps working.
 *
 * `scripts/with-vercel-dev.mjs` (used by `test:e2e`/`test:visual`) runs Vite
 * directly rather than through `vercel dev`'s own reverse proxy — that proxy
 * turned out not to apply `vercel.json`'s rewrites at all for a project with
 * a custom `devCommand`, silently serving the SPA shell for every request,
 * including source-module requests like `/app/main.tsx` — so this plugin is
 * what makes those routes actually work under `vite dev`, both for
 * plain local development and for the test suite.
 */
function displayRoutes(): Plugin {
  const routes: [RegExp, string][] = [
    [/^\/board\/[^/?]+/, '/display/scoreboard/index.html'],
    [/^\/mirror\/[^/?]+/, '/display/mirror/index.html'],
    [/^\/overlay\/[^/?]+/, '/display/overlay/index.html'],
    [/^\/gameclock\/[^/?]+/, '/display/gameclock/index.html'],
    [/^\/shotclock\/[^/?]+/, '/display/shotclock/index.html'],
  ];
  return {
    name: 'display-routes',
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        const url = req.url ?? '';
        const [path, query] = url.split('?');
        const match = routes.find(([pattern]) => pattern.test(path ?? ''));
        if (match) {
          req.url = query ? `${match[1]}?${query}` : match[1];
        }
        next();
      });
    },
  };
}

/**
 * Six HTML entry points, not one bundle.
 *
 * The React app is a single SPA covering login, dashboard and control panel. The
 * five display surfaces stay plain pages with their own entries, so a
 * scoreboard on a gym wall and an overlay inside OBS load only the few kilobytes
 * they actually need — no router, no React runtime — over whatever venue Wi-Fi
 * happens to be available. The two clock screens are the extreme case: one
 * number and a label, on a panel that may be sharing a phone's hotspot.
 *
 * Firebase Hosting rewrites map the public URLs onto these files; see the
 * `rewrites` block in firebase.json.
 */
export default defineConfig({
  root: 'src',
  publicDir: 'public',
  plugins: [react(), displayRoutes()],
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    target: 'es2022',
    sourcemap: true,
    rollupOptions: {
      input: {
        app: at('src/index.html'),
        scoreboard: at('src/display/scoreboard/index.html'),
        mirror: at('src/display/mirror/index.html'),
        overlay: at('src/display/overlay/index.html'),
        gameclock: at('src/display/gameclock/index.html'),
        shotclock: at('src/display/shotclock/index.html'),
      },
      output: {
        // Firestore and React are used only by the console app. Left to its
        // default heuristic, Rollup would fold every module reachable from more
        // than one entry into a single shared chunk — since core/firebase.ts is
        // imported by every page, that chunk would carry Firestore's client
        // (one of the larger pieces of the SDK) onto the OBS overlay and the
        // gym-wall mirror, which never call it. Splitting by package keeps each
        // display entry's payload to exactly what it uses: app, auth, database,
        // functions — and nothing these pages don't touch.
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          if (id.includes('firebase/firestore') || id.includes('@firebase/firestore')) {
            return 'vendor-firestore';
          }
          if (id.includes('/react/') || id.includes('/react-dom/') || id.includes('react-router')) {
            return 'vendor-react';
          }
          if (id.includes('firebase') || id.includes('@firebase')) {
            return 'vendor-firebase';
          }
          return 'vendor';
        },
      },
    },
    chunkSizeWarningLimit: 900,
  },
  server: {
    // scripts/with-vercel-dev.mjs (used by test:e2e/test:visual) sets PORT to
    // 5000 so Vite listens on the same port the app has always used in this
    // repo's tests; plain `vite`/`npm run dev` has no PORT set and keeps the
    // original fixed port.
    port: Number(process.env.PORT) || 5173,
    strictPort: true,
    // Bind IPv4 explicitly. On this Windows setup Vite's default binds only
    // `[::1]`, so anything connecting to `127.0.0.1` — Playwright's baseURL
    // and the readiness check in scripts/with-vercel-dev.mjs both do — gets
    // connection-refused against a server that is otherwise running fine.
    host: '127.0.0.1',
    // `/api/*` (src/server/ business logic via api/*.ts) isn't served by
    // Vite itself — scripts/with-vercel-dev.mjs runs a separate `vercel dev`
    // instance just for those routes, on VERCEL_API_PORT, and this proxies
    // to it. Unset (plain `npm run dev`) means no proxy at all, so an
    // unhandled `/api/*` request just fails outright — no worse than before
    // this existed, and correct: frontend-only dev was never able to reach
    // privileged operations without the emulator+function stack running too.
    proxy: process.env.VERCEL_API_PORT
      ? { '/api': `http://127.0.0.1:${process.env.VERCEL_API_PORT}` }
      : undefined,
  },
  preview: {
    port: 4173,
    strictPort: true,
  },
});
