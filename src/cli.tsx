// CLI entry point for Huagent
// Integrates: streaming, permissions, sessions, slash commands, status bar, unified engine

import { Command } from 'commander';
import React from 'react';
import { render } from 'ink';
import { ModernApp } from './tui/ModernApp.js';
import { OpenCodeApp } from './tui/OpenCodeApp.js';
import { Engine } from './engine/core.js';
import { UnifiedClient } from './providers/client.js';
import { PROVIDERS, detectProviderFromEnv, type ProviderId } from './providers/registry.js';
import { MemoryStore } from './memory/store.js';
import { MemoryManager } from './memory/manager.js';
import { ToolRegistry } from './tools/index.js';
import { SessionManager } from './sessions.js';
import { getSkills, type Skill } from './skills.js';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { theme as legacyTheme, fg, sparkleText as sparkle, gradient } from './tui/theme.js';
import { theme, fg as ocFg } from './tui/oc/theme.js';
import { mascots } from './tui/mascot.js';
import { config as loadDotenv } from 'dotenv';
import { runOnboarding } from './onboarding/wizard.js';


loadDotenv();

// Read version from package.json (bundled at build time)
// Use createRequire to load from anywhere (works in both ESM and CJS)
import { createRequire } from 'node:module';
const _require = createRequire(import.meta.url);
let VERSION = '0.0.0';
try {
  const pkg = _require('../package.json');
  VERSION = pkg.version;
} catch {
  // Fall back to a constant if package.json can't be read
  VERSION = '4.3.1';
}
const CONFIG_DIR = join(homedir(), '.huagent');
const CONFIG_PATH = join(CONFIG_DIR, 'config.json');
const MEMORY_PATH = join(CONFIG_DIR, 'memory.db');

interface Config {
  provider: string;
  model: string;
  apiKey?: string;
  baseUrl?: string;
  workdir: string;
  permissionMode?: string;
  /** Autonomous mode: no confirmations, all bash auto-allow (default: false) */
  autonomous?: boolean;
  /** File scope: limit agent edits to this single file (default: null = multi-file) */
  scope?: string | null;
  /** Known provider ids (used by /provider for the list) */
  knownProviders?: string[];
  /** Effort tier for current session (low/medium/high/xhigh/max/ultramax) */
  effort?: string;
  /** Onboarding completed flag — prevents re-running wizard */
  onboarded?: boolean;
}

function loadConfig(): Config {
  if (!existsSync(CONFIG_DIR)) mkdirSync(CONFIG_DIR, { recursive: true });

  if (existsSync(CONFIG_PATH)) {
    // Wrap in try/catch — a corrupt or partially-written config file
    // (e.g. process killed mid-write) would otherwise crash startup
    // with a SyntaxError. Fall back to defaults and warn the user.
    try {
      return JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'));
    } catch (err: any) {
      console.error(fg(theme.warning || '#f5a742', `Warning: config file at ${CONFIG_PATH} is invalid (${err.message}). Using defaults.`));
    }
  }

  return {
    provider: (process.env.HUAGENT_PROVIDER as any) || 'custom',
    model: process.env.HUAGENT_MODEL || 'MiniMax-M3',
    apiKey: process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY || process.env.TOKENROUTER_API_KEY
      || process.env.GEMINI_API_KEY || process.env.DEEPSEEK_API_KEY || process.env.GROQ_API_KEY || '',
    baseUrl: process.env.HUAGENT_BASE_URL,
    workdir: process.cwd(),
    permissionMode: 'workspace-write',
  };
}

function saveConfig(config: Config): void {
  if (!existsSync(CONFIG_DIR)) mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
}

function printBanner(): void {
  const banner = `
${gradient('╔════════════════════════════════════════════════════════╗', theme.primary, theme.secondary)}
${gradient('║', theme.primary, theme.secondary)}  ${sparkle('huagent v' + VERSION)}  ${gradient('║', theme.primary, theme.secondary)}
${gradient('║', theme.primary, theme.secondary)}  ${fg(theme.sakura, 'AI coding agent CLI')}  ${gradient('║', theme.primary, theme.secondary)}
${gradient('║', theme.primary, theme.secondary)}  ${fg(theme.accent, '22 providers · 101 models · MIT')}  ${gradient('║', theme.primary, theme.secondary)}
${gradient('╚════════════════════════════════════════════════════════╝', theme.primary, theme.secondary)}

${mascots.smallHua} ${fg(theme.sky, 'Type a request or /help for commands. Ctrl+C to exit.')}
`;
  console.log(banner);
}

