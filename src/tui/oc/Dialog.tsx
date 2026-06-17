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
 *
 * Keyboard:
 *   - Esc / Ctrl+C — cancel (calls onCancel if provided)
 *   - Enter        — confirm (calls onConfirm if provided)
 */

import React from 'react';
import { Box, Text, useInput, useApp } from 'ink';
import { theme, glyph } from './theme.js';
import { RoundedBorder } from './border.js';

export interface DialogProps {
  title?: string;
  variant?: 'info' | 'warning' | 'error' | 'confirm';
  width?: number;
  children: React.ReactNode;
  footer?: React.ReactNode;
  /** Called when user presses Esc / Ctrl+C. */
  onCancel?: () => void;
  /** Called when user presses Enter. */
  onConfirm?: () => void;
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
  onCancel,
  onConfirm,
}) => {
  const { exit } = useApp();
  const borderColor = VARIANT_BORDER[variant];

  useInput((inputChar, key) => {
    if (key.escape || (key.ctrl && inputChar === 'c')) {
      onCancel?.();
      return;
    }
    if (key.return) {
      onConfirm?.();
      return;
    }
  });

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
 *
 * Keyboard:
 *   - y / Enter  — confirm
 *   - n / Esc    — cancel
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
  useInput((inputChar, key) => {
    if (key.escape || (key.ctrl && inputChar === 'c') || inputChar === 'n' || inputChar === 'N') {
      onCancel();
      return;
    }
    if (key.return || inputChar === 'y' || inputChar === 'Y') {
      onConfirm();
      return;
    }
  });

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
 *
 * Keyboard:
 *   - Enter / Esc / Space — dismiss
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
  useInput((inputChar, key) => {
    if (key.return || key.escape || (key.ctrl && inputChar === 'c') || inputChar === ' ') {
      onDismiss();
      return;
    }
  });

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
 *
 * Keyboard:
 *   - Esc / Enter / ? — dismiss
 */
export interface HelpDialogProps {
  onDismiss: () => void;
  width?: number;
}

export const HelpDialog: React.FC<HelpDialogProps> = ({ onDismiss, width = 70 }) => {
  useInput((inputChar, key) => {
    if (key.escape || key.return || (key.ctrl && inputChar === 'c') || inputChar === '?') {
      onDismiss();
      return;
    }
  });

  const keybindings: Array<[string, string]> = [
    ['Ctrl+C', 'Exit huagent'],
    ['Ctrl+P', 'Open provider picker'],
    ['Ctrl+T', 'Open model picker'],
    ['Ctrl+E', 'Open scope picker'],
    ['Ctrl+R', 'Resume a previous session'],
    ['Ctrl+K', 'Open command palette'],
    ['Ctrl+L', 'Clear screen'],
    ['Enter', 'Submit prompt'],
    ['Alt+Enter', 'Insert newline (multi-line)'],
    ['Ctrl+A / E', 'Move cursor to line start / end'],
    ['Ctrl+U / K', 'Delete to line start / end'],
    ['Ctrl+W', 'Delete previous word'],
    ['↑ / ↓', 'Navigate history / suggestions / lines'],
    ['← / →', 'Move cursor horizontally'],
    ['Tab', 'Accept autocomplete suggestion'],
    ['Esc', 'Close dialog / autocomplete'],
    ['/', 'Trigger slash command autocomplete'],
    ['?', 'Show this help'],
  ];
  return (
    <Dialog title="Keybindings" variant="info" width={width} footer="enter / ? / esc dismiss">
      <Box flexDirection="column" marginBottom={1}>
        {keybindings.map(([key, desc]) => (
          <Box key={key}>
            <Box width={18}>
              <Text color={theme.primary} bold>{key}</Text>
            </Box>
            <Text color={theme.textMuted}>{desc}</Text>
          </Box>
        ))}
      </Box>
    </Dialog>
  );
};
