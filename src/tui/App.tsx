// Main TUI app - the visual interface
// Enhanced with: status bar, slash commands, tab completion, streaming display
// NOTE: This is the legacy TUI. The modern TUI is ModernApp.tsx — use that instead.

import React, { useState, useEffect, useRef } from 'react';
import { Box, Text, useInput, useApp } from 'ink';
import Gradient from 'ink-gradient';
import Spinner from 'ink-spinner';
import { theme, gradient, bar } from './theme.js';
import { mascots, statusEmojis, getToolIcon } from './mascot.js';
import type { Message, Plan, EngineEvent } from '../types/index.js';
import { SLASH_COMMANDS, completeSlashCommand, executeSlashCommand, type SlashCommandContext } from '../slash-commands.js';
import { classifyBashCommand, describeIntent } from '../permissions.js';

// We use `any` for the cross-cutting types in this legacy file. The types
// in slash-commands.ts (UnifiedClient, ToolRegistry, SessionManager, etc.) are
// the canonical interfaces, but App.tsx predates the strict-typing pass.
// For the modern TUI, see ModernApp.tsx which uses structural types.
interface AppProps {
  engine: any;
  client: any;
  memory: any;
  tools: any;
  sessions: any;
  skills: any;
  config: any;
  onSubmit: (message: string) => Promise<string>;
  onExit?: () => void;
}

