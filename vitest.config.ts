import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    exclude: ['node_modules', 'dist', 'tests/wllm/**', 'tests/tui-v4.test.ts', 'tests/discipline.test.ts', 'tests/cli-commands.test.ts'],
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
