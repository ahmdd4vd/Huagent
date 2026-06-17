/**
 * Diff View — Tampilkan perubahan file dengan diff view.
 * 
 * Phase 3: TUI Polish
 * 
 * Features:
 * - Line-by-line diff (added/removed/unchanged)
 * - Color-coded: green (+), red (-), gray (context)
 * - Line numbers (before/after)
 * - Unified diff format
 */

import React from 'react';
import { Box, Text } from 'ink';
import { diffLines, type Change } from 'diff';
import { theme } from './theme.js';

export interface DiffViewProps {
  /** Old content (before) */
  oldContent: string;
  /** New content (after) */
  newContent: string;
  /** Filename */
  filename?: string;
  /** Show line numbers */
  lineNumbers?: boolean;
  /** Context lines (lines around changes) */
  contextLines?: number;
  /** Max width */
  width?: number;
}

export interface DiffLine {
  type: 'added' | 'removed' | 'unchanged';
  content: string;
  oldLineNum?: number;
  newLineNum?: number;
}

/**
 * Parse diff into lines.
 */
function parseDiff(oldContent: string, newContent: string, contextLines: number = 3): DiffLine[] {
  const changes: Change[] = diffLines(oldContent, newContent);
  const lines: DiffLine[] = [];

  let oldLine = 1;
  let newLine = 1;

  for (let i = 0; i < changes.length; i++) {
    const change = changes[i];
    const changeLines = change.value.split('\n');

    // Remove trailing empty line from split
    if (changeLines[changeLines.length - 1] === '') {
      changeLines.pop();
    }

    if (change.added) {
      // Added lines (green)
      for (const line of changeLines) {
        lines.push({
          type: 'added',
          content: line,
          newLineNum: newLine++,
        });
      }
    } else if (change.removed) {
      // Removed lines (red)
      for (const line of changeLines) {
        lines.push({
          type: 'removed',
          content: line,
          oldLineNum: oldLine++,
        });
      }
    } else {
      // Unchanged lines (gray) - show context
      const prevChange = changes[i - 1];
      const nextChange = changes[i + 1];
      const hasPrevChange = prevChange && (prevChange.added || prevChange.removed);
      const hasNextChange = nextChange && (nextChange.added || nextChange.removed);

      for (let j = 0; j < changeLines.length; j++) {
        const line = changeLines[j];

        // Show context lines (before/after changes)
        const isNearPrevChange = hasPrevChange && j < contextLines;
        const isNearNextChange = hasNextChange && j >= changeLines.length - contextLines;
        const isFirstOrLast = i === 0 || i === changes.length - 1;

        if (isNearPrevChange || isNearNextChange || isFirstOrLast || lines.length === 0) {
          lines.push({
            type: 'unchanged',
            content: line,
            oldLineNum: oldLine++,
            newLineNum: newLine++,
          });
        } else {
          // Skip middle unchanged lines (but increment counters)
          oldLine++;
          newLine++;
        }
      }
    }
  }

  return lines;
}

/**
 * DiffView component.
 */
export const DiffView: React.FC<DiffViewProps> = ({
  oldContent,
  newContent,
  filename,
  lineNumbers = true,
  contextLines = 3,
  width,
}) => {
  const lines = parseDiff(oldContent, newContent, contextLines);

  // Count changes
  const added = lines.filter(l => l.type === 'added').length;
  const removed = lines.filter(l => l.type === 'removed').length;

  return (
    <Box flexDirection="column" marginY={1} width={width}>
      {/* Header */}
      {filename && (
        <Box marginBottom={0}>
          <Text color={theme.fg} bold>
            📄 {filename}
          </Text>
          <Text color={theme.fgSubtle}>
            {' '}({added > 0 ? `+${added}` : ''}{removed > 0 ? ` -${removed}` : ''})
          </Text>
        </Box>
      )}

      {/* Diff block */}
      <Box
        flexDirection="column"
        borderStyle="round"
        borderColor={theme.border}
        paddingX={1}
        width={width}
      >
        {lines.map((line, i) => {
          let prefix = '  ';
          let color: string = theme.fgSubtle;

          if (line.type === 'added') {
            prefix = '+ ';
            color = theme.success;
          } else if (line.type === 'removed') {
            prefix = '- ';
            color = theme.danger;
          }

          // Line numbers
          let lineNumStr = '';
          if (lineNumbers) {
            const oldNum = line.oldLineNum ? String(line.oldLineNum).padStart(4, ' ') : '    ';
            const newNum = line.newLineNum ? String(line.newLineNum).padStart(4, ' ') : '    ';
            lineNumStr = `${oldNum} ${newNum} `;
          }

          return (
            <Text key={i} wrap="truncate">
              <Text color={theme.fgSubtle}>{lineNumStr}</Text>
              <Text color={color}>{prefix}{line.content}</Text>
            </Text>
          );
        })}
      </Box>

      {/* Summary */}
      <Box marginTop={0}>
        <Text color={theme.fgSubtle}>
          {added > 0 && <Text color={theme.success}>+{added} added</Text>}
          {added > 0 && removed > 0 && <Text color={theme.fgSubtle}>, </Text>}
          {removed > 0 && <Text color={theme.danger}>-{removed} removed</Text>}
        </Text>
      </Box>
    </Box>
  );
};

/**
 * Inline diff (single line).
 */
export const InlineDiff: React.FC<{
  oldText: string;
  newText: string;
}> = ({ oldText, newText }) => {
  const changes = diffLines(oldText, newText);

  return (
    <Text>
      {changes.map((change, i) => {
        if (change.added) {
          return <Text key={i} color={theme.success} backgroundColor={theme.bgElevated}>{change.value}</Text>;
        } else if (change.removed) {
          return <Text key={i} color={theme.danger} backgroundColor={theme.bgElevated} strikethrough>{change.value}</Text>;
        } else {
          return <Text key={i} color={theme.fg}>{change.value}</Text>;
        }
      })}
    </Text>
  );
};

/**
 * File change summary.
 */
export const FileChangeSummary: React.FC<{
  filename: string;
  oldContent: string;
  newContent: string;
}> = ({ filename, oldContent, newContent }) => {
  const changes = diffLines(oldContent, newContent);
  const added = changes.filter(c => c.added).reduce((sum, c) => sum + c.count, 0);
  const removed = changes.filter(c => c.removed).reduce((sum, c) => sum + c.count, 0);

  return (
    <Box>
      <Text color={theme.fg}>📄 {filename}</Text>
      <Text color={theme.fgSubtle}> </Text>
      {added > 0 && <Text color={theme.success}>+{added}</Text>}
      {added > 0 && removed > 0 && <Text color={theme.fgSubtle}> </Text>}
      {removed > 0 && <Text color={theme.danger}>-{removed}</Text>}
    </Box>
  );
};