export async function run(args: string[]): Promise<void> {
  const firstArg = args[0];

  // No args → TUI
  if (args.length === 0 || firstArg === undefined) {
    await startAgent(undefined, {}, args);
    return;
  }

  // Subcommands
  switch (firstArg) {
    case 'init':
      return cmdInit();
    case 'config':
      return cmdConfig(args.slice(1));
    case 'memory':
      return cmdMemory();
    case 'skills':
      return cmdSkills();
    case 'version':
    case '--version':
    case '-v':
      console.log(`huagent v${VERSION}`);
      return;
    case 'help':
    case '--help':
    case '-h':
      return cmdHelp();
  }

  // Otherwise: parse options, find message
  const options = parseOptions(args);
  let message: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('-')) {
      // Handle --key=value format
      const isKeyValue = arg.startsWith("--") && arg.includes("=");
      const keyOnly = isKeyValue ? arg.slice(0, arg.indexOf("=")) : arg;
      if (['--dir', '-d', '--provider', '-p', '--model', '-m', '--api-key', '--base-url', '--perm', '--scope'].includes(keyOnly)) {
        if (!isKeyValue) i++;  // skip value if not --key=value
      }
      continue;
    }
    message = arg;
    break;
  }

  await startAgent(message, options, args);
}

function parseOptions(argList: string[]): any {
  const options: any = {};
  for (let i = 0; i < argList.length; i++) {
    let arg = argList[i];

    // Support --key=value format
    let key: string | undefined;
    let value: string | undefined;
    if (arg.startsWith("--") && arg.includes("=")) {
      const eqIdx = arg.indexOf("=");
      key = arg.slice(0, eqIdx);
      value = arg.slice(eqIdx + 1);
      arg = key; // for the rest of the matching
    }

    if (arg === '--dir' || arg === '-d') options.dir = value ?? argList[++i];
    else if (arg === '--provider' || arg === '-p') options.provider = value ?? argList[++i];
    else if (arg === '--model' || arg === '-m') options.model = value ?? argList[++i];
    else if (arg === '--no-tui') options.tui = false;
    else if (arg === '--tui') options.tui = value ?? argList[++i] ?? 'modern';
    else if (arg === '--api-key') options.apiKey = value ?? argList[++i];
    else if (arg === '--base-url') options.baseUrl = value ?? argList[++i];
    else if (arg === '--perm') options.permissionMode = value ?? argList[++i];
    // ── Autoresearch-inspired flags ────────────────────────────
    else if (arg === '--autonomous' || arg === '--auto') options.autonomous = true;
    else if (arg === '--no-autonomous') options.autonomous = false;
    else if (arg === '--scope') options.scope = value ?? argList[++i];
  }
  return options;
}

function cmdHelp(): void {
  console.log(`
${gradient('huagent', theme.primary, theme.secondary)} v${VERSION}
${fg(theme.fgDim, 'AI coding agent CLI')}

${fg(theme.primary, 'USAGE:')}
  huagent                    ${fg(theme.fgDim, 'Start interactive TUI')}
  huagent "message"          ${fg(theme.fgDim, 'One-shot mode (no TUI)')}
  huagent init               ${fg(theme.fgDim, 'Initialize in current dir')}
  huagent memory             ${fg(theme.fgDim, 'Show memory stats')}
  huagent skills             ${fg(theme.fgDim, 'List learned skills')}
  huagent config [k] [v]     ${fg(theme.fgDim, 'Get/set config')}
  huagent version            ${fg(theme.fgDim, 'Show version')}

${fg(theme.primary, 'OPTIONS:')}
  --dir <path>               ${fg(theme.fgDim, 'Working directory')}
  --provider <name>          ${fg(theme.fgDim, 'anthropic | openai | mock')}
  --model <name>             ${fg(theme.fgDim, 'Model name')}
  --api-key <key>            ${fg(theme.fgDim, 'API key')}
  --base-url <url>           ${fg(theme.fgDim, 'Custom base URL (e.g. TokenRouter)')}
  --perm <mode>              ${fg(theme.fgDim, 'Permission: read-only | workspace-write | danger-full-access')}
  --no-tui                   ${fg(theme.fgDim, 'Disable TUI (one-shot)')}
  --tui <mode>               ${fg(theme.fgDim, 'TUI mode: modern (default) | legacy')}

${fg(theme.primary, 'AUTONOMY & SCOPE:')}
  --autonomous               ${fg(theme.fgDim, 'Start in autonomous mode: no confirmations, all bash auto-allow')}
  --no-autonomous            ${fg(theme.fgDim, 'Disable autonomous mode (default)')}
  --scope <file>             ${fg(theme.fgDim, 'Limit agent edits to this single file only')}

${fg(theme.primary, 'EXAMPLES:')}
  huagent "fix the auth bug"
  huagent "add OAuth" --no-tui
  huagent "fix the JWT bug" --autonomous
  huagent "refactor auth.ts" --scope=src/auth.ts

${fg(theme.primary, 'TUI COMMANDS (type / to start):')}
  /help, /status, /cost, /clear, /compact
  /model <name>, /provider <name>, /scope <file>, /autonomous
  /permissions <mode>, /memory, /skills, /sessions, /resume <id>
  /init, /diff, /export, /undo, /doctor
  /theme, /exit

${fg(theme.primary, 'KEYBOARD:')}
  Ctrl+C     ${fg(theme.fgDim, 'Exit')}
  Ctrl+L     ${fg(theme.fgDim, 'Toggle status panel')}
  Tab        ${fg(theme.fgDim, 'Complete slash command')}

${mascots.smallHua} ${fg(theme.accent, 'by huanime · powered by 22 LLM providers')}
`);
}

