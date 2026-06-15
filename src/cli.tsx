// CLI entry point for huagent v4.0
// Integrates: streaming, permissions, sessions, slash commands, status bar, v4 engine

import { Command } from 'commander';
import React from 'react';
import { render } from 'ink';
import { App } from './tui/App.js';
import { ModernApp } from './tui/ModernApp.js';
import { Engine } from './engine/core.js';
import { EngineV4 } from './engine/v4/index.js';
import { InMemoryGraphStore } from './engine/v4/index.js';
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
import { theme, fg, sparkleText as sparkle, gradient } from './tui/theme.js';
import { mascots } from './tui/mascot.js';
import { config as loadDotenv } from 'dotenv';
import { runWithV4, formatEvent } from './engine/v4-runner.js';

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
  VERSION = '4.1.0';
}
const CONFIG_DIR = join(homedir(), '.huagent');
const CONFIG_PATH = join(CONFIG_DIR, 'config.json');
const MEMORY_PATH = join(CONFIG_DIR, 'memory.db');

interface Config {
  provider: 'anthropic' | 'openai' | 'mock';
  model: string;
  apiKey?: string;
  baseUrl?: string;
  workdir: string;
  permissionMode?: string;
  /** Engine version: 'v3' (default) or 'v4' (stream-native actor model) */
  engine?: 'v3' | 'v4';
  /** v4 speculation budget in ms (default 5000) */
  speculationBudgetMs?: number;
  /** v4 quality threshold (default 0.7) */
  qualityThreshold?: number;
  /** Autonomous mode: no confirmations, all bash auto-allow (default: false) */
  autonomous?: boolean;
  /** File scope: limit agent edits to this single file (default: null = multi-file) */
  scope?: string | null;
  /** Known provider ids (used by /provider for the list) */
  knownProviders?: string[];
}

