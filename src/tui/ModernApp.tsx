/**
 * ModernApp — Adapter that uses the new compact NewLayout as the visual layer
 * but delegates all state and logic to the engine like App.tsx did.
 *
 * This is the production TUI: same internals as App.tsx, but with the modern
 * 3-line header, adaptive status bar, and elegant mode chips.
 *
 * Why not just use App.tsx directly?
 *   - App.tsx has 5-line ASCII mascot header
 *   - App.tsx uses square brackets and emoji
 *   - App.tsx status bar is a single line that overflows at narrow widths
 *   - We want the "elegant, modern, restrained" aesthetic David asked for
 */

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useApp } from 'ink';
import { NewLayout, type ChatMessage, type SessionStats, type SessionConfig, type ToastItem } from './new-layout.js';
import { Picker, type PickerItem } from './picker.js';
import { QuestionPrompt } from './question-prompt.js';
import { PlanMode, type PlanView } from './plan-mode.js';
import { ToolConfirmation } from './tool-confirmation.js';
import { SessionResume, buildSessionItems, type SessionView } from './session-resume.js';
import { completeSlashCommand, executeSlashCommand, type SlashCommandContext } from '../slash-commands.js';
import { getActivityStore } from './activity-store.js';
import { listProviders, PROVIDERS, type ProviderId } from '../providers/registry.js';
import { getModels } from '../providers/models.js';
import { getDialogController, type DialogState } from './dialog-controller.js';
import type {
  QuestionRequest,
  PermissionRequest,
  PermissionDecisionType,
  EngineEvent,
  Plan,
} from '../engine/core.js';

// ─── Engine/Client/Tools interfaces ────────────────────────────
// We use structural types (just what we need) instead of `any` to catch
// regressions when the underlying engine changes.
// Note: For full type compat with SlashCommandContext, we import the
// concrete types from their source modules. This avoids the `any` escape hatch
// that hides bugs at the prop boundary.

import type { LLMClient } from '../llm/client.js';
import type { ToolRegistry } from '../tools/index.js';
import type { SessionManager } from '../sessions.js';
import type { MemoryManager } from '../memory/manager.js';
import type { PermissionMode } from '../permissions.js';

interface ModernAppProps {
  engine: EngineLike;
  client: LLMClient;
  memory: MemoryManager;
  tools: ToolRegistry;
  sessions: SessionManager;
  skills: Record<string, unknown>;
  config: ConfigLike;
  onSubmit: (message: string) => Promise<string>;
  onExit?: () => void;
}

// Re-exported for compatibility
export type { LLMClient, ToolRegistry, SessionManager, MemoryManager, PermissionMode };

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
}

