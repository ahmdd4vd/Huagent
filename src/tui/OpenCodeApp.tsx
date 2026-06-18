/**
 * OpenCodeApp — OpenCode-inspired TUI for Huagent.
 *
 * This is the new production TUI, replacing ModernApp.tsx. It mimics the
 * OpenCode design language (left-border prompt, minimal mascot usage,
 * single-line footer with directory + status info, OpenCode color palette)
 * while keeping Huagent's existing engine/client/tools contract intact.
 *
 * Layout (top → bottom):
 *   1. MessageList  — scrollable chat history (grows to fill)
 *   2. Prompt       — left-border textarea with status row below
 *   3. Footer       — single line: directory · permissions · LSP · MCP
 *
 * When a dialog is open (picker, question, plan, permission, session),
 * it renders as an overlay above the prompt.
 *
 * Compatible with the existing ModernAppProps contract — we accept the
 * same engine/client/memory/tools/sessions/skills/config props.
 */

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Box, Text, useApp, useInput } from 'ink';
import { MessageList, type ChatMessage, type ToolCallInfo } from './oc/MessageList.js';
import { Prompt, type PromptStatus } from './oc/Prompt.js';
import { Footer } from './oc/Footer.js';
import { Picker as OCPicker, type PickerItem } from './oc/Picker.js';
import { ConfirmDialog, AlertDialog, HelpDialog } from './oc/Dialog.js';
import { theme, glyph, truncate } from './oc/theme.js';
import { completeSlashCommand, executeSlashCommand, type SlashCommandContext } from '../slash-commands.js';
import { getActivityStore } from './activity-store.js';
import { listProviders, PROVIDERS, type ProviderId } from '../providers/registry.js';
import { getModels } from '../providers/models.js';
import { getDialogController, type DialogState } from './dialog-controller.js';
import { QuestionPrompt } from './question-prompt.js';
import { PlanMode, type PlanView } from './plan-mode.js';
import { ToolConfirmation } from './tool-confirmation.js';
import { SessionResume, buildSessionItems, type SessionView } from './session-resume.js';
import { Picker as LegacyPicker, type PickerItem as LegacyPickerItem } from './picker.js';
import type {
  QuestionRequest,
  PermissionRequest,
  PermissionDecisionType,
  EngineEvent,
  Plan,
} from '../engine/core.js';

// ─── Engine/Client/Tools structural interfaces ───────────────────
// We use structural types (just what we need) instead of `any` to catch
// regressions when the underlying engine changes.

import type { UnifiedClient } from '../providers/client.js';
import type { ToolRegistry } from '../tools/index.js';
import type { SessionManager } from '../sessions.js';
import type { MemoryManager } from '../memory/manager.js';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { writeFileSync, existsSync, mkdirSync } from 'node:fs';
import type { PermissionMode } from '../permissions.js';

interface OpenCodeAppProps {
  engine: EngineLike;
  client: UnifiedClient;
  memory: MemoryManager;
  tools: ToolRegistry;
  sessions: SessionManager;
  skills: any;
  config: ConfigLike;
  onSubmit: (message: string) => Promise<string>;
  onExit?: () => void;
}

export type { UnifiedClient, ToolRegistry, SessionManager, MemoryManager };

export interface LLMStats {
  totalTokens?: number;
  totalCost?: number;
  requests?: number;
}

export interface EngineLike {
  process(msg: string, workdir: string): Promise<string>;
  end(): Promise<void>;
}

export interface ConfigLike {
  workdir?: string;
  model?: string;
  provider?: string;
  baseUrl?: string;
  autonomous?: boolean;
  scope?: string | null;
  permissionMode?: string;
  effort?: string;
}

// ─── Component ───────────────────────────────────────────────────