export const App: React.FC<AppProps> = ({ engine, client, memory, tools, sessions, skills, config, onSubmit, onExit }) => {
  const { exit } = useApp();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isThinking, setIsThinking] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingText, setStreamingText] = useState('');
  const [currentPlan, setCurrentPlan] = useState<Plan | null>(null);
  const [activeToolCall, setActiveToolCall] = useState<{ name: string; args: any } | null>(null);
  const [stats, setStats] = useState({ tokens: 0, cost: 0, steps: 0, refinements: 0, requests: 0, tasks: 0 });
  const [mood, setMood] = useState<'happy' | 'thinking' | 'coding' | 'casting'>('happy');
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [showToolResult, setShowToolResult] = useState<{ name: string; result: any; duration: number } | null>(null);
  const [permissionMode, setPermissionMode] = useState(tools.getPermissionMode());
  const [showStatus, setShowStatus] = useState(false);
  const [activeStage, setActiveStage] = useState<{ stage: string; status: 'start' | 'end'; detail?: string } | null>(null);
  const [critiqueDisplay, setCritiqueDisplay] = useState<{ verdict: string; overall: number; feedback: string } | null>(null);
  const [reflectionDisplay, setReflectionDisplay] = useState<string | null>(null);
  // ── Autoresearch-inspired state ──────────────────────────────
  const [autonomous, setAutonomous] = useState<boolean>(Boolean(config.autonomous));
  const [scope, setScope] = useState<string | null>(config.scope ?? null);
  // When autonomous mode is on, the engine treats every tool call as "allow".
  // We re-route by setting the tools permission mode to 'allow' while active.
  useEffect(() => {
    if (autonomous) {
      tools.setPermissionMode('allow');
      setPermissionMode('allow');
    } else if (permissionMode === 'allow' && !autonomous) {
      // Restore from config when turning off (don't leave the user stuck in 'allow')
      const restoreMode = (config.permissionMode as any) || 'workspace-write';
      tools.setPermissionMode(restoreMode);
      setPermissionMode(restoreMode);
    }
  }, [autonomous]); // eslint-disable-line react-hooks/exhaustive-deps
  const inputRef = useRef('');

  // Handle keyboard
  useInput((inputChar, key) => {
    if (key.ctrl && inputChar === 'c') {
      onExit?.();
      exit();
      return;
    }
    if (key.ctrl && inputChar === 'l') {
      // Ctrl+L: toggle status panel
      setShowStatus(!showStatus);
      return;
    }
    if (key.return) {
      handleSubmit();
      return;
    }
    if (key.tab) {
      // Tab completion
      handleTabCompletion();
      return;
    }
    if (key.backspace) {
      setInput((s) => s.slice(0, -1));
      return;
    }
    if (inputChar && !key.ctrl && !key.meta) {
      const newInput = input + inputChar;
      setInput(newInput);
      // Show suggestions for slash commands
      if (newInput.startsWith('/')) {
        const sugg = completeSlashCommand(newInput);
        setSuggestions(sugg.slice(0, 5));
      } else {
        setSuggestions([]);
      }
    }
  });

  // Update stats periodically
  useEffect(() => {
    const interval = setInterval(() => {
      const llmStats = client.getStats();
      setStats((s) => ({
        ...s,
        tokens: llmStats.totalTokens,
        cost: llmStats.totalCost,
        requests: llmStats.requests,
      }));
    }, 500);
    return () => clearInterval(interval);
  }, [client]);

  const handleTabCompletion = () => {
    if (input.startsWith('/') && suggestions.length > 0) {
      setInput(suggestions[0] + ' ');
      setSuggestions([]);
    }
  };

  const handleSubmit = async () => {
    if (!input.trim() || isThinking || isStreaming) return;
    const userMsg = input.trim();
    setInput('');
    setSuggestions([]);

    // Check for slash command
    if (userMsg.startsWith('/')) {
      await handleSlashCommand(userMsg);
      return;
    }

    // Regular message - use the engine with 6-stage workflow
    setIsThinking(true);
    setMood('thinking');
    setActiveStage(null);
    setCritiqueDisplay(null);
    setReflectionDisplay(null);

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: userMsg,
      timestamp: Date.now(),
    };
    setMessages((msgs) => [...messages, userMessage]);

    try {
      setIsStreaming(true);
      setStreamingText('');
      setMood('coding');

      // Wire engine events to UI
      let finalResponse = '';
      let lastTextDelta = '';

      const eventHandler = (event: any) => {
        switch (event.type) {
          case 'stage':
            setActiveStage({ stage: event.stage, status: event.status, detail: event.detail });
            break;
          case 'plan_created':
            setCurrentPlan(event.plan);
            break;
          case 'step_start':
            setActiveToolCall({ name: event.step.tool || 'think', args: event.step.args });
            break;
          case 'tool_call':
            setActiveToolCall({ name: event.call.name, args: event.call.args });
            break;
          case 'tool_result':
            setShowToolResult({ name: event.call.name, result: event.result, duration: 0 });
            setActiveToolCall(null);
            setStats((s) => ({ ...s, steps: s.steps + 1 }));
            break;
          case 'critique':
            setCritiqueDisplay({ verdict: event.verdict, overall: event.overall, feedback: event.feedback });
            break;
          case 'refining':
            setStats((s) => ({ ...s, refinements: s.refinements + 1 }));
            break;
          case 'reflection':
            setReflectionDisplay(event.learned);
            break;
          case 'stream_delta':
            setStreamingText(event.accumulated);
            lastTextDelta = event.accumulated;
            break;
        }
      };

      // Call engine.process() — this drives the 6-stage workflow
      // The engine accepts an onEvent callback
      const onSubmitFn = (engine as any).options?.onEvent;
      // Inject our event handler
      if ((engine as any).options) {
        const original = (engine as any).options.onEvent;
        (engine as any).options.onEvent = (e: any) => {
          original(e);
          eventHandler(e);
        };
      }

      const response = await onSubmit(userMsg);
      finalResponse = response;

      // Add assistant message
      const assistantMsg: Message = {
        id: Date.now().toString(),
        role: 'assistant',
        content: finalResponse,
        timestamp: Date.now(),
      };
      setMessages((msgs) => [...msgs, assistantMsg]);
      setStreamingText('');
      setStats((s) => ({ ...s, tasks: s.tasks + 1 }));
    } catch (err: any) {
      setMessages((msgs) => [...msgs, {
        id: Date.now().toString(),
        role: 'system',
        content: `⚠️ Error: ${err.message}`,
        timestamp: Date.now(),
      }]);
    } finally {
      setIsThinking(false);
      setIsStreaming(false);
      setMood('happy');
      setActiveStage(null);
    }
  };

  const handleSlashCommand = async (cmd: string) => {
    const parts = cmd.slice(1).split(/\s+/);
    const command = parts[0];
    const args = parts.slice(1);

    const ctx: SlashCommandContext = {
      messages,
      llm: client,
      memory,
      tools,
      sessions,
      workdir: config.workdir,
      config,
      onClear: () => setMessages([]),
      onSwitchModel: (model) => {
        config.model = model;
      },
      onSwitchProvider: (provider) => {
        config.provider = provider;
      },
      onSetPermissionMode: (mode) => {
        tools.setPermissionMode(mode);
        setPermissionMode(mode);
      },
      onToggleAutonomous: () => {
        setAutonomous((prev) => {
          const next = !prev;
          config.autonomous = next;
          return next;
        });
        // Use functional update fallback: return the new value
        return !autonomous;
      },
      onGetAutonomous: () => autonomous,
      onSetScope: (newScope) => {
        const next = newScope ?? null;
        setScope(next);
        config.scope = next;
        return next;
      },
      onGetScope: () => scope,
      onPersistConfig: () => {
        // Persist via the same path the CLI uses. We can't import the
        // function here directly (it's at the top of cli.tsx), so we use
        // a custom event that the CLI listens for. As a fallback, write
        // the relevant fields via fetch+postMessage would be too heavy;
        // just mutate config and rely on a status save.
        try {
          const fs = require('node:fs');
          const path = require('node:path');
          const os = require('node:os');
          const cfgPath = path.join(os.homedir(), '.huagent', 'config.json');
          if (fs.existsSync(cfgPath)) {
            const existing = JSON.parse(fs.readFileSync(cfgPath, 'utf-8'));
            existing.provider = config.provider;
            existing.model = config.model;
            existing.autonomous = config.autonomous;
            existing.scope = config.scope;
            existing.knownProviders = config.knownProviders;
            fs.writeFileSync(cfgPath, JSON.stringify(existing, null, 2));
          }
        } catch {
          // best effort; don't crash on persist failure
        }
      },
    };

    const result = await executeSlashCommand(command, args, ctx);

    if (result.message) {
      setMessages((msgs) => [...msgs, {
        id: Date.now().toString(),
        role: 'system',
        content: result.message!,
        timestamp: Date.now(),
      }]);
    }

    if (result.clearMessages) {
      setMessages([]);
    }

    if (result.exit) {
      onExit?.();
      exit();
    }
  };

  return (
    <Box flexDirection="column" paddingX={1}>
      <Header mood={mood} stats={stats} permissionMode={permissionMode} showStatus={showStatus} config={config} />

      {showStatus && <StatusPanel stats={stats} config={config} permissionMode={permissionMode} memory={memory} />}

      {activeStage && <StageDisplay stage={activeStage} />}

      {currentPlan && <PlanDisplay plan={currentPlan} />}

      {activeToolCall && <ToolCallDisplay name={activeToolCall.name} args={activeToolCall.args} />}

      {showToolResult && <ToolResultDisplay result={showToolResult} />}

      {critiqueDisplay && <CritiqueDisplay critique={critiqueDisplay} />}

      {reflectionDisplay && <ReflectionDisplay learned={reflectionDisplay} />}

      {/* Messages */}
      <Box flexDirection="column" marginTop={1}>
        {messages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} />
        ))}

        {/* Streaming response */}
        {isStreaming && streamingText && (
          <Box marginY={1} flexDirection="column">
            <Box>
              <Text color={theme.primary} bold>✧ Hua </Text>
              <Text color={theme.fgMuted}><Spinner type="dots" /> streaming...</Text>
            </Box>
            <Box marginLeft={2}>
              <Text color={theme.fg}>{streamingText}</Text>
            </Box>
          </Box>
        )}
      </Box>

      {/* Suggestions */}
      {suggestions.length > 0 && (
        <Box marginTop={1} paddingX={1} borderStyle="single" borderColor={theme.lavender}>
          <Text color={theme.lavender}>Suggestions: </Text>
          {suggestions.map((s, i) => (
            <Text key={s} color={i === 0 ? theme.accent : theme.fgDim}>
              {i > 0 ? '  ' : ''}{s}
            </Text>
          ))}
        </Box>
      )}

      {/* Input area */}
      <Box marginTop={1} borderStyle="round" borderColor={isStreaming ? theme.lavender : theme.primary} paddingX={1}>
        {isThinking || isStreaming ? (
          <Box>
            <Text color={theme.primary}>
              <Spinner type="dots" /> {mood === 'coding' ? 'Hua-chan is crafting' : 'Hua-chan is thinking'}
            </Text>
            <Text color={theme.fgDim}>... ✧･ﾟ: *✧･ﾟ:*</Text>
          </Box>
        ) : (
          <Box>
            <Text color={theme.primary} bold>{'❯ '}</Text>
            <Text color={theme.fg}>{input || <Text color={theme.fgMuted}>Try: "build a CLI" or "/help" for commands</Text>}</Text>
            <Text color={theme.accent}>{'▌'}</Text>
          </Box>
        )}
      </Box>

      <StatusBar stats={stats} mood={mood} permissionMode={permissionMode} />
    </Box>
  );
};

