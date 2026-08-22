import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const at = (path: string) => resolve(process.cwd(), path);

/**
 * Four HTML entry points, not one bundle.
 *
 * The React app is a single SPA covering login, dashboard and control panel. The
 * three display surfaces stay plain pages with their own entries, so a
 * scoreboard on a gym wall and an overlay inside OBS load only the few kilobytes
 * they actually need — no router, no React runtime — over whatever venue Wi-Fi
 * happens to be available.
 *
 * Firebase Hosting rewrites map the public URLs onto these files; see the
 * `rewrites` block in firebase.json.
 */
export default defineConfig({
  root: 'src',
  publicDir: 'public',
  plugins: [react()],
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
      },
      output: {
        // Firestore and React are used only by the console app. Left to its
        // default heuristic, Rollup would fold every module reachable from more
        // than one entry into a single shared chunk — since core/firebase.ts is
        // imported by all four pages, that chunk would carry Firestore's client
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
    port: 5173,
    strictPort: true,
  },
  preview: {
    port: 4173,
    strictPort: true,
  },
});
