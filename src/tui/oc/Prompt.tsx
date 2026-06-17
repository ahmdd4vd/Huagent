/**
 * Prompt — the OpenCode-style input box.
 *
 * Design (ported from packages/tui/src/component/prompt/index.tsx):
 *   - Left-border only (no full box around the textarea)
 *   - Background = backgroundElement (#1e1e1e)
 *   - Padding: 2 left/right, 1 top
 *   - Textarea grows from minHeight=1 to maxHeight (terminal-aware)
 *   - Below textarea: a status row showing agent · model · provider
 *   - Below the prompt: a status row with spinner + status text (when
 *     engine is running) or a "ready" hint
 *
 * Behavioral notes:
 *   - Enter submits the prompt (single-line by default).
 *   - Shift+Enter inserts a newline (multi-line). Ink doesn't natively
 *     distinguish Shift+Enter from Enter, so we use Alt+Enter / Ctrl+J
 *     as the multi-line keybinding (matches OpenCode's behavior on
 *     terminals that don't send Shift+Enter distinctly).
 *   - Up/Down arrows navigate multi-line input when the buffer has
 *     more than one line; otherwise they navigate history.
 *   - Tab triggers autocomplete.
 *   - Ctrl+C exits. Esc closes autocomplete.
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Box, Text, useInput, useApp } from 'ink';
import { theme, glyph, truncate } from './theme.js';
import { LeftBorder, EmptyBorder } from './border.js';

export interface PromptStatus {
  type: 'idle' | 'thinking' | 'streaming' | 'error' | 'retry';
  message?: string;
}

export interface PromptProps {
  value: string;
  onChange: (next: string) => void;
  onSubmit: (text: string) => void;
  /** Status shown in the status row below the textarea. */
  status?: PromptStatus;
  /** Disable input (e.g. while engine is running). */
  disabled?: boolean;
  /** Model label shown in the meta row. */
  modelLabel?: string;
  /** Provider label shown in the meta row. */
  providerLabel?: string;
  /** Agent label shown in the meta row. */
  agentLabel?: string;
  /** Variant label (e.g. "thinking", "fast"). */
  variantLabel?: string;
  /** Right-side content (e.g. keybind hints). */
  right?: React.ReactNode;
  /** Autocomplete suggestions to render above the prompt. */
  suggestions?: Array<{ name: string; summary?: string }>;
  /** Called when user picks a suggestion (Tab/Enter on highlighted item). */
  onPickSuggestion?: (item: { name: string; summary?: string }) => void;
  /** Width of the prompt (terminal columns). */
  width: number;
  /** Placeholder text when input is empty. */
  placeholder?: string;
}