// Header component
const Header: React.FC<{ mood: string; stats: any; permissionMode: string; showStatus: boolean; config: any }> = ({ mood, stats, permissionMode, showStatus, config }) => {
  const getMoodArt = () => {
    switch (mood) {
      case 'thinking': return mascots.huaThinking;
      case 'coding': return mascots.huaCoding;
      case 'casting': return mascots.huaCasting;
      default: return mascots.hua;
    }
  };

  const modeColor = permissionMode === 'read-only' ? theme.success :
                    permissionMode === 'danger-full-access' ? theme.danger :
                    permissionMode === 'prompt' ? theme.warning : theme.info;

  return (
    <Box borderStyle="double" borderColor={theme.primary} paddingX={1} flexDirection="row">
      <Box width={28}>
        <Text>{getMoodArt()}</Text>
      </Box>
      <Box flexDirection="column" flexGrow={1} marginLeft={1}>
        <Gradient name="pastel">
          <Text bold>huagent</Text>
        </Gradient>
        <Text color={theme.fgDim}>the cutest, smartest coding agent in your terminal</Text>
        <Text color={theme.accent}>by huanime ✦ powered by magic ✦</Text>
        <Text color={theme.fgMuted}>model: {config.model} | perm: <Text color={modeColor}>{permissionMode}</Text></Text>
      </Box>
      <Box flexDirection="column" alignItems="flex-end">
        <Text color={theme.sakura}>HP {bar(Math.max(0, 100000 - stats.tokens), 100000, 10, theme.success)}</Text>
        <Text color={theme.sky}>MP {bar(Math.min(stats.tokens, 100000), 100000, 10, theme.info)}</Text>
        <Text color={theme.gold}>XP {bar(stats.requests * 100, 1000, 10, theme.gold)}</Text>
      </Box>
    </Box>
  );
};

