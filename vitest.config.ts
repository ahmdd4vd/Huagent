import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'tests/**/*.test.ts',
    ],
    exclude: [
      'node_modules',
      'dist',
      'tests/wllm/**',
      // Legacy custom-framework tests (run via tests/run.test.ts)
      'tests/tui-v4.test.ts',
      'tests/discipline.test.ts',
      'tests/cli-commands.test.ts',
    ],
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
  esbuild: {
    target: 'node18',
  },
});
