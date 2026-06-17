/**
 * Smart Autocomplete — Fuzzy matching with context-aware suggestions.
 * 
 * Phase 4: UX Polish
 * 
 * Features:
 * - Fuzzy matching (finds similar matches)
 * - Context-aware (commands vs files vs variables)
 * - Recent history (prioritize recent commands)
 * - Visual picker (arrow keys + Enter)
 * - Rich descriptions
 */

import React, { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import Fuse from 'fuse.js';
import { theme } from './theme.js';

export interface AutocompleteItem {
  value: string;
  label?: string;
  description?: string;
  category?: 'command' | 'file' | 'variable' | 'history';
  icon?: string;
}

export interface SmartAutocompleteProps {
  /** Input text */
  input: string;
  /** Available items */
  items: AutocompleteItem[];
  /** Max items to show */
  maxItems?: number;
  /** Callback when item selected */
  onSelect: (item: AutocompleteItem) => void;
  /** Callback when cancelled */
  onCancel?: () => void;
  /** Placeholder text */
  placeholder?: string;
}

/**
 * Fuzzy search using Fuse.js
 */
function fuzzySearch(items: AutocompleteItem[], query: string, maxResults: number = 10): AutocompleteItem[] {
  if (!query || query.length === 0) {
    return items.slice(0, maxResults);
  }

  const fuse = new Fuse(items, {
    keys: ['value', 'label', 'description'],
    threshold: 0.4,  // Fuzzy threshold (0 = exact, 1 = anything)
    includeScore: true,
    shouldSort: true,
  });

  const results = fuse.search(query);
  return results.slice(0, maxResults).map(r => r.item);
}

/**
 * SmartAutocomplete component.
 */
export const SmartAutocomplete: React.FC<SmartAutocompleteProps> = ({
  input,
  items,
  maxItems = 10,
  onSelect,
  onCancel,
  placeholder = 'Type to search...',
}) => {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [filteredItems, setFilteredItems] = useState<AutocompleteItem[]>([]);

  // Filter items based on input
  useEffect(() => {
    const filtered = fuzzySearch(items, input, maxItems);
    setFilteredItems(filtered);
    setSelectedIndex(0);  // Reset selection when input changes
  }, [input, items, maxItems]);

  useInput((inputChar, key) => {
    if (key.return) {
      if (filteredItems[selectedIndex]) {
        onSelect(filteredItems[selectedIndex]);
      }
    } else if (key.escape) {
      onCancel?.();
    } else if (key.upArrow) {
      setSelectedIndex((i) => Math.max(0, i - 1));
    } else if (key.downArrow) {
      setSelectedIndex((i) => Math.min(filteredItems.length - 1, i + 1));
    } else if (key.tab) {
      // Tab to select first match
      if (filteredItems.length > 0) {
        onSelect(filteredItems[0]);
      }
    }
  });

  if (filteredItems.length === 0) {
    return null;
  }

  // Group items by category
  const grouped = filteredItems.reduce((acc, item) => {
    const cat = item.category || 'other';
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(item);
    return acc;
  }, {} as Record<string, AutocompleteItem[]>);

  const categoryLabels: Record<string, string> = {
    command: 'Commands',
    file: 'Files',
    variable: 'Variables',
    history: 'Recent',
    other: 'Other',
  };

  const categoryIcons: Record<string, string> = {
    command: '⚡',
    file: '📄',
    variable: '🔧',
    history: '🕒',
    other: '•',
  };

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={theme.border} paddingX={1}>
      {Object.entries(grouped).map(([category, categoryItems]) => (
        <Box flexDirection="column" key={category}>
          {/* Category header */}
          <Box marginTop={0}>
            <Text color={theme.fgSubtle} bold>
              {categoryLabels[category] || category}
            </Text>
          </Box>

          {/* Items */}
          {categoryItems.map((item, i) => {
            const globalIndex = filteredItems.indexOf(item);
            const isSelected = globalIndex === selectedIndex;
            const icon = item.icon || categoryIcons[category] || '•';

            return (
              <Box key={item.value}>
                <Text color={isSelected ? theme.success : theme.fg}>
                  {isSelected ? '▶ ' : '  '}
                  {icon} {item.label || item.value}
                </Text>
                {item.description && (
                  <Text color={theme.fgSubtle}>
                    {' '}— {item.description}
                  </Text>
                )}
              </Box>
            );
          })}
        </Box>
      ))}

      {/* Footer */}
      <Box marginTop={1}>
        <Text color={theme.fgSubtle}>
          ↑↓ to navigate, Enter to select, Esc to cancel
        </Text>
      </Box>
    </Box>
  );
};

/**
 * Command autocomplete (slash commands).
 */
export const CommandAutocomplete: React.FC<{
  input: string;
  commands: Array<{ name: string; description: string; aliases?: string[] }>;
  onSelect: (command: string) => void;
  onCancel?: () => void;
}> = ({ input, commands, onSelect, onCancel }) => {
  const items: AutocompleteItem[] = commands.map(cmd => ({
    value: `/${cmd.name}`,
    label: `/${cmd.name}`,
    description: cmd.description,
    category: 'command' as const,
  }));

  return (
    <SmartAutocomplete
      input={input}
      items={items}
      onSelect={(item) => onSelect(item.value)}
      onCancel={onCancel}
    />
  );
};

/**
 * File autocomplete.
 */
export const FileAutocomplete: React.FC<{
  input: string;
  files: string[];
  onSelect: (file: string) => void;
  onCancel?: () => void;
}> = ({ input, files, onSelect, onCancel }) => {
  const items: AutocompleteItem[] = files.map(file => ({
    value: file,
    label: file.split('/').pop() || file,
    description: file,
    category: 'file' as const,
  }));

  return (
    <SmartAutocomplete
      input={input}
      items={items}
      onSelect={(item) => onSelect(item.value)}
      onCancel={onCancel}
    />
  );
};

/**
 * Inline autocomplete (single line suggestion).
 */
export const InlineSuggestion: React.FC<{
  suggestion: string;
  onAccept?: () => void;
}> = ({ suggestion, onAccept }) => {
  useInput((input, key) => {
    if (key.tab) {
      onAccept?.();
    }
  });

  return (
    <Box>
      <Text color={theme.fgSubtle}>
        {suggestion}
      </Text>
      <Text color={theme.fgSubtle}>
        {' '}(press Tab to accept)
      </Text>
    </Box>
  );
};
