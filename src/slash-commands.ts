// Slash command system - inspired by claw-code (Rust) commands/
// 15+ commands for power-user control

import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { theme, fg, gradient } from './tui/theme.js';
import { mascots } from './tui/mascot.js';
import { SessionManager } from './sessions.js';
import { MemoryManager } from './memory/manager.js';
import { ToolRegistry } from './tools/index.js';
import { LLMClient } from './llm/client.js';
import { summarizeConversation } from './summary.js';
import type { Message } from './types/index.js';
import { classifyBashCommand, describeIntent } from './permissions.js';
import { listProviders, getProvider, type ProviderId, PROVIDERS } from './providers/registry.js';
import { getModels, totalModelCount, getDefaultModel } from './providers/models.js';

const execAsync = promisify(exec);

export interface SlashCommandContext {
  messages: Message[];
  llm: any; // UnifiedClient - any for flexibility
  memory: MemoryManager;
  tools: ToolRegistry;
  sessions: SessionManager;
  workdir: string;
  config: any;
  // Mutable state
  onClear?: () => void;
  onSwitchModel?: (model: string) => void;
  onSwitchProvider?: (provider: string) => void;
  onSetPermissionMode?: (mode: any) => void;
  onSave?: (summary: string) => void;
  /** Toggle autonomous mode (no confirmations). Returns the new state. */
  onToggleAutonomous?: () => boolean;
  /** Set the file scope. Pass undefined to clear. Returns the new scope or null. */
  onSetScope?: (scope: string | undefined) => string | null;
  /** Get current scope (string or null if no scope). */
  onGetScope?: () => string | null;
  /** Get current autonomous mode. */
  onGetAutonomous?: () => boolean;
  /** Persist config to disk. */
  onPersistConfig?: () => void;
}

export interface SlashCommandResult {
  handled: boolean;
  message?: string;
  clearMessages?: boolean;
  exit?: boolean;
}

export const SLASH_COMMANDS = [
  { name: 'help', aliases: ['?'], summary: 'Show available slash commands' },
  { name: 'status', aliases: [], summary: 'Show current session status' },
  { name: 'cost', aliases: ['usage'], summary: 'Show cumulative token usage' },
  { name: 'clear', aliases: ['reset'], summary: 'Start a fresh local session' },
  { name: 'compact', aliases: [], summary: 'Compact local session history' },
  { name: 'model', aliases: ['m'], summary: 'Show or switch the active model' },
  { name: 'models', aliases: ['mods'], summary: 'List all available models for the current provider' },
  { name: 'provider', aliases: ['prov'], summary: 'Show or switch the LLM provider' },
  { name: 'providers', aliases: ['provs'], summary: 'List all 22+ supported LLM providers' },
  { name: 'autonomous', aliases: ['auto'], summary: 'Toggle autonomous mode (no confirmations)' },
  { name: 'scope', aliases: [], summary: 'Show or set file scope (limit edits to one file)' },
  { name: 'permissions', aliases: ['perm', 'p'], summary: 'Show or switch the active permission mode' },
  { name: 'memory', aliases: ['mem'], summary: 'Inspect loaded memory' },
  { name: 'skills', aliases: ['skill'], summary: 'List, install, or invoke available skills' },
  { name: 'init', aliases: [], summary: 'Create a starter HUAAGENT.md for this project' },
  { name: 'diff', aliases: [], summary: 'Show git diff for current workspace changes' },
  { name: 'version', aliases: ['v'], summary: 'Show CLI version' },
  { name: 'marketplace', aliases: ['shop', 'store'], summary: 'Browse, search, and install wiki bundles' },
  { name: 'agents', aliases: ['subs'], summary: 'List and manage subagents' },
  { name: 'modes', aliases: [], summary: 'Show all current modes (autonomous, scope, permission)' },
  { name: 'activity', aliases: ['act'], summary: 'Toggle the live activity feed panel' },
  { name: 'sessions', aliases: ['session'], summary: 'List, switch, or delete saved sessions' },
  { name: 'resume', aliases: ['r'], summary: 'Load a saved session' },
  { name: 'export', aliases: [], summary: 'Export the current conversation to a file' },
  { name: 'undo', aliases: [], summary: 'Show how to undo the last edit' },
  { name: 'doctor', aliases: ['check'], summary: 'Run diagnostic checks' },
  { name: 'theme', aliases: [], summary: 'Show or switch color theme' },
  { name: 'exit', aliases: ['quit', 'q'], summary: 'Exit huagent' },
];

export async function executeSlashCommand(
  command: string,
  args: string[],
  ctx: SlashCommandContext
): Promise<SlashCommandResult> {
  switch (command) {
    case 'help':
    case '?':
      return cmdHelp();
    case 'status':
      return cmdStatus(ctx);
    case 'cost':
    case 'usage':
      return cmdCost(ctx);
    case 'clear':
    case 'reset':
      return cmdClear(ctx);
    case 'compact':
      return cmdCompact(ctx);
    case 'model':
    case 'm':
      return cmdModel(args, ctx);
    case 'models':
    case 'mods':
      return cmdModels(args, ctx);
    case 'provider':
    case 'prov':
      return cmdProvider(args, ctx);
    case 'providers':
    case 'provs':
      return cmdProviders(args, ctx);
    case 'autonomous':
    case 'auto':
      return cmdAutonomous(args, ctx);
    case 'scope':
      return cmdScope(args, ctx);
    case 'permissions':
    case 'perm':
    case 'p':
      return cmdPermissions(args, ctx);
    case 'memory':
    case 'mem':
      return cmdMemory(ctx);
    case 'skills':
    case 'skill':
      return cmdSkills(ctx);
    case 'init':
      return await cmdInit(ctx);
    case 'marketplace':
    case 'shop':
    case 'store':
      return await cmdMarketplace(args, ctx);
    case 'agents':
    case 'subs':
      return cmdAgents(ctx);
    case 'modes':
      return cmdModes(ctx);
    case 'activity':
    case 'act':
      return cmdActivity(ctx);
    case 'diff':
      return await cmdDiff(ctx);
    case 'version':
    case 'v':
      return cmdVersion([], ctx);
    case 'sessions':
    case 'session':
      return cmdSessions(args, ctx);
    case 'resume':
    case 'r':
      return cmdResume(args, ctx);
    case 'export':
      return await cmdExport(args, ctx);
    case 'undo':
      return cmdUndo();
    case 'doctor':
    case 'check':
      return await cmdDoctor(ctx);
    case 'theme':
      return cmdTheme(args);
    case 'exit':
    case 'quit':
    case 'q':
      return { handled: true, exit: true, message: `${mascots.winkHua} Goodbye!` };
    default:
      return {
        handled: false,
        message: `${fg(theme.warning, '⚠ Unknown command: /' + command)}. Type ${fg(theme.primary, '/help')} for available commands.`,
      };
  }
}

