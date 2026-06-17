/**
 * Error Handler — User-friendly error messages with actionable suggestions.
 * 
 * Phase 4: UX Polish
 * 
 * Features:
 * - Error classification (permission, file-not-found, syntax, network, etc.)
 * - Actionable suggestions (copy-paste ready commands)
 * - Interactive action picker
 * - Documentation links
 */

import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { theme } from './theme.js';

export type ErrorCategory = 
  | 'permission'
  | 'file-not-found'
  | 'syntax'
  | 'network'
  | 'api'
  | 'configuration'
  | 'timeout'
  | 'unknown';

export interface ErrorSuggestion {
  label: string;
  command?: string;
  description?: string;
  action?: () => void;
}

export interface ErrorHandlerProps {
  error: Error | string;
  category?: ErrorCategory;
  suggestions?: ErrorSuggestion[];
  onAction?: (suggestion: ErrorSuggestion) => void;
  onDismiss?: () => void;
}

/**
 * Classify error into category.
 */
export function classifyError(error: Error | string): ErrorCategory {
  const message = typeof error === 'string' ? error : error.message;
  const lower = message.toLowerCase();

  if (lower.includes('permission') || lower.includes('eacces')) {
    return 'permission';
  }
  if (lower.includes('no such file') || lower.includes('enoent') || lower.includes('not found')) {
    return 'file-not-found';
  }
  if (lower.includes('syntax') || lower.includes('unexpected token')) {
    return 'syntax';
  }
  if (lower.includes('network') || lower.includes('econnrefused') || lower.includes('fetch failed')) {
    return 'network';
  }
  if (lower.includes('api') || lower.includes('status') || lower.includes('404') || lower.includes('500')) {
    return 'api';
  }
  if (lower.includes('config') || lower.includes('environment') || lower.includes('missing')) {
    return 'configuration';
  }
  if (lower.includes('timeout') || lower.includes('timed out')) {
    return 'timeout';
  }

  return 'unknown';
}

/**
 * Generate suggestions based on error category.
 */