// Status panel (Ctrl+L)
const StatusPanel: React.FC<{ stats: any; config: any; permissionMode: string; memory: any }> = ({ stats, config, permissionMode, memory }) => {
  const memStats = memory.stats();
  return (
    <Box flexDirection="column" marginTop={1} borderStyle="round" borderColor={theme.lavender} paddingX={1}>
      <Text color={theme.lavender} bold>⚡ Status</Text>
      <Text color={theme.fgDim}>{'─'.repeat(50)}</Text>
      <Text color={theme.fg}>Model:     <Text color={theme.primary}>{config.model}</Text></Text>
      <Text color={theme.fg}>Provider:  <Text color={theme.primary}>{config.provider}</Text></Text>
      <Text color={theme.fg}>Workspace: <Text color={theme.primary}>{config.workdir}</Text></Text>
      <Text color={theme.fg}>Memory:    <Text color={theme.sakura}>{memStats.memories}</Text> memories, <Text color={theme.lavender}>{memStats.skills}</Text> skills</Text>
      <Text color={theme.fg}>Tokens:    <Text color={theme.gold}>{stats.tokens.toLocaleString()}</Text> (${stats.cost.toFixed(4)})</Text>
      <Text color={theme.fg}>Requests:  <Text color={theme.accent}>{stats.requests}</Text></Text>
    </Box>
  );
};

// Plan display
const PlanDisplay: React.FC<{ plan: Plan }> = ({ plan }) => {
  return (
    <Box flexDirection="column" marginTop={1} borderStyle="round" borderColor={theme.info} paddingX={1}>
      <Text color={theme.info} bold>📋 Plan: {plan.goal}</Text>
      {plan.complexity && (
        <Text color={theme.fgMuted}>  complexity: {plan.complexity} | task: {plan.taskType}</Text>
      )}
      {plan.steps.map((step, i) => (
        <Box key={step.id}>
          <Text color={theme.accent}>{i + 1}. </Text>
          <Text color={step.status === 'done' ? theme.success : step.status === 'failed' ? theme.danger : theme.fg}>
            {step.status === 'done' ? '✓' : step.status === 'failed' ? '✗' : step.status === 'running' ? '⏳' : '○'} {step.description}
          </Text>
          {step.duration !== undefined && (
            <Text color={theme.fgDim}> ({step.duration}ms)</Text>
          )}
        </Box>
      ))}
    </Box>
  );
};

// Stage display — shows current workflow stage
const StageDisplay: React.FC<{ stage: { stage: string; status: 'start' | 'end'; detail?: string } }> = ({ stage }) => {
  const isStart = stage.status === 'start';
  return (
    <Box marginY={1} paddingX={1} borderStyle="single" borderColor={isStart ? theme.primary : theme.success}>
      <Text color={isStart ? theme.primary : theme.success} bold>
        {isStart ? '⏳' : '✓'} {stage.stage}
      </Text>
      {stage.detail && <Text color={theme.fgMuted}> — {stage.detail}</Text>}
    </Box>
  );
};

