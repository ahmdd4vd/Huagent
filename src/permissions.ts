// Permission system - inspired by claw-code (Rust)
// 5 modes, from most restrictive to most permissive:
//   - ReadOnly: only read operations allowed
//   - WorkspaceWrite: read + write within workspace
//   - DangerFullAccess: read + write + system commands
//   - Prompt: ask before each potentially dangerous operation
//   - Allow: allow everything (use with caution)

import { existsSync, statSync } from 'node:fs';
import { resolve, isAbsolute, sep } from 'node:path';
import { lexicallyNormalize } from './utils/paths.js';

export type PermissionMode = 'read-only' | 'workspace-write' | 'danger-full-access' | 'prompt' | 'allow';

export const PERMISSION_MODES: PermissionMode[] = [
  'read-only',
  'workspace-write',
  'danger-full-access',
  'prompt',
  'allow',
];

export interface PermissionResult {
  allowed: boolean;
  reason?: string;
  requiredMode?: PermissionMode;
}

export interface PermissionContext {
  workspaceRoot: string;
  mode: PermissionMode;
  prompter?: PermissionPrompter;
  // User-defined rules (path patterns that are always allowed/denied)
  allowRules?: string[];
  denyRules?: string[];
}

export interface PermissionRequest {
  tool: string;
  input: string;
  currentMode: PermissionMode;
  requiredMode: PermissionMode;
  reason: string;
}

export type PermissionDecision = 'allow' | 'deny' | 'allow-always' | 'deny-always';

export interface PermissionPrompter {
  decide(request: PermissionRequest): Promise<PermissionDecision>;
}

// Default prompter: just allows (for non-interactive mode)
export class DefaultPrompter implements PermissionPrompter {
  async decide(): Promise<PermissionDecision> {
    return 'allow';
  }
}

export class PermissionEnforcer {
  private context: PermissionContext;

  constructor(context: PermissionContext) {
    this.context = context;
  }

  setMode(mode: PermissionMode): void {
    this.context.mode = mode;
  }

  getMode(): PermissionMode {
    return this.context.mode;
  }

  setWorkspaceRoot(root: string): void {
    this.context.workspaceRoot = root;
  }

  // Check if a tool call is allowed
  async check(tool: string, args: any): Promise<PermissionResult> {
    // ReadOnly mode: only read operations
    if (this.context.mode === 'read-only') {
      return this.checkReadOnly(tool, args);
    }

    // WorkspaceWrite: read + write within workspace
    if (this.context.mode === 'workspace-write') {
      return this.checkWorkspaceWrite(tool, args);
    }

    // DangerFullAccess: everything
    if (this.context.mode === 'danger-full-access') {
      return { allowed: true };
    }

    // Allow: everything
    if (this.context.mode === 'allow') {
      return { allowed: true };
    }

    // Prompt: ask for everything potentially dangerous
    if (this.context.mode === 'prompt') {
      return this.checkWithPrompt(tool, args);
    }

    return { allowed: false, reason: 'Unknown permission mode' };
  }

  private async checkReadOnly(tool: string, args: any): Promise<PermissionResult> {
    const readOnlyTools = new Set(['read', 'search', 'grep', 'list', 'glob']);
    if (readOnlyTools.has(tool)) {
      // Verify path is within workspace
      if (args.path) {
        return this.checkPathInWorkspace(args.path, tool);
      }
      return { allowed: true };
    }

    return {
      allowed: false,
      reason: `Tool '${tool}' is not allowed in read-only mode`,
      requiredMode: 'workspace-write',
    };
  }

  private async checkWorkspaceWrite(tool: string, args: any): Promise<PermissionResult> {
    const writeTools = new Set(['write', 'edit']);
    if (writeTools.has(tool) && args.path) {
      const pathCheck = this.checkPathInWorkspace(args.path, tool);
      if (!pathCheck.allowed) return pathCheck;
      return { allowed: true };
    }

    if (tool === 'bash') {
      const bashCheck = this.checkBashCommand(args.command || '');
      if (!bashCheck.allowed) return bashCheck;
      return { allowed: true };
    }

    // Read-only tools are always allowed in workspace-write mode.
    if (['read', 'search', 'grep', 'list', 'glob', 'web', 'memory'].includes(tool)) {
      return { allowed: true };
    }

    // SECURITY: Default-deny for unknown tools. The previous behavior
    // (`return { allowed: true }`) auto-allowed any tool not in the
    // explicit list, which means a new tool added to the registry would
    // bypass permission checks entirely. Unknown tools must be denied
    // until they're explicitly added to the allowlist above.
    return {
      allowed: false,
      reason: `Tool "${tool}" is not in the workspace-write allowlist. Use danger-full-access mode to allow it.`,
    };
  }