export const Prompt: React.FC<PromptProps> = ({
  value,
  onChange,
  onSubmit,
  status = { type: 'idle' },
  disabled = false,
  modelLabel = 'huagent',
  providerLabel,
  agentLabel,
  variantLabel,
  right,
  suggestions = [],
  onPickSuggestion,
  width,
  placeholder = 'Ask, search, or run /help for commands',
}) => {
  const { exit } = useApp();
  const [cursor, setCursor] = useState(value.length);
  const [history, setHistory] = useState<string[]>([]);
  const [historyIdx, setHistoryIdx] = useState(-1);
  const [selectedSuggestion, setSelectedSuggestion] = useState(0);
  const valueRef = useRef(value);
  valueRef.current = value;
  const cursorRef = useRef(cursor);
  cursorRef.current = cursor;

  // Reset suggestion selection when suggestions change.
  useEffect(() => {
    setSelectedSuggestion(0);
  }, [suggestions.length]);

  // ── Input handling ───────────────────────────────────────────
  useInput((inputChar, key) => {
    if (key.ctrl && inputChar === 'c') {
      exit();
      return;
    }

    // Esc closes autocomplete (clears suggestions visually).
    if (key.escape) {
      setSelectedSuggestion(0);
      return;
    }

    // Autocomplete navigation when suggestions are shown.
    if (suggestions.length > 0) {
      if (key.upArrow) {
        setSelectedSuggestion((i) => Math.max(0, i - 1));
        return;
      }
      if (key.downArrow) {
        setSelectedSuggestion((i) => Math.min(suggestions.length - 1, i + 1));
        return;
      }
      if (key.tab) {
        const pick = suggestions[selectedSuggestion];
        if (pick && onPickSuggestion) {
          onPickSuggestion(pick);
        }
        return;
      }
    }

    // Submit on Enter (unless multi-line modifier is held).
    if (key.return) {
      // Ctrl+J or Alt+Enter → newline (multi-line input).
      // Ink doesn't expose shift directly, so we use ctrl+j (0x0a) as the
      // canonical "insert newline" keybinding.
      if (key.ctrl && inputChar === 'j') {
        const next = value.slice(0, cursor) + '\n' + value.slice(cursor);
        onChange(next);
        setCursor((c) => c + 1);
        return;
      }
      const text = value.trim();
      if (!text || disabled) return;
      setHistory((h) => [...h, text].slice(-50));
      setHistoryIdx(-1);
      onSubmit(text);
      return;
    }

    // History navigation (only when input is single-line).
    if (!value.includes('\n')) {
      if (key.upArrow && history.length > 0) {
        const nextIdx = historyIdx === -1 ? history.length - 1 : Math.max(0, historyIdx - 1);
        setHistoryIdx(nextIdx);
        onChange(history[nextIdx] ?? '');
        setCursor((history[nextIdx] ?? '').length);
        return;
      }
      if (key.downArrow && historyIdx !== -1) {
        const nextIdx = historyIdx + 1;
        if (nextIdx >= history.length) {
          setHistoryIdx(-1);
          onChange('');
          setCursor(0);
        } else {
          setHistoryIdx(nextIdx);
          onChange(history[nextIdx] ?? '');
          setCursor((history[nextIdx] ?? '').length);
        }
        return;
      }
    }

    // Multi-line cursor movement with arrows.
    if (value.includes('\n')) {
      if (key.upArrow) {
        const before = value.slice(0, cursor);
        const nlIdx = before.lastIndexOf('\n');
        if (nlIdx > 0) {
          const prevLineStart = before.slice(0, nlIdx).lastIndexOf('\n') + 1;
          const col = cursor - nlIdx - 1;
          const newPos = Math.max(prevLineStart, prevLineStart + Math.min(col, nlIdx - prevLineStart - 1));
          setCursor(newPos);
          return;
        }
      }
      if (key.downArrow) {
        const after = value.slice(cursor);
        const nlIdx = after.indexOf('\n');
        if (nlIdx !== -1) {
          const nextLineStart = cursor + nlIdx + 1;
          const before = value.slice(0, cursor);
          const col = cursor - (before.lastIndexOf('\n') + 1);
          const nextNl = value.indexOf('\n', nextLineStart);
          const nextLineEnd = nextNl === -1 ? value.length : nextNl;
          const newPos = Math.min(nextLineEnd, nextLineStart + col);
          setCursor(newPos);
          return;
        }
      }
    }

    // Backspace
    if (key.backspace || key.delete) {
      if (cursor > 0) {
        const removed = value[cursor - 1] === '\n' ? 1 : 1;
        const next = value.slice(0, cursor - removed) + value.slice(cursor);
        onChange(next);
        setCursor((c) => Math.max(0, c - removed));
      }
      return;
    }

    // Regular character
    if (inputChar && !key.ctrl && !key.meta) {
      const next = value.slice(0, cursor) + inputChar + value.slice(cursor);
      onChange(next);
      setCursor((c) => c + inputChar.length);
      return;
    }
  });

  // ── Render ─────────────────────────────────────────────────────
  const isActive = status.type === 'thinking' || status.type === 'streaming';
  const borderColor = disabled
    ? theme.borderSubtle
    : isActive
      ? theme.accent
      : theme.border;

  return (
    <Box flexDirection="column" width={width}>
      {/* Autocomplete suggestions (above prompt, OpenCode-style) */}
      {suggestions.length > 0 && (
        <Box flexDirection="column" paddingLeft={1} paddingBottom={0}>
          {suggestions.map((s, i) => (
            <Box key={s.name}>
              <Text color={i === selectedSuggestion ? theme.primary : theme.textMuted}>
                {i === selectedSuggestion ? '▶ ' : '  '}
              </Text>
              <Text color={i === selectedSuggestion ? theme.text : theme.textMuted} bold={i === selectedSuggestion}>
                {truncate(s.name, 24)}
              </Text>
              {s.summary && (
                <Text color={i === selectedSuggestion ? theme.textMuted : theme.border}>
                  {'  '}{truncate(s.summary, width - s.name.length - 6)}
                </Text>
              )}
            </Box>
          ))}
          <Text color={theme.textMuted} dimColor>  ↵ enter · tab accept · esc close</Text>
        </Box>
      )}

      {/* The prompt itself: left border + textarea + meta row */}
      <Box
        borderStyle={LeftBorder}
        borderColor={borderColor}
        flexDirection="column"
        paddingLeft={1}
        paddingRight={1}
        paddingTop={0}
        paddingBottom={0}
      >
        {/* Textarea area — use a Text with backgroundColor to get the OpenCode
            "elevated background" effect since Ink's Box doesn't support
            backgroundColor directly. */}
        <Box paddingLeft={1} paddingRight={1} paddingTop={0} paddingBottom={0}>
          <TextareaView
            value={value}
            cursor={cursor}
            disabled={disabled}
            placeholder={placeholder}
            width={width - 6}
          />
        </Box>

        {/* Meta row: agent · model · provider · variant (left) | right content */}
        <Box flexDirection="row" justifyContent="space-between" gap={1} paddingLeft={1} paddingRight={1} paddingTop={0}>
          <Box flexDirection="row" gap={1}>
            <Text color={theme.text} bold>{agentLabel ?? 'huagent'}</Text>
            <Text color={theme.textMuted}>·</Text>
            <Text color={theme.text}>{modelLabel}</Text>
            {providerLabel && (
              <>
                <Text color={theme.textMuted}> </Text>
                <Text color={theme.textMuted}>{providerLabel}</Text>
              </>
            )}
            {variantLabel && (
              <>
                <Text color={theme.textMuted}>·</Text>
                <Text color={theme.warning} bold>{variantLabel}</Text>
              </>
            )}
          </Box>
          {right && (
            <Box flexDirection="row" gap={1}>
              {right}
            </Box>
          )}
        </Box>
      </Box>

      {/* Status row below the prompt */}
      <Box paddingLeft={1} paddingTop={0}>
        <StatusRow status={status} disabled={disabled} />
      </Box>
    </Box>
  );
};

