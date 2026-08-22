import { defineConfig } from 'vitest/config';

/**
 * Three suites, separated because they have very different costs:
 *
 *   unit        — pure functions, no I/O. Runs in milliseconds, on every save.
 *   rules       — security rules against the emulator. The tenant-isolation proof.
 *   integration — real transactions against the emulator. Concurrency behaviour.
 *
 * The emulator-backed suites disable file parallelism: they share one emulator
 * instance, and concurrent files would see each other's writes.
 */
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: ['tests/unit/**/*.test.ts'],
          environment: 'node',
        },
      },
      {
        test: {
          name: 'rules',
          include: ['tests/rules/**/*.test.ts'],
          environment: 'node',
          testTimeout: 20_000,
          hookTimeout: 20_000,
          // One process, one file at a time: these suites share a single
          // emulator instance and would otherwise observe each other's writes.
          pool: 'forks',
          poolOptions: { forks: { singleFork: true } },
        },
      },
      {
        test: {
          name: 'integration',
          include: ['tests/integration/**/*.test.ts'],
          environment: 'node',
          testTimeout: 30_000,
          hookTimeout: 30_000,
          pool: 'forks',
          poolOptions: { forks: { singleFork: true } },
        },
      },
    ],
    coverage: {
      provider: 'v8',
      include: ['src/core/**/*.ts'],
      reporter: ['text', 'lcov'],
      thresholds: {
        lines: 90,
        functions: 90,
        branches: 85,
        statements: 90,
      },
    },
  },
});