function cmdHelp(): SlashCommandResult {
  // Group commands by category for a clean, scannable help screen
  const groups: Array<{ name: string; cmds: string[] }> = [
    {
      name: 'session',
      cmds: ['/clear', '/compact', '/export', '/undo', '/sessions', '/resume', '/diff'],
    },
    {
      name: 'model & provider',
      cmds: ['/model', '/provider', '/permissions'],
    },
    {
      name: 'modes & scope',
      cmds: ['/autonomous', '/scope', '/modes', '/activity'],
    },
    {
      name: 'memory & skills',
      cmds: ['/memory', '/skills', '/init'],
    },
    {
      name: 'discover',
      cmds: ['/marketplace', '/agents', '/help', '/status', '/cost', '/doctor'],
    },
    {
      name: 'meta',
      cmds: ['/theme', '/version', '/exit'],
    },
  ];

  let msg = `\n${gradient('Slash Commands', theme.primary, theme.secondary)}\n`;
  msg += `${fg(theme.fgDim, '─'.repeat(60))}\n`;
  for (const g of groups) {
    msg += `\n  ${fg(theme.accent, g.name.toUpperCase())}\n`;
    for (const c of g.cmds) {
      const cmd = SLASH_COMMANDS.find((x) => '/' + x.name === c);
      const summary = cmd?.summary ?? '';
      msg += `    ${fg(theme.primary, c.padEnd(18))} ${fg(theme.fgDim, summary)}\n`;
    }
  }
  msg += `\n${fg(theme.fgDim, 'total: ' + SLASH_COMMANDS.length + ' commands')}\n`;
  msg += `\n${mascots.smallHua} ${fg(theme.accent, 'tip: type /command + Tab for completion')}\n`;
  return { handled: true, message: msg };
}

function cmdStatus(ctx: SlashCommandContext): SlashCommandResult {
  const stats = ctx.llm.getStats();
  const memStats = ctx.memory.stats();
  const mode = ctx.tools.getPermissionMode();
  const recentMsgs = ctx.messages.length;
  const autonomous = ctx.onGetAutonomous ? ctx.onGetAutonomous() : false;
  const scope = ctx.onGetScope ? ctx.onGetScope() : null;
  let msg = `\n${gradient('Session Status', theme.primary, theme.secondary)}\n`;
  msg += `${fg(theme.fgDim, '─'.repeat(60))}\n`;
  msg += `  ${fg(theme.accent, 'Model:         ')} ${ctx.config.model}\n`;
  msg += `  ${fg(theme.accent, 'Provider:      ')} ${ctx.config.provider}\n`;
  msg += `  ${fg(theme.accent, 'Workspace:     ')} ${ctx.workdir}\n`;
  msg += `  ${fg(theme.accent, 'Messages:      ')} ${recentMsgs}\n`;
  msg += `  ${fg(theme.accent, 'Memory:        ')} ${memStats.memories} memories, ${memStats.skills} skills, ${memStats.facts} facts\n`;
  msg += `  ${fg(theme.accent, 'Permission:    ')} ${fg(mode === 'read-only' ? theme.success : mode === 'danger-full-access' ? theme.danger : theme.info, mode)}\n`;
  msg += `  ${fg(theme.accent, 'Autonomous:    ')} ${fg(autonomous ? theme.warning : theme.fgDim, autonomous ? 'ON ⚡' : 'off')}\n`;
  msg += `  ${fg(theme.accent, 'Scope:         ')} ${fg(scope ? theme.primary : theme.fgDim, scope ?? '(none — multi-file)')}\n`;
  msg += `  ${fg(theme.accent, 'Tokens:        ')} ${stats.totalTokens.toLocaleString()} (${stats.totalInputTokens.toLocaleString()} in / ${stats.totalOutputTokens.toLocaleString()} out)\n`;
  msg += `  ${fg(theme.accent, 'Cost:          ')} $${stats.totalCost.toFixed(4)}\n`;
  msg += `  ${fg(theme.accent, 'Requests:      ')} ${stats.totalRequests}\n`;
  return { handled: true, message: msg };
}

function cmdCost(ctx: SlashCommandContext): SlashCommandResult {
  const stats = ctx.llm.getStats();
  let msg = `\n${gradient('Token Usage', theme.primary, theme.secondary)}\n`;
  msg += `${fg(theme.fgDim, '─'.repeat(60))}\n`;
  msg += `  ${fg(theme.accent, 'Input:         ')} ${stats.totalInputTokens.toLocaleString()} tokens\n`;
  msg += `  ${fg(theme.accent, 'Output:        ')} ${stats.totalOutputTokens.toLocaleString()} tokens\n`;
  msg += `  ${fg(theme.accent, 'Total:         ')} ${stats.totalTokens.toLocaleString()} tokens\n`;
  msg += `  ${fg(theme.accent, 'Requests:      ')} ${stats.totalRequests}\n`;
  msg += `  ${fg(theme.accent, 'Estimated cost:')} $${stats.totalCost.toFixed(4)}\n`;
  return { handled: true, message: msg };
}