// Critique display — shows verifier verdict
const CritiqueDisplay: React.FC<{ critique: { verdict: string; overall: number; feedback: string } }> = ({ critique }) => {
  const color = critique.verdict === 'pass' ? theme.success : critique.verdict === 'refine' ? theme.warning : theme.danger;
  const emoji = critique.verdict === 'pass' ? '✨' : critique.verdict === 'refine' ? '🔄' : '⚠️';
  return (
    <Box flexDirection="column" marginY={1} paddingX={1} borderStyle="round" borderColor={color}>
      <Text color={color} bold>
        {emoji} Verify: {critique.verdict.toUpperCase()} (score {critique.overall.toFixed(1)}/5)
      </Text>
      {critique.feedback && (
        <Text color={theme.fg}>{critique.feedback.slice(0, 200)}</Text>
      )}
    </Box>
  );
};

// Reflection display — shows what was learned
const ReflectionDisplay: React.FC<{ learned: string }> = ({ learned }) => {
  return (
    <Box marginY={1} paddingX={1} borderStyle="single" borderColor={theme.lavender}>
      <Text color={theme.lavender} bold>💡 Reflect: </Text>
      <Text color={theme.fg}>{learned}</Text>
    </Box>
  );
};

// Tool call display with bash classification
const ToolCallDisplay: React.FC<{ name: string; args: any }> = ({ name, args }) => {
  let intentStr = '';
  if (name === 'bash' && args.command) {
    const intent = classifyBashCommand(args.command);
    intentStr = ` ${describeIntent(intent)}`;
  }

  return (
    <Box marginTop={1} borderStyle="round" borderColor={theme.lavender} paddingX={1}>
      <Text color={theme.lavender}>
        {getToolIcon(name)} <Text bold>{name}</Text>{intentStr}
        {Object.keys(args).length > 0 && (
          <Text color={theme.fgDim}> {JSON.stringify(args).slice(0, 120)}</Text>
        )}
      </Text>
    </Box>
  );
};

// Tool result display
const ToolResultDisplay: React.FC<{ result: { name: string; result: any; duration: number } }> = ({ result }) => {
  const isError = !result.result?.success && result.result?.error;
  const color = isError ? theme.danger : theme.success;
  const icon = isError ? '✗' : '✓';
  const preview = JSON.stringify(result.result).slice(0, 200);

  return (
    <Box marginTop={1} borderStyle="round" borderColor={color} paddingX={1}>
      <Text color={color}>{icon} {result.name} </Text>
      <Text color={theme.fgDim}>({result.duration}ms)</Text>
      <Box marginLeft={2}>
        <Text color={theme.fg}>{preview}</Text>
      </Box>
    </Box>
  );
};

// Message bubble
const MessageBubble: React.FC<{ message: Message }> = ({ message }) => {
  const isUser = message.role === 'user';
  const isSystem = message.role === 'system';
  const isTool = message.role === 'tool';

  if (isSystem) {
    return (
      <Box marginY={1}>
        <Text>{message.content}</Text>
      </Box>
    );
  }

  if (isTool) {
    return (
      <Box marginY={1} paddingX={1} borderStyle="single" borderColor={theme.fgMuted}>
        <Text color={theme.fgDim}>🔧 Tool: </Text>
        <Text color={theme.fg}>{message.content.slice(0, 500)}</Text>
      </Box>
    );
  }

  return (
    <Box marginY={1} flexDirection="column">
      <Box>
        <Text color={isUser ? theme.sakura : theme.primary} bold>
          {isUser ? '🌸 You' : '✧ Hua'}
        </Text>
        <Text color={theme.fgMuted}> {new Date(message.timestamp).toLocaleTimeString()}</Text>
      </Box>
      <Box marginLeft={2}>
        <Text color={theme.fg}>{message.content}</Text>
      </Box>
    </Box>
  );
};

// Status bar (footer)
const StatusBar: React.FC<{ stats: any; mood: string; permissionMode: string }> = ({ stats, mood, permissionMode }) => {
  return (
    <Box marginTop={1} paddingX={1} borderStyle="single" borderColor={theme.border}>
      <Text color={theme.fgDim}>
        {statusEmojis[mood as keyof typeof statusEmojis] || '⚡'} {mood}
      </Text>
      <Text color={theme.fgMuted}> | </Text>
      <Text color={theme.accent}>⚡ {stats.requests}</Text>
      <Text color={theme.fgMuted}> | </Text>
      <Text color={theme.gold}>🪙 {stats.tokens.toLocaleString()} (${stats.cost.toFixed(4)})</Text>
      <Text color={theme.fgMuted}> | </Text>
      <Text color={theme.fgDim}>perm: {permissionMode}</Text>
      <Text color={theme.fgMuted}> | </Text>
      <Text color={theme.fgDim}>Ctrl+C exit | Ctrl+L status | Tab complete</Text>
    </Box>
  );
};
