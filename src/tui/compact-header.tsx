/**
 * v4 CompactHeader — Modern, restrained header for the TUI.
 *
 * Replaces the old 5-line ASCII mascot header with:
 *   - 1 line: "huagent" wordmark + model + status indicator
 *   - 1 line: mode chips (autonomous, scope, perm, model) — single row
 *   - 1 line: separator
 *
 * No emoji, no ASCII art, no clutter. Just clean info.
 *
 * Width-aware: never overflows the terminal width.
 */

import React from 'react';
import { Box, Text } from 'ink';
import { theme, gradient, truncate } from './theme.js';
import { ModeChips } from './status.js';

export interface CompactHeaderProps {
  model: string;
  permissionMode: string;
  autonomous: boolean;
  scope: string | null;
  engine: string;
  effort?: string;
  projectName?: string;
  width?: number;
}

export const CompactHeader: React.FC<CompactHeaderProps> = ({
  model,
  permissionMode,
  autonomous,
  scope,
  engine,
  effort,
  projectName,
  width = 100,
}) => {
  return (
    <Box flexDirection="column" paddingX={1} marginY={0} width={width}>
      {/* Top line: wordmark + project + engine ··· model */}
      <Box flexDirection="row" width={width - 2}>
        <Text>{gradient('huagent', theme.primary, theme.secondary)}</Text>
        <Text color={theme.fgMuted}> · </Text>
        <Text color={theme.fgSubtle}>{engine}</Text>
        {projectName && (
          <>
            <Text color={theme.fgMuted}> · </Text>
            <Text color={theme.sakura}>{projectName}</Text>
          </>
        )}
        <Box flexGrow={1} />
        <Text color={theme.fgSubtle}>{truncate(model, Math.max(10, Math.floor(width / 6)))}</Text>
      </Box>
      {/* Second line: mode chips — single row, width-bounded */}
      <Box flexDirection="row" width={width - 2}>
        <ModeChips
          autonomous={autonomous}
          scope={scope}
          permissionMode={permissionMode}
          model={model}
          effort={effort}
          width={width - 2}
        />
      </Box>
      {/* Third line: separator */}
      <Box flexDirection="row" width={width - 2}>
        <Text color={theme.border}>{'─'.repeat(Math.max(20, width - 2))}</Text>
      </Box>
    </Box>
  );
};
