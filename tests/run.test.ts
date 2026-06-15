/**
 * tests/run.test.ts — Vitest wrapper around the custom test() framework.
 *
 * Each legacy test file uses its own test() function with console.log output.
 * We run them as child processes, capture their output, and verify the
 * "X passed, 0 failed" summary line.
 */
import { describe, it, expect } from 'vitest';
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';

const execFileP = promisify(execFile);
const ROOT = join(__dirname, '..');

const TEST_FILES = [
  { file: 'tests/tui-v4.test.ts', minPass: 100 },
  { file: 'tests/discipline.test.ts', minPass: 100 },
  { file: 'tests/cli-commands.test.ts', minPass: 50 },
  { file: 'tests/test-tui-stress.ts', minPass: 100 },
  { file: 'tests/test-providers.ts', minPass: 300 },
  { file: 'tests/test-picker.ts', minPass: 30 },
  { file: 'tests/test-dialogs.ts', minPass: 40 },
];

function runTestFile(file: string): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile('npx', ['tsx', file], { cwd: ROOT, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      // err is non-null when process exits with non-zero. We still want stdout.
      resolve({ stdout: stdout || '', stderr: stderr || '' });
    });
  });
}

describe('huagent test suite', () => {
  for (const { file, minPass } of TEST_FILES) {
    it(`runs ${file}`, async () => {
      const fullPath = join(ROOT, file);
      expect(existsSync(fullPath), `test file ${file} should exist`).toBe(true);

      const { stdout } = await runTestFile(fullPath);
      // Each test file uses its own test() function and prints ✓/✗.
      // Look for the "X passed, Y failed" line.
      const match = stdout.match(/(\d+)\s*passed,\s*(\d+)\s*failed/);
      expect(match, `${file} should report pass/fail summary. Got output: ${stdout.slice(0, 500)}`).toBeTruthy();
      const passed = parseInt(match![1], 10);
      const failed = parseInt(match![2], 10);
      expect(failed, `${file} should have 0 failures`).toBe(0);
      expect(passed, `${file} should have at least ${minPass} tests`).toBeGreaterThanOrEqual(minPass);
    }, 30_000);
  }
});