function cmdClear(ctx: SlashCommandContext): SlashCommandResult {
  if (ctx.onClear) ctx.onClear();
  ctx.llm.resetStats();
  return { handled: true, clearMessages: true, message: `${mascots.smallHua} ${fg(theme.success, '✨ Session cleared! Fresh start ✧')}` };
}

function cmdCompact(ctx: SlashCommandContext): SlashCommandResult {
  if (ctx.messages.length === 0) {
    return { handled: true, message: `${mascots.sleepHua} Nothing to compact yet.` };
  }
  const summary = summarizeConversation(ctx.messages);
  // Record the summary as a semantic memory
  ctx.memory.saveProjectFact('last-compacted-session', summary, 0.8);
  return { handled: true, message: `\n${fg(theme.info, '📝 Compacted summary:')}\n\n${summary}\n\n${fg(theme.fgDim, `(saved to memory as 'last-compacted-session')`)}` };
}

function cmdModel(args: string[], ctx: SlashCommandContext): SlashCommandResult {
  if (args.length === 0) {
    return {
      handled: true,
      message:
        `Current model: ${fg(theme.primary, ctx.config.model)}\n` +
        `Provider: ${ctx.config.provider}\n\n` +
        `${fg(theme.fgDim, 'Usage: /model <name>  |  /models (list all for this provider)')}`,
    };
  }
  const newModel = args[0];
  if (ctx.onSwitchModel) ctx.onSwitchModel(newModel);
  return {
    handled: true,
    message: `${mascots.smallHua} ${fg(theme.success, '✓ Switched to model: ' + newModel)}`,
  };
}

/**
 * /models — list all available models for the current provider.
 * Usage: /models                  show models for current provider
 *        /models <provider>       show models for a specific provider
 *        /models <provider> <id>  switch to model
 */
function cmdModels(args: string[], ctx: SlashCommandContext): SlashCommandResult {
  const targetProvider = (args[0] || ctx.config.provider) as ProviderId;
  const provider = PROVIDERS[targetProvider];
  if (!provider) {
    return {
      handled: true,
      message: `${fg(theme.danger, '✗ Unknown provider: ' + targetProvider)}\n${fg(theme.fgDim, 'Try /providers to see the full list.')}`,
    };
  }

  // Switching model: /models <provider> <model-id>
  if (args.length >= 2) {
    const modelId = args[1];
    if (args[0] !== ctx.config.provider) {
      // Also switch provider
      if (ctx.onSwitchProvider) ctx.onSwitchProvider(args[0]);
    }
    if (ctx.onSwitchModel) ctx.onSwitchModel(modelId);
    return {
      handled: true,
      message: `${mascots.smallHua} ${fg(theme.success, '✓ Switched to ' + targetProvider + ' / ' + modelId)}`,
    };
  }

  const models = getModels(targetProvider);
  const cur = ctx.config.model;

  let msg = `\n${gradient(`Models: ${provider.displayName}`, theme.primary, theme.secondary)}\n`;
  msg += `${fg(theme.fgDim, '─'.repeat(72))}\n`;
  msg += `  ${fg(theme.fgMuted, provider.emoji + '  ' + provider.baseUrl)}\n`;
  msg += `  ${fg(theme.fgMuted, 'context: ' + (provider.contextWindow?.toLocaleString() || 'n/a') + ' tokens')}\n\n`;

  // Group by tier
  const tiers: Array<{ key: string; label: string }> = [
    { key: 'flagship', label: 'Flagship' },
    { key: 'reasoning', label: 'Reasoning' },
    { key: 'fast', label: 'Fast' },
    { key: 'code', label: 'Code' },
    { key: 'local', label: 'Local' },
    { key: 'legacy', label: 'Legacy' },
  ];
  for (const t of tiers) {
    const tierModels = models.filter((m) => m.tier === t.key);
    if (tierModels.length === 0) continue;
    msg += `  ${fg(theme.accent, t.label.toUpperCase())}\n`;
    for (const m of tierModels) {
      const marker = m.id === cur ? '●' : '○';
      const color = m.id === cur ? theme.success : m.deprecated ? theme.fgMuted : theme.fg;
      const ctx = (m.context >= 1_000_000 ? (m.context / 1_000_000) + 'M' : m.context >= 1000 ? Math.round(m.context / 1000) + 'k' : m.context) + 'ctx';
      const cost = m.cost.input === 0 && m.cost.output === 0 ? 'free' : `$${m.cost.input}/$${m.cost.output}`;
      msg += `    ${fg(color, marker + ' ' + m.label.padEnd(36))} ${fg(theme.fgMuted, ctx.padStart(7))}  ${fg(theme.fgSubtle, cost.padStart(12))}\n`;
    }
  }
  msg += `\n${fg(theme.fgDim, 'total: ' + models.length + ' models  ·  switch: /models ' + targetProvider + ' <model-id>')}\n`;
  return { handled: true, message: msg };
}

/**
 * /providers — list all 22+ supported LLM providers.
 */
