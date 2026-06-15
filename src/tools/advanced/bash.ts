// Enhanced Bash tool with security validation, exit code semantics,
// output categorization, and command classification
// Inspired by OpenClaude BashTool.tsx (1180 LOC) and claw-code bash_validation

import { exec, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { classifyBashCommand, describeIntent, type CommandIntent } from '../../permissions.js';
import { stat } from 'node:fs/promises';

const execAsync = promisify(exec);

const DEFAULT_TIMEOUT = 30000;
const MAX_OUTPUT = 50000;
const MAX_TIMEOUT = 600000; // 10 min for explicit long-running

// Dangerous patterns to block
const BLOCKED_PATTERNS = [
  'rm -rf /',
  'rm -rf ~',
  'rm -rf .',
  'mkfs',
  ':(){ :|:& };:',  // fork bomb
  'dd if=',
  'curl | sh',
  'wget | sh',
  'curl | bash',
  'wget | bash',
];

// Command-specific exit code semantics
const COMMAND_SEMANTICS: Record<string, (exit: number) => { isError: boolean; message?: string }> = {
  grep: (exit) => ({ isError: exit >= 2, message: exit === 1 ? 'No matches found' : undefined }),
  rg: (exit) => ({ isError: exit >= 2, message: exit === 1 ? 'No matches found' : undefined }),
  find: (exit) => ({ isError: exit >= 2, message: exit === 1 ? 'Some dirs inaccessible' : undefined }),
  diff: (exit) => ({ isError: exit >= 2, message: exit === 1 ? 'Files differ' : undefined }),
  test: (exit) => ({ isError: exit >= 2, message: exit === 1 ? 'Condition false' : undefined }),
  true: () => ({ isError: false }),
  false: () => ({ isError: true, message: 'Command returned false' }),
};

export const advancedBashTool = {
  name: 'bash',
  description: `Execute a bash command with intelligent analysis.

Features:
- Auto-classifies command intent (read-only/write/destructive/network/package/etc.)
- Detects dangerous patterns and blocks them
- Honors command-specific exit codes (grep 1 = no matches, etc.)
- Captures stdout, stderr, exit code
- Tracks duration
- Optional timeout (default 30s, max 10min)
- Optional working directory

Examples:
- { "command": "ls -la" }
- { "command": "npm install", "timeout": 120000 }
- { "command": "git status", "cwd": "/path/to/repo" }`,
  workdir: process.cwd(),
  schema: {
    type: 'object',
    properties: {
      command: { type: 'string', description: 'The bash command to execute' },
      timeout: { type: 'number', description: 'Timeout in ms (default 30000, max 600000)' },
      cwd: { type: 'string', description: 'Working directory for this command' },
    },
    required: ['command'],
  },
  async execute(args: { command: string; timeout?: number; cwd?: string }) {
    // Block dangerous patterns
    for (const blocked of BLOCKED_PATTERNS) {
      if (args.command.includes(blocked)) {
        throw new Error(`⛔ Blocked dangerous command: contains "${blocked}"`);
      }
    }

    const intent: CommandIntent = classifyBashCommand(args.command);
    const timeout = Math.min(args.timeout || DEFAULT_TIMEOUT, MAX_TIMEOUT);
    const cwd = args.cwd || this.workdir;

    const start = Date.now();
    try {
      const { stdout, stderr } = await execAsync(args.command, {
        timeout,
        cwd,
        maxBuffer: MAX_OUTPUT,
      });

      const duration = Date.now() - start;
      const truncated = stdout.length > MAX_OUTPUT || stderr.length > MAX_OUTPUT;

      return {
        command: args.command,
        intent,
        intentLabel: describeIntent(intent),
        stdout: stdout.slice(0, MAX_OUTPUT),
        stderr: stderr.slice(0, MAX_OUTPUT),
        exitCode: 0,
        duration,
        truncated,
      };
    } catch (err: any) {
      const duration = Date.now() - start;
      const exitCode = err.code || 1;
      const cmdBase = args.command.trim().split(/\s+/)[0];
      const semantic = COMMAND_SEMANTICS[cmdBase]?.(exitCode);

      return {
        command: args.command,
        intent,
        intentLabel: describeIntent(intent),
        stdout: (err.stdout || '').slice(0, MAX_OUTPUT),
        stderr: (err.stderr || '').slice(0, MAX_OUTPUT),
        exitCode,
        duration,
        timedOut: err.killed && err.signal === 'SIGTERM',
        error: semantic?.message || err.message,
        isError: semantic?.isError ?? exitCode !== 0,
      };
    }
  },
};