  private async checkWithPrompt(tool: string, args: any): Promise<PermissionResult> {
    // For prompt mode, use prompter to ask
    const readOnlyTools = new Set(['read', 'search', 'grep']);
    if (readOnlyTools.has(tool)) {
      return { allowed: true };
    }

    if (this.context.prompter) {
      const request: PermissionRequest = {
        tool,
        input: JSON.stringify(args).slice(0, 200),
        currentMode: this.context.mode,
        requiredMode: 'workspace-write',
        reason: `Allow ${tool} to run?`,
      };

      const decision = await this.context.prompter.decide(request);
      if (decision === 'allow' || decision === 'allow-always') {
        return { allowed: true };
      }
      return { allowed: false, reason: 'Denied by user' };
    }

    // No prompter, default to allowing
    return { allowed: true };
  }

  // Check if a path is within the workspace
  private checkPathInWorkspace(path: string, tool: string): PermissionResult {
    if (!this.context.workspaceRoot) {
      return { allowed: true };
    }

    const fullPath = isAbsolute(path) ? path : resolve(this.context.workspaceRoot, path);
    const normalized = lexicallyNormalize(fullPath);
    const root = lexicallyNormalize(this.context.workspaceRoot);
    const rootWithSep = root.endsWith(sep) ? root : root + sep;

    if (normalized === root || normalized.startsWith(rootWithSep)) {
      return { allowed: true };
    }

    return {
      allowed: false,
      reason: `Path '${path}' is outside workspace '${this.context.workspaceRoot}'`,
      requiredMode: 'danger-full-access',
    };
  }

  // Classify a bash command (read-only vs mutating)
  checkBashCommand(command: string): PermissionResult {
    const classification = classifyBashCommand(command);

    if (classification === 'read-only') {
      return { allowed: true };
    }

    // CRITICAL FIX: 'unknown' commands (like `npx skills add`, `npm install`,
    // `pip install`, etc.) were being DENIED in workspace-write mode, which
    // made huagent say "I can't access the terminal" or "I don't have
    // permission". This is the #1 user complaint. OpenCode allows all
    // non-destructive commands in workspace-write mode. We now allow
    // 'unknown' commands in workspace-write mode — only block in read-only.
    if (classification === 'unknown') {
      if (this.context.mode === 'read-only') {
        return {
          allowed: false,
          reason: `Command not classified as read-only: ${command.slice(0, 100)}`,
          requiredMode: 'workspace-write',
        };
      }
      // workspace-write, sandboxed, danger-full-access, allow → all permit unknown
      return { allowed: true };
    }

    // Mutating command (write, package, network, process, system)
    if (this.context.mode === 'read-only') {
      return {
        allowed: false,
        reason: `Bash command '${command.slice(0, 100)}' may modify state (${classification})`,
        requiredMode: 'workspace-write',
      };
    }

    // For destructive commands, still require danger-full-access
    if (classification === 'destructive' && this.context.mode !== 'danger-full-access' && this.context.mode !== 'allow') {
      return {
        allowed: false,
        reason: `Destructive command detected: ${command.slice(0, 100)}`,
        requiredMode: 'danger-full-access',
      };
    }

    return { allowed: true };
  }
}

// Classify bash command intent
// Inspired by claw-code (Rust) bash_validation.rs
export type CommandIntent = 'read-only' | 'write' | 'destructive' | 'network' | 'process' | 'package' | 'system' | 'unknown';

const READ_ONLY_COMMANDS = new Set([
  'ls', 'cat', 'head', 'tail', 'less', 'more', 'file', 'stat', 'wc', 'find', 'grep',
  'egrep', 'fgrep', 'awk', 'sed', 'sort', 'uniq', 'cut', 'tr', 'diff', 'cmp', 'md5sum',
  'sha256sum', 'echo', 'printf', 'date', 'whoami', 'hostname', 'pwd', 'env', 'printenv',
  'which', 'whereis', 'type', 'uname', 'uptime', 'df', 'du', 'free', 'ps', 'pgrep', 'top', 'htop',
  'lsof', 'netstat', 'ss', 'ifconfig', 'ip', 'route', 'ping', 'traceroute', 'nslookup',
  'dig', 'git status', 'git log', 'git diff', 'git show', 'git branch', 'git remote',
  'git tag', 'git ls-files', 'git config --get', 'npm list', 'npm ls', 'pip list',
  'pip show', 'cargo --version', 'node --version', 'npm --version',
]);