function cmdProviders(_args: string[], _ctx: SlashCommandContext): SlashCommandResult {
  const providers = listProviders();
  let msg = `\n${gradient('Supported Providers', theme.primary, theme.secondary)}\n`;
  msg += `${fg(theme.fgDim, '─'.repeat(72))}\n`;

  // Group by format
  const groups: Record<string, typeof providers> = {};
  for (const p of providers) {
    if (!groups[p.apiFormat]) groups[p.apiFormat] = [];
    groups[p.apiFormat].push(p);
  }

  for (const [format, ps] of Object.entries(groups)) {
    msg += `\n  ${fg(theme.accent, format.toUpperCase())}\n`;
    for (const p of ps) {
      const hasKey = process.env[p.apiKeyEnv] ? '✓ key set' : '○ no key';
      const keyColor = process.env[p.apiKeyEnv] ? theme.success : theme.fgMuted;
      const ctx = p.contextWindow >= 1_000_000 ? Math.round(p.contextWindow / 1_000_000) + 'M' : Math.round(p.contextWindow / 1000) + 'k';
      msg += `    ${fg(theme.primary, p.emoji + '  ' + p.displayName.padEnd(28))} ${fg(keyColor, hasKey.padEnd(10))} ${fg(theme.fgSubtle, ctx + 'ctx')}\n`;
    }
  }
  msg += `\n${fg(theme.fgDim, 'total: ' + providers.length + ' providers  ·  ' + totalModelCount() + ' models')}\n`;
  msg += `${fg(theme.fgDim, 'switch:  /provider <id>')}\n`;
  msg += `${fg(theme.fgDim, 'browse:  /models <provider>')}\n`;
  return { handled: true, message: msg };
}

/**
 * /provider — show or switch the LLM provider at runtime.
 * Usage: /provider             show current provider + list
 *        /provider <name>      switch to provider
 *        /provider persist     save current to config
 *
 * Inspired by the autoresearch "single-binary, runtime-tweakable" philosophy.
 */
function cmdProvider(args: string[], ctx: SlashCommandContext): SlashCommandResult {
  const current = ctx.config.provider;
  const known = listProviders().map((p) => p.id);

  if (args.length === 0) {
    let msg = `\n${gradient('LLM Provider', theme.primary, theme.secondary)}\n`;
    msg += `${fg(theme.fgDim, '─'.repeat(60))}\n`;
    msg += `  ${fg(theme.accent, 'Current:  ')} ${fg(theme.primary, current)}\n`;
    msg += `  ${fg(theme.accent, 'Model:    ')} ${ctx.config.model}\n\n`;
    msg += `  ${fg(theme.fgDim, 'Available providers:')}\n`;
    for (const id of known) {
      const p = PROVIDERS[id];
      const marker = id === current ? '●' : '○';
      const color = id === current ? theme.success : theme.fg;
      const hasKey = process.env[p.apiKeyEnv] ? '✓' : '○';
      msg += `    ${fg(color, marker + ' ' + id.padEnd(20))} ${fg(theme.fgSubtle, hasKey + ' ' + p.displayName)}\n`;
    }
    msg += `\n${fg(theme.fgDim, 'Usage: /provider <name>  |  /provider persist')}\n`;
    msg += `${fg(theme.fgDim, 'Browse: /models  |  /providers (categorized)')}\n`;
    return { handled: true, message: msg };
  }

  if (args[0] === 'persist') {
    if (ctx.onPersistConfig) {
      ctx.onPersistConfig();
      return { handled: true, message: `${mascots.smallHua} ${fg(theme.success, '✓ Config persisted to disk')}` };
    }
    return { handled: true, message: `${fg(theme.warning, '⚠ No persist callback wired up')}` };
  }

  const newProvider = args[0];
  if (!PROVIDERS[newProvider]) {
    return {
      handled: true,
      message: `${fg(theme.danger, '✗ Unknown provider: ' + newProvider)}\n${fg(theme.fgDim, 'Valid: ' + known.join(', '))}`,
    };
  }
  if (ctx.onSwitchProvider) ctx.onSwitchProvider(newProvider);
  if (ctx.onPersistConfig) ctx.onPersistConfig();
  return { handled: true, message: `${mascots.smallHua} ${fg(theme.success, '✓ Switched to provider: ' + newProvider)} ${fg(theme.fgDim, '(persisted to config)')}` };
}

/**
 * /autonomous — toggle autonomous mode at runtime.
 * Usage: /autonomous             show current state
 *        /autonomous on|off      toggle
 *        /autonomous             (no args) toggle
 *
 * Inspired by the autoresearch "NEVER STOP" rule: when autonomous is on, the
 * agent doesn't ask for permission, doesn't confirm, and runs to completion
 * (or until Ctrl+C). Safety: per-step timeout + write-to-disk per step.
 */
function cmdAutonomous(args: string[], ctx: SlashCommandContext): SlashCommandResult {
  const current = ctx.onGetAutonomous ? ctx.onGetAutonomous() : false;
  const arg = args[0]?.toLowerCase();

  // No args → toggle
  if (args.length === 0) {
    const next = ctx.onToggleAutonomous ? ctx.onToggleAutonomous() : current;
    if (next) {
      return {
        handled: true,
        message: `${mascots.huaCasting} ${fg(theme.warning, '⚡ Autonomous mode: ON')}\n${fg(theme.fgDim, '  • No confirmations will be asked')}\n${fg(theme.fgDim, '  • All bash commands auto-allow')}\n${fg(theme.fgDim, '  • Agent runs until done or Ctrl+C')}\n${fg(theme.fgDim, '  • Use /autonomous again to disable')}`,
      };
    }
    return { handled: true, message: `${mascots.huaHappy} ${fg(theme.success, '✦ Autonomous mode: OFF')} ${fg(theme.fgDim, '(back to interactive)')}` };
  }

  // Explicit on/off
  if (arg === 'on' || arg === 'true' || arg === '1') {
    if (!current && ctx.onToggleAutonomous) ctx.onToggleAutonomous();
    return { handled: true, message: `${mascots.huaCasting} ${fg(theme.warning, '⚡ Autonomous mode: ON')}` };
  }
  if (arg === 'off' || arg === 'false' || arg === '0') {
    if (current && ctx.onToggleAutonomous) ctx.onToggleAutonomous();
    return { handled: true, message: `${mascots.huaHappy} ${fg(theme.success, '✦ Autonomous mode: OFF')}` };
  }

  return { handled: true, message: `${fg(theme.warning, '⚠ Usage: /autonomous [on|off]')}` };
}

