// Bash tool - execute shell commands safely (cross-platform)
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { platform } from 'node:os';

const execAsync = promisify(exec);

const TIMEOUT = 60000;
const MAX_OUTPUT = 50000;
const IS_WINDOWS = platform() === 'win32';

// Blocklist of dangerous commands
const BLOCKED = [
  'rm -rf /',
  'rm -rf ~',
  'mkfs',
  ':(){ :|:& };:', // fork bomb
  'dd if=',
  'curl | sh',
  'wget | sh',
  'format c:',
  'del /f /s /q C:\\',
];

// Common Unix → Windows command translations.
// When the LLM sends a Unix command on Windows, we auto-translate it
// so the user doesn't get "'ls' is not recognized" errors.
const UNIX_TO_WIN: Record<string, string> = {
  'ls': 'dir',
  'ls -la': 'dir /a',
  'ls -l': 'dir',
  'ls -al': 'dir /a',
  'cat': 'type',
  'cp': 'copy',
  'mv': 'move',
  'rm': 'del',
  'rm -rf': 'rmdir /s /q',
  'rm -f': 'del /f /q',
  'mkdir -p': 'mkdir',
  'touch': 'type nul >',
  'grep': 'findstr',
  'find': 'dir /s /b',
  'pwd': 'cd',
  'clear': 'cls',
  'which': 'where',
  'export': 'set',
  'head': 'more',
  'tail': 'more',
  'wc -l': 'find /c /v ""',
};

/**
 * Translate a Unix command to Windows equivalent.
 * Only translates the FIRST word (the command itself) — flags and args
 * are left as-is (most are compatible or close enough).
 */
function translateCommand(command: string): string {
  if (!IS_WINDOWS) return command;

  const trimmed = command.trim();

  // Check for exact multi-word matches first (e.g. "ls -la")
  for (const [unix, win] of Object.entries(UNIX_TO_WIN)) {
    if (trimmed.startsWith(unix + ' ') || trimmed === unix) {
      return trimmed.replace(unix, win);
    }
  }

  // Check single-word command
  const firstWord = trimmed.split(/\s+/)[0];
  if (UNIX_TO_WIN[firstWord]) {
    return trimmed.replace(firstWord, UNIX_TO_WIN[firstWord]);
  }

  // No translation needed
  return command;
}

export const bashTool = {
  name: 'bash',
  description: IS_WINDOWS
    ? 'Execute a shell command on Windows (cmd.exe). Common Unix commands like ls, cat, grep are auto-translated. Returns stdout, stderr, and exit code. 60s timeout.'
    : 'Execute a bash command. Returns stdout, stderr, and exit code. 60s timeout.',
  dangerous: true,
  schema: {
    type: 'object',
    properties: {
      command: { type: 'string', description: IS_WINDOWS ? 'The shell command to run (Unix commands like ls/cat/grep are auto-translated to Windows equivalents)' : 'The bash command to run' },
      timeout: { type: 'number', description: 'Timeout in ms (default 60000)' },
      cwd: { type: 'string', description: 'Working directory for this command' },
    },
    required: ['command'],
  },
  async execute(args: { command: string; timeout?: number; cwd?: string }) {
    if (!args || !args.command) {
      throw new Error('bash tool requires a "command" argument');
    }

    // Safety check
    for (const blocked of BLOCKED) {
      if (args.command.includes(blocked)) {
        throw new Error(`⛔ Blocked dangerous command pattern: "${blocked}"`);
      }
    }

    // Auto-translate Unix commands to Windows equivalents
    const command = translateCommand(args.command);
    const timeout = args.timeout || TIMEOUT;
    const cwd = args.cwd || process.cwd();

    // On Windows, use cmd.exe explicitly. On Unix, use the default shell.
    const shellOptions: any = {
      timeout,
      cwd,
      maxBuffer: MAX_OUTPUT,
    };
    if (IS_WINDOWS) {
      shellOptions.shell = 'cmd.exe';
    }

    try {
      const { stdout, stderr } = await execAsync(command, shellOptions);

      return {
        command: args.command,
        executedCommand: command !== args.command ? command : undefined,
        stdout: stdout.slice(0, MAX_OUTPUT),
        stderr: stderr.slice(0, MAX_OUTPUT),
        exitCode: 0,
        truncated: stdout.length > MAX_OUTPUT || stderr.length > MAX_OUTPUT,
      };
    } catch (err: any) {
      return {
        command: args.command,
        executedCommand: command !== args.command ? command : undefined,
        stdout: err.stdout?.slice(0, MAX_OUTPUT) || '',
        stderr: err.stderr?.slice(0, MAX_OUTPUT) || err.message,
        exitCode: typeof err.code === 'number' ? err.code : 1,
        timedOut: err.killed && err.signal === 'SIGTERM',
      };
    }
  },
};