function cmdInit(): void {
  const config = loadConfig();
  config.workdir = process.cwd();
  saveConfig(config);
  console.log(`${mascots.smallHua} ${fg(theme.success, '✓ huagent initialized in ' + process.cwd())}`);
  console.log(`  ${fg(theme.fgDim, 'Config: ' + CONFIG_PATH)}`);
  console.log(`  ${fg(theme.fgDim, 'Memory: ' + MEMORY_PATH)}`);
}

function cmdConfig(args: string[]): void {
  const config = loadConfig();
  const [key, value] = args;
  if (!key) {
    console.log(JSON.stringify(config, null, 2));
    return;
  }
  if (!value) {
    console.log(`${key} = ${(config as any)[key]}`);
    return;
  }
  (config as any)[key] = value;
  saveConfig(config);
  console.log(`${mascots.smallHua} ${fg(theme.success, `✓ ${key} = ${value}`)}`);
}

function cmdMemory(): void {
  const store = new MemoryStore(MEMORY_PATH);
  const stats = store.stats();
  console.log(`${mascots.smallHua} ${fg(theme.primary, 'Memory Stats')}`);
  console.log(`  ${fg(theme.sakura, '✦')} Memories: ${stats.memories}`);
  console.log(`  ${fg(theme.sky, '✧')} Project facts: ${stats.facts}`);
  console.log(`  ${fg(theme.lavender, '✿')} Learned skills: ${stats.skills}`);
  console.log(`  ${fg(theme.gold, '♡')} Past sessions: ${stats.sessions}`);
  store.close();
}

function cmdSkills(): void {
  const store = new MemoryStore(MEMORY_PATH);
  const skills = store.listSkills();
  if (skills.length === 0) {
    console.log(`${mascots.sleepHua} No skills learned yet. Chat with me and I'll learn!`);
  } else {
    console.log(`${mascots.huaHappy} ${fg(theme.primary, 'Learned Skills')}`);
    for (const s of skills) {
      console.log(`  ${fg(theme.accent, '✦')} ${fg(theme.fg, s.name)} ${fg(theme.fgDim, `(used ${s.useCount}x, ${(s.successRate * 100).toFixed(0)}% success)`)}`);
      console.log(`    ${fg(theme.fgDim, s.description)}`);
    }
  }
  store.close();
}

