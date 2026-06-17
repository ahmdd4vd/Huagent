/**
 * Picker — OpenCode-style interactive picker overlay.
 *
 * - Type to filter (case-insensitive substring)
 * - ↑/↓ or Ctrl+P/Ctrl+N to navigate
 * - Enter to select, Esc to cancel
 * - Shows current selection with a "●" marker
 * - Footer with key hints
 *
 * Inspired by opencode's `packages/tui/src/ui/picker.tsx`.
 */

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Box, Text, useInput } from 'ink';
import { theme, glyph, fg } from './theme.js';

export interface PickerItem {
  id: string;
  label: string;
  detail?: string;
  description?: string;
  /** Right-aligned metadata (e.g. cost, context window) */
  meta?: string;
  /** Disabled items can't be selected */
  disabled?: boolean;
  /** Mark as current (will be auto-focused initially) */
  current?: boolean;
}

export interface PickerProps {
  title: string;
  items: PickerItem[];
  onSelect: (id: string) => void;
  onCancel: () => void;
  /** Initial filter query */
  initialQuery?: string;
  /** Maximum visible items (default 8) */
  maxVisible?: number;
  /** Width in columns (default 80) */
  width?: number;
  /** Optional placeholder for empty state */
  emptyText?: string;
}

export const Picker: React.FC<PickerProps> = ({
  title,
  items,
  onSelect,
  onCancel,
  initialQuery = '',
  maxVisible = 8,
  width = 80,
  emptyText = 'no matches',
}) => {
  const [query, setQuery] = useState(initialQuery);
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef('');

  // Filter items by query
  const filtered = useMemo(() => {
    if (!query) return items;
    const q = query.toLowerCase();
    return items.filter(
      (it) =>
        it.id.toLowerCase().includes(q) ||
        it.label.toLowerCase().includes(q) ||
        (it.detail?.toLowerCase().includes(q) ?? false) ||
        (it.description?.toLowerCase().includes(q) ?? false),
    );
  }, [items, query]);

  // Find first non-disabled + current item to start cursor at
  useEffect(() => {
    if (cursor >= filtered.length) {
      const idx = filtered.findIndex((it) => !it.disabled);
      setCursor(idx >= 0 ? idx : 0);
    }
  }, [filtered, cursor]);

  useEffect(() => {
    if (filtered.length === 0) return;
    // On first mount, focus the current item
    const currentIdx = filtered.findIndex((it) => it.current);
    if (currentIdx >= 0 && cursor === 0) {
      setCursor(currentIdx);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useInput((inputChar, key) => {
    if (key.escape) {
      onCancel();
      return;
    }
    if (key.return) {
      const item = filtered[cursor];
      if (item && !item.disabled) onSelect(item.id);
      return;
    }
    if (key.upArrow || (key.ctrl && inputChar === 'p')) {
      setCursor((c) => {
        let next = c - 1;
        while (next >= 0 && filtered[next]?.disabled) next--;
        return next < 0 ? Math.max(0, filtered.length - 1) : next;
      });
      return;
    }
    if (key.downArrow || (key.ctrl && inputChar === 'n')) {
      setCursor((c) => {
        let next = c + 1;
        while (next < filtered.length && filtered[next]?.disabled) next++;
        return next >= filtered.length ? 0 : next;
      });
      return;
    }
    if (key.backspace || key.delete) {
      setQuery((q) => q.slice(0, -1));
      return;
    }
    if (inputChar && !key.ctrl && !key.meta) {
      setQuery((q) => q + inputChar);
    }
  });

  // Window the visible items
  const visibleStart = Math.max(
    0,
    Math.min(cursor - Math.floor(maxVisible / 2), filtered.length - maxVisible),
  );
  const visibleEnd = Math.min(filtered.length, visibleStart + maxVisible);
  const visible = filtered.slice(visibleStart, visibleEnd);
  const hasMore = filtered.length > maxVisible;
  const topHidden = visibleStart > 0 ? visibleStart : 0;
  const bottomHidden = filtered.length - visibleEnd;

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={theme.borderActive}
      paddingX={1}
      width={width}
    >
      {/* Title + filter row */}
      <Box>
        <Text color={theme.primary} bold>
          {title}
        </Text>
        <Text color={theme.fgMuted}> · filter: </Text>
        <Text color={theme.fg}>{query || '…'}</Text>
        <Text color={theme.fgSubtle}>{glyph.bullet}</Text>
        <Text color={theme.fgMuted}> {filtered.length}/{items.length}</Text>
      </Box>

      <Box>
        <Text color={theme.fgSubtle}>{glyph.horz.repeat(width - 4)}</Text>
      </Box>

      {/* Items */}
      {filtered.length === 0 ? (
        <Box>
          <Text color={theme.fgSubtle} italic>
            {emptyText}
          </Text>
        </Box>
      ) : (
        visible.map((item, idx) => {
          const realIdx = visibleStart + idx;
          const isCursor = realIdx === cursor;
          const isCurrent = item.current;
          const marker = isCurrent ? '●' : isCursor ? '▸' : ' ';
          const markerColor = isCurrent
            ? theme.success
            : isCursor
              ? theme.primary
              : theme.fgSubtle;
          const labelColor = item.disabled
            ? theme.fgDisabled
            : isCursor
              ? theme.fg
              : theme.fgMuted;
          return (
            <Box key={item.id}>
              <Text color={markerColor} bold={isCursor || isCurrent}>
                {marker}{' '}
              </Text>
              <Text color={labelColor} bold={isCursor}>
                {item.label}
              </Text>
              {item.detail ? (
                <Text color={theme.fgSubtle}> · {item.detail}</Text>
              ) : null}
              {item.meta ? <Text color={theme.accent}> · {item.meta}</Text> : null}
            </Box>
          );
        })
      )}

      {hasMore && (
        <Box>
          <Text color={theme.fgSubtle} dimColor>
            {topHidden > 0 ? `↑ ${topHidden} more  ` : ''}
            {bottomHidden > 0 ? `↓ ${bottomHidden} more` : ''}
          </Text>
        </Box>
      )}

      <Box>
        <Text color={theme.fgSubtle}>{glyph.horz.repeat(width - 4)}</Text>
      </Box>

      {/* Footer key hints */}
      <Box>
        <Text color={theme.fgSubtle} dimColor>
          ↑↓ navigate · type filter · ⏎ select · esc cancel
        </Text>
      </Box>
    </Box>
  );
};

export default Picker;
