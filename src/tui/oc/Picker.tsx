/**
 * Picker — fuzzy-searchable list dialog (OpenCode-style).
 *
 * Used for picking providers, models, sessions, files, etc.
 *
 * Design:
 *   - Rounded border, accent-colored
 *   - Title at top
 *   - Search input below title (filter the list)
 *   - Scrollable list of items (max 10 visible)
 *   - Footer with hint
 *
 * Behavior:
 *   - Type to filter
 *   - ↑/↓ to navigate
 *   - Enter to select
 *   - Esc / Ctrl+C to cancel
 *   - Ctrl+A / Ctrl+E — move cursor to start / end of query
 *   - Ctrl+U — clear query
 *   - Ctrl+W — delete previous word
 *   - Home / End — move cursor to start / end of query
 */

import React, { useState, useEffect, useRef } from 'react';
import { Box, Text, useInput } from 'ink';
import { theme, glyph, truncate } from './theme.js';
import { RoundedBorder } from './border.js';

export interface PickerItem {
  id: string;
  label: string;
  description?: string;
  /** Optional icon/emoji prefix. */
  icon?: string;
  /** Optional right-aligned hint (e.g. "default", "current"). */
  hint?: string;
}

export interface PickerProps {
  title: string;
  items: PickerItem[];
  onSelect: (id: string) => void;
  onCancel: () => void;
  width?: number;
  maxVisible?: number;
  placeholder?: string;
}

export const Picker: React.FC<PickerProps> = ({
  title,
  items,
  onSelect,
  onCancel,
  width = 60,
  maxVisible = 10,
  placeholder = 'Type to filter',
}) => {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);

  // Filter items by query (case-insensitive substring match on label + description).
  const filtered = items.filter((it) => {
    if (!query) return true;
    const q = query.toLowerCase();
    return (
      it.label.toLowerCase().includes(q) ||
      (it.description?.toLowerCase().includes(q) ?? false) ||
      it.id.toLowerCase().includes(q)
    );
  });

  // Reset selection when query changes.
  useEffect(() => {
    setSelected(0);
  }, [query]);

  // Ensure selected index is in range when filtered list changes.
  useEffect(() => {
    if (selected >= filtered.length) {
      setSelected(Math.max(0, filtered.length - 1));
    }
  }, [filtered.length, selected]);

  // Keep refs in sync so useInput closures read fresh values without
  // re-subscribing on every keystroke.
  const filteredRef = useRef(filtered);
  filteredRef.current = filtered;
  const selectedRef = useRef(selected);
  selectedRef.current = selected;

  useInput((inputChar, key) => {
    // Esc / Ctrl+C — cancel.
    if (key.escape || (key.ctrl && inputChar === 'c')) {
      onCancel();
      return;
    }

    // ↑ — move selection up.
    if (key.upArrow) {
      setSelected((s) => Math.max(0, s - 1));
      return;
    }

    // ↓ — move selection down.
    if (key.downArrow) {
      setSelected((s) => Math.min(filteredRef.current.length - 1, s + 1));
      return;
    }

    // Enter — select current item.
    if (key.return) {
      const item = filteredRef.current[selectedRef.current];
      if (item) onSelect(item.id);
      return;
    }

    // Ctrl+A / Home — move cursor to start of query.
    if ((key.ctrl && inputChar === 'a') || (key as any).home) {
      // The query is just a string — cursor is always at the end for our
      // simple input model. For now we don't track a separate cursor
      // position in the picker query (it's a filter, not a buffer), so
      // Ctrl+A is a no-op. We still consume the keystroke so it doesn't
      // insert a stray 'a' into the query.
      return;
    }

    // Ctrl+E / End — move cursor to end of query (no-op for same reason).
    if ((key.ctrl && inputChar === 'e') || (key as any).end) {
      return;
    }

    // Ctrl+U — clear the query.
    if (key.ctrl && inputChar === 'u') {
      setQuery('');
      return;
    }

    // Ctrl+W — delete the previous word in the query.
    if (key.ctrl && inputChar === 'w') {
      setQuery((q) => {
        let i = q.length - 1;
        while (i >= 0 && /\s/.test(q[i])) i--;
        while (i >= 0 && !/\s/.test(q[i])) i--;
        return q.slice(0, i + 1);
      });
      return;
    }

    // Backspace / Delete — remove last char.
    if (key.backspace || key.delete) {
      setQuery((q) => q.slice(0, -1));
      return;
    }

    // Regular character — append to query.
    if (inputChar && !key.ctrl && !key.meta && !key.return && !key.tab && !key.upArrow && !key.downArrow) {
      const code = inputChar.codePointAt(0);
      if (code === undefined) return;
      const isPrintable = (code >= 0x20 && code <= 0x7e) || code > 0xa0;
      if (!isPrintable) return;
      setQuery((q) => q + inputChar);
      return;
    }
  });

  // Determine the visible window of items (pagination). Keep the selected
  // item in view — if it goes past the bottom, scroll down; if past the
  // top, scroll up.
  const halfVisible = Math.floor(maxVisible / 2);
  let start = Math.max(0, selected - halfVisible);
  const end = Math.min(filtered.length, start + maxVisible);
  // Re-adjust start if we hit the bottom (so the last page is full).
  if (end - start < maxVisible) {
    start = Math.max(0, end - maxVisible);
  }
  const visibleItems = filtered.slice(start, end);

  return (
    <Box
      borderStyle={RoundedBorder}
      borderColor={theme.border}
      flexDirection="column"
      width={width}
      paddingLeft={1}
      paddingRight={1}
    >
      {/* Title */}
      <Box>
        <Text color={theme.text} bold>{title}</Text>
      </Box>

      {/* Search input */}
      <Box marginBottom={1}>
        <Text color={theme.primary} bold>{glyph.arrowR} </Text>
        {query ? (
          <Text color={theme.text}>{query}</Text>
        ) : (
          <Text color={theme.textMuted} italic>{placeholder}</Text>
        )}
        <Text color={theme.primary} inverse> </Text>
      </Box>

      {/* Items list */}
      <Box flexDirection="column" minHeight={Math.min(maxVisible, Math.max(1, filtered.length))}>
        {filtered.length === 0 ? (
          <Text color={theme.textMuted}>No matches</Text>
        ) : (
          visibleItems.map((item, i) => {
            const realIdx = start + i;
            const isSelected = realIdx === selected;
            const labelMax = Math.floor((width - 8) * 0.5);
            const descMax = Math.floor((width - 8) * 0.4);
            return (
              <Box key={item.id}>
                <Text color={isSelected ? theme.primary : theme.textMuted}>
                  {isSelected ? '▶ ' : '  '}
                </Text>
                {item.icon && (
                  <Text color={isSelected ? theme.text : theme.textMuted}>{item.icon} </Text>
                )}
                <Text color={isSelected ? theme.text : theme.textMuted} bold={isSelected}>
                  {truncate(item.label, labelMax)}
                </Text>
                {item.description && (
                  <Text color={isSelected ? theme.textMuted : theme.border}>
                    {'  '}{truncate(item.description, descMax)}
                  </Text>
                )}
                {item.hint && (
                  <Text color={theme.accent}> {item.hint}</Text>
                )}
              </Box>
            );
          })
        )}
      </Box>

      {/* Footer */}
      <Box marginTop={1}>
        <Text color={theme.textMuted} dimColor>
          {filtered.length} of {items.length} · ↑↓ navigate · ↵ select · esc cancel · ctrl+u clear
        </Text>
      </Box>
    </Box>
  );
};