/**
 * /scope — show or set the file scope (limit edits to one file).
 * Usage: /scope                    show current scope
 *        /scope <file>             set scope to file
 *        /scope clear|off|none     clear scope (multi-file again)
 *
 * Inspired by autoresearch's "single file to modify" principle. When scope is
 * set, the engine injects this into the system prompt and refuses to edit
 * other files. The LLM is also told explicitly.
 */
function cmdScope(args: string[], ctx: SlashCommandContext): SlashCommandResult {
  const current = ctx.onGetScope ? ctx.onGetScope() : null;

  if (args.length === 0) {
    let msg = `\n${gradient('File Scope', theme.primary, theme.secondary)}\n`;
    msg += `${fg(theme.fgDim, '─'.repeat(60))}\n`;
    if (current) {
      msg += `  ${fg(theme.accent, 'Current:  ')} ${fg(theme.primary, current)}\n`;
      msg += `  ${fg(theme.fgDim, 'The agent will only edit this file.')}\n`;
    } else {
      msg += `  ${fg(theme.fgDim, 'No scope set. Agent can edit any file.')}\n`;
    }
    msg += `\n${fg(theme.fgDim, 'Usage: /scope <file>  |  /scope clear')}\n`;
    msg += `${fg(theme.fgDim, 'Example: /scope src/auth.ts')}\n`;
    return { handled: true, message: msg };
  }

  if (args[0] === 'clear' || args[0] === 'off' || args[0] === 'none') {
    if (ctx.onSetScope) ctx.onSetScope(undefined);
    return { handled: true, message: `${mascots.huaHappy} ${fg(theme.success, '✦ Scope cleared.')} ${fg(theme.fgDim, 'Multi-file edits enabled again.')}` };
  }

  const newScope = args.join(' ');
  if (ctx.onSetScope) ctx.onSetScope(newScope);
  return { handled: true, message: `${mascots.huaCasting} ${fg(theme.primary, '✦ Scope set: ' + newScope)}\n${fg(theme.fgDim, '  Agent will only edit this file.')}` };
}

/**
 * /marketplace — browse, search, and install wiki bundles from the marketplace.
 *
 * Usage:
 *   /marketplace               list available bundles (from local + GitHub)
 *   /marketplace search <q>    search bundles by query
 *   /marketplace install <id>  install a bundle
 *   /marketplace featured      show featured bundles
 *
 * For now, /marketplace is a stub that points to the GitHub topic page
 * (https://github.com/topics/wllm-wiki) where the marketplace is hosted.
 * Bundles are git-cloneable + free, MIT-licensed.
 */
async function cmdMarketplace(args: string[], ctx: SlashCommandContext): Promise<SlashCommandResult> {
  const featured = [
    { id: 'postgres-panduan', name: 'PostgreSQL Panduan',  size: '2.9 KB',  lang: 'SQL' },
    { id: 'react-patterns',   name: 'React Patterns',      size: '12.4 KB', lang: 'TypeScript' },
    { id: 'auth-best-practices', name: 'Auth Best Practices', size: '8.1 KB', lang: 'Markdown' },
  ];

  const sub = args[0]?.toLowerCase();

  if (!sub || sub === 'list') {
    let msg = `\n${gradient('Marketplace', theme.primary, theme.secondary)}\n`;
    msg += `${fg(theme.fgDim, '─'.repeat(60))}\n`;
    msg += `  ${fg(theme.fgDim, 'wllm-wiki bundles · MIT licensed · free')}\n\n`;
    msg += `  ${fg(theme.accent, 'featured:')}\n`;
    for (const b of featured) {
      msg += `    ${fg(theme.primary, '✦')} ${fg(theme.fg, b.name.padEnd(24))} ${fg(theme.fgMuted, b.size.padStart(8))} ${fg(theme.fgDim, b.lang)}\n`;
    }
    msg += `\n${fg(theme.fgDim, '  install:')}  ${fg(theme.accent, '/marketplace install <id>')}\n`;
    msg += `${fg(theme.fgDim, '  search:  ')}  ${fg(theme.accent, '/marketplace search <query>')}\n`;
    msg += `\n${fg(theme.fgSubtle, '  github: github.com/topics/wllm-wiki')}\n`;
    return { handled: true, message: msg };
  }

  if (sub === 'search') {
    const q = args.slice(1).join(' ');
    if (!q) {
      return { handled: true, message: `${fg(theme.warning, '⚠ Usage: /marketplace search <query>')}` };
    }
    let msg = `\n${gradient('Marketplace Search', theme.primary, theme.secondary)}\n`;
    msg += `${fg(theme.fgDim, '─'.repeat(60))}\n`;
    msg += `  ${fg(theme.fgMuted, `query: "${q}"`)}\n\n`;
    msg += `  ${fg(theme.fgDim, 'stub: 0 results — full search via GitHub API not yet wired')}\n`;
    msg += `  ${fg(theme.fgSubtle, 'fallback: visit github.com/topics/wllm-wiki')}\n`;
    return { handled: true, message: msg };
  }

  if (sub === 'install') {
    const id = args[1];
    if (!id) {
      return { handled: true, message: `${fg(theme.warning, '⚠ Usage: /marketplace install <bundle-id>')}` };
    }
    let msg = `\n${gradient('Installing Bundle', theme.primary, theme.secondary)}\n`;
    msg += `${fg(theme.fgDim, '─'.repeat(60))}\n`;
    msg += `  ${fg(theme.accent, 'id:    ')} ${fg(theme.fg, id)}\n`;
    msg += `  ${fg(theme.accent, 'src:   ')} ${fg(theme.fgMuted, 'github.com/topics/wllm-wiki')}\n`;
    msg += `\n${fg(theme.fgDim, '  stub: clone + import not yet wired in CLI')}\n`;
    msg += `${fg(theme.fgSubtle, '  use: huagent wiki import <repo-url>')}\n`;
    return { handled: true, message: msg };
  }

  if (sub === 'featured') {
    return { handled: true, message: `${fg(theme.fg, 'featured bundles (see /marketplace for full list)')}` };
  }

  return { handled: true, message: `${fg(theme.warning, '⚠ Usage: /marketplace [list|search|install|featured]')}` };
}

