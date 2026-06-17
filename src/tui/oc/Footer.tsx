/**
 * Footer — bottom status bar (OpenCode-style).
 *
 * Layout (single line):
 *   <directory path>   <right-side status info>
 *
 * Right-side info (in order):
 *   - "△ N Permissions" (warning) — only when permissions are pending
 *   - "• N LSP"          — language servers connected
 *   - "⊙ N MCP"          — MCP servers connected
 *   - "/status" hint
 *
 * Ported from packages/tui/src/routes/session/footer.tsx in OpenCode.
 */

import React from 'react';
import { Box, Text } from 'ink';
import { theme, glyph, truncate } from './theme.js';

export interface FooterProps {
  /** Current working directory (shown on the left). */
  directory?: string;
  /** Number of pending permission requests. */
  pendingPermissions?: number;
  /** Number of connected LSP servers. */
  lspCount?: number;
  /** Number of connected MCP servers. */
  mcpCount?: number;
  /** True if any MCP server failed to connect. */
  mcpError?: boolean;
  /** Width of the footer (terminal columns). */
  width: number;
}

export const Footer: React.FC<FooterProps> = ({
  directory = '',
  pendingPermissions = 0,
  lspCount = 0,
  mcpCount = 0,
  mcpError = false,
  width,
}) => {
  const dirDisplay = directory ? truncate(shortenPath(directory), Math.max(10, Math.floor(width / 2))) : '';

  return (
    <Box flexDirection="row" justifyContent="space-between" gap={1}>
      <Text color={theme.textMuted}>{dirDisplay}</Text>
      <Box flexDirection="row" gap={2}>
        {pendingPermissions > 0 && (
          <Text color={theme.warning}>
            {glyph.warn} {pendingPermissions} Permission{pendingPermissions > 1 ? 's' : ''}
          </Text>
        )}
        <Text color={theme.text}>
          <Text color={lspCount > 0 ? theme.success : theme.textMuted}>{glyph.connected}</Text>
          {' '}{lspCount} LSP
        </Text>
        {mcpCount > 0 && (
          <Text color={theme.text}>
            <Text color={mcpError ? theme.error : theme.success}>{glyph.mcp} </Text>
            {mcpCount} MCP
          </Text>
        )}
        <Text color={theme.textMuted}>/status</Text>
      </Box>
    </Box>
  );
};

/**
 * Shorten a directory path for display. Replaces the home directory with
 * "~" and truncates long middle segments.
 */
function shortenPath(p: string): string {
  const home = process.env.HOME || process.env.USERPROFILE || '';
  let out = p;
  if (home && p.startsWith(home)) {
    out = '~' + p.slice(home.length);
  }
  // If the path is still very long, keep only the last 2-3 segments.
  if (out.length > 40) {
    const parts = out.split(/[/\\]/).filter(Boolean);
    if (parts.length > 3) {
      out = parts.slice(-3).join('/');
      if (out.startsWith('~')) out = '~/' + out;
      else if (!out.startsWith('/')) out = '/' + out;
    }
  }
  return out;
}
