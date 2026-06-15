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
import { Picker, type PickerItem } from './picker.js';
import { QuestionPrompt } from './question-prompt.js';
import { PlanMode } from './plan-mode.js';
import { ToolConfirmation } from './tool-confirmation.js';
import { SessionResume } from './session-resume.js';
import { completeSlashCommand } from '../slash-commands.js';

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

export interface PickerState {
  title: string;
  items: PickerItem[];
  onSelect: (id: string) => void;
  onCancel: () => void;
}

export type DialogState =
  | { type: 'picker'; picker: PickerState }
  | { type: 'question'; request: any; onSubmit: (answers: string[][]) => void; onCancel: () => void }
  | { type: 'plan'; plan: any; onApprove: () => void; onReject: () => void; onEdit: (feedback: string) => void }
  | { type: 'permission'; request: any; onDecide: (d: any) => void }
  | { type: 'session'; sessions: any[]; onSelect: (id: string) => void; onCancel: () => void }
  | null;

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
  // Picker integration
  picker: PickerState | null;
  onOpenProviderPicker: () => void;
  onOpenModelPicker: () => void;
  onOpenScopePicker: () => void;
  onOpenPermissionPicker: () => void;
  onOpenCommandPalette: () => void;
  onOpenSessionResume: () => void;
  // New dialogs (question, plan, permission, session-resume)
  dialog: DialogState;
}

// ─── Slash command suggestions (autocomplete, OpenCode-style) ──
// The completion logic lives in src/slash-commands.ts. We only import the
// helper here so the suggestions pop up as the user types.