export function generateSuggestions(error: Error | string, category: ErrorCategory): ErrorSuggestion[] {
  const message = typeof error === 'string' ? error : error.message;

  switch (category) {
    case 'permission':
      return [
        {
          label: 'Run with sudo',
          command: 'sudo huagent',
          description: 'Run Huagent with elevated permissions',
        },
        {
          label: 'Change file permissions',
          command: 'chmod 644 <file>',
          description: 'Make file readable/writable',
        },
        {
          label: 'Move to user directory',
          command: 'mv <file> ~/.huagent/',
          description: 'Move file to user-owned directory',
        },
      ];

    case 'file-not-found':
      const filename = message.match(/['"](.+?)['"]/)?.[1] || 'file';
      return [
        {
          label: 'Check if file exists',
          command: `ls -la ${filename}`,
          description: 'Verify file path',
        },
        {
          label: 'Search for similar files',
          command: `find . -name "*${filename.replace(/\.[^.]+$/, '')}*" -type f`,
          description: 'Find files with similar names',
        },
        {
          label: 'Create the file',
          command: `touch ${filename}`,
          description: 'Create empty file',
        },
      ];

    case 'syntax':
      return [
        {
          label: 'Check syntax',
          command: 'huagent --check',
          description: 'Run syntax checker',
        },
        {
          label: 'View error location',
          command: 'huagent --show-error',
          description: 'Show error with context',
        },
        {
          label: 'Auto-fix syntax',
          command: 'huagent --fix',
          description: 'Attempt to fix syntax errors',
        },
      ];

    case 'network':
      return [
        {
          label: 'Check connection',
          command: 'ping google.com',
          description: 'Test internet connection',
        },
        {
          label: 'Check API status',
          command: 'huagent --status',
          description: 'Check if API is up',
        },
        {
          label: 'Use offline mode',
          command: 'huagent --offline',
          description: 'Work without internet',
        },
      ];

    case 'api':
      return [
        {
          label: 'Check API key',
          command: 'huagent --config api-key',
          description: 'Verify API key is set',
        },
        {
          label: 'Check rate limits',
          command: 'huagent --quota',
          description: 'View API usage',
        },
        {
          label: 'Switch provider',
          command: '/provider',
          description: 'Use different LLM provider',
        },
      ];

    case 'configuration':
      return [
        {
          label: 'View config',
          command: 'huagent --config',
          description: 'Show current configuration',
        },
        {
          label: 'Reset config',
          command: 'huagent --reset-config',
          description: 'Reset to defaults',
        },
        {
          label: 'Re-run setup',
          command: 'huagent setup',
          description: 'Run setup wizard',
        },
      ];

    case 'timeout':
      return [
        {
          label: 'Increase timeout',
          command: 'huagent --timeout 60',
          description: 'Wait longer for response',
        },
        {
          label: 'Use faster model',
          command: '/model gpt-3.5-turbo',
          description: 'Switch to faster model',
        },
        {
          label: 'Check connection',
          command: 'ping api.openai.com',
          description: 'Test API latency',
        },
      ];

    default:
      return [
        {
          label: 'Get help',
          command: 'huagent --help',
          description: 'View documentation',
        },
        {
          label: 'Report issue',
          command: 'huagent --report',
          description: 'Report bug to developers',
        },
      ];
  }
}

/**
 * ErrorHandler component.
 */
export const ErrorHandler: React.FC<ErrorHandlerProps> = ({
  error,
  category: providedCategory,
  suggestions: providedSuggestions,
  onAction,
  onDismiss,
}) => {
  const message = typeof error === 'string' ? error : error.message;
  const category = providedCategory || classifyError(error);
  const suggestions = providedSuggestions || generateSuggestions(error, category);
  const [selectedIndex, setSelectedIndex] = useState(0);

  useInput((input, key) => {
    if (key.return) {
      if (onAction && suggestions[selectedIndex]) {
        onAction(suggestions[selectedIndex]);
      }
    } else if (key.escape) {
      onDismiss?.();
    } else if (key.upArrow) {
      setSelectedIndex((i) => Math.max(0, i - 1));
    } else if (key.downArrow) {
      setSelectedIndex((i) => Math.min(suggestions.length - 1, i + 1));
    } else if (/^\d$/.test(input)) {
      const index = parseInt(input) - 1;
      if (index >= 0 && index < suggestions.length) {
        setSelectedIndex(index);
        if (onAction) {
          onAction(suggestions[index]);
        }
      }
    }
  });

  const categoryLabels: Record<ErrorCategory, string> = {
    'permission': 'Permission Error',
    'file-not-found': 'File Not Found',
    'syntax': 'Syntax Error',
    'network': 'Network Error',
    'api': 'API Error',
    'configuration': 'Configuration Error',
    'timeout': 'Timeout Error',
    'unknown': 'Unknown Error',
  };

  return (
    <Box flexDirection="column" marginY={1} borderStyle="round" borderColor={theme.danger} paddingX={1}>
      {/* Error header */}
      <Box>
        <Text color={theme.danger} bold>
          ❌ {categoryLabels[category]}
        </Text>
      </Box>

      {/* Error message */}
      <Box marginTop={0}>
        <Text color={theme.fg} wrap="wrap">
          {message}
        </Text>
      </Box>

      {/* Suggestions */}
      {suggestions.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          <Text color={theme.info} bold>
            💡 Suggested actions:
          </Text>
          <Box flexDirection="column" marginTop={0}>
            {suggestions.map((suggestion, i) => (
              <Box key={i}>
                <Text color={i === selectedIndex ? theme.success : theme.fg}>
                  {i === selectedIndex ? '▶ ' : '  '}
                  [{i + 1}] {suggestion.label}
                </Text>
                {suggestion.description && (
                  <Text color={theme.fgSubtle}> — {suggestion.description}</Text>
                )}
              </Box>
            ))}
          </Box>
        </Box>
      )}

      {/* Footer */}
      <Box marginTop={1}>
        <Text color={theme.fgSubtle}>
          Press number to select, Enter to run, or Esc to cancel
        </Text>
      </Box>
    </Box>
  );
};

/**
 * Simple error message (non-interactive).
 */
export const ErrorMessage: React.FC<{
  error: Error | string;
  category?: ErrorCategory;
}> = ({ error, category }) => {
  const message = typeof error === 'string' ? error : error.message;
  const cat = category || classifyError(error);

  const categoryLabels: Record<ErrorCategory, string> = {
    'permission': 'Permission Error',
    'file-not-found': 'File Not Found',
    'syntax': 'Syntax Error',
    'network': 'Network Error',
    'api': 'API Error',
    'configuration': 'Configuration Error',
    'timeout': 'Timeout Error',
    'unknown': 'Unknown Error',
  };

  return (
    <Box flexDirection="column" marginY={1}>
      <Text color={theme.danger} bold>
        ❌ {categoryLabels[cat]}
      </Text>
      <Text color={theme.fg}>{message}</Text>
    </Box>
  );
};
