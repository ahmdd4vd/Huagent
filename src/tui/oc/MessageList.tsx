/**
 * MessageList — OpenCode-style chat message rendering.
 *
 * Design (matching OpenCode):
 *   - Messages flow naturally: user → assistant text → tool call → result → more text
 *   - Streaming text appears INLINE as tokens arrive (not in a separate section)
 *   - Tool calls render as compact inline cards:
 *       ⠋ read  src/index.ts
 *       ✓ read  src/index.ts  0.3s
 *         42 lines
 *   - Tool results are collapsible (show first 3 lines, then "...")
 *   - No separate "thinking" section — spinner is inline with streaming text
 *   - Timestamps optional
 */

import React, { useEffect } from 'react';
import { Box, Text } from 'ink';
import { theme, truncate } from './theme.js';
import { useSpinnerFrame, SPINNER_FRAMES } from './useSpinner.js';

export interface ToolCallInfo {
  name: string;
  status: 'running' | 'success' | 'error' | 'skipped';
  durationMs?: number;
  args?: Record<string, any>;
  result?: any;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  toolCalls?: ToolCallInfo[];
  streaming?: boolean;
}

export interface MessageListProps {
  messages: ChatMessage[];
  width: number;
  maxVisible?: number;
  showTimestamps?: boolean;
  streamingText?: string;
  isThinking?: boolean;
  modelLabel?: string;
}

export const MessageList: React.FC<MessageListProps> = ({
  messages,
  width,
  maxVisible = 100,
  showTimestamps = false,
  streamingText = '',
  isThinking = false,
  modelLabel = 'huagent',
}) => {
  const visibleMessages = messages.slice(-maxVisible);

  return (
    <Box flexDirection="column" gap={1} paddingBottom={1}>
      {visibleMessages.map((msg) => (
        <MessageItem
          key={msg.id}
          message={msg}
          width={width}
          showTimestamp={showTimestamps}
          modelLabel={modelLabel}
        />
      ))}

      {/* In-flight assistant response — streaming text + thinking spinner */}
      {(isThinking || streamingText.length > 0) && (
        <StreamingMessage
          text={streamingText}
          isThinking={isThinking}
          width={width}
          modelLabel={modelLabel}
        />
      )}
    </Box>
  );
};

// ─── Single message ──────────────────────────────────────────────

const MessageItem: React.FC<{
  message: ChatMessage;
  width: number;
  showTimestamp: boolean;
  modelLabel: string;
}> = ({ message, width, showTimestamp, modelLabel }) => {
  if (message.role === 'system') {
    return (
      <Box>
        <Text color={theme.textMuted}>  </Text>
        <Text color={theme.textMuted} italic>{truncate(message.content, width - 4)}</Text>
      </Box>
    );
  }

  if (message.role === 'user') {
    return (
      <Box flexDirection="column">
        <Box>
          <Text color={theme.primary} bold>› </Text>
          <Text color={theme.text} wrap="wrap">{message.content}</Text>
        </Box>
        {showTimestamp && (
          <Box marginLeft={2}>
            <Text color={theme.textMuted} dimColor>{formatTime(message.timestamp)}</Text>
          </Box>
        )}
      </Box>
    );
  }

  // Assistant message — render content + inline tool calls
  return (
    <Box flexDirection="column">
      <Box>
        <Text color={theme.accent} bold>{modelLabel}</Text>
        {showTimestamp && (
          <Text color={theme.textMuted}> {formatTime(message.timestamp)}</Text>
        )}
      </Box>
      {message.content && (
        <Box marginLeft={2}>
          <Text color={theme.text} wrap="wrap">{message.content}</Text>
        </Box>
      )}
      {message.toolCalls && message.toolCalls.length > 0 && (
        <Box marginLeft={2} marginTop={0} flexDirection="column" gap={0}>
          {message.toolCalls.map((tc, i) => (
            <ToolCard key={i} call={tc} width={Math.max(20, width - 4)} />
          ))}
        </Box>
      )}
    </Box>
  );
};

// ─── Streaming message (in-flight) ───────────────────────────────

const StreamingMessage: React.FC<{
  text: string;
  isThinking: boolean;
  width: number;
  modelLabel: string;
}> = ({ text, isThinking, width, modelLabel }) => {
  const frame = useSpinnerFrame();

  return (
    <Box flexDirection="column">
      <Box>
        <Text color={theme.accent} bold>{modelLabel}</Text>
        <Text color={theme.primary}> {SPINNER_FRAMES[frame]}</Text>
        {!text && isThinking && (
          <Text color={theme.textMuted}> thinking…</Text>
        )}
      </Box>
      {text && (
        <Box marginLeft={2}>
          <Text color={theme.text} wrap="wrap">{text}</Text>
        </Box>
      )}
    </Box>
  );
};

