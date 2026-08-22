// @ts-check
import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/**
 * One flat config for the whole repo: the framework-free core, the React
 * console, the vanilla display pages, and the server-side API routes all
 * lint the same way, with a couple of narrow overrides where their
 * environments genuinely differ (browser globals vs Node globals, JSX rules
 * only where JSX exists).
 */
export default tseslint.config(
  {
    ignores: ['dist/**', 'node_modules/**'],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  // Browser code: core/, app/, display/.
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: {
      globals: { ...globals.browser },
    },
  },

  // React console specifically.
  {
    files: ['src/app/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
    },
  },

  // Server-side: the trusted, Admin-SDK-privileged layer (src/server/) and
  // the thin Vercel route handlers that call into it (api/). Node, not
  // browser — this also overrides the broader `src/**` browser-globals block
  // above for the one subtree that genuinely isn't browser code.
  {
    files: ['src/server/**/*.ts', 'api/**/*.ts'],
    languageOptions: {
      globals: { ...globals.node },
    },
  },

  // Local dev/CI scripts: plain Node, not TypeScript.
  {
    files: ['scripts/**/*.mjs'],
    languageOptions: {
      globals: { ...globals.node },
    },
  },

  // Tests: Node-run, and Vitest/Playwright's globals-free style means `expect`
  // etc. come from explicit imports, so no extra globals are needed — just
  // relax a couple of rules that fight against common test patterns.
  {
    files: ['tests/**/*.ts'],
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      '@typescript-eslint/no-unused-expressions': 'off',
    },
  },

  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      // Type-only imports already avoid the runtime cost this rule guards
      // against; the value is in catching genuinely dead code, not this.
      '@typescript-eslint/no-explicit-any': 'warn',
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },

  prettier,
);
