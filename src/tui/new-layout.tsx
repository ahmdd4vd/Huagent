/**
 * v4 NewLayout — The complete redesigned TUI layout.
 *
 * Modern, restrained, elegant — David asked for this.
 *
 * Layout (top → bottom):
 *   1. CompactHeader  (3 lines: wordmark, mode chips, separator)
 *   2. Toasts         (ephemeral notifications)
 *   3. SubagentPanel  (only when subagents exist)
 *   4. Main row:
 *        - Messages column (left, flexGrow)
 *        - Activity feed (right, fixed width, toggleable)
 *   5. Suggestions    (tab completion, only when typing)
 *   6. Input box      (with thinking/streaming states)
 *   7. StatusBar      (1 line footer)
 *
 * Width-aware: never overflows the terminal width.
 */

import React, { useState, useEffect } from 'react';
import { Box, Text, useInput, useApp } from 'ink';
import Spinner from 'ink-spinner';
import { theme, glyph, truncate } from './theme.js';
import { CompactHeader } from './compact-header.js';
import { ActivityFeed } from './activity-feed.js';
import { SubagentPanel, StatusBar, Toasts, type ToastItem } from './status.js';
export type { ToastItem };
import { getActivityStore, type Activity, type SubagentState } from './activity-store.js';

// ─── Types ─────────────────────────────────────────────────────

export interface SessionStats {
  tokens: number;
  cost: number;
  requests: number;
  steps: number;
}

export interface SessionConfig {
  workdir?: string;
  model?: string;
  provider?: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
}

export interface NewLayoutProps {
  messages: ChatMessage[];
  input: string;
  setInput: (s: string) => void;
  isThinking: boolean;
  isStreaming: boolean;
  streamingText: string;
  config: SessionConfig;
  permissionMode: string;
  autonomous: boolean;
  scope: string | null;
  showActivity: boolean;
  stats: SessionStats;
  toasts: ToastItem[];
  engine: string;
  onSubmit: (text: string) => Promise<void>;
  onExecuteSlash: (cmd: string, args: string[]) => Promise<{ message?: string; clear?: boolean; exit?: boolean }>;
  onToggleActivity: () => void;
  onExit: () => void;
  onShowHelp: () => void;
}

const SLASH_COMMANDS = [
  '/help', '/status', '/model', '/provider', '/autonomous', '/scope', '/permissions',
  '/memory', '/skills', '/sessions', '/resume', '/marketplace', '/agents', '/modes',
  '/activity', '/theme', '/diff', '/init', '/export', '/undo', '/doctor', '/clear',
  '/compact', '/cost', '/exit', '/shop', '/act', '/subs',
];

// ─── Component ─────────────────────────────────────────────────