// ─── Tool card (compact, inline — OpenCode style) ────────────────

const ToolCard: React.FC<{
  call: ToolCallInfo;
  width: number;
}> = ({ call, width }) => {
  const frame = useSpinnerFrame();

  // Icon + color based on status
  let icon: string;
  let color: string;
  switch (call.status) {
    case 'running':
      icon = SPINNER_FRAMES[frame];
      color = theme.primary;
      break;
    case 'success':
      icon = '✓';
      color = theme.success;
      break;
    case 'error':
      icon = '✗';
      color = theme.error;
      break;
    case 'skipped':
      icon = '⊘';
      color = theme.textMuted;
      break;
  }

  // Build the summary line: icon + tool name + key arg + duration
  const duration = call.durationMs ? ` ${(call.durationMs / 1000).toFixed(1)}s` : '';
  const keyArg = getToolSummaryArg(call);
  const summaryText = keyArg ? `  ${call.name}  ${truncate(keyArg, width - call.name.length - duration.length - 6)}` : `  ${call.name}`;

  // Build result preview (first 3 lines for successful tools)
  const resultPreview = call.status === 'success' && call.result
    ? formatToolResult(call.name, call.result, 3)
    : call.status === 'error' && call.result
      ? formatToolResult(call.name, call.result, 3)
      : null;

  return (
    <Box flexDirection="column">
      <Box>
        <Text color={color}>{icon}</Text>
        <Text color={theme.textMuted}>{summaryText}</Text>
        <Text color={theme.textMuted}>{duration}</Text>
      </Box>
      {resultPreview && (
        <Box marginLeft={4} flexDirection="column">
          {resultPreview.split('\n').slice(0, 3).map((line, i) => (
            <Box key={i}>
              <Text color={theme.textMuted} dimColor>  {truncate(line, width - 6)}</Text>
            </Box>
          ))}
          {resultPreview.split('\n').length > 3 && (
            <Text color={theme.textMuted} dimColor>  …{resultPreview.split('\n').length - 3} more lines</Text>
          )}
        </Box>
      )}
    </Box>
  );
};

// ─── Helpers ─────────────────────────────────────────────────────

/**
 * Get the most useful argument for display in the tool summary line.
 * e.g. read(path) → show path, bash(command) → show command, write(path) → show path
 */
function getToolSummaryArg(call: ToolCallInfo): string {
  const args = call.args || {};
  switch (call.name) {
    case 'read':
    case 'write':
    case 'edit':
      return args.path || '';
    case 'bash':
      return truncate(args.command || '', 60);
    case 'grep':
      return args.pattern || '';
    case 'search':
      return args.pattern || '';
    case 'web':
      return args.query || '';
    case 'subagent':
      return args.type || args.task || '';
    case 'memory':
      return args.action || '';
    default:
      // Show first string value
      const firstVal = Object.values(args).find(v => typeof v === 'string');
      return firstVal ? String(firstVal) : '';
  }
}

/**
 * Format tool result for inline preview.
 * Shows a few lines of the result so the user can see what happened
 * without expanding the full output.
 */
function formatToolResult(toolName: string, result: any, maxLines: number): string {
  if (!result) return '';

  // For read tool — show file content preview
  if (toolName === 'read' && typeof result === 'string') {
    return result;
  }

  // For bash — show stdout
  if (toolName === 'bash' && typeof result === 'object') {
    const stdout = result.stdout || result.content || '';
    const stderr = result.stderr || '';
    if (stdout) return stdout;
    if (stderr) return stderr;
    return '';
  }

  // For grep/search — show matches
  if ((toolName === 'grep' || toolName === 'search') && typeof result === 'object') {
    const matches = result.matches || [];
    if (matches.length === 0) return 'No matches';
    return matches.slice(0, maxLines).map((m: any) =>
      `${m.file || ''}:${m.line || ''} ${m.content || ''}`
    ).join('\n');
  }

  // For write/edit — show confirmation
  if (toolName === 'write' || toolName === 'edit') {
    return typeof result === 'string' ? result : 'File updated';
  }

  // Fallback — stringify
  if (typeof result === 'string') return result;
  try {
    return JSON.stringify(result, null, 2);
  } catch {
    return String(result);
  }
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  if (isNaN(d.getTime())) return '--:--';
  const h = d.getHours().toString().padStart(2, '0');
  const m = d.getMinutes().toString().padStart(2, '0');
  return `${h}:${m}`;
}
