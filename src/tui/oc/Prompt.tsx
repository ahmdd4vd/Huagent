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
 * Behavioral notes (matches OpenCode + standard readline):
 *   - Enter submits the prompt (single-line by default).
 *   - Alt+Enter OR Shift+Enter inserts a newline (multi-line). Ink
 *     exposes `key.meta` for Alt and (in newer versions) `key.shift`
 *     for Shift. We accept either.
 *   - Up/Down arrows navigate multi-line input when the buffer has
 *     more than one line; otherwise they navigate history.
 *   - Left/Right arrows move the cursor horizontally.
 *   - Ctrl+A / Home — move cursor to start of line.
 *   - Ctrl+E / End  — move cursor to end of line.
 *   - Ctrl+U — delete from cursor to start of line.
 *   - Ctrl+K — delete from cursor to end of line.
 *   - Ctrl+W — delete the previous word.
 *   - Tab — accept autocomplete suggestion (or no-op).
 *   - Ctrl+C — request exit (calls onExit if provided, else app exit).
 *   - Esc — close autocomplete (clears suggestions via onClearSuggestions).
 */

import React, { useState, useEffect, useRef } from 'react';
import { Box, Text, useInput, useApp } from 'ink';
import { theme, glyph, truncate } from './theme.js';
import { LeftBorder } from './border.js';
import { useSpinnerFrame, SPINNER_FRAMES } from './useSpinner.js';

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
  /** Called when user presses Esc with suggestions open. Parent should clear suggestions. */
  onClearSuggestions?: () => void;
  /** Width of the prompt (terminal columns). */
  width: number;
  /** Placeholder text when input is empty. */
  placeholder?: string;
  /** Called when user presses Ctrl+C. If not provided, exits the app. */
  onExit?: () => void;
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
  onClearSuggestions,
  width,
  placeholder = 'Ask, search, or run /help for commands',
  onExit,
}) => {
  const { exit } = useApp();
  const [cursor, setCursor] = useState(value.length);
  const [history, setHistory] = useState<string[]>([]);
  const [historyIdx, setHistoryIdx] = useState(-1);
  const [selectedSuggestion, setSelectedSuggestion] = useState(0);

  // Keep refs in sync so closures inside useInput can read the latest
  // values without re-subscribing to useInput on every keystroke.
  const valueRef = useRef(value);
  valueRef.current = value;
  const cursorRef = useRef(cursor);
  cursorRef.current = cursor;
  const suggestionsRef = useRef(suggestions);
  suggestionsRef.current = suggestions;
  const selectedSuggestionRef = useRef(selectedSuggestion);
  selectedSuggestionRef.current = selectedSuggestion;
  const historyRef = useRef(history);
  historyRef.current = history;
  const historyIdxRef = useRef(historyIdx);
  historyIdxRef.current = historyIdx;
  const disabledRef = useRef(disabled);
  disabledRef.current = disabled;

  // Reset suggestion selection when suggestions change.
  useEffect(() => {
    setSelectedSuggestion(0);
  }, [suggestions]);

  // ── Input handling ───────────────────────────────────────────
  useInput((inputChar, key) => {
    // ── Ctrl+C — request exit (with cleanup hook) ───────────────
    if (key.ctrl && inputChar === 'c') {
      if (onExit) onExit();
      else exit();
      return;
    }

    // ── Esc — close autocomplete if open, else no-op ────────────
    if (key.escape) {
      if (suggestionsRef.current.length > 0 && onClearSuggestions) {
        onClearSuggestions();
      }
      setSelectedSuggestion(0);
      return;
    }

    // ── Autocomplete navigation (when suggestions are shown) ────
    if (suggestionsRef.current.length > 0) {
      if (key.upArrow) {
        setSelectedSuggestion((i) => Math.max(0, i - 1));
        return;
      }
      if (key.downArrow) {
        setSelectedSuggestion((i) => Math.min(suggestionsRef.current.length - 1, i + 1));
        return;
      }
      if (key.tab) {
        const pick = suggestionsRef.current[selectedSuggestionRef.current];
        if (pick && onPickSuggestion) {
          onPickSuggestion(pick);
        }
        return;
      }
    }

    const currentValue = valueRef.current;
    const currentCursor = cursorRef.current;

    // ── Enter / Return — submit, OR insert newline if Alt/Shift held ──
    if (key.return) {
      // Alt+Enter OR Shift+Enter → insert newline (multi-line input).
      // Ink sends `key.meta=true` for Alt+Enter and (in newer versions)
      // `key.shift=true` for Shift+Enter. We accept either.
      if (key.meta || key.shift) {
        const next = currentValue.slice(0, currentCursor) + '\n' + currentValue.slice(currentCursor);
        onChange(next);
        setCursor((c) => c + 1);
        return;
      }
      // Plain Enter — submit (if not disabled and not empty).
      const text = currentValue.trim();
      if (!text || disabledRef.current) return;
      setHistory((h) => [...h, text].slice(-50));
      setHistoryIdx(-1);
      onSubmit(text);
      return;
    }

    // ── Left/Right arrows — horizontal cursor movement ──────────
    if (key.leftArrow) {
      setCursor((c) => Math.max(0, c - 1));
      return;
    }
    if (key.rightArrow) {
      setCursor((c) => Math.min(currentValue.length, c + 1));
      return;
    }

    // ── Ctrl+A / Home — move cursor to start of line ───────────
    // ── Ctrl+E / End  — move cursor to end of line ──────────────
    if ((key.ctrl && inputChar === 'a') || (key as any).home) {
      // Move to start of the current line (not start of buffer).
      const lineStart = currentValue.lastIndexOf('\n', currentCursor - 1) + 1;
      setCursor(lineStart);
      return;
    }
    if ((key.ctrl && inputChar === 'e') || (key as any).end) {
      // Move to end of the current line.
      const nextNl = currentValue.indexOf('\n', currentCursor);
      setCursor(nextNl === -1 ? currentValue.length : nextNl);
      return;
    }

    // ── Ctrl+U — delete from cursor to start of line ───────────
    if (key.ctrl && inputChar === 'u') {
      const lineStart = currentValue.lastIndexOf('\n', currentCursor - 1) + 1;
      if (currentCursor > lineStart) {
        const next = currentValue.slice(0, lineStart) + currentValue.slice(currentCursor);
        onChange(next);
        setCursor(lineStart);
      }
      return;
    }

    // ── Ctrl+K — delete from cursor to end of line ─────────────
    if (key.ctrl && inputChar === 'k') {
      const nextNl = currentValue.indexOf('\n', currentCursor);
      const lineEnd = nextNl === -1 ? currentValue.length : nextNl;
      if (currentCursor < lineEnd) {
        const next = currentValue.slice(0, currentCursor) + currentValue.slice(lineEnd);
        onChange(next);
      }
      return;
    }

    // ── Ctrl+W — delete the previous word ──────────────────────
    if (key.ctrl && inputChar === 'w') {
      // Find the start of the previous word. A "word" here is a run of
      // non-whitespace chars; we skip whitespace backwards first.
      let i = currentCursor - 1;
      while (i >= 0 && /\s/.test(currentValue[i])) i--;
      while (i >= 0 && !/\s/.test(currentValue[i])) i--;
      const wordStart = i + 1;
      if (wordStart < currentCursor) {
        const next = currentValue.slice(0, wordStart) + currentValue.slice(currentCursor);
        onChange(next);
        setCursor(wordStart);
      }
      return;
    }

    // ── Up/Down arrows — history navigation OR multi-line cursor ──
    // When the input is single-line, ↑/↓ navigate history.
    // When the input is multi-line, ↑/↓ move the cursor between lines.
    if (!currentValue.includes('\n')) {
      if (key.upArrow && historyRef.current.length > 0) {
        const nextIdx = historyIdxRef.current === -1
          ? historyRef.current.length - 1
          : Math.max(0, historyIdxRef.current - 1);
        const restored = historyRef.current[nextIdx] ?? '';
        setHistoryIdx(nextIdx);
        onChange(restored);
        setCursor(restored.length);
        return;
      }
      if (key.downArrow && historyIdxRef.current !== -1) {
        const nextIdx = historyIdxRef.current + 1;
        if (nextIdx >= historyRef.current.length) {
          setHistoryIdx(-1);
          onChange('');
          setCursor(0);
        } else {
          const restored = historyRef.current[nextIdx] ?? '';
          setHistoryIdx(nextIdx);
          onChange(restored);
          setCursor(restored.length);
        }
        return;
      }
    } else {
      // Multi-line cursor movement with arrows.
      if (key.upArrow) {
        const before = currentValue.slice(0, currentCursor);
        const nlIdx = before.lastIndexOf('\n');
        if (nlIdx !== -1) {
          // There's a previous line. Find its start and length.
          const prevLineStart = before.slice(0, nlIdx).lastIndexOf('\n') + 1;
          const col = currentCursor - nlIdx - 1; // column on current line
          const prevLineLen = nlIdx - prevLineStart;
          const newPos = prevLineStart + Math.min(col, prevLineLen);
          setCursor(newPos);
          return;
        }
        // No previous line — move to start of buffer.
        setCursor(0);
        return;
      }
      if (key.downArrow) {
        const after = currentValue.slice(currentCursor);
        const nlIdx = after.indexOf('\n');
        if (nlIdx !== -1) {
          // There's a next line. Find its start and length.
          const nextLineStart = currentCursor + nlIdx + 1;
          const before = currentValue.slice(0, currentCursor);
          const col = currentCursor - (before.lastIndexOf('\n') + 1);
          const nextNl = currentValue.indexOf('\n', nextLineStart);
          const nextLineEnd = nextNl === -1 ? currentValue.length : nextNl;
          const nextLineLen = nextLineEnd - nextLineStart;
          const newPos = nextLineStart + Math.min(col, nextLineLen);
          setCursor(newPos);
          return;
        }
        // No next line — move to end of buffer.
        setCursor(currentValue.length);
        return;
      }
    }

    // ── Backspace / Delete ──────────────────────────────────────
    if (key.backspace || key.delete) {
      if (currentCursor > 0) {
        // Removing one char (whether it's \n or a regular char).
        const next = currentValue.slice(0, currentCursor - 1) + currentValue.slice(currentCursor);
        onChange(next);
        setCursor((c) => Math.max(0, c - 1));
      }
      return;
    }

    // ── Regular character (including space, punctuation, etc.) ──
    // Ink fires this for printable ASCII chars. We skip ctrl/meta combos
    // (handled above) so we don't insert stray control chars into the buffer.
    if (inputChar && !key.ctrl && !key.meta && !key.return && !key.tab) {
      // Filter out non-printable chars (e.g. escape sequences that leaked
      // through). We accept any char in the printable ASCII range (0x20-0x7E)
      // plus common Unicode (Japanese, Korean, emoji, etc. — codepoint > 0x7F).
      const code = inputChar.codePointAt(0);
      if (code === undefined) return;
      const isPrintable = (code >= 0x20 && code <= 0x7e) || code > 0xa0;
      if (!isPrintable) return;
      const next = currentValue.slice(0, currentCursor) + inputChar + currentValue.slice(currentCursor);
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
          {suggestions.map((s, i) => {
            const isSelected = i === selectedSuggestion;
            return (
              <Box key={s.name}>
                <Text color={isSelected ? theme.primary : theme.textMuted}>
                  {isSelected ? '▶ ' : '  '}
                </Text>
                <Text color={isSelected ? theme.text : theme.textMuted} bold={isSelected}>
                  {truncate(s.name, 24)}
                </Text>
                {s.summary && (
                  <Text color={isSelected ? theme.textMuted : theme.border}>
                    {'  '}{truncate(s.summary, Math.max(10, width - s.name.length - 6))}
                  </Text>
                )}
              </Box>
            );
          })}
          <Text color={theme.textMuted} dimColor>  ↵ enter · tab accept · esc close · ↑↓ navigate</Text>
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
        {/* Textarea area */}
        <Box paddingLeft={1} paddingRight={1} paddingTop={0} paddingBottom={0}>
          <TextareaView
            value={value}
            cursor={cursor}
            disabled={disabled}
            placeholder={placeholder}
            width={Math.max(10, width - 6)}
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
        {truncate(placeholder, width)}
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

  // If the cursor is at the very end of the buffer and the last char is \n,
  // we end up with an extra empty line that should show a cursor.
  const isCursorOnEmptyLastLine =
    cursor === value.length && value.endsWith('\n');

  return (
    <Box flexDirection="column">
      {lines.map((line, i) => {
        const isCursorLine = i === cursorLine && !isCursorOnEmptyLastLine;
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
      {isCursorOnEmptyLastLine && (
        <Box>
          <Text color={theme.primary} inverse> </Text>
        </Box>
      )}
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
        <Text color={theme.textMuted} dimColor>· ↵ send · alt+↵ newline · ↑↓ history · tab complete · ctrl+c exit</Text>
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