/**
 * /agents — list and manage subagents.
 */
function cmdAgents(ctx: SlashCommandContext): SlashCommandResult {
  let msg = `\n${gradient('Subagents', theme.primary, theme.secondary)}\n`;
  msg += `${fg(theme.fgDim, '─'.repeat(60))}\n`;
  msg += `  ${fg(theme.fgMuted, 'subagents are spawned by the engine to parallelize work.')}\n\n`;
  msg += `  ${fg(theme.accent, '• ')} ${fg(theme.fg, 'explore')}  ${fg(theme.fgDim, '— read-only investigation, fast')}\n`;
  msg += `  ${fg(theme.accent, '• ')} ${fg(theme.fg, 'plan')}     ${fg(theme.fgDim, '— produce a step-by-step plan')}\n`;
  msg += `  ${fg(theme.accent, '• ')} ${fg(theme.fg, 'review')}   ${fg(theme.fgDim, '— 3-critic-style review of code')}\n`;
  msg += `  ${fg(theme.accent, '• ')} ${fg(theme.fg, 'test')}     ${fg(theme.fgDim, '— write + run tests in isolation')}\n\n`;
  msg += `  ${fg(theme.fgSubtle, 'live subagents: open the activity panel (ctrl+l)')}\n`;
  msg += `  ${fg(theme.fgSubtle, 'spawn:  /agents spawn <kind> <task>')}\n`;
  msg += `  ${fg(theme.fgSubtle, 'kill:   /agents kill <id>')}\n`;
  return { handled: true, message: msg };
}

/**
 * /modes — show all current modes (autonomous, scope, permission) in one place.
 */
function cmdModes(ctx: SlashCommandContext): SlashCommandResult {
  const autonomous = ctx.onGetAutonomous ? ctx.onGetAutonomous() : false;
  const scope = ctx.onGetScope ? ctx.onGetScope() : null;
  const perm = ctx.tools.getPermissionMode();
  let msg = `\n${gradient('Current Modes', theme.primary, theme.secondary)}\n`;
  msg += `${fg(theme.fgDim, '─'.repeat(60))}\n`;
  msg += `  ${fg(theme.accent, 'autonomous  ')} ${autonomous ? fg(theme.warning, '● on') : fg(theme.fgDim, '○ off')}   ${fg(theme.fgMuted, '/autonomous')}\n`;
  msg += `  ${fg(theme.accent, 'scope       ')} ${scope ? fg(theme.primary, `● ${scope}`) : fg(theme.fgDim, '○ none')}            ${fg(theme.fgMuted, '/scope <file>')}\n`;
  msg += `  ${fg(theme.accent, 'permission  ')} ${fg(theme.info, `● ${perm}`)}      ${fg(theme.fgMuted, '/permissions <mode>')}\n`;
  msg += `  ${fg(theme.accent, 'model       ')} ${fg(theme.fg, `● ${ctx.config.model}`)}     ${fg(theme.fgMuted, '/model <name>')}\n`;
  msg += `  ${fg(theme.accent, 'provider    ')} ${fg(theme.fg, `● ${ctx.config.provider}`)}      ${fg(theme.fgMuted, '/provider <name>')}\n`;
  return { handled: true, message: msg };
}

/**
 * /activity — toggle the live activity feed panel.
 */
function cmdActivity(ctx: SlashCommandContext): SlashCommandResult {
  return {
    handled: true,
    message: `${fg(theme.info, 'Activity feed:')} ${fg(theme.fg, 'toggle with Ctrl+L inside the TUI')}\n${fg(theme.fgDim, '  shows the live stream of read/write/edit/bash/verify/subagent events')}`,
  };
}

function cmdPermissions(args: string[], ctx: SlashCommandContext): SlashCommandResult {
  const modes = ['read-only', 'workspace-write', 'danger-full-access', 'prompt', 'allow'];
  if (args.length === 0) {
    const current = ctx.tools.getPermissionMode();
    let msg = `\n${gradient('Permission Modes', theme.primary, theme.secondary)}\n`;
    msg += `${fg(theme.fgDim, '─'.repeat(60))}\n`;
    for (const mode of modes) {
      const marker = mode === current ? '●' : '○';
      const color = mode === current ? theme.success : theme.fg;
      const desc = {
        'read-only': 'Only read operations (ls, cat, grep)',
        'workspace-write': 'Read + write within workspace (default)',
        'danger-full-access': 'Everything, including system commands',
        'prompt': 'Ask before each operation',
        'allow': 'Allow all (no checks)',
      }[mode];
      msg += `  ${fg(color, marker + ' ' + mode.padEnd(22))}${fg(theme.fgDim, desc)}\n`;
    }
    msg += `\n${fg(theme.fgDim, 'Usage: /permissions <mode>')}`;
    return { handled: true, message: msg };
  }

  const newMode = args[0] as any;
  if (!modes.includes(newMode)) {
    return { handled: true, message: `${fg(theme.danger, '✗ Unknown mode: ' + newMode)}\nValid: ${modes.join(', ')}` };
  }
  if (ctx.onSetPermissionMode) ctx.onSetPermissionMode(newMode as any);
  return { handled: true, message: `${mascots.smallHua} ${fg(theme.success, '✓ Permission mode: ' + newMode)}` };
}

