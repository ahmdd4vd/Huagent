/**
 * ToolConfirmation — OpenCode-style tool permission dialog.
 *
 * Pause + ask the user before executing a potentially dangerous tool.
 * Shows the tool, args preview, and reason. User picks:
 *   - allow (once)
 *   - allow-always (remember for this session)
 *   - deny (cancel this call)
 *   - deny-always (cancel all future calls of this tool)
 *
 * Key bindings:
 *   1 / y       allow
 *   2 / n       deny
 *   3 / a       allow-always
 *   4 / d       deny-always
 *   ←/→        switch option
 *   enter       confirm highlighted
 *   esc         deny
 */

import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { theme, glyph, fg } from './theme.js';
import type { PermissionRequest, PermissionDecisionType } from '../engine/core.js';

export interface ToolConfirmationProps {
  request: PermissionRequest;
  onDecide: (decision: PermissionDecisionType) => void;
  width?: number;
}

const TOOL_ICONS: Record<string, string> = {
  bash: 'BASH',
  write: 'WRITE',
  edit: 'EDIT',
  read: 'READ',
  grep: 'GREP',
  search: 'GREP',
  web: 'WEB',
  memory: 'MEM',
  ask_user: 'ASK',
  subagent: 'AGNT',
  todo: 'TODO',
  delete: 'DEL',
  move: 'MOVE',
};

const TOOL_COLORS: Record<string, string> = {
  bash: theme.warning,
  write: theme.info,
  edit: theme.info,
  read: theme.success,
  grep: theme.fgMuted,
  search: theme.fgMuted,
  web: theme.secondary,
  memory: theme.accent,
  ask_user: theme.primary,
  subagent: theme.secondary,
  todo: theme.fgMuted,
  delete: theme.danger,
  move: theme.warning,
};

export const ToolConfirmation: React.FC<ToolConfirmationProps> = ({
  request,
  onDecide,
  width = 80,
}) => {
  const choices: Array<{ key: string; label: string; value: PermissionDecisionType; color: string }> = [
    { key: '1', label: 'Allow (once)', value: 'allow', color: theme.success },
    { key: '2', label: 'Deny', value: 'deny', color: theme.danger },
    { key: '3', label: 'Always allow', value: 'allow-always', color: theme.success },
    { key: '4', label: 'Always deny', value: 'deny-always', color: theme.danger },
  ];
  const [cursor, setCursor] = useState(0);

  useInput((input, key) => {
    if (key.escape) {
      onDecide('deny');
      return;
    }
    if (key.leftArrow) {
      setCursor((c) => Math.max(0, c - 1));
      return;
    }
    if (key.rightArrow) {
      setCursor((c) => Math.min(choices.length - 1, c + 1));
      return;
    }
    if (key.return) {
      onDecide(choices[cursor].value);
      return;
    }
    if (input === '1' || input === 'y') onDecide('allow');
    else if (input === '2' || input === 'n') onDecide('deny');
    else if (input === '3' || input === 'a') onDecide('allow-always');
    else if (input === '4' || input === 'd') onDecide('deny-always');
  });

  const toolColor = TOOL_COLORS[request.tool] ?? theme.fg;
  const toolLabel = TOOL_ICONS[request.tool] ?? request.tool.toUpperCase();

  // Format args preview
  const argsPreview = (() => {
    if (!request.args) return '';
    if (typeof request.args === 'string') return request.args;
    if (request.tool === 'bash' && request.args.command) return String(request.args.command);
    if ((request.tool === 'write' || request.tool === 'edit' || request.tool === 'read') && request.args.path) {
      return String(request.args.path);
    }
    if (request.tool === 'web' && request.args.url) return String(request.args.url);
    if (request.tool === 'grep' && request.args.pattern) {
      return `${request.args.pattern}${request.args.path ? ' in ' + request.args.path : ''}`;
    }
    return JSON.stringify(request.args).slice(0, 200);
  })();

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={theme.warning} paddingX={1} width={width}>
      {/* Title */}
      <Box>
        <Text color={theme.warning} bold>{glyph.bullet} Permission Required</Text>
      </Box>
      <Box>
        <Text color={theme.fgSubtle}>{glyph.horz.repeat(width - 4)}</Text>
      </Box>

      {/* Tool + reason */}
      <Box>
        <Text color={theme.fgMuted}>Tool:  </Text>
        <Text color={toolColor} bold>[{toolLabel}]</Text>
        <Text color={theme.fg}> {request.tool}</Text>
      </Box>
      <Box>
        <Text color={theme.fgMuted}>Why:  </Text>
        <Text color={theme.fg}>{request.reason}</Text>
      </Box>

      {/* Preview */}
      {argsPreview && (
        <Box flexDirection="column" marginTop={1}>
          <Text color={theme.fgMuted} dimColor>Preview:</Text>
          <Box marginLeft={2} marginTop={0}>
            <Text color={theme.fg} wrap="wrap">
              {argsPreview}
            </Text>
          </Box>
        </Box>
      )}

      <Box marginTop={1}>
        <Text color={theme.fgSubtle}>{glyph.horz.repeat(width - 4)}</Text>
      </Box>

      {/* Choice row */}
      <Box>
        {choices.map((c, i) => {
          const isCursor = i === cursor;
          return (
            <Box key={c.value} marginRight={1}>
              <Text color={isCursor ? c.color : theme.fgSubtle} bold={isCursor} inverse={isCursor}>
                {isCursor ? ' ▸ ' : '   '}[{c.key}]{c.label.replace(/^\(.*\)/, '').trim()}{isCursor ? ' ' : ' '}
              </Text>
            </Box>
          );
        })}
      </Box>

      <Box marginTop={1}>
        <Text color={theme.fgSubtle} dimColor>
          ←/→ select · 1-4 quick · enter confirm · esc deny
        </Text>
      </Box>
    </Box>
  );
};

export default ToolConfirmation;