export const OpenCodeApp: React.FC<OpenCodeAppProps> = ({
  engine,
  client,
  memory,
  tools,
  sessions,
  skills,
  config,
  onSubmit,
  onExit,
}) => {
  const { exit } = useApp();

  // ── Core UI state ────────────────────────────────────────────
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isThinking, setIsThinking] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingText, setStreamingText] = useState('');
  const [stats, setStats] = useState<{ tokens: number; cost: number; requests: number; steps: number }>({
    tokens: 0, cost: 0, requests: 0, steps: 0,
  });
  const [permissionMode, setPermissionMode] = useState(tools.getPermissionMode());
  const [toasts, setToasts] = useState<Array<{ id: string; level: 'info' | 'success' | 'warning' | 'error'; message: string }>>([]);
  const [autonomous, setAutonomous] = useState<boolean>(Boolean(config.autonomous));
  const [scope, setScope] = useState<string | null>(config.scope ?? null);
  const [suggestions, setSuggestions] = useState<Array<{ name: string; summary: string; aliases: string[] }>>([]);
  const [pendingPermissions, setPendingPermissions] = useState(0);
  const [showHelp, setShowHelp] = useState(false);

  // ── Live model/provider state (mutated by picker + /model + /provider) ──
  const [currentProvider, setCurrentProvider] = useState<string>(config.provider || 'anthropic');
  const [currentModel, setCurrentModel] = useState<string>(config.model || '');

  // ── Picker state ─────────────────────────────────────────────
  type PickerMode = 'provider' | 'model' | 'scope' | 'permission' | 'engine' | 'session' | null;
  const [picker, setPicker] = useState<{
    mode: PickerMode;
    title: string;
    items: PickerItem[];
    onSelect: (id: string) => void;
  } | null>(null);

  // ── Modal dialogs (question, plan, permission, session-resume) ──
  const [dialogState, setDialogState] = useState<DialogState>({
    question: null,
    permission: null,
    plan: null,
  });
  const dialogController = useMemo(() => getDialogController(), []);
  useEffect(() => {
    return dialogController.subscribe(() => {
      setDialogState(dialogController.getState());
    });
  }, [dialogController]);

  // ── Refs ─────────────────────────────────────────────────────
  const messagesRef = useRef<ChatMessage[]>([]);
  messagesRef.current = messages;
  const autonomousRef = useRef(autonomous);
  autonomousRef.current = autonomous;

  // ── Terminal width/height tracking (responsive layout) ───────
  const [width, setWidth] = useState(process.stdout.columns || 100);
  const [height, setHeight] = useState(process.stdout.rows || 40);
  useEffect(() => {
    const onResize = () => {
      setWidth(process.stdout.columns || 100);
      setHeight(process.stdout.rows || 40);
    };
    process.stdout.on('resize', onResize);
    return () => { process.stdout.off('resize', onResize); };
  }, []);

  // ── Global keyboard shortcuts (work alongside the Prompt's useInput) ──
  // These are the OpenCode-style "leader" shortcuts. They're only active
  // when no picker / dialog is open (otherwise the picker/dialog gets
  // priority for the same keys).
  useInput((inputChar, key) => {
    // If a picker or dialog is open, defer to its useInput handler.
    if (picker || dialogState.question || dialogState.permission || dialogState.plan || showHelp) {
      return;
    }

    // Ctrl+P — provider picker (skip if upArrow, since some terminals send
    // Ctrl+P as up-arrow when in cooked mode).
    if (key.ctrl && inputChar === 'p' && !key.upArrow) {
      openPicker('provider');
      return;
    }
    // Ctrl+T — model picker.
    if (key.ctrl && inputChar === 't') {
      openPicker('model');
      return;
    }
    // Ctrl+E — scope picker.
    if (key.ctrl && inputChar === 'e') {
      openPicker('scope');
      return;
    }
    // Ctrl+R — session resume picker.
    if (key.ctrl && inputChar === 'r' && !key.shift) {
      openPicker('session');
      return;
    }
    // Ctrl+K — command palette (for now, just show a toast since we don't
    // have a full palette implementation).
    if (key.ctrl && inputChar === 'k') {
      pushToast('info', 'Command palette — type / and Tab for slash commands');
      return;
    }
    // Ctrl+L — clear screen (clear messages).
    if (key.ctrl && inputChar === 'l') {
      setMessages([]);
      pushToast('info', 'Cleared messages');
      return;
    }
    // ? — show help dialog (only when input is empty, so users can type
    // ? in their message without triggering help).
    if (inputChar === '?' && input === '') {
      setShowHelp(true);
      return;
    }
  });

  // ── Toast helper ─────────────────────────────────────────────
  const pushToast = useCallback((level: 'info' | 'success' | 'warning' | 'error', message: string) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setToasts((t) => [...t.slice(-3), { id, level, message }]);
    setTimeout(() => {
      setToasts((t) => t.filter((x) => x.id !== id));
    }, 5000);
  }, []);

  // ── Stats update ─────────────────────────────────────────────
  useEffect(() => {
    const interval = setInterval(() => {
      const llmStats = client.getStats();
      setStats((s) => ({
        ...s,
        tokens: llmStats.totalTokens ?? s.tokens,
        cost: llmStats.totalCost ?? s.cost,
        requests: llmStats.totalRequests ?? s.requests,
      }));
    }, 500);
    return () => clearInterval(interval);
  }, [client]);

  // ── Autonomous mode effect ───────────────────────────────────
  useEffect(() => {
    if (autonomous) {
      tools.setPermissionMode('allow');
      setPermissionMode('allow');
      pushToast('info', 'Autonomous mode: ON — no confirmations');
    } else if (permissionMode === 'allow' && !autonomous) {
      const restoreMode = (config.permissionMode as PermissionMode) || 'workspace-write';
      tools.setPermissionMode(restoreMode);
      setPermissionMode(restoreMode);
    }
  }, [autonomous]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Engine event handler (defined before useEffect so the subscription
  //    below can reference it without TDZ issues) ─────────────────
  // Track the current streaming assistant message ID so we can append
  // tool calls to it as they arrive during streaming.
  const streamingMsgIdRef = useRef<string | null>(null);

  const handleEngineEvent = useCallback((event: EngineEvent) => {
    switch (event.type) {
      case 'thinking':
        setIsThinking(true);
        setIsStreaming(false);
        setStreamingText('');
        streamingMsgIdRef.current = null;
        break;

      case 'stream_delta': {
        // Streaming text arrives in real-time. Update the streaming text
        // display. Tool calls may arrive interleaved with text deltas.
        setIsThinking(false);
        setIsStreaming(true);
        setStreamingText(event.accumulated || event.delta || '');
        break;
      }

      case 'tool_call': {
        // A tool call arrived during streaming. Add it as an inline tool
        // card to the current streaming message (or create one if this
        // is the first event).
        const call = (event as any).call;
        if (!call) break;

        // If we're streaming, add the tool call to a new assistant message
        // that will be finalized when streaming ends. For now, show it as
        // a running tool in the streaming area.
        setMessages((m) => {
          // Find or create the current streaming assistant message
          let msgId = streamingMsgIdRef.current;
          if (!msgId) {
            msgId = `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
            streamingMsgIdRef.current = msgId;
            return [...m, {
              id: msgId,
              role: 'assistant' as const,
              content: '',
              timestamp: Date.now(),
              toolCalls: [{
                name: call.name,
                status: 'running' as const,
                args: call.args,
              }],
            }];
          }
          // Append to existing streaming message
          return m.map((msg) => {
            if (msg.id === msgId) {
              return {
                ...msg,
                toolCalls: [...(msg.toolCalls || []), {
                  name: call.name,
                  status: 'running' as const,
                  args: call.args,
                }],
              };
            }
            return msg;
          });
        });
        break;
      }

      case 'tool_result': {
        // Tool finished — update its status and add result preview.
        const call = (event as any).call;
        const result = (event as any).result;
        const isError = result && typeof result === 'object' && result.error;
        const msgId = streamingMsgIdRef.current;
        if (!msgId) break;

        setMessages((m) => m.map((msg) => {
          if (msg.id !== msgId || !msg.toolCalls) return msg;
          const newCalls = [...msg.toolCalls];
          // Find the last running tool call with this name
          for (let i = newCalls.length - 1; i >= 0; i--) {
            if (newCalls[i].name === call.name && newCalls[i].status === 'running') {
              newCalls[i] = {
                ...newCalls[i],
                status: isError ? 'error' : 'success',
                result: result,
                durationMs: call.durationMs,
              };
              break;
            }
          }
          return { ...msg, toolCalls: newCalls };
        }));
        break;
      }

      case 'message': {
        // A complete assistant message arrived. Finalize it.
        const msg = (event as any).message;
        if (msg && msg.role === 'assistant') {
          const content = typeof msg.content === 'string' ? msg.content : '';
          const msgId = streamingMsgIdRef.current;

          if (msgId) {
            // Update the existing streaming message with final content
            setMessages((m) => m.map((mm) =>
              mm.id === msgId ? { ...mm, content, streaming: false } : mm
            ));
          } else {
            // No streaming message was created (e.g. tool-call-only response)
            setMessages((m) => [...m, {
              id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
              role: 'assistant',
              content,
              timestamp: Date.now(),
            }]);
          }

          setIsStreaming(false);
          setStreamingText('');
          setIsThinking(false);
          streamingMsgIdRef.current = null;
        }
        break;
      }

      case 'permission':
        setPendingPermissions((p) => p + 1);
        break;

      case 'step_failed':
        pushToast('error', (event as any).error || 'Step failed');
        setIsThinking(false);
        setIsStreaming(false);
        streamingMsgIdRef.current = null;
        break;

      case 'stage':
      case 'plan_created':
      case 'plan_approved':
      case 'plan_rejected':
      case 'step_start':
      case 'step_done':
      case 'step_skipped':
      case 'critique':
      case 'refining':
      case 'subagent_start':
      case 'subagent_done':
      case 'session_resumed':
      case 'question':
      case 'compact':
      case 'reflection':
      default:
        break;
    }
  }, [pushToast]);

  // ── Engine events subscription ───────────────────────────────
  // The Engine accepts an `onEvent` callback via constructor options
  // (NOT an `on()` method). cli.tsx wires the engine's onEvent to
  // `dialogController.publishEvent`, so we subscribe to engine events
  // via the dialogController's event bus instead of trying to attach
  // a listener directly to the engine.
  useEffect(() => {
    const unsub = dialogController.subscribeEvents((event: EngineEvent) => {
      handleEngineEvent(event);
    });
    return unsub;
  }, [dialogController, handleEngineEvent]);

  // ── Submit handler ───────────────────────────────────────────
  const handleSubmit = useCallback(async (text: string) => {
    if (!text.trim()) return;
    const userMsg: ChatMessage = {
      id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      role: 'user',
      content: text,
      timestamp: Date.now(),
    };
    setMessages((m) => [...m, userMsg]);
    setIsThinking(true);
    try {
      await onSubmit(text);
    } catch (err: any) {
      pushToast('error', err.message || 'Submission failed');
      setIsThinking(false);
    }
  }, [onSubmit, pushToast]);

  // ── Picker opener (defined before handleSlashCommand so it can be referenced) ──
  const openPicker = useCallback((mode: PickerMode) => {
    if (mode === 'provider') {
      const items: PickerItem[] = listProviders().map((p) => ({
        id: p.id,
        label: p.displayName,
        description: p.id === currentProvider ? 'current' : undefined,
        icon: p.emoji,
      }));
      setPicker({
        mode,
        title: 'Select provider',
        items,
        onSelect: (id) => {
          const provider = PROVIDERS[id as ProviderId];
          if (!provider) {
            pushToast('error', `Unknown provider: ${id}`);
            setPicker(null);
            return;
          }
          // Read API key from env (matches detectProviderFromEnv logic).
          const apiKey = process.env[provider.apiKeyEnv] || '';
          const baseUrl = (config as any).baseUrl || '';
          if (provider.id !== 'custom' && provider.id !== 'ollama' && !apiKey) {
            pushToast('error', `No API key: set ${provider.apiKeyEnv}`);
            setPicker(null);
            return;
          }
          if (provider.id === 'custom' && !baseUrl) {
            pushToast('error', 'Custom provider requires HUAGENT_BASE_URL');
            setPicker(null);
            return;
          }
          try {
            client.setProvider(id as ProviderId, apiKey, baseUrl);
            (config as any).provider = id;
            setCurrentProvider(id);
            // Reset to provider's default model.
            const defaultModel = provider.defaultModel;
            if (defaultModel) {
              client.setModel(defaultModel);
              (config as any).model = defaultModel;
              setCurrentModel(defaultModel);
            }
          } catch (err: any) {
            pushToast('error', `Failed to switch provider: ${err.message}`);
          }
          pushToast('success', `Provider: ${provider.displayName}`);
          setPicker(null);
        },
      });
      return;
    }
    if (mode === 'model') {
      const models = getModels(currentProvider as any) || [];
      const items: PickerItem[] = models.map((m) => ({
        id: m.id,
        label: m.id,
        description: m.id === currentModel ? 'current' : (m.tier ? m.tier : undefined),
      }));
      setPicker({
        mode,
        title: `Select model (${currentProvider})`,
        items,
        onSelect: (id) => {
          try {
            client.setModel(id);
            (config as any).model = id;
            setCurrentModel(id);
          } catch (err: any) {
            pushToast('error', `Failed to switch model: ${err.message}`);
          }
          pushToast('success', `Model: ${id}`);
          setPicker(null);
        },
      });
      return;
    }
    if (mode === 'scope') {
      const workdir = config.workdir || process.cwd();
      let files: string[] = [];
      try {
        files = readdirSync(workdir, { recursive: false, withFileTypes: false } as any)
          .filter((f) => typeof f === 'string')
          .slice(0, 100) as string[];
      } catch {
        files = [];
      }
      const items: PickerItem[] = [
        { id: '__none__', label: '(no scope)', description: 'clear scope' },
        ...files.map((f) => ({ id: f, label: f })),
      ];
      setPicker({
        mode,
        title: 'Set scope (limit edits to one file)',
        items,
        onSelect: (id) => {
          const s = id === '__none__' ? null : id;
          setScope(s);
          (config as any).scope = s;
          pushToast('info', s ? `Scope: ${s}` : 'Scope cleared');
          setPicker(null);
        },
      });
      return;
    }
    if (mode === 'permission') {
      const items: PickerItem[] = [
        { id: 'read-only', label: 'read-only', description: 'Read files, no edits' },
        { id: 'workspace-write', label: 'workspace-write', description: 'Edit project files (default)' },
        { id: 'sandboxed', label: 'sandboxed', description: 'Edits go to a temp directory' },
        { id: 'danger-full-access', label: 'danger-full-access', description: 'No confirmations at all' },
        { id: 'allow', label: 'allow (autonomous)', description: 'Auto-approve everything' },
      ];
      setPicker({
        mode,
        title: 'Permission mode',
        items,
        onSelect: (id) => {
          setPermissionMode(id as any);
          tools.setPermissionMode(id as any);
          (config as any).permissionMode = id;
          pushToast('info', `Permission: ${id}`);
          setPicker(null);
        },
      });
      return;
    }
    if (mode === 'session') {
      const sessionsList = sessions.list?.() ?? [];
      if (sessionsList.length === 0) {
        pushToast('info', 'No saved sessions');
        return;
      }
      const items: PickerItem[] = sessionsList.map((s: any) => ({
        id: s.id,
        label: s.id,
        description: s.messageCount ? `${s.messageCount} msgs` : undefined,
      }));
      setPicker({
        mode,
        title: 'Resume session',
        items,
        onSelect: (id) => {
          setPicker(null);
          try {
            sessions.load?.(id);
            pushToast('success', `Resumed: ${id}`);
          } catch (err: any) {
            pushToast('error', err.message);
          }
        },
      });
      return;
    }
  }, [currentProvider, currentModel, config.workdir, sessions, tools, client, pushToast, config]);

  // ── Slash command handling ───────────────────────────────────
  const handleSlashCommand = useCallback(async (cmd: string, args: string[]) => {
    const ctx: SlashCommandContext = {
      messages: [],
      llm: client,
      memory,
      tools,
      sessions,
      workdir: config.workdir || process.cwd(),
      config,
      onClear: () => setMessages([]),
      onSwitchModel: (m: string) => {
        try {
          client.setModel(m);
          (config as any).model = m;
          setCurrentModel(m);
        } catch (err: any) {
          pushToast('error', `Failed: ${err.message}`);
          return;
        }
        pushToast('info', `Model: ${m}`);
      },
      onSwitchProvider: (p: string) => {
        const provider = PROVIDERS[p as ProviderId];
        if (!provider) {
          pushToast('error', `Unknown provider: ${p}`);
          return;
        }
        const apiKey = process.env[provider.apiKeyEnv] || '';
        const baseUrl = (config as any).baseUrl || '';
        if (provider.id !== 'custom' && provider.id !== 'ollama' && !apiKey) {
          pushToast('error', `No API key: set ${provider.apiKeyEnv}`);
          return;
        }
        try {
          client.setProvider(p as ProviderId, apiKey, baseUrl);
          (config as any).provider = p;
          setCurrentProvider(p);
          const defaultModel = provider.defaultModel;
          if (defaultModel) {
            client.setModel(defaultModel);
            (config as any).model = defaultModel;
            setCurrentModel(defaultModel);
          }
        } catch (err: any) {
          pushToast('error', `Failed: ${err.message}`);
          return;
        }
        pushToast('info', `Provider: ${p}`);
      },
      onSetPermissionMode: (m: any) => {
        setPermissionMode(m);
        tools.setPermissionMode(m);
        pushToast('info', `Permission: ${m}`);
      },
      onSave: (summary: string) => pushToast('success', summary),
      onToggleAutonomous: () => {
        const next = !autonomousRef.current;
        setAutonomous(next);
        return next;
      },
      onSetScope: (s: string | undefined) => {
        const next = s ?? null;
        setScope(next);
        return next;
      },
      onGetScope: () => scope,
      onGetAutonomous: () => autonomous,
      onShowSessionResume: () => openPicker('session'),
      onOpenProviderPicker: () => openPicker('provider'),
      onOpenModelPicker: () => openPicker('model'),
      onOpenScopePicker: () => openPicker('scope'),
      onOpenPermissionPicker: () => openPicker('permission'),
      onPersistConfig: () => {
        try {
          const configDir = join(homedir(), '.huagent');
          if (!existsSync(configDir)) mkdirSync(configDir, { recursive: true });
          writeFileSync(join(configDir, 'config.json'), JSON.stringify(config, null, 2));
        } catch {}
      },
      onGetEffort: () => (config as any).effort ?? null,
      onSetEffort: (e: string) => { (config as any).effort = e; },
    };

    const result = await executeSlashCommand(cmd, args, ctx);
    if (result?.message) {
      pushToast('info', result.message);
    }
    if (result?.exit) {
      if (onExit) onExit();
      exit();
    }
    return result;
  }, [client, memory, tools, sessions, config, exit, onExit, pushToast, autonomous, scope, openPicker]);

  // ── Suggestions update on input change ──────────────────────
  useEffect(() => {
    if (input.startsWith('/')) {
      setSuggestions(completeSlashCommand(input).slice(0, 5));
    } else {
      setSuggestions([]);
    }
  }, [input]);

  // ── Render ───────────────────────────────────────────────────
  const promptStatus: PromptStatus = isThinking
    ? { type: 'thinking' }
    : isStreaming
      ? { type: 'streaming' }
      : { type: 'idle' };

  // Status info for the footer.
  const directory = config.workdir || process.cwd();
  const modelLabel = currentModel || config.model || 'huagent';
  const providerLabel = currentProvider || config.provider;

  // Picker suggestions (for the prompt's autocomplete popup).
  const promptSuggestions = suggestions.map((s) => ({
    name: s.name,
    summary: s.summary,
  }));

  return (
    <Box flexDirection="column" height={height} width={width}>
      {/* Toasts (top-right, ephemeral) */}
      {toasts.length > 0 && (
        <Box flexDirection="column" paddingLeft={1}>
          {toasts.map((t) => {
            const color = t.level === 'error' ? theme.error
              : t.level === 'warning' ? theme.warning
              : t.level === 'success' ? theme.success
              : theme.info;
            const icon = t.level === 'error' ? glyph.fail
              : t.level === 'warning' ? glyph.warn
              : t.level === 'success' ? glyph.success
              : glyph.bullet;
            return (
              <Box key={t.id}>
                <Text color={color}>{icon} </Text>
                <Text color={theme.text}>{truncate(t.message, width - 4)}</Text>
              </Box>
            );
          })}
        </Box>
      )}

      {/* Message list (fills most of the screen) */}
      <Box flexDirection="column" flexGrow={1} paddingLeft={2} paddingRight={2} paddingBottom={1}>
        <MessageList
          messages={messages}
          width={width - 4}
          maxVisible={50}
          streamingText={streamingText}
          isThinking={isThinking}
          modelLabel={modelLabel}
        />
      </Box>

      {/* Dialog overlay (replaces prompt when active) */}
      {dialogState.question ? (
        <Box paddingLeft={2} paddingRight={2}>
          <QuestionPrompt
            request={dialogState.question.request}
            onSubmit={(answers) => dialogController.resolveQuestion(answers)}
            onCancel={() => dialogController.rejectQuestion()}
            width={width - 4}
          />
        </Box>
      ) : dialogState.permission ? (
        <Box paddingLeft={2} paddingRight={2}>
          <ToolConfirmation
            request={dialogState.permission.request}
            onDecide={(d) => dialogController.resolvePermission(d)}
            width={width - 4}
          />
        </Box>
      ) : dialogState.plan ? (
        <Box paddingLeft={2} paddingRight={2}>
          <PlanMode
            plan={dialogState.plan.plan as any}
            onApprove={() => dialogController.resolvePlan('approve')}
            onReject={() => dialogController.resolvePlan('reject')}
            onEdit={(_feedback) => dialogController.resolvePlan('edit')}
            width={width - 4}
          />
        </Box>
      ) : picker ? (
        <Box paddingLeft={2} paddingRight={2}>
          <OCPicker
            title={picker.title}
            items={picker.items}
            onSelect={picker.onSelect}
            onCancel={() => setPicker(null)}
            width={Math.min(80, width - 4)}
          />
        </Box>
      ) : showHelp ? (
        <Box paddingLeft={2} paddingRight={2}>
          <HelpDialog onDismiss={() => setShowHelp(false)} width={Math.min(80, width - 4)} />
        </Box>
      ) : (
        /* Prompt (main input) */
        <Box paddingLeft={2} paddingRight={2}>
          <Prompt
            value={input}
            onChange={setInput}
            onSubmit={(text) => {
              if (text.startsWith('/')) {
                const parts = text.slice(1).split(/\s+/);
                const cmd = parts[0];
                const args = parts.slice(1);
                setInput('');
                setSuggestions([]);
                handleSlashCommand(cmd, args);
                return;
              }
              setInput('');
              setSuggestions([]);
              handleSubmit(text);
            }}
            status={promptStatus}
            disabled={isThinking || isStreaming}
            modelLabel={modelLabel}
            providerLabel={providerLabel}
            agentLabel="huagent"
            variantLabel={autonomous ? 'auto' : undefined}
            suggestions={promptSuggestions}
            onPickSuggestion={(item) => {
              setInput(item.name + ' ');
              setSuggestions([]);
            }}
            onClearSuggestions={() => setSuggestions([])}
            onExit={onExit}
            width={width - 4}
            placeholder="Ask, search, or run /help for commands"
          />
        </Box>
      )}

      {/* Footer (status bar) */}
      <Box paddingLeft={2} paddingRight={2} paddingTop={0}>
        <Footer
          directory={directory}
          pendingPermissions={pendingPermissions}
          lspCount={0}
          mcpCount={0}
          width={width - 4}
        />
      </Box>

      {/* Stats hint at the very bottom — shown only when no overlay is active.
          Kept on a single line; truncated if terminal is narrow. */}
      {!picker && !dialogState.question && !dialogState.permission && !dialogState.plan && !showHelp && (
        <Box paddingLeft={2} paddingRight={2}>
          <Box flexDirection="row" gap={2}>
            <Text color={theme.textMuted} dimColor>
              <Text color={theme.text}>tokens:</Text> {stats.tokens}
            </Text>
            <Text color={theme.textMuted} dimColor>
              <Text color={theme.text}>cost:</Text> ${stats.cost.toFixed(4)}
            </Text>
            <Text color={theme.textMuted} dimColor>
              <Text color={theme.text}>perm:</Text> {permissionMode}
            </Text>
            {autonomous && (
              <Text color={theme.warning} bold>auto</Text>
            )}
            {scope && (
              <Text color={theme.textMuted} dimColor>
                <Text color={theme.text}>scope:</Text> {truncate(scope, 20)}
              </Text>
            )}
            <Text color={theme.textMuted} dimColor>
              <Text color={theme.primary}>?</Text> help
            </Text>
            <Text color={theme.textMuted} dimColor>
              <Text color={theme.primary}>Ctrl+P</Text>/<Text color={theme.primary}>T</Text>/<Text color={theme.primary}>E</Text>/<Text color={theme.primary}>R</Text> pickers
            </Text>
          </Box>
        </Box>
      )}
    </Box>
  );
};
