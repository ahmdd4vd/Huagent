/**
 * v4 ActivityFeed — Live, scrollable feed of recent activities.
 *
 * Shows the most recent N activities (newest at top, or bottom — we use
 * bottom = chronological, which feels natural for log streams).
 *
 * Inspired by opencode's session-parts view but more compact.
 *
 * Width-aware: never overflows the terminal width.
 */

import React from 'react';
import { Box, Text } from 'ink';
import { theme, glyph, padEnd, padStart, truncate } from './theme.js';
import type { Activity, ActivityKind, ActivityStatus } from './activity-store.js';

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

function statusChar(status: ActivityStatus, frame: number): { ch: string; color: string } {
  if (status === 'pending') return { ch: glyph.pending, color: theme.fgSubtle };
  if (status === 'running') return { ch: SPINNER_FRAMES[frame % SPINNER_FRAMES.length], color: theme.primary };
  if (status === 'success') return { ch: glyph.success, color: theme.success };
  if (status === 'error')   return { ch: glyph.fail,    color: theme.danger };
  if (status === 'skipped') return { ch: glyph.skip,    color: theme.fgSubtle };
  return { ch: '?', color: theme.fgMuted };
}

function kindColor(kind: ActivityKind): string {
  switch (kind) {
    case 'read':     return theme.sky;
    case 'write':    return theme.accent;
    case 'edit':     return theme.lavender;
    case 'bash':     return theme.mint;
    case 'grep':     return theme.sky;
    case 'search':   return theme.info;
    case 'fetch':    return theme.info;
    case 'plan':     return theme.secondary;
    case 'observe':  return theme.fgMuted;
    case 'ground':   return theme.fgSubtle;
    case 'verify':   return theme.success;
    case 'diagnose': return theme.warning;
    case 'subagent': return theme.primary;
    case 'message':  return theme.fg;
    case 'system':   return theme.fgSubtle;
    default:         return theme.fg;
  }
}

function kindLabel(kind: ActivityKind): string {
  switch (kind) {
    case 'read':     return 'READ';
    case 'write':    return 'WRITE';
    case 'edit':     return 'EDIT';
    case 'bash':     return 'BASH';
    case 'grep':     return 'GREP';
    case 'search':   return 'WEB';
    case 'fetch':    return 'FETCH';
    case 'plan':     return 'PLAN';
    case 'observe':  return 'OBS';
    case 'ground':   return 'GRND';
    case 'verify':   return 'TEST';
    case 'diagnose': return 'DIAG';
    case 'subagent': return 'AGENT';
    case 'message':  return 'MSG';
    case 'system':   return 'SYS';
    default:         return '?';
  }
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  if (isNaN(d.getTime())) return '--:--:--';
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}:${d.getSeconds().toString().padStart(2, '0')}`;
}

function formatDuration(ms: number | undefined): string {
  if (ms === undefined) return '';
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m${Math.floor((ms % 60_000) / 1000)}s`;
}

export interface ActivityFeedProps {
  activities: Activity[];
  /** Terminal width (in characters) */
  width?: number;
  /** Max number of activities to show (default 20) */
  maxItems?: number;
  /** Spinner animation frame (0-9) */
  frame?: number;
  /** Whether to auto-scroll to bottom (default true) */
  autoScroll?: boolean;
  /** Optional title */
  title?: string;
}

export const ActivityFeed: React.FC<ActivityFeedProps> = ({
  activities,
  width = 100,
  maxItems = 20,
  frame = 0,
  title,
}) => {
  const visible = activities.slice(-maxItems);
  if (visible.length === 0) {
    return (
      <Box flexDirection="column" width={width}>
        {title && <Text color={theme.fgSubtle} bold> {title}</Text>}
        <Text color={theme.fgMuted}>  waiting for activity…</Text>
      </Box>
    );
  }

  // Column widths (sized to never overflow when terminal is narrow)
  const labelWidth = 6;
  const tsWidth = 8;
  const durWidth = 7;
  // Reserve 4 chars for status glyph + spaces + minimum spacing
  const summaryWidth = Math.max(15, width - labelWidth - tsWidth - durWidth - 8);

  return (
    <Box flexDirection="column" width={width}>
      {title && (
        <Text color={theme.fgMuted} bold> {title} ({visible.length})</Text>
      )}
      {visible.map((a) => {
        const s = statusChar(a.status, frame);
        const kind = kindColor(a.kind);
        const label = padEnd(kindLabel(a.kind), labelWidth);
        const ts = formatTime(a.start_ts);
        const dur = formatDuration(a.durationMs);
        const durPadded = padStart(dur, durWidth);
        return (
          <Box key={a.id} flexDirection="row">
            <Text color={s.color}>{s.ch} </Text>
            <Text color={kind} bold>{label}</Text>
            <Text color={theme.fg}> {truncate(a.summary, summaryWidth)}</Text>
            <Text color={theme.fgSubtle}>  {ts} {durPadded}</Text>
          </Box>
        );
      })}
      {activities.length > maxItems && (
        <Text color={theme.fgSubtle}>  … {activities.length - maxItems} earlier (press ctrl+l to scroll)</Text>
      )}
    </Box>
  );
};