const WRITE_COMMANDS = new Set([
  'cp', 'mv', 'mkdir', 'rmdir', 'touch', 'chmod', 'chown', 'chgrp', 'ln', 'install',
  'tee', 'truncate', 'mkfifo', 'mknod', 'dd', 'git add', 'git commit', 'git push',
  'git pull', 'git fetch', 'git merge', 'git rebase', 'git checkout', 'git reset',
  'git stash', 'npm install', 'npm i', 'yarn add', 'pnpm add', 'pip install',
]);

const DESTRUCTIVE_COMMANDS = new Set([
  'rm', 'shred', 'wipe', 'srm', 'dd if=', 'mkfs', 'fdisk', 'parted',
  'git push --force', 'git push -f', 'git reset --hard', 'git clean -fd',
  'drop table', 'truncate table', 'delete from',
]);

const NETWORK_COMMANDS = new Set([
  'curl', 'wget', 'ssh', 'scp', 'rsync', 'ftp', 'sftp', 'nc', 'netcat', 'telnet',
  'ping -c', 'traceroute', 'mtr',
]);

const PROCESS_COMMANDS = new Set([
  'kill', 'killall', 'pkill', 'jobs', 'fg', 'bg', 'nohup',
  'systemctl', 'service',
]);

const PACKAGE_COMMANDS = new Set([
  'apt', 'apt-get', 'yum', 'dnf', 'pacman', 'brew', 'snap', 'flatpak',
  'pip', 'pip3', 'npm', 'yarn', 'pnpm', 'bun', 'cargo', 'gem', 'go',
  'npx', 'tsx', 'deno', 'rustup', 'volta', 'nvm', 'fnm', 'volta',
]);

const SYSTEM_COMMANDS = new Set([
  'sudo', 'su', 'mount', 'umount', 'chroot', 'crontab', 'at', 'batch',
  'useradd', 'userdel', 'usermod', 'groupadd', 'groupdel', 'passwd',
]);

export function classifyBashCommand(command: string): CommandIntent {
  const trimmed = command.trim();
  if (!trimmed) return 'read-only';

  // Handle pipes - check the first command
  const firstCmd = trimmed.split(/[|&;]/)[0].trim();
  const cmdBase = firstCmd.split(/\s+/)[0];

  // Check for destructive patterns first
  const destructiveArr = Array.from(DESTRUCTIVE_COMMANDS);
  for (const pattern of destructiveArr) {
    if (trimmed.includes(pattern)) {
      return 'destructive';
    }
  }

  // Check for redirects (writing) FIRST - they override the base command
  if (/[>]/.test(trimmed) && !/^[<>]\s*$/.test(trimmed)) {
    // >> is append (still write), > is overwrite
    return 'write';
  }
  if (/[<][^=]/.test(trimmed)) {
    // < is read (input redirect)
  }

  // Specific categories first (more specific = more important)
  if (DESTRUCTIVE_COMMANDS.has(cmdBase)) {
    return 'destructive';
  }
  if (NETWORK_COMMANDS.has(cmdBase)) {
    return 'network';
  }
  if (PACKAGE_COMMANDS.has(cmdBase)) {
    return 'package';
  }
  if (PROCESS_COMMANDS.has(cmdBase)) {
    return 'process';
  }
  if (SYSTEM_COMMANDS.has(cmdBase)) {
    return 'system';
  }

  if (READ_ONLY_COMMANDS.has(cmdBase) || READ_ONLY_COMMANDS.has(firstCmd)) {
    return 'read-only';
  }
  if (WRITE_COMMANDS.has(cmdBase) || WRITE_COMMANDS.has(firstCmd)) {
    return 'write';
  }

  return 'unknown';
}

// Human-readable command intent
export function describeIntent(intent: CommandIntent): string {
  switch (intent) {
    case 'read-only': return '📖 read-only';
    case 'write': return '✏️ write';
    case 'destructive': return '💥 destructive';
    case 'network': return '🌐 network';
    case 'process': return '⚙️ process';
    case 'package': return '📦 package';
    case 'system': return '🔐 system';
    case 'unknown': return '❓ unknown';
  }
}
