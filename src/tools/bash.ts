// Bash tool - execute shell commands safely
import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

const TIMEOUT = 30000; // 30s default
const MAX_OUTPUT = 50000; // 50KB

// Blocklist of dangerous commands
const BLOCKED = [
  'rm -rf /',
  'rm -rf ~',
  'mkfs',
  ':(){ :|:& };:', // fork bomb
  'dd if=',
  'curl | sh',
  'wget | sh',
];

export const bashTool = {
  name: 'bash',
  description: 'Execute a bash command. Returns stdout, stderr, and exit code. Commands have a 30s timeout.',
  dangerous: true,
  schema: {
    type: 'object',
    properties: {
      command: { type: 'string', description: 'The bash command to run' },
      timeout: { type: 'number', description: 'Timeout in ms (default 30000)' },
      cwd: { type: 'string', description: 'Working directory for this command' },
    },
    required: ['command'],
  },
  async execute(args: { command: string; timeout?: number; cwd?: string }) {
    // Safety check
    for (const blocked of BLOCKED) {
      if (args.command.includes(blocked)) {
        throw new Error(`⛔ Blocked dangerous command pattern: "${blocked}"`);
      }
    }

    const timeout = args.timeout || TIMEOUT;
    const cwd = args.cwd || process.cwd();

    try {
      const { stdout, stderr } = await execAsync(args.command, {
        timeout,
        cwd,
        maxBuffer: MAX_OUTPUT,
      });

      return {
        command: args.command,
        stdout: stdout.slice(0, MAX_OUTPUT),
        stderr: stderr.slice(0, MAX_OUTPUT),
        exitCode: 0,
        truncated: stdout.length > MAX_OUTPUT || stderr.length > MAX_OUTPUT,
      };
    } catch (err: any) {
      return {
        command: args.command,
        stdout: err.stdout?.slice(0, MAX_OUTPUT) || '',
        stderr: err.stderr?.slice(0, MAX_OUTPUT) || err.message,
        // `err.code` from exec can be a string like 'ENOENT' (command not
        // found) or a number (exit code). Use a numeric default of 1 when
        // it's not a valid exit code number.
        exitCode: typeof err.code === 'number' ? err.code : 1,
        timedOut: err.killed && err.signal === 'SIGTERM',
      };
    }
  },
};