function cmdMemory(ctx: SlashCommandContext): SlashCommandResult {
  const stats = ctx.memory.stats();
  let msg = `\n${gradient('Memory Stats', theme.primary, theme.secondary)}\n`;
  msg += `${fg(theme.fgDim, '─'.repeat(60))}\n`;
  msg += `  ${fg(theme.sakura, '✦')} Memories:  ${stats.memories}\n`;
  msg += `  ${fg(theme.sky, '✧')} Facts:     ${stats.facts}\n`;
  msg += `  ${fg(theme.lavender, '✿')} Skills:    ${stats.skills}\n`;
  msg += `  ${fg(theme.gold, '♡')} Sessions:  ${stats.sessions}\n`;

  // Show recent memories
  const recent = ctx.memory.recall('', 5);
  if (recent.length > 0) {
    msg += `\n${fg(theme.fgDim, 'Recent memories:')}\n`;
    for (const m of recent.slice(0, 5)) {
      const preview = m.content.replace(/\n/g, ' ').slice(0, 80);
      msg += `  ${fg(theme.accent, '•')} ${fg(theme.fg, m.type)}: ${fg(theme.fgDim, preview)}\n`;
    }
  }
  return { handled: true, message: msg };
}

function cmdSkills(ctx: SlashCommandContext): SlashCommandResult {
  const skills = ctx.memory.getLearnedSkills();
  if (skills.length === 0) {
    return { handled: true, message: `${mascots.sleepHua} No skills learned yet. Chat with me and I'll learn!` };
  }
  let msg = `\n${gradient('Learned Skills', theme.primary, theme.secondary)}\n`;
  msg += `${fg(theme.fgDim, '─'.repeat(60))}\n`;
  for (const s of skills) {
    msg += `  ${fg(theme.accent, '✦')} ${fg(theme.fg, s.name)} ${fg(theme.fgDim, `(used ${s.useCount}x, ${(s.successRate * 100).toFixed(0)}% success)`)}\n`;
    msg += `    ${fg(theme.fgDim, s.description)}\n`;
  }
  return { handled: true, message: msg };
}

async function cmdInit(ctx: SlashCommandContext): Promise<SlashCommandResult> {
  const path = join(ctx.workdir, 'HUAAGENT.md');
  const content = `# Project Context for huagent

This file helps huagent (your AI coding agent) understand your project.

## Project Overview
[Brief description of what this project does]

## Tech Stack
- Language: [TypeScript / Python / etc.]
- Framework: [React / Express / etc.]
- Build: [Vite / Webpack / etc.]

## Conventions
- [Code style preferences]
- [File organization]
- [Test framework and how to run tests]

## Important Files
- [\`src/\`: Main source]
- [\`tests/\`: Test files]

## Common Commands
- \`npm run dev\`: Start development server
- \`npm test\`: Run tests
- \`npm run build\`: Build for production
`;

  const { writeFile } = await import('node:fs/promises');
  await writeFile(path, content, 'utf-8');
  return { handled: true, message: `${mascots.smallHua} ${fg(theme.success, '✓ Created ' + path)}` };
}

async function cmdDiff(ctx: SlashCommandContext): Promise<SlashCommandResult> {
  try {
    const { stdout } = await execAsync('git diff --stat', { cwd: ctx.workdir, maxBuffer: 5_000_000 });
    if (!stdout.trim()) {
      return { handled: true, message: `${mascots.smallHua} ${fg(theme.fgDim, 'No changes')}` };
    }
    let msg = `\n${gradient('Git Diff Summary', theme.primary, theme.secondary)}\n`;
    msg += `${fg(theme.fgDim, '─'.repeat(60))}\n`;
    msg += fg(theme.fg, stdout) + '\n';

    // Get full diff
    const { stdout: fullDiff } = await execAsync('git diff', { cwd: ctx.workdir, maxBuffer: 5_000_000 });
    if (fullDiff.length < 5000) {
      msg += `\n${fg(theme.fgDim, '─'.repeat(60))}\n`;
      // Color diff lines
      for (const line of fullDiff.split('\n')) {
        if (line.startsWith('+') && !line.startsWith('+++')) {
          msg += fg(theme.success, line) + '\n';
        } else if (line.startsWith('-') && !line.startsWith('---')) {
          msg += fg(theme.danger, line) + '\n';
        } else if (line.startsWith('@@')) {
          msg += fg(theme.info, line) + '\n';
        } else {
          msg += line + '\n';
        }
      }
    }
    return { handled: true, message: msg };
  } catch (err: any) {
    return { handled: true, message: `${fg(theme.danger, '✗ Git diff failed: ' + err.message)}` };
  }
}

function cmdVersion(_args: string[], ctx: SlashCommandContext): SlashCommandResult {
  const v = (ctx.config && ctx.config.version) || '4.0.0';
  return { handled: true, message: `${mascots.smallHua} ${fg(theme.primary, 'huagent v' + v)}` };
}

