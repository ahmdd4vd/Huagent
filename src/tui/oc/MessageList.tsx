/**
 * MessageList — scrollable list of chat messages.
 *
 * OpenCode-inspired design:
 *   - No "hua" mascot character
 *   - No emoji decorations
 *   - User messages: prefixed with a subtle "» " marker, otherwise plain text
 *   - Assistant messages: prefixed with the model name in muted color
 *   - Tool calls: rendered inline with a collapsible-looking status badge
 *   - Timestamps optional (small, muted, right-aligned)
 *
 * Since Ink doesn't have a native scrollbox, we render the last N messages
 * (configurable) and auto-scroll to bottom on new messages.
 */

import React, { useEffect, useRef } from 'react';
import { Box, Text, useInput } from 'ink';
import { theme, glyph, truncate } from './theme.js';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  /** Optional tool-call metadata for assistant messages. */
  toolCalls?: Array<{
    name: string;
    status: 'running' | 'success' | 'error' | 'skipped';
    durationMs?: number;
    summary?: string;
  }>;
  /** Streaming flag for in-flight assistant messages. */
  streaming?: boolean;
}

export interface MessageListProps {
  messages: ChatMessage[];
  width: number;
  /** Max number of messages to render (older ones are pruned). */
  maxVisible?: number;
  /** Show timestamp next to each message. */
  showTimestamps?: boolean;
  /** Streaming text for in-flight assistant response. */
  streamingText?: string;
  /** Whether the engine is currently thinking (no streaming text yet). */
  isThinking?: boolean;
  /** Currently selected model name (for assistant message labels). */
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
  // Track the bottom of the list so we can auto-scroll.
  // Ink doesn't have a real scroll container, but by always rendering the
  // last N messages and putting the most recent at the bottom, the
  // terminal's native scrollback buffer handles the rest.
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

      {/* In-flight assistant response */}
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

// ─── Single message rendering ────────────────────────────────────

const MessageItem: React.FC<{
  message: ChatMessage;
  width: number;
  showTimestamp: boolean;
  modelLabel: string;
}> = ({ message, width, showTimestamp, modelLabel }) => {
  if (message.role === 'system') {
    // System messages are very subdued.
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
          <Text color={theme.primary} bold>{glyph.arrowR} </Text>
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

  // Assistant message
  return (
    <Box flexDirection="column">
      <Box>
        <Text color={theme.accent} bold>{modelLabel}</Text>
        {showTimestamp && (
          <Text color={theme.textMuted}> {formatTime(message.timestamp)}</Text>
        )}
      </Box>
      <Box marginLeft={2} flexDirection="column">
        <Text color={theme.text} wrap="wrap">{message.content}</Text>
        {message.toolCalls && message.toolCalls.length > 0 && (
          <Box marginTop={1} flexDirection="column" gap={0}>
            {message.toolCalls.map((tc, i) => (
              <ToolCallBadge key={i} call={tc} width={width - 4} />
            ))}
          </Box>
        )}
      </Box>
    </Box>
  );
};

// ─── Streaming message (in-flight assistant response) ────────────

const StreamingMessage: React.FC<{
  text: string;
  isThinking: boolean;
  width: number;
  modelLabel: string;
}> = ({ text, isThinking, width, modelLabel }) => {
  // Use a frame counter to animate the braille spinner.
  const frame = useSpinnerFrame();

  return (
    <Box flexDirection="column">
      <Box>
        <Text color={theme.accent} bold>{modelLabel}</Text>
        <Text color={theme.textMuted}> </Text>
        <Text color={theme.primary}>{SPINNER_FRAMES[frame]}</Text>
        <Text color={theme.textMuted}>
          {' '}
          {isThinking ? 'thinking' : 'writing'}
          {glyph.ellipsis}
        </Text>
      </Box>
      {text.length > 0 && (
        <Box marginLeft={2}>
          <Text color={theme.text} wrap="wrap">{truncate(text, width * 8)}</Text>
        </Box>
      )}
    </Box>
  );
};

// ─── Tool call badge (compact, inline) ───────────────────────────

const ToolCallBadge: React.FC<{
  call: {
    name: string;
    status: 'running' | 'success' | 'error' | 'skipped';
    durationMs?: number;
    summary?: string;
  };
  width: number;
}> = ({ call, width }) => {
  const frame = useSpinnerFrame();
  let icon: string = glyph.pending;
  let color: string = theme.textMuted;

  switch (call.status) {
    case 'running':
      icon = SPINNER_FRAMES[frame];
      color = theme.primary;
      break;
    case 'success':
      icon = glyph.success;
      color = theme.success;
      break;
    case 'error':
      icon = glyph.fail;
      color = theme.error;
      break;
    case 'skipped':
      icon = glyph.skip;
      color = theme.textMuted;
      break;
  }

  const duration =
    call.durationMs !== undefined ? ` ${(call.durationMs / 1000).toFixed(1)}s` : '';
  const summary = call.summary ? ` ${truncate(call.summary, width - call.name.length - duration.length - 4)}` : '';

  return (
    <Box>
      <Text color={color}>{icon} </Text>
      <Text color={theme.text} bold>{call.name}</Text>
      <Text color={theme.textMuted}>{duration}</Text>
      <Text color={theme.textMuted}>{summary}</Text>
    </Box>
  );
};

// ─── Helpers ─────────────────────────────────────────────────────

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

/**
 * useSpinnerFrame — a tiny hook that cycles through spinner frames.
 * We re-implement this locally so the new oc/ components don't depend
 * on the old theme.ts (which we're deprecating).
 */
function useSpinnerFrame(): number {
  const [frame, setFrame] = React.useState(0);
  useEffect(() => {
    const t = setInterval(() => setFrame((f) => (f + 1) % SPINNER_FRAMES.length), 80);
    return () => clearInterval(t);
  }, []);
  return frame;
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  if (isNaN(d.getTime())) return '--:--';
  const h = d.getHours().toString().padStart(2, '0');
  const m = d.getMinutes().toString().padStart(2, '0');
  return `${h}:${m}`;
}
