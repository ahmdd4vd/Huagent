import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    // The excluded files are "script-style" test files that use a custom
    // test() function and process.exit() — they are run as child processes
    // by tests/run.test.ts, not directly by vitest. Loading them inside
    // vitest triggers an "unexpected process.exit" error.
    exclude: [
      'node_modules',
      'dist',
      'tests/wllm/**',
      'tests/engine.test.ts',
      'tests/tui-v4.test.ts',
      'tests/discipline.test.ts',
      'tests/cli-commands.test.ts',
    ],
    testTimeout: 60000,
    hookTimeout: 60000,
  },
  resolve: {
    extensions: ['.ts', '.tsx', '.js', '.jsx', '.json'],
  },
  esbuild: {
    target: 'node18',
  },
});