export const ModernApp: React.FC<ModernAppProps> = ({
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
  const [stats, setStats] = useState<SessionStats>({ tokens: 0, cost: 0, requests: 0, steps: 0 });
  const [permissionMode, setPermissionMode] = useState(tools.getPermissionMode());
  const [showActivity, setShowActivity] = useState(false);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [autonomous, setAutonomous] = useState<boolean>(Boolean(config.autonomous));
  const [scope, setScope] = useState<string | null>(config.scope ?? null);
  const [suggestions, setSuggestions] = useState<Array<{ name: string; summary: string; aliases: string[] }>>([]);

  // ── Picker state (Ctrl+P/Ctrl+T/... open this) ───────────────
  type PickerMode = 'provider' | 'model' | 'scope' | 'permission' | 'engine' | null;
  const [picker, setPicker] = useState<{ mode: PickerMode; items: PickerItem[]; title: string; onSelect: (id: string) => void } | null>(null);

  // ── Modal dialogs (question, plan, permission, session-resume) ──
  // Sourced from the DialogController singleton — the engine calls
  // controller.askUser/requestPermission/reviewPlan and the TUI shows
  // the dialog + resolves the Promise when the user picks.
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

  // ── Refs for closures that need current state ────────────────
  const messagesRef = useRef<ChatMessage[]>([]);
  messagesRef.current = messages;
  const autonomousRef = useRef(autonomous);
  autonomousRef.current = autonomous;

  // ── Toast helper ─────────────────────────────────────────────
  const pushToast = useCallback((level: ToastItem['level'], message: string) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setToasts((t) => [...t.slice(-3), { id, level, message, createdAt: Date.now() }]);
    // Auto-dismiss after 5s
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
        steps: s.steps,
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

  // (handleSubmit moved below — it needs handleSlashCommand which is defined later)

  // ── Tab completion ───────────────────────────────────────────
  const handleTabCompletion = useCallback(() => {
    if (input.startsWith('/') && suggestions.length > 0) {
      setInput(suggestions[0].name + ' ');
      setSuggestions([]);
    }
  }, [input, suggestions]);

  // ── Live model/provider state (mutated by picker + /model + /provider) ──
  const [currentProvider, setCurrentProvider] = useState<string>(config.provider || 'anthropic');
  const [currentModel, setCurrentModel] = useState<string>(config.model || '');

  // ── Session resume picker ─────────────────────────────────────
  const [showSessionResume, setShowSessionResume] = useState(false);
  const openSessionResume = useCallback(() => {
    setShowSessionResume(true);
  }, []);
  const sessionViews: SessionView[] = useMemo(() => {
    if (!sessions || typeof (sessions as any).list !== 'function') return [];
    const list = (sessions as any).list() as any[];
    return list.map((s) => ({
      id: s.id,
      startTime: s.startTime || 0,
      endTime: s.endTime,
      projectPath: s.projectPath || '',
      summary: s.summary || '',
      messageCount: (s.messages || []).length,
      model: s.metadata?.model,
      provider: s.metadata?.provider,
    }));
  }, [sessions, showSessionResume]);
  const closeSessionResume = useCallback(() => setShowSessionResume(false), []);
  const handleSessionSelect = useCallback((id: string) => {
    const s = (sessions as any).load?.(id);
    if (s) {
      setMessages(s.messages || []);
      pushToast('success', `Resumed session: ${id.slice(0, 8)}`);
      dialogController.publishEvent({ type: 'session_resumed', sessionId: id, messageCount: (s.messages || []).length });
    }
    setShowSessionResume(false);
  }, [sessions, pushToast, dialogController]);

  // ── Picker openers ───────────────────────────────────────────
  const openProviderPicker = useCallback(() => {
    const providers = listProviders();
    const items: PickerItem[] = providers.map((p) => {
      const hasKey = Boolean(process.env[p.apiKeyEnv] || (config.baseUrl && p.id === 'custom'));
      const keyMark = hasKey ? '✓ key set' : '○ no key';
      return {
        id: p.id,
        label: p.displayName,
        detail: p.id,
        description: p.baseUrl,
        meta: keyMark,
        current: p.id === currentProvider,
        disabled: !hasKey,
      };
    });
    setPicker({
      mode: 'provider',
      title: 'Switch Provider',
      items,
      onSelect: (id: string) => {
        const p = PROVIDERS[id as ProviderId];
        if (!p) return;
        // Read API key from env (or fall back to current baseUrl for custom)
        const apiKey = process.env[p.apiKeyEnv] || '';
        const baseUrl = process.env.HUAGENT_BASE_URL || config.baseUrl;
        if (p.id === 'custom' && !baseUrl) {
          pushToast('error', 'Custom provider requires HUAGENT_BASE_URL');
          setPicker(null);
          return;
        }
        if (!apiKey && p.id !== 'custom') {
          pushToast('error', `No API key: set ${p.apiKeyEnv}`);
          setPicker(null);
          return;
        }
        // Update engine + config
        (engine as any).setProvider?.(p.id, apiKey, baseUrl);
        (config as any).provider = p.id;
        setCurrentProvider(p.id);
        // Reset to provider default model if current is from another provider
        if (!getModels(p.id).find((m) => m.id === currentModel)) {
          const def = getModels(p.id)[0]?.id || p.defaultModel || '';
          (engine as any).setModel?.(def);
          (config as any).model = def;
          setCurrentModel(def);
        }
        pushToast('success', `Provider → ${p.displayName}${apiKey ? '' : ' (custom, no key)'}`);
        setPicker(null);
      },
    });
  }, [currentProvider, currentModel, config, engine, pushToast]);

  const openModelPicker = useCallback(() => {
    const providerId = currentProvider as ProviderId;
    const provider = PROVIDERS[providerId];
    const models = getModels(providerId);
    const items: PickerItem[] = models.map((m) => ({
      id: m.id,
      label: m.id,
      detail: m.label,
      description: m.notes,
      meta: m.tier,
      current: m.id === currentModel,
    }));
    setPicker({
      mode: 'model',
      title: `Switch Model · ${provider?.displayName || providerId}`,
      items,
      onSelect: (id: string) => {
        (engine as any).setModel?.(id);
        (config as any).model = id;
        setCurrentModel(id);
        pushToast('success', `Model → ${id}`);
        setPicker(null);
      },
    });
  }, [currentProvider, currentModel, engine, pushToast]);

  const openScopePicker = useCallback(() => {
    const presets = [
      { id: '__clear__', label: '○ no scope (whole project)', detail: 'clear' },
      { id: '__pick__', label: '… pick file or directory', detail: 'interactive' },
    ];
    const cwd = config.workdir || process.cwd();
    let items: PickerItem[] = [...presets];
    // If we have a scope set, include it at the top
    if (scope && scope !== '__clear__') {
      items.unshift({
        id: scope,
        label: `● current: ${scope}`,
        detail: 'active',
        current: true,
      });
    }
    // Allow quick pick of common subdirs
    try {
      const fs = require('node:fs') as typeof import('node:fs');
      const path = require('node:path') as typeof import('node:path');
      const entries = fs.readdirSync(cwd, { withFileTypes: true })
        .filter((e: any) => !e.name.startsWith('.') && e.name !== 'node_modules')
        .slice(0, 12);
      for (const e of entries) {
        const id = path.join(cwd, e.name);
        if (e.isDirectory()) {
          items.push({ id, label: e.name + '/', detail: 'dir' });
        } else if (/\.(ts|tsx|js|jsx|py|go|rs|md|json|yaml|yml)$/.test(e.name)) {
          items.push({ id, label: e.name, detail: 'file' });
        }
      }
    } catch {}
    setPicker({
      mode: 'scope',
      title: 'Set Scope (restrict edits)',
      items,
      onSelect: (id: string) => {
        if (id === '__clear__') {
          setScope(null);
          (config as any).scope = null;
          pushToast('success', 'Scope cleared');
        } else if (id === '__pick__') {
          setInput('/scope ');
          pushToast('info', 'Type a path after /scope');
        } else {
          setScope(id);
          (config as any).scope = id;
          pushToast('success', `Scope → ${id}`);
        }
        setPicker(null);
      },
    });
  }, [config.workdir, scope, pushToast, setInput]);

  const openPermissionPicker = useCallback(() => {
    const items: PickerItem[] = [
      { id: 'read-only', label: 'read-only', detail: 'no edits, no bash', current: permissionMode === 'read-only' },
      { id: 'workspace-write', label: 'workspace-write', detail: 'edit files in cwd', current: permissionMode === 'workspace-write' },
      { id: 'allow', label: 'allow', detail: 'all operations (autonomous)', current: permissionMode === 'allow' },
    ];
    setPicker({
      mode: 'permission',
      title: 'Permission Mode',
      items,
      onSelect: (id: string) => {
        tools.setPermissionMode(id as any);
        setPermissionMode(id as any);
        (config as any).permissionMode = id;
        pushToast('success', `Permission → ${id}`);
        setPicker(null);
      },
    });
  }, [permissionMode, tools, config, pushToast]);

  const closePicker = useCallback(() => setPicker(null), []);

  // ── Slash command handler ────────────────────────────────────
  const handleSlashCommand = useCallback(async (text: string) => {
    const parts = text.slice(1).split(/\s+/);
    const cmd = parts[0].toLowerCase();
    const args = parts.slice(1);
    const ctx: SlashCommandContext = {
      messages: messagesRef.current as any,
      llm: client,
      memory,
      tools,
      sessions,
      workdir: config.workdir,
      config,
      onToggleAutonomous: () => {
        setAutonomous((a) => !a);
        return !autonomousRef.current;
      },
      onSetScope: (s: string | undefined) => {
        const next = s ?? null;
        setScope(next);
        return next;
      },
      onGetScope: () => scope,
      onGetAutonomous: () => autonomous,
      onSetPermissionMode: (mode: PermissionMode) => {
        tools.setPermissionMode(mode);
        setPermissionMode(mode);
      },
      onClear: () => setMessages([]),
      // Picker openers — wire to React state
      onOpenProviderPicker: openProviderPicker,
      onOpenModelPicker: openModelPicker,
      onOpenScopePicker: openScopePicker,
      onOpenPermissionPicker: openPermissionPicker,
      onShowSessionResume: openSessionResume,
    };
    const result = await executeSlashCommand(cmd, args, ctx);
    if (result.message) {
      pushToast(result.clearMessages ? 'info' : 'success', result.message);
    }
    if (result.exit) {
      onExit?.();
      exit();
    }
    // Always clear input after slash command (the picker is the new UX, or the toast confirms)
    setInput('');
    setSuggestions([]);
  }, [config, tools, memory, sessions, onExit, exit, pushToast, scope, autonomous, openProviderPicker, openModelPicker, openScopePicker, openPermissionPicker, openSessionResume]);

  // ── Command palette: lets the user pick any slash action via Ctrl+K ──
  const openCommandPalette = useCallback(() => {
    const items: PickerItem[] = [
      { id: 'pick:provider', label: '/provider', detail: 'switch LLM provider', meta: 'Ctrl+P' },
      { id: 'pick:model', label: '/model', detail: 'switch model', meta: 'Ctrl+T' },
      { id: 'pick:scope', label: '/scope', detail: 'restrict to a path', meta: 'Ctrl+E' },
      { id: 'pick:permission', label: '/permissions', detail: 'change permission mode', meta: 'Ctrl+Shift+P' },
      { id: 'pick:session', label: '/resume', detail: 'resume a previous session', meta: 'Ctrl+R' },
      { id: '/autonomous', label: '/autonomous', detail: 'toggle autonomous mode', meta: 'Ctrl+A' },
      { id: '/clear', label: '/clear', detail: 'clear messages', meta: 'Ctrl+L' },
      { id: '/status', label: '/status', detail: 'show session status', meta: 'Ctrl+I' },
      { id: '/cost', label: '/cost', detail: 'token usage and cost' },
      { id: '/memory', label: '/memory', detail: 'memory statistics' },
      { id: '/skills', label: '/skills', detail: 'list learned skills' },
      { id: '/doctor', label: '/doctor', detail: 'run diagnostics' },
      { id: '/exit', label: '/exit', detail: 'quit', meta: 'Ctrl+D' },
    ];
    setPicker({
      mode: 'engine',
      title: 'Command Palette',
      items,
      onSelect: (id: string) => {
        setPicker(null);
        if (id.startsWith('pick:')) {
          const which = id.slice(5);
          if (which === 'provider') openProviderPicker();
          else if (which === 'model') openModelPicker();
          else if (which === 'scope') openScopePicker();
          else if (which === 'permission') openPermissionPicker();
          else if (which === 'session') openSessionResume();
        } else {
          // Run the slash command
          handleSlashCommand(id);
        }
      },
    });
  }, [openProviderPicker, openModelPicker, openScopePicker, openPermissionPicker, openSessionResume, handleSlashCommand]);

  // ── Submit handler ───────────────────────────────────────────
  const handleSubmit = useCallback(async (text: string) => {
    if (!text.trim() || isThinking || isStreaming) return;
    const userMsg = text.trim();
    setInput('');
    setSuggestions([]);

    if (userMsg.startsWith('/')) {
      await handleSlashCommand(userMsg);
      return;
    }

    setIsThinking(true);
    setIsStreaming(true);
    setStreamingText('');

    // Add user message
    const userMessage: ChatMessage = {
      id: Date.now().toString(),
      role: 'user',
      content: userMsg,
      timestamp: Date.now(),
    };
    setMessages((m) => [...m, userMessage]);

    try {
      // Use activity store to track this conversation
      const store = getActivityStore();
      store.start('message', `user: ${userMsg.slice(0, 80)}`);

      // Use the engine
      const fullResponse = await onSubmit(userMsg);

      // Add assistant message
      const assistantMessage: ChatMessage = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: fullResponse,
        timestamp: Date.now(),
      };
      setMessages((m) => [...m, assistantMessage]);
      setStreamingText('');
      store.finish(store.getState().activities[store.getState().activities.length - 1]?.id ?? '', 'success', {
        summary: 'message complete',
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      pushToast('error', `Error: ${message}`);
    } finally {
      setIsThinking(false);
      setIsStreaming(false);
      setStreamingText('');
    }
  }, [isThinking, isStreaming, handleSlashCommand, onSubmit, pushToast]);

  // ── Engine event subscription: forward to activity store + log to console ──
  useEffect(() => {
    return dialogController.subscribeEvents((event: EngineEvent) => {
      // Log to activity store so it shows up in the activity feed
      const store = getActivityStore();
      switch (event.type) {
        case 'plan_created':
          store.start('plan', `Plan: ${(event.plan?.steps || []).length} steps`);
          break;
        case 'plan_approved':
          store.finish(store.getState().activities[store.getState().activities.length - 1]?.id ?? '', 'success', { summary: 'Plan approved' });
          break;
        case 'plan_rejected':
          store.finish(store.getState().activities[store.getState().activities.length - 1]?.id ?? '', 'error', { summary: 'Plan rejected' });
          break;
        case 'step_start':
          store.start('verify', event.step?.description || event.step?.id || 'step');
          break;
        case 'step_done':
          store.finish(store.getState().activities[store.getState().activities.length - 1]?.id ?? '', 'success', { summary: 'done' });
          break;
        case 'step_failed':
          store.finish(store.getState().activities[store.getState().activities.length - 1]?.id ?? '', 'error', { summary: event.error });
          pushToast('error', `Step failed: ${event.error.slice(0, 80)}`);
          break;
        case 'tool_call':
          store.start('bash', `${event.call.name}(${JSON.stringify(event.call.args || {}).slice(0, 60)})`);
          break;
        case 'tool_result':
          store.finish(store.getState().activities[store.getState().activities.length - 1]?.id ?? '', 'success', { summary: 'ok' });
          break;
      }
    });
  }, [dialogController, pushToast]);

  // ── Dialog state computation ─────────────────────────────────
  // Priority: question > plan > permission > session-resume > picker
  const activeDialog = useMemo(() => {
    if (dialogState.question) {
      return {
        type: 'question' as const,
        request: dialogState.question.request,
        onSubmit: (answers: string[][]) => dialogController.resolveQuestion(answers),
        onCancel: () => dialogController.rejectQuestion(),
      };
    }
    if (dialogState.plan) {
      return {
        type: 'plan' as const,
        plan: dialogState.plan.plan as any,
        onApprove: () => dialogController.resolvePlan('approve'),
        onReject: () => dialogController.resolvePlan('reject'),
        onEdit: (_feedback: string) => dialogController.resolvePlan('edit'),
      };
    }
    if (dialogState.permission) {
      return {
        type: 'permission' as const,
        request: dialogState.permission.request,
        onDecide: (d: PermissionDecisionType) => dialogController.resolvePermission(d),
      };
    }
    if (showSessionResume) {
      return {
        type: 'session' as const,
        sessions: sessionViews,
        onSelect: handleSessionSelect,
        onCancel: closeSessionResume,
      };
    }
    return null;
  }, [dialogState, dialogController, showSessionResume, sessionViews, handleSessionSelect, closeSessionResume]);

  // ── Session config (reactive to picker changes) ──────────────
  const sessionConfig: SessionConfig = {
    workdir: config.workdir,
    model: currentModel,
    provider: currentProvider,
    effort: (config as any).effort,
  };

  return (
    <>
      <NewLayout
        messages={messages}
        input={input}
        setInput={(s: string) => {
          setInput(s);
          if (s.startsWith('/')) {
            setSuggestions(completeSlashCommand(s).slice(0, 5));
          } else {
            setSuggestions([]);
          }
        }}
        isThinking={isThinking}
        isStreaming={isStreaming}
        streamingText={streamingText}
        config={sessionConfig}
        permissionMode={permissionMode}
        autonomous={autonomous}
        scope={scope}
        showActivity={showActivity}
        stats={stats}
        toasts={toasts}
        engine="v3"
        onSubmit={handleSubmit}
        onExecuteSlash={async (cmd: string, args: string[]) => {
          const ctx: SlashCommandContext = {
            messages: messagesRef.current as any,
            llm: client,
            memory,
            tools,
            sessions,
            workdir: config.workdir,
            config,
            onToggleAutonomous: () => {
              setAutonomous((a) => !a);
              return !autonomousRef.current;
            },
            onSetScope: (s: string | undefined) => {
              const next = s ?? null;
              setScope(next);
              return next;
            },
            onGetScope: () => scope,
            onGetAutonomous: () => autonomous,
            onGetEffort: () => (config as any).effort || 'medium',
            onSetEffort: (e: string) => {
              (config as any).effort = e;
              pushToast('success', `Effort → ${e}`);
            },
            onShowSessionResume: openSessionResume,
            onSetPermissionMode: (mode: PermissionMode) => {
              tools.setPermissionMode(mode);
              setPermissionMode(mode);
            },
            onSwitchModel: (m: string) => {
              (engine as any).setModel?.(m);
              (config as any).model = m;
              setCurrentModel(m);
              pushToast('success', `Model → ${m}`);
            },
            onSwitchProvider: (p: string) => {
              const prov = PROVIDERS[p as ProviderId];
              if (!prov) return;
              const apiKey = process.env[prov.apiKeyEnv] || '';
              if (!apiKey && prov.id !== 'custom') {
                pushToast('error', `No API key: set ${prov.apiKeyEnv}`);
                return;
              }
              const baseUrl = process.env.HUAGENT_BASE_URL || config.baseUrl;
              (engine as any).setProvider?.(prov.id, apiKey, baseUrl);
              (config as any).provider = prov.id;
              setCurrentProvider(prov.id);
              pushToast('success', `Provider → ${prov.displayName}`);
            },
            onPersistConfig: () => {
              try {
                const path = require('node:path');
                const fs = require('node:fs');
                const os = require('node:os');
                const dir = path.join(os.homedir(), '.huagent');
                if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
                fs.writeFileSync(
                  path.join(dir, 'config.json'),
                  JSON.stringify(config, null, 2),
                );
              } catch {}
            },
            onClear: () => setMessages([]),
            // Picker openers — wire to React state
            onOpenProviderPicker: openProviderPicker,
            onOpenModelPicker: openModelPicker,
            onOpenScopePicker: openScopePicker,
            onOpenPermissionPicker: openPermissionPicker,
          };
          const result = await executeSlashCommand(cmd, args, ctx);
          if (result.message) pushToast(result.clearMessages ? 'info' : 'success', result.message);
          if (result.exit) { onExit?.(); exit(); }
          return result;
        }}
        onToggleActivity={() => setShowActivity((s) => !s)}
        onExit={() => { onExit?.(); exit(); }}
        onShowHelp={() => pushToast('info', 'Type /help for all commands')}
        picker={picker ? { title: picker.title, items: picker.items, onSelect: picker.onSelect, onCancel: closePicker } : null}
        onOpenProviderPicker={openProviderPicker}
        onOpenModelPicker={openModelPicker}
        onOpenScopePicker={openScopePicker}
        onOpenPermissionPicker={openPermissionPicker}
        onOpenCommandPalette={openCommandPalette}
        onOpenSessionResume={openSessionResume}
        dialog={
          activeDialog
            ? (activeDialog.type === 'question'
                ? { type: 'question' as const, request: activeDialog.request, onSubmit: activeDialog.onSubmit, onCancel: activeDialog.onCancel }
                : activeDialog.type === 'plan'
                  ? { type: 'plan' as const, plan: activeDialog.plan, onApprove: activeDialog.onApprove, onReject: activeDialog.onReject, onEdit: activeDialog.onEdit }
                  : activeDialog.type === 'permission'
                    ? { type: 'permission' as const, request: activeDialog.request, onDecide: activeDialog.onDecide }
                    : activeDialog.type === 'session'
                      ? { type: 'session' as const, sessions: activeDialog.sessions, onSelect: activeDialog.onSelect, onCancel: activeDialog.onCancel }
                      : null)
            : null
        }
      />
    </>
  );
};