export const NewLayout: React.FC<NewLayoutProps> = ({
  messages,
  input,
  setInput,
  isThinking,
  isStreaming,
  streamingText,
  config,
  permissionMode,
  autonomous,
  scope,
  showActivity,
  stats,
  toasts,
  engine,
  onSubmit,
  onExecuteSlash,
  onToggleActivity,
  onExit,
  onShowHelp,
}) => {
  const { exit } = useApp();
  const [frame, setFrame] = useState(0);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [subagents, setSubagents] = useState<SubagentState[]>([]);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [width, setWidth] = useState(process.stdout.columns || 100);

  // Spinner animation
  useEffect(() => {
    const t = setInterval(() => setFrame((f) => (f + 1) % 10), 80);
    return () => clearInterval(t);
  }, []);

  // Subscribe to activity store
  useEffect(() => {
    const store = getActivityStore();
    const apply = (s: { activities: Activity[]; subagents: SubagentState[] }) => {
      setActivities(s.activities);
      setSubagents(s.subagents);
    };
    apply(store.getState());
    const unsub = store.subscribe(apply);
    return unsub;
  }, []);

  // Resize tracking
  useEffect(() => {
    const onResize = () => setWidth(process.stdout.columns || 100);
    process.stdout.on('resize', onResize);
    return () => { process.stdout.off('resize', onResize); };
  }, []);

  // Keyboard
  useInput(async (inputChar, key) => {
    if (key.ctrl && inputChar === 'c') {
      onExit();
      exit();
      return;
    }
    if (key.ctrl && inputChar === 'l') {
      onToggleActivity();
      return;
    }
    if (key.return) {
      const text = input.trim();
      if (!text) return;
      setInput('');
      setSuggestions([]);
      if (text.startsWith('/')) {
        const parts = text.slice(1).split(/\s+/);
        const cmd = parts[0];
        const args = parts.slice(1);
        await onExecuteSlash(cmd, args);
        return;
      }
      await onSubmit(text);
      return;
    }
    if (key.tab) {
      if (suggestions.length > 0) {
        setInput(suggestions[0] + ' ');
        setSuggestions([]);
      }
      return;
    }
    if (key.backspace || key.delete) {
      setInput(input.slice(0, -1));
      return;
    }
    if (inputChar && !key.ctrl && !key.meta) {
      const next = input + inputChar;
      setInput(next);
      if (next.startsWith('/')) {
        setSuggestions(SLASH_COMMANDS.filter((c) => c.startsWith(next)).slice(0, 5));
      } else {
        setSuggestions([]);
      }
    }
  });

  const projectName = config?.workdir?.split('/').filter(Boolean).pop() || undefined;
  const contentWidth = Math.max(40, width);
  const activityWidth = showActivity ? Math.min(60, Math.max(30, Math.floor(contentWidth * 0.4))) : 0;
  const messageWidth = contentWidth - activityWidth - (showActivity ? 2 : 0);

  return (
    <Box flexDirection="column" width={contentWidth}>
      {/* Header (compact, 3 lines max) */}
      <CompactHeader
        model={config?.model || ''}
        permissionMode={permissionMode}
        autonomous={autonomous}
        scope={scope}
        engine={engine}
        projectName={projectName}
        width={contentWidth}
      />

      {/* Toasts (top, ephemeral) */}
      <Toasts toasts={toasts} width={Math.min(60, contentWidth - 2)} />

      {/* Subagent panel (when present) */}
      <Box paddingX={1}>
        <SubagentPanel subagents={subagents} width={contentWidth - 2} />
      </Box>

      {/* Main content: messages + activity feed */}
      <Box flexDirection="row">
        {/* Messages column (left) */}
        <Box flexDirection="column" flexGrow={1} paddingX={1} width={messageWidth}>
          {messages.slice(-30).map((msg) => (
            <MessageRow key={msg.id} message={msg} width={messageWidth - 4} />
          ))}

          {/* Streaming response */}
          {isStreaming && streamingText && (
            <Box marginY={1} flexDirection="column">
              <Box>
                <Text color={theme.primary} bold>✧ hua</Text>
                <Text color={theme.fgMuted}><Spinner type="dots" /> streaming</Text>
              </Box>
              <Box marginLeft={2}>
                <Text color={theme.fg}>{truncate(streamingText, messageWidth - 8)}</Text>
              </Box>
            </Box>
          )}

          {/* Thinking indicator */}
          {isThinking && !isStreaming && (
            <Box marginY={1}>
              <Text color={theme.primary}><Spinner type="dots" /></Text>
              <Text color={theme.fgMuted}> thinking…</Text>
            </Box>
          )}
        </Box>

        {/* Activity feed (right) — only when toggle is on */}
        {showActivity && (
          <Box flexDirection="column" width={activityWidth} borderStyle="round" borderColor={theme.border} paddingX={1}>
            <ActivityFeed
              activities={activities}
              width={activityWidth - 4}
              maxItems={20}
              frame={frame}
              title="activity"
            />
          </Box>
        )}
      </Box>

      {/* Tab completion suggestions */}
      {suggestions.length > 0 && (
        <Box paddingX={1}>
          <Text color={theme.lavender}>↪ </Text>
          {suggestions.map((s, i) => (
            <Text key={s} color={i === 0 ? theme.accent : theme.fgMuted}>
              {i > 0 ? '  ' : ''}{s}
            </Text>
          ))}
        </Box>
      )}

      {/* Input */}
      <Box borderStyle="round" borderColor={isStreaming ? theme.lavender : theme.primary} paddingX={1} marginX={1}>
        {isThinking || isStreaming ? (
          <Box>
            <Text color={theme.primary}><Spinner type="dots" /></Text>
            <Text color={theme.fgMuted}>  {autonomous ? 'Huagent is running autonomously' : 'Huagent is thinking'}…</Text>
          </Box>
        ) : (
          <Box>
            <Text color={theme.primary} bold>❯ </Text>
            <Text color={theme.fg}>{input || <Text color={theme.fgMuted}>try "build a CLI" or /help</Text>}</Text>
            <Text color={theme.accent}>▌</Text>
          </Box>
        )}
      </Box>

      {/* Status bar (footer) */}
      <Box paddingX={1} marginTop={0}>
        <StatusBar stats={stats} permissionMode={permissionMode} engine={engine} autonomous={autonomous} width={contentWidth - 2} />
      </Box>
    </Box>
  );
};

// ─── Compact message row ──────────────────────────────────────

const MessageRow: React.FC<{ message: ChatMessage; width: number }> = ({ message, width }) => {
  if (message.role === 'system') {
    return (
      <Box>
        <Text color={theme.fgSubtle}>  </Text>
        <Text color={theme.fgMuted}>{truncate(message.content, Math.max(40, width))}</Text>
      </Box>
    );
  }
  if (message.role === 'user') {
    return (
      <Box marginY={0}>
        <Text color={theme.sakura} bold>  ❯ </Text>
        <Text color={theme.fg}>{truncate(message.content, Math.max(40, width - 4))}</Text>
      </Box>
    );
  }
  return (
    <Box marginY={0} flexDirection="column">
      <Box>
        <Text color={theme.primary} bold>  ✧ hua</Text>
        <Text color={theme.fgMuted}> {formatTime(message.timestamp)}</Text>
      </Box>
      <Box marginLeft={4}>
        <Text color={theme.fg}>{truncate(message.content, Math.max(40, width - 6))}</Text>
      </Box>
    </Box>
  );
};

function formatTime(ts: number): string {
  const d = new Date(ts);
  if (isNaN(d.getTime())) return '--:--';
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
}