async function startAgent(message: string | undefined, options: any, fullArgs: string[] = []): Promise<void> {
  // Load config (for first-run detection)
  let config = loadConfig();

  // First-run detection: no provider configured + no API key in env + no --provider/--api-key/--model flags
  const hasApiKeyInEnv = Object.values(PROVIDERS).some((p) => !!process.env[p.apiKeyEnv]);
  const isFirstRun =
    !config.onboarded &&
    !options.provider &&
    !options.apiKey &&
    !options.model &&
    !hasApiKeyInEnv &&
    process.stdin.isTTY === true; // Only run wizard interactively

  if (isFirstRun) {
    try {
      const result = await runOnboarding(VERSION);
      config.provider = result.provider;
      config.model = result.model;
      config.apiKey = result.apiKey;
      config.effort = result.effort;
      config.onboarded = true;
      saveConfig(config);
      // Reload to ensure persistence
      config = loadConfig();
    } catch (err: any) {
      if (err.message === 'cancelled') {
        console.log(`\n${fg(theme.warning, '⚠ Onboarding cancelled. Run huagent again to retry.')}\n`);
        process.exit(0);
      }
      throw err;
    }
  }

  // No banner — the TUI/REPL prints its own minimal header. Keeping the
  // printBanner function around for backward compat in case external code
  // calls it, but we don't invoke it from the main entry point anymore.
  // printBanner();

  if (options.provider) config.provider = options.provider;
  if (options.model) config.model = options.model;
  if (options.apiKey) config.apiKey = options.apiKey;
  if (options.baseUrl) config.baseUrl = options.baseUrl;
  if (options.dir) config.workdir = options.dir;
  if (options.permissionMode) config.permissionMode = options.permissionMode;
  // ── Autoresearch-inspired flags ────────────────────────────
  if (options.autonomous !== undefined) config.autonomous = options.autonomous;
  if (options.scope !== undefined) config.scope = options.scope;
  // Populate known providers (used by /provider for the list)
  config.knownProviders = Object.keys(PROVIDERS).filter((k) => k !== 'custom');
  saveConfig(config);

  // Initialize components
  const store = new MemoryStore(MEMORY_PATH);
  const memory = new MemoryManager(store);
  const tools = new ToolRegistry(config.workdir, (config.permissionMode as any) || 'workspace-write');
  const sessions = new SessionManager();
  const skills = getSkills();

  // Resolve provider - either from config or auto-detect from env
  const providerId = (config.provider as ProviderId) || detectProviderFromEnv()?.id || 'custom';
  // Smart API key resolution: prefer config.apiKey if provider matches, else use provider's env var
  const providerApiKeyEnv = PROVIDERS[providerId]?.apiKeyEnv || 'TOKENROUTER_API_KEY';
  const apiKey = config.apiKey || process.env[providerApiKeyEnv] || '';
  const baseUrl = config.baseUrl || process.env.HUAGENT_BASE_URL;

  const client = new UnifiedClient(providerId, apiKey, baseUrl);
  // Override model via the proper setModel method (no global mutation)
  if (config.model) {
    client.setModel(config.model);
  }

  // Minimal "connected" line — no mascot character, OpenCode-style.
  // The full status info (memory, permission) is shown inside the TUI/REPL
  // itself, so we don't need to duplicate it here.
  // (The old mascot-based lines were removed to match the OpenCode aesthetic.)

  // One-shot mode
  if (message) {
    console.log(`\n${fg(theme.textMuted, '⠋ streaming...')}\n`);
    let fullResponse = '';
    // FIX: one-shot mode now sends tools + handles tool_use events.
    // Previously it was chat-only (no tools), so 'install X' or 'read file'
    // commands just got a text response with no action.
    const oneShotMessages: any[] = [{ role: 'user', content: message }];
    const MAX_ONE_SHOT_ROUNDS = 5;

    for (let round = 0; round < MAX_ONE_SHOT_ROUNDS; round++) {
      const pendingToolCalls: Array<{ id: string; name: string; args: any }> = [];
      fullResponse = '';

      for await (const event of client.stream({
        model: config.model || client.getModel(),
        system: 'You are Hua, an AI coding agent. Use tools when needed. Be concise.',
        messages: oneShotMessages,
        tools: tools.getSchemas(),
        temperature: 0.7,
      })) {
        if (event.type === 'text_delta') {
          process.stdout.write(event.delta);
          fullResponse = event.accumulated;
        } else if (event.type === 'tool_use') {
          pendingToolCalls.push({ id: event.id, name: event.name, args: event.args });
        } else if (event.type === 'usage') {
          setTimeout(() => {
            console.log(`\n\n${fg(theme.fgDim, `[${event.total} tokens, $${event.cost.toFixed(4)}]`)}`);
          }, 100);
        } else if (event.type === 'message_stop') {
          process.stdout.write('\n');
        }
      }

      // No tool calls → done
      if (pendingToolCalls.length === 0) break;

      // Execute tools and feed results back
      oneShotMessages.push({ role: 'assistant', content: fullResponse, tool_calls: pendingToolCalls.map(tc => ({
        id: tc.id, type: 'function', function: { name: tc.name, arguments: JSON.stringify(tc.args || {}) },
      })) });

      for (const tc of pendingToolCalls) {
        console.log(fg(theme.textMuted, `  → ${tc.name}`));
        const execResult = await tools.execute(tc.name, tc.args);
        const result = execResult.success ? execResult.result : { error: execResult.error };
        const resultStr = typeof result === 'string' ? result.slice(0, 2000) : JSON.stringify(result).slice(0, 2000);
        oneShotMessages.push({ role: 'tool', content: resultStr, tool_call_id: tc.id });
      }
    }

    // Save session
    try {
      const sessionId = sessions.save({
        projectPath: config.workdir,
        messages: [
          { id: '1', role: 'user', content: message, timestamp: Date.now() },
          { id: '2', role: 'assistant', content: fullResponse, timestamp: Date.now() },
        ],
        metadata: { model: config.model, provider: providerId, permissionMode: tools.getPermissionMode() } as any,
        summary: message.slice(0, 100),
      });
      console.log(fg(theme.fgDim, `\n  Session saved: ${sessionId}`));
    } catch (err: any) {
      console.error(fg(theme.danger, `  Failed to save session: ${err.message}`));
    }

    memory.recordEpisode(`User asked: ${message.slice(0, 200)}\nResponded: ${fullResponse.slice(0, 200)}`, { sessionType: 'one-shot' }, 0.5);

    store.close();
    return;
  }

  // TUI mode
  if (options.tui !== false) {
    // Wire the dialog controller BEFORE creating the engine so events
    // are published from the very first call.
    const { getDialogController } = await import('./tui/dialog-controller.js');
    const dialog = getDialogController();

    const engine = new Engine(client, memory, tools, sessions, {
      onEvent: (event: any) => {
        dialog.publishEvent(event);
      },
      onQuestion: (req: any) => dialog.askUser(req),
      onPermissionRequest: (req: any) => dialog.requestPermission(req),
      onPlanReview: (plan: any) => dialog.reviewPlan(plan),
    });

    const AppComponent = OpenCodeApp;

    const { waitUntilExit } = render(
      React.createElement(AppComponent, {
        engine,
        client,
        memory,
        tools,
        sessions,
        skills,
        config,
        onSubmit: async (msg: string) => {
          // Events are already wired at engine construction time.
          // Just process the message.
          return engine.process(msg, config.workdir);
        },
        onExit: async () => {
          await engine.end();
          store.close();
          process.exit(0);
        },
      })
    );

    await waitUntilExit();
  } else {
    // Simple REPL mode (OpenCode-inspired: minimal output, no mascot).
    const readline = await import('node:readline');
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: process.stdin.isTTY,
    });
    const engine = new Engine(client, memory, tools, sessions);

    // Print a minimal header — no mascot, no big banner.
    console.log(fg(theme.text, `huagent v${VERSION}`));
    console.log(fg(theme.textMuted, `Type a request or /help for commands. Ctrl+C to exit.`));
    console.log(fg(theme.textMuted, `Provider: ${client.getProviderName?.() ?? 'unknown'} · Model: ${client.getModel()}`));
    console.log('');

    let closed = false;
    rl.on('close', () => { closed = true; });

    const prompt = () => {
      if (closed) return;
      try {
        rl.question(fg(theme.primary, '❯ '), async (input) => {
          if (closed) return;
          const cmd = (input || '').trim();
          if (cmd === '/exit' || cmd === '/quit') {
            console.log(fg(theme.textMuted, 'bye.'));
            store.close();
            rl.close();
            return;
          }
          if (cmd) {
            // Use braille spinner for "thinking" — matches the TUI's aesthetic.
            process.stdout.write(fg(theme.textMuted, '⠋ thinking...'));
            try {
              const response = await engine.process(cmd, config.workdir);
              // Clear the thinking line and print the response.
              process.stdout.write('\r\x1b[K');
              console.log(fg(theme.accent, 'huagent') + fg(theme.textMuted, ' ·'));
              console.log(fg(theme.text, response));
              console.log('');
            } catch (err: any) {
              process.stdout.write('\r\x1b[K');
              console.error(fg(theme.error, `error: ${err.message}`));
            }
          }
          // Schedule next prompt on next tick so we don't recurse.
          setImmediate(prompt);
        });
      } catch {
        // readline was closed — exit gracefully.
      }
    };

    prompt();
  }
}