// ─── Textarea view (renders the multi-line input with cursor) ────

const TextareaView: React.FC<{
  value: string;
  cursor: number;
  disabled: boolean;
  placeholder: string;
  width: number;
}> = ({ value, cursor, disabled, placeholder, width }) => {
  if (!value) {
    return (
      <Text color={disabled ? theme.border : theme.textMuted}>
        {placeholder}
        <Text color={theme.text}> </Text>
      </Text>
    );
  }

  // Split into lines and find which line the cursor is on.
  const lines = value.split('\n');
  let charCount = 0;
  let cursorLine = 0;
  let cursorCol = 0;
  for (let i = 0; i < lines.length; i++) {
    const lineLen = lines[i].length;
    if (charCount + lineLen >= cursor) {
      cursorLine = i;
      cursorCol = cursor - charCount;
      break;
    }
    charCount += lineLen + 1; // +1 for the \n
  }

  return (
    <Box flexDirection="column">
      {lines.map((line, i) => {
        const isCursorLine = i === cursorLine;
        if (isCursorLine) {
          const before = line.slice(0, cursorCol);
          const at = line.slice(cursorCol, cursorCol + 1);
          const after = line.slice(cursorCol + 1);
          return (
            <Box key={i}>
              <Text color={disabled ? theme.textMuted : theme.text}>{before}</Text>
              <Text color={theme.primary} inverse={at === ' ' || at === ''}>{at || ' '}</Text>
              <Text color={disabled ? theme.textMuted : theme.text}>{after}</Text>
            </Box>
          );
        }
        return (
          <Box key={i}>
            <Text color={disabled ? theme.textMuted : theme.text}>{line || ' '}</Text>
          </Box>
        );
      })}
    </Box>
  );
};

// ─── Status row (below the prompt) ───────────────────────────────

const StatusRow: React.FC<{ status: PromptStatus; disabled: boolean }> = ({ status, disabled }) => {
  const frame = useSpinnerFrame();
  if (status.type === 'idle' || disabled) {
    return (
      <Box flexDirection="row" gap={1}>
        <Text color={theme.textMuted}>  ready</Text>
        <Text color={theme.textMuted} dimColor>· ↵ send · ctrl+j newline · ↑↓ history · tab complete</Text>
      </Box>
    );
  }
  if (status.type === 'thinking') {
    return (
      <Box flexDirection="row" gap={1}>
        <Text color={theme.primary}>{SPINNER_FRAMES[frame]}</Text>
        <Text color={theme.textMuted}>thinking{glyph.ellipsis}</Text>
      </Box>
    );
  }
  if (status.type === 'streaming') {
    return (
      <Box flexDirection="row" gap={1}>
        <Text color={theme.primary}>{SPINNER_FRAMES[frame]}</Text>
        <Text color={theme.textMuted}>writing{glyph.ellipsis}</Text>
      </Box>
    );
  }
  if (status.type === 'error') {
    return (
      <Box flexDirection="row" gap={1}>
        <Text color={theme.error}>{glyph.fail}</Text>
        <Text color={theme.error}>{status.message ?? 'error'}</Text>
      </Box>
    );
  }
  if (status.type === 'retry') {
    return (
      <Box flexDirection="row" gap={1}>
        <Text color={theme.warning}>{glyph.warn}</Text>
        <Text color={theme.warning}>{status.message ?? 'retrying'}</Text>
      </Box>
    );
  }
  return null;
};

// ─── Helpers ─────────────────────────────────────────────────────

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

function useSpinnerFrame(): number {
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setFrame((f) => (f + 1) % SPINNER_FRAMES.length), 80);
    return () => clearInterval(t);
  }, []);
  return frame;
}
