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

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useApp } from 'ink';
import { NewLayout, type ChatMessage, type SessionStats, type SessionConfig, type ToastItem } from './new-layout.js';
import { completeSlashCommand, executeSlashCommand, type SlashCommandContext } from '../slash-commands.js';
import { getActivityStore } from './activity-store.js';

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
  const [suggestions, setSuggestions] = useState<string[]>([]);

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
    };
    const result = await executeSlashCommand(cmd, args, ctx);
    if (result.message) {
      pushToast(result.clearMessages ? 'info' : 'success', result.message);
    }
    if (result.exit) {
      onExit?.();
      exit();
    }
  }, [config, tools, memory, sessions, onExit, exit, pushToast, scope, autonomous]);

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

  // ── Tab completion ───────────────────────────────────────────
  const handleTabCompletion = useCallback(() => {
    if (input.startsWith('/') && suggestions.length > 0) {
      setInput(suggestions[0] + ' ');
      setSuggestions([]);
    }
  }, [input, suggestions]);

  // ── Session config ───────────────────────────────────────────
  const sessionConfig: SessionConfig = {
    workdir: config.workdir,
    model: config.model,
    provider: config.provider,
  };

  return (
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
          onSetPermissionMode: (mode: PermissionMode) => {
            tools.setPermissionMode(mode);
            setPermissionMode(mode);
          },
          onClear: () => setMessages([]),
        };
        const result = await executeSlashCommand(cmd, args, ctx);
        if (result.message) pushToast(result.clearMessages ? 'info' : 'success', result.message);
        if (result.exit) { onExit?.(); exit(); }
        return result;
      }}
      onToggleActivity={() => setShowActivity((s) => !s)}
      onExit={() => { onExit?.(); exit(); }}
      onShowHelp={() => pushToast('info', 'Type /help for all commands')}
    />
  );
};
