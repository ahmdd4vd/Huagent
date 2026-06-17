/**
 * Dialog — minimal modal overlay (OpenCode-style).
 *
 * OpenCode's dialogs use a single rounded border, a title line, then
 * the content, then a footer with keybind hints. We replicate that here.
 *
 * Variants:
 *   - "info"    — neutral accent border
 *   - "warning" — warning border
 *   - "error"   — error border
 *   - "confirm" — neutral border with Yes/No footer
 */

import React from 'react';
import { Box, Text } from 'ink';
import { theme, glyph } from './theme.js';
import { RoundedBorder } from './border.js';

export interface DialogProps {
  title?: string;
  variant?: 'info' | 'warning' | 'error' | 'confirm';
  width?: number;
  children: React.ReactNode;
  footer?: React.ReactNode;
}

const VARIANT_BORDER: Record<NonNullable<DialogProps['variant']>, string> = {
  info: theme.border,
  warning: theme.warning,
  error: theme.error,
  confirm: theme.border,
};

export const Dialog: React.FC<DialogProps> = ({
  title,
  variant = 'info',
  width = 60,
  children,
  footer,
}) => {
  const borderColor = VARIANT_BORDER[variant];
  return (
    <Box
      borderStyle={RoundedBorder}
      borderColor={borderColor}
      flexDirection="column"
      width={width}
      paddingLeft={1}
      paddingRight={1}
      paddingTop={0}
      paddingBottom={0}
    >
      {title && (
        <Box>
          <Text color={theme.text} bold>{title}</Text>
        </Box>
      )}
      <Box flexDirection="column">
        {children}
      </Box>
      {footer && (
        <Box>
          <Text color={theme.textMuted} dimColor>{footer}</Text>
        </Box>
      )}
    </Box>
  );
};

/**
 * ConfirmDialog — a yes/no dialog with a question.
 */
export interface ConfirmDialogProps {
  title?: string;
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
  width?: number;
  confirmLabel?: string;
  cancelLabel?: string;
}

export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  title = 'Confirm',
  message,
  onConfirm,
  onCancel,
  width = 60,
  confirmLabel = 'Yes',
  cancelLabel = 'No',
}) => {
  return (
    <Dialog title={title} variant="confirm" width={width} footer="y confirm · n/esc cancel">
      <Box marginBottom={1}>
        <Text color={theme.text}>{message}</Text>
      </Box>
      <Box flexDirection="row" gap={2}>
        <Text color={theme.success} bold>[{confirmLabel}]</Text>
        <Text color={theme.textMuted}>[{cancelLabel}]</Text>
      </Box>
    </Dialog>
  );
};

/**
 * AlertDialog — informational dialog with a single OK button.
 */
export interface AlertDialogProps {
  title?: string;
  message: string;
  onDismiss: () => void;
  width?: number;
}

export const AlertDialog: React.FC<AlertDialogProps> = ({
  title = 'Notice',
  message,
  onDismiss,
  width = 60,
}) => {
  return (
    <Dialog title={title} variant="info" width={width} footer="enter dismiss">
      <Box marginBottom={1}>
        <Text color={theme.text}>{message}</Text>
      </Box>
    </Dialog>
  );
};

/**
 * HelpDialog — list of keybindings.
 */
export interface HelpDialogProps {
  onDismiss: () => void;
  width?: number;
}

export const HelpDialog: React.FC<HelpDialogProps> = ({ onDismiss, width = 70 }) => {
  const keybindings: Array<[string, string]> = [
    ['Ctrl+C', 'Exit huagent'],
    ['Ctrl+L', 'Toggle activity feed'],
    ['Ctrl+P', 'Open provider picker'],
    ['Ctrl+T', 'Open model picker'],
    ['Ctrl+E', 'Open scope picker'],
    ['Ctrl+R', 'Resume a previous session'],
    ['Ctrl+K', 'Open command palette'],
    ['Enter', 'Submit prompt'],
    ['Ctrl+J', 'Insert newline (multi-line)'],
    ['↑ / ↓', 'Navigate history / suggestions'],
    ['Tab', 'Accept autocomplete suggestion'],
    ['Esc', 'Close dialog / autocomplete'],
    ['/', 'Trigger slash command autocomplete'],
  ];
  return (
    <Dialog title="Keybindings" variant="info" width={width} footer="enter dismiss">
      <Box flexDirection="column" marginBottom={1}>
        {keybindings.map(([key, desc]) => (
          <Box key={key}>
            <Box width={16}>
              <Text color={theme.primary} bold>{key}</Text>
            </Box>
            <Text color={theme.textMuted}>{desc}</Text>
          </Box>
        ))}
      </Box>
    </Dialog>
  );
};