function cmdSessions(args: string[], ctx: SlashCommandContext): SlashCommandResult {
  if (args.length === 0 || args[0] === 'list') {
    const sessions = ctx.sessions.list(20);
    let msg = `\n${gradient('Saved Sessions', theme.primary, theme.secondary)}\n`;
    msg += `${fg(theme.fgDim, '─'.repeat(60))}\n`;
    msg += ctx.sessions.formatList(sessions);
    msg += `\n\n${fg(theme.fgDim, 'Usage: /sessions list | switch <id> | delete <id>')}`;
    return { handled: true, message: msg };
  }
  if (args[0] === 'delete' && args[1]) {
    const ok = ctx.sessions.delete(args[1]);
    return { handled: true, message: ok ? `${fg(theme.success, '✓ Deleted ' + args[1])}` : `${fg(theme.danger, '✗ Not found')}` };
  }
  return { handled: true, message: `${fg(theme.fgDim, 'Usage: /sessions [list|delete <id>]')}` };
}

function cmdResume(args: string[], ctx: SlashCommandContext): SlashCommandResult {
  if (args.length === 0) {
    const sessions = ctx.sessions.list(5);
    return { handled: true, message: `Recent sessions:\n${ctx.sessions.formatList(sessions)}\n\n${fg(theme.fgDim, 'Usage: /resume <id>')}` };
  }
  const session = ctx.sessions.load(args[0]);
  if (!session) {
    return { handled: true, message: `${fg(theme.danger, '✗ Session not found: ' + args[0])}` };
  }
  return {
    handled: true,
    message: `${mascots.smallHua} ${fg(theme.success, '✓ Loaded session: ' + session.id)} (${session.messages.length} messages)\n\n${fg(theme.fgDim, 'Note: messages will appear in next prompt')}\n${JSON.stringify(session.messages, null, 2).slice(0, 500)}...`,
  };
}

async function cmdExport(args: string[], ctx: SlashCommandContext): Promise<SlashCommandResult> {
  const filename = args[0] || `huagent-session-${new Date().toISOString().slice(0, 10)}.md`;
  const path = join(process.cwd(), filename);

  let content = `# huagent session\n\n`;
  content += `**Date:** ${new Date().toISOString()}\n`;
  content += `**Model:** ${ctx.config.model}\n`;
  content += `**Workspace:** ${ctx.workdir}\n\n`;
  content += `---\n\n`;

  for (const msg of ctx.messages) {
    const role = msg.role === 'user' ? '🌸 You' : msg.role === 'assistant' ? '✧ Hua' : `🔧 ${msg.role}`;
    content += `## ${role}\n\n${msg.content}\n\n`;
  }

  const { writeFile } = await import('node:fs/promises');
  await writeFile(path, content, 'utf-8');
  return { handled: true, message: `${mascots.smallHua} ${fg(theme.success, '✓ Exported to ' + path)}` };
}

function cmdUndo(): SlashCommandResult {
  return {
    handled: true,
    message: `${mascots.smallHua} ${fg(theme.fgDim, 'Use git to undo:')}\n  ${fg(theme.fg, 'git diff')} ${fg(theme.fgDim, '— see what changed')}\n  ${fg(theme.fg, 'git checkout .')} ${fg(theme.fgDim, '— discard all changes')}\n  ${fg(theme.fg, 'git checkout <file>')} ${fg(theme.fgDim, '— discard one file')}`,
  };
}

async function cmdDoctor(ctx: SlashCommandContext): Promise<SlashCommandResult> {
  let msg = `\n${gradient('Doctor — Diagnostic Check', theme.primary, theme.secondary)}\n`;
  msg += `${fg(theme.fgDim, '─'.repeat(60))}\n`;

  // Check Node version
  const nodeVer = process.version;
  msg += `  ${fg(theme.success, '✓')} Node.js: ${nodeVer}\n`;

  // Check workspace
  msg += `  ${fg(theme.success, '✓')} Workspace: ${ctx.workdir}\n`;

  // Check LLM connection
  const stats = ctx.llm.getStats();
  msg += `  ${fg(theme.success, '✓')} LLM: ${ctx.config.provider}/${ctx.config.model}\n`;

  // Check memory
  const memStats = ctx.memory.stats();
  msg += `  ${fg(theme.success, '✓')} Memory: ${memStats.memories} entries\n`;

  // Check tools
  const tools = ctx.tools.list();
  msg += `  ${fg(theme.success, '✓')} Tools: ${tools.length} available (${tools.map(t => t.name).join(', ')})\n`;

  // Check git
  try {
    await execAsync('git status', { cwd: ctx.workdir });
    msg += `  ${fg(theme.success, '✓')} Git: initialized\n`;
  } catch {
    msg += `  ${fg(theme.warning, '⚠')} Git: not initialized\n`;
  }

  // Check session
  const sessions = ctx.sessions.list(1);
  msg += `  ${fg(theme.success, '✓')} Sessions: ${sessions.length > 0 ? 'history available' : 'no history yet'}\n`;

  msg += `\n${mascots.huaHappy} ${fg(theme.success, 'All systems go! ✧')}`;
  return { handled: true, message: msg };
}

function cmdTheme(args: string[]): SlashCommandResult {
  const themes = ['sakura', 'neon', 'classic'];
  if (args.length === 0) {
    return { handled: true, message: `Available themes: ${themes.map(t => fg(theme.primary, t)).join(', ')}\n${fg(theme.fgDim, 'Usage: /theme <name>')}` };
  }
  return { handled: true, message: `${mascots.smallHua} ${fg(theme.success, '✓ Theme: ' + args[0])} ${fg(theme.fgDim, '(restart to apply)')}` };
}

// Tab completion for slash commands
export function completeSlashCommand(partial: string): string[] {
  if (!partial.startsWith('/')) return [];
  const cmd = partial.slice(1).toLowerCase();
  return SLASH_COMMANDS
    .filter((c) => c.name.startsWith(cmd) || c.aliases.some((a) => a.startsWith(cmd)))
    .map((c) => '/' + c.name);
}
