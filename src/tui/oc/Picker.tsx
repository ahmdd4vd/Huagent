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
 *   - Esc to cancel
 */

import React, { useState, useEffect } from 'react';
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

  useInput((inputChar, key) => {
    if (key.escape) {
      onCancel();
      return;
    }
    if (key.ctrl && inputChar === 'c') {
      onCancel();
      return;
    }
    if (key.upArrow) {
      setSelected((s) => Math.max(0, s - 1));
      return;
    }
    if (key.downArrow) {
      setSelected((s) => Math.min(filtered.length - 1, s + 1));
      return;
    }
    if (key.return) {
      const item = filtered[selected];
      if (item) onSelect(item.id);
      return;
    }
    if (key.backspace || key.delete) {
      setQuery((q) => q.slice(0, -1));
      return;
    }
    if (inputChar && !key.ctrl && !key.meta && !key.return) {
      setQuery((q) => q + inputChar);
      return;
    }
  });

  // Determine the visible window of items (pagination).
  const start = Math.max(0, selected - Math.floor(maxVisible / 2));
  const end = Math.min(filtered.length, start + maxVisible);
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
        <Text color={theme.text}>{query}</Text>
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
            return (
              <Box key={item.id}>
                <Text color={isSelected ? theme.primary : theme.textMuted}>
                  {isSelected ? '▶ ' : '  '}
                </Text>
                {item.icon && (
                  <Text color={isSelected ? theme.text : theme.textMuted}>{item.icon} </Text>
                )}
                <Text color={isSelected ? theme.text : theme.textMuted} bold={isSelected}>
                  {truncate(item.label, Math.floor((width - 8) * 0.5))}
                </Text>
                {item.description && (
                  <Text color={isSelected ? theme.textMuted : theme.border}>
                    {'  '}{truncate(item.description, Math.floor((width - 8) * 0.4))}
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
          {filtered.length} of {items.length} · ↑↓ navigate · ↵ select · esc cancel
        </Text>
      </Box>
    </Box>
  );
};