function loadConfig(): Config {
  if (!existsSync(CONFIG_DIR)) mkdirSync(CONFIG_DIR, { recursive: true });

  if (existsSync(CONFIG_PATH)) {
    return JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'));
  }

  return {
    provider: (process.env.HUAGENT_PROVIDER as any) || 'mock',
    model: process.env.HUAGENT_MODEL || 'huagent-mock-1',
    apiKey: process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY || process.env.TOKENROUTER_API_KEY,
    baseUrl: process.env.HUAGENT_BASE_URL,
    workdir: process.cwd(),
    permissionMode: 'workspace-write',
    engine: (process.env.HUAGENT_ENGINE as 'v3' | 'v4') || 'v3',
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
      if (['--dir', '-d', '--provider', '-p', '--model', '-m', '--api-key', '--base-url', '--perm', '--engine', '--quality-threshold', '--speculation-budget-ms', '--scope'].includes(keyOnly)) {
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
    else if (arg === '--engine') options.engine = value ?? argList[++i];
    else if (arg === '--quality-threshold') options.qualityThreshold = parseFloat(value ?? argList[++i]);
    else if (arg === '--speculation-budget-ms') options.speculationBudgetMs = parseInt(value ?? argList[++i], 10);
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
  --engine <v3|v4>           ${fg(theme.fgDim, 'Engine version: v3 (ReAct) or v4 (stream-native actor model)')}
  --quality-threshold <0-1>  ${fg(theme.fgDim, 'v4: race winner quality threshold (default 0.7)')}
  --speculation-budget-ms <ms>  ${fg(theme.fgDim, 'v4: speculation race budget in ms (default 5000)')}

${fg(theme.primary, 'AUTONOMY & SCOPE (autoresearch-inspired):')}
  --autonomous               ${fg(theme.fgDim, 'Start in autonomous mode: no confirmations, all bash auto-allow')}
  --no-autonomous            ${fg(theme.fgDim, 'Disable autonomous mode (default)')}
  --scope <file>             ${fg(theme.fgDim, 'Limit agent edits to this single file only')}

${fg(theme.primary, 'ENGINE v4.0 (Stream-Native Actor Model):')}
  --engine=v4 enables 8 novel primitives:
  - Stream-native architecture (events, not loop)
  - HTN planning (parallel subgoals)
  - Speculative execution (3-strategy race)
  - 3-critic mesh verification
  - Bi-temporal memory graph
  - Composable capability pipelines
  - Self-healing actor supervision
  - Discipline layer (Fable-5 mindset: plan, observe, ground, verify, diagnose)

${fg(theme.primary, 'EXAMPLES:')}
  huagent "fix the auth bug" --engine=v4
  huagent "add OAuth" --engine=v4 --quality-threshold=0.8
  huagent "what is JWT?" --engine=v4 --no-tui
  huagent "refactor auth" --engine=v4 --speculation-budget-ms=10000
  huagent "fix the JWT bug" --engine=v4 --autonomous         ${fg(theme.fgDim, '# autoresearch-style: never stop')}
  huagent "refactor auth.ts" --engine=v4 --scope=src/auth.ts ${fg(theme.fgDim, '# autoresearch-style: 1 file only')}

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

/**
 * Run a task using the v4.0 engine.
 *
 * This is the main entry point for v4.0 in the CLI. It:
 * 1. Creates a v4 engine with the configured LLM provider
 * 2. Streams events to stdout (one-shot mode) or TUI
 * 3. Returns the final result
 */
async function runV4Engine(
  message: string | undefined,
  config: Config,
  options: any,
): Promise<void> {
  console.log(`${mascots.smallHua} ${fg(theme.sakura, '⚡ v4.0 Stream-Native Actor Model')}`);
  console.log(`${mascots.smallHua} ${fg(theme.sky, '7 primitives: Stream, HTN, Speculation, Critic Mesh, Graph, Capability, Actor')}`);

  // No message → TUI in v4 mode (one-shot only for now; TUI in v3 mode)
  if (!message) {
    console.log(`${mascots.sleepHua} ${fg(theme.fgDim, 'TUI mode with v4 engine is not yet supported. Please provide a message.')}`);
    console.log(`${mascots.sleepHua} ${fg(theme.fgDim, 'Example: huagent "fix the auth bug" --engine=v4')}`);
    return;
  }

  // One-shot mode
  console.log(`\n${fg(theme.fgDim, '✧ Running v4.0 engine...')}\n`);

  // Stream events as they happen
  const onEvent = (e: any) => {
    // Print high-signal events only
    if (
      e.kind === "classified" ||
      e.kind === "htn_plan" ||
      e.kind === "speculation_started" ||
      e.kind === "speculation_winner" ||
      e.kind === "mesh_verdict" ||
      e.kind === "episode_recorded" ||
      e.kind === "actor_started" ||
      e.kind === "actor_crashed" ||
      e.kind === "actor_restarted"
    ) {
      console.log(`  ${fg(theme.fgDim, formatEvent(e))}`);
    }
  };

  try {
    const result = await runWithV4(message, {
      provider: config.provider,
      model: config.model,
      apiKey: config.apiKey,
      baseUrl: config.baseUrl,
      workdir: config.workdir,
      speculationBudgetMs: options.speculationBudgetMs ?? config.speculationBudgetMs,
      qualityThreshold: options.qualityThreshold ?? config.qualityThreshold,
      autonomous: options.autonomous ?? config.autonomous,
      scope: options.scope ?? config.scope,
      onEvent,
    });

    // Print final output
    console.log("\n" + "─".repeat(60));
    console.log(`${fg(theme.primary, '✧ v4.0 Output:')}\n${result.output}`);
    console.log("─".repeat(60));
    console.log(`${fg(theme.fgDim, '✧ Stats:')} ${result.totalMs}ms, ${result.totalTokens} tokens, ${result.events.length} events`);
    if (result.plan) {
      console.log(`${fg(theme.fgDim, '✧ Plan:')} ${result.plan.subgoals?.length ?? 0} subgoals, methods: ${result.plan.methodsUsed?.join(", ") ?? "none"}`);
    }
  } catch (err: any) {
    console.error(`${mascots.sleepHua} ${fg(theme.danger, 'v4.0 engine error: ' + err.message)}`);
  }
}

async function startAgent(message: string | undefined, options: any, fullArgs: string[] = []): Promise<void> {
  printBanner();

  // Load config
  const config = loadConfig();
  if (options.provider) config.provider = options.provider;
  if (options.model) config.model = options.model;
  if (options.apiKey) config.apiKey = options.apiKey;
  if (options.baseUrl) config.baseUrl = options.baseUrl;
  if (options.dir) config.workdir = options.dir;
  if (options.permissionMode) config.permissionMode = options.permissionMode;
  if (options.engine) config.engine = options.engine;
  if (options.qualityThreshold !== undefined) config.qualityThreshold = options.qualityThreshold;
  if (options.speculationBudgetMs !== undefined) config.speculationBudgetMs = options.speculationBudgetMs;
  // ── Autoresearch-inspired flags ────────────────────────────
  if (options.autonomous !== undefined) config.autonomous = options.autonomous;
  if (options.scope !== undefined) config.scope = options.scope;
  // Populate known providers (used by /provider for the list)
  config.knownProviders = Object.keys(PROVIDERS).filter((k) => k !== 'custom');
  saveConfig(config);

  // If v4 engine requested, route to v4 runner
  if (config.engine === 'v4') {
    await runV4Engine(message, config, options);
    return;
  }

  // Initialize components
  const store = new MemoryStore(MEMORY_PATH);
  const memory = new MemoryManager(store);
  const tools = new ToolRegistry(config.workdir, (config.permissionMode as any) || 'workspace-write');
  const sessions = new SessionManager();
  const skills = getSkills();

  // Resolve provider - either from config or auto-detect from env
  const providerId = (config.provider as ProviderId) || detectProviderFromEnv()?.id || 'custom';
  const apiKey = config.apiKey || process.env[PROVIDERS[providerId]?.apiKeyEnv || 'TOKENROUTER_API_KEY'] || '';
  const baseUrl = config.baseUrl || process.env.HUAGENT_BASE_URL;

  const client = new UnifiedClient(providerId, apiKey, baseUrl);
  // Override model if specified
  if (config.model && config.model !== client.getModel()) {
    (client as any).provider.defaultModel = config.model;
  }

  console.log(`${mascots.smallHua} ${fg(theme.success, 'Connected to ' + client.getProviderName() + '/' + (config.model || client.getModel()))}`);
  console.log(`${mascots.smallHua} ${fg(theme.sky, 'Memory: ' + memory.stats().memories + ' memories, ' + memory.stats().skills + ' skills, ' + skills.list().length + ' skill files')}`);
  console.log(`${mascots.smallHua} ${fg(theme.lavender, 'Permission: ' + tools.getPermissionMode())}`);

  // One-shot mode
  if (message) {
    console.log(`\n${fg(theme.fgDim, '✧ Streaming response...')}\n`);
    let fullResponse = '';
    for await (const event of client.stream({
      model: config.model || client.getModel(),
      system: 'You are Hua, an anime-powered AI coding agent. Be helpful, magical, and concise.',
      messages: [{ role: 'user', content: message }],
      temperature: 0.7,
    })) {
      if (event.type === 'text_delta') {
        process.stdout.write(event.delta);
        fullResponse = event.accumulated;
      } else if (event.type === 'usage') {
        setTimeout(() => {
          console.log(`\n\n${fg(theme.fgDim, `[${event.total} tokens, $${event.cost.toFixed(4)}]`)}`);
        }, 100);
      } else if (event.type === 'message_stop') {
        process.stdout.write('\n');
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
    const tuiMode = options.tui === 'legacy' || options.tui === 'classic' ? 'legacy' : 'modern';
    const engine = new Engine(client, memory, tools, sessions, {
      onEvent: (event: any) => {},
    });

    const AppComponent = tuiMode === 'legacy' ? App : ModernApp;

    // Wire the dialog controller so the TUI can pause the engine
    // for questions / permissions / plan reviews.
    const { getDialogController } = await import('./tui/dialog-controller.js');
    const dialog = getDialogController();

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
          // Wire dialog callbacks into the engine for this session.
          // Using setOptions (not a new constructor) preserves the
          // engine's existing state (messages, session, stats).
          (engine as any).setOptions?.({
            onQuestion: (req: any) => dialog.askUser(req),
            onPermissionRequest: (req: any) => dialog.requestPermission(req),
            onPlanReview: (plan: any) => dialog.reviewPlan(plan),
            onEvent: (event: any) => {
              // Forward to dialog controller (for TUI live updates)
              dialog.publishEvent(event);
            },
          });
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
    // Simple REPL mode
    const readline = await import('node:readline');
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const engine = new Engine(client, memory, tools, sessions);

    const prompt = () => {
      rl.question(fg(theme.primary, '\n❯ '), async (input) => {
        const cmd = input.trim();
        if (cmd === '/exit' || cmd === '/quit') {
          console.log(`${mascots.winkHua} ${fg(theme.sakura, 'Goodbye!')}`);
          store.close();
          rl.close();
          return;
        }
        if (cmd) {
          console.log(fg(theme.fgDim, '✧ Hua is thinking...'));
          try {
            const response = await engine.process(cmd, config.workdir);
            console.log('\n' + fg(theme.primary, '✧ Hua: ') + response);
          } catch (err: any) {
            console.error(fg(theme.danger, 'Error: ' + err.message));
          }
        }
        prompt();
      });
    };

    prompt();
  }
}