// All known slash command names (for autocomplete-on-Enter detection).
// Kept in sync with SLASH_COMMANDS in src/slash-commands.ts.
const SLASH_COMMANDS_LIST = [
  'help', 'status', 'cost', 'clear', 'compact', 'model', 'models', 'provider',
  'providers', 'autonomous', 'scope', 'permissions', 'memory', 'skills', 'init',
  'diff', 'version', 'marketplace', 'agents', 'modes', 'activity', 'sessions',
  'resume', 'export', 'undo', 'doctor', 'theme', 'exit',
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
  picker,
  onOpenProviderPicker,
  onOpenModelPicker,
  onOpenScopePicker,
  onOpenPermissionPicker,
  onOpenCommandPalette,
  onOpenSessionResume,
  dialog,
}) => {
  const { exit } = useApp();
  const [frame, setFrame] = useState(0);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [subagents, setSubagents] = useState<SubagentState[]>([]);
  const [suggestions, setSuggestions] = useState<Array<{ name: string; summary: string; aliases: string[] }>>([]);
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
    // ── Global shortcuts (work whether picker is open or not) ────
    if (key.ctrl && inputChar === 'c') {
      onExit();
      exit();
      return;
    }
    if (key.ctrl && inputChar === 'l') {
      onToggleActivity();
      return;
    }
    // Esc closes picker OR dialog
    if (key.escape) {
      if (picker) {
        picker.onCancel();
        return;
      }
      if (dialog) {
        // For picker-typed dialog, cancel via picker.onCancel
        if (dialog.type === 'picker' && (dialog as any).picker) {
          (dialog as any).picker.onCancel();
        } else if (dialog.type === 'plan') {
          (dialog as any).onReject?.();
        } else if (dialog.type === 'permission') {
          (dialog as any).onDecide?.('deny');
        } else if ((dialog as any).onCancel) {
          (dialog as any).onCancel();
        }
        return;
      }
    }
    // Ctrl+K — command palette (works as inputChar 'k' in raw mode)
    if (key.ctrl && (inputChar === 'k' || key.tab)) {
      onOpenCommandPalette();
      return;
    }
    // Ctrl+P — provider picker (Ctrl+P is also up-arrow in some terminals,
    // so we guard with !key.upArrow)
    if (key.ctrl && inputChar === 'p' && !key.upArrow) {
      onOpenProviderPicker();
      return;
    }
    // Ctrl+T — model picker. We use Ctrl+T (0x14) instead of Ctrl+M
    // (0x0D) because Ctrl+M is the same as Enter in terminal control codes
    // and Ink's readline interprets it as such.
    if (key.ctrl && inputChar === 't') {
      onOpenModelPicker();
      return;
    }
    // Ctrl+E — scope picker. We use Ctrl+E (0x05) instead of Ctrl+S
    // (0x13) because Ctrl+S is XOFF (software flow control) and many
    // terminals intercept it before the application sees it.
    if (key.ctrl && inputChar === 'e') {
      onOpenScopePicker();
      return;
    }
    // Ctrl+Shift+P — permission picker (works on most terminals)
    if (key.ctrl && key.shift && (inputChar === 'p' || inputChar === 'P')) {
      onOpenPermissionPicker();
      return;
    }
    // Ctrl+R — session resume (works in raw mode; bash readline's
    // reverse-search doesn't apply since ink sets raw mode)
    if (key.ctrl && inputChar === 'r' && !key.shift) {
      onOpenSessionResume();
      return;
    }
    // If picker is open, don't process other input (picker handles it)
    if (picker) {
      return;
    }
    if (key.return) {
      const text = input.trim();
      if (!text) return;
      // ── Autocomplete + execute on Enter (OpenCode-style):
      // ── if input is a partial slash command, expand to top match
      // ── and immediately execute it.
      if (text.startsWith('/') && suggestions.length > 0) {
        const cmdOnly = text.slice(1).split(/\s+/)[0];
        const isFullCommand = SLASH_COMMANDS_LIST.includes(cmdOnly);
        if (!isFullCommand) {
          // Use top suggestion as the actual command to run
          const top = suggestions[0];
          const topCmdName = top.name.slice(1); // strip leading "/"
          const args = text.slice(1 + cmdOnly.length).trim().split(/\s+/).filter(Boolean);
          setInput('');
          setSuggestions([]);
          await onExecuteSlash(topCmdName, args);
          return;
        }
      }
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
        setInput(suggestions[0].name + ' ');
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
        setSuggestions(completeSlashCommand(next).slice(0, 5));
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

      {/* Dialog overlay (replaces input when active) */}
      {dialog ? (
        <Box marginX={1} marginY={1}>
          {dialog.type === 'picker' && dialog.picker ? (
            <Picker
              title={dialog.picker.title}
              items={dialog.picker.items}
              onSelect={dialog.picker.onSelect}
              onCancel={dialog.picker.onCancel}
              width={contentWidth - 4}
            />
          ) : dialog.type === 'question' ? (
            <QuestionPrompt
              request={dialog.request}
              onSubmit={dialog.onSubmit}
              onCancel={dialog.onCancel}
              width={contentWidth - 4}
            />
          ) : dialog.type === 'plan' ? (
            <PlanMode
              plan={dialog.plan}
              onApprove={dialog.onApprove}
              onReject={dialog.onReject}
              onEdit={dialog.onEdit}
              width={contentWidth - 4}
            />
          ) : dialog.type === 'permission' ? (
            <ToolConfirmation
              request={dialog.request}
              onDecide={dialog.onDecide}
              width={contentWidth - 4}
            />
          ) : dialog.type === 'session' ? (
            <SessionResume
              sessions={dialog.sessions}
              onSelect={dialog.onSelect}
              onCancel={dialog.onCancel}
              width={contentWidth - 4}
            />
          ) : null}
        </Box>
      ) : picker ? (
        <Box marginX={1} marginY={1}>
          <Picker
            title={picker.title}
            items={picker.items}
            onSelect={picker.onSelect}
            onCancel={picker.onCancel}
            width={contentWidth - 4}
          />
        </Box>
      ) : (
        <>
          {/* Tab completion suggestions — OpenCode-style: name + summary */}
          {suggestions.length > 0 && (
            <Box paddingX={1} flexDirection="column">
              {suggestions.map((s, i) => (
                <Box key={s.name}>
                  <Text color={theme.lavender}>{i === 0 ? '▶ ' : '  '}</Text>
                  <Text color={i === 0 ? theme.accent : theme.fg} bold={i === 0}>
                    {s.name.padEnd(16)}
                  </Text>
                  <Text color={i === 0 ? theme.fgMuted : theme.fgSubtle}>{s.summary}</Text>
                  {s.aliases.length > 0 && i === 0 && (
                    <Text color={theme.fgSubtle}>  ({s.aliases.join(', ')})</Text>
                  )}
                </Box>
              ))}
              <Box marginTop={0}>
                <Text color={theme.fgSubtle}>  ↪ Tab complete · Enter runs top match</Text>
              </Box>
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
        </>
      )}

      {/* Keyboard shortcut hint */}
      {!picker && !dialog && (
        <Box paddingX={1}>
          <Text color={theme.fgSubtle} dimColor>
            {theme.fgSubtle && '⌨  '}
            <Text color={theme.fgSubtle}>Ctrl+P</Text> provider
            {'  ·  '}
            <Text color={theme.fgSubtle}>Ctrl+T</Text> model
            {'  ·  '}
            <Text color={theme.fgSubtle}>Ctrl+E</Text> scope
            {'  ·  '}
            <Text color={theme.fgSubtle}>Ctrl+R</Text> resume
            {'  ·  '}
            <Text color={theme.fgSubtle}>Ctrl+K</Text> palette
            {'  ·  '}
            <Text color={theme.fgSubtle}>Ctrl+L</Text> activity
            {'  ·  '}
            <Text color={theme.fgSubtle}>?</Text> help
          </Text>
        </Box>
      )}

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
