/**
 * v4 Activity Components — compact visual cards for each activity kind.
 *
 * Design:
 *   - One-line default view
 *   - Status glyph (· ⠋ ✓ ✗) + kind label + summary
 *   - Optional detail expansion
 *   - Modern, no emoji overload
 *
 * Each component is pure: takes an Activity, returns Ink JSX.
 */

import React from 'react';
import { Box, Text } from 'ink';
import { theme, glyph, fg, padEnd, truncate } from './theme.js';
import type { Activity, ActivityStatus, ActivityKind } from './activity-store.js';

// ─── Status helpers ───────────────────────────────────────────
export function statusGlyph(status: ActivityStatus, frame?: number): { char: string; color: string } {
  if (status === 'pending')  return { char: glyph.pending, color: theme.fgSubtle };
  if (status === 'running')  return { char: SPINNER_AT(frame ?? 0), color: theme.primary };
  if (status === 'success')  return { char: glyph.success, color: theme.success };
  if (status === 'error')    return { char: glyph.fail, color: theme.danger };
  if (status === 'skipped')  return { char: glyph.skip, color: theme.fgSubtle };
  return { char: '?', color: theme.fgMuted };
}

// A static snapshot of the spinner (caller can pass frame for animation)
const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
function SPINNER_AT(frame: number): string {
  return SPINNER_FRAMES[frame % SPINNER_FRAMES.length];
}

// ─── Kind-specific color ──────────────────────────────────────
export function kindColor(kind: ActivityKind): string {
  switch (kind) {
    case 'read':      return theme.sky;
    case 'write':     return theme.accent;
    case 'edit':      return theme.lavender;
    case 'bash':      return theme.mint;
    case 'grep':      return theme.sky;
    case 'search':    return theme.info;
    case 'fetch':     return theme.info;
    case 'plan':      return theme.secondary;
    case 'observe':   return theme.fgMuted;
    case 'ground':    return theme.fgMuted;
    case 'verify':    return theme.success;
    case 'diagnose':  return theme.warning;
    case 'subagent':  return theme.primary;
    case 'message':   return theme.fg;
    case 'system':    return theme.fgMuted;
    default:          return theme.fg;
  }
}

export function kindLabel(kind: ActivityKind): string {
  switch (kind) {
    case 'read':      return 'READ';
    case 'write':     return 'WRITE';
    case 'edit':      return 'EDIT';
    case 'bash':      return 'BASH';
    case 'grep':      return 'GREP';
    case 'search':    return 'WEB';
    case 'fetch':     return 'FETCH';
    case 'plan':      return 'PLAN';
    case 'observe':   return 'OBS';
    case 'ground':    return 'GRND';
    case 'verify':    return 'TEST';
    case 'diagnose':  return 'DIAG';
    case 'subagent':  return 'AGENT';
    case 'message':   return 'MSG';
    case 'system':    return 'SYS';
    default:          return '?';
  }
}

// ─── Single activity card ─────────────────────────────────────

export interface ActivityCardProps {
  activity: Activity;
  /** Spinner frame index for animation (0-9) */
  frame?: number;
  /** Terminal width for summary truncation */
  width?: number;
  /** Show detail (multi-line) below summary */
  showDetail?: boolean;
  /** Compact mode: only show kind + status, no summary */
  compact?: boolean;
}

export const ActivityCard: React.FC<ActivityCardProps> = ({
  activity,
  frame = 0,
  width = 100,
  showDetail = false,
  compact = false,
}) => {
  const status = statusGlyph(activity.status, frame);
  const kind = kindColor(activity.kind);
  const label = kindLabel(activity.kind);
  const labelWidth = 6; // READ/WRITE/etc.
  const ts = formatTime(activity.start_ts);
  const dur = activity.durationMs !== undefined ? formatDuration(activity.durationMs) : '';

  // Truncate summary to fit width
  const meta = `${ts} ${dur}`.trim();
  const prefix = `${status.char} ${padEnd(label, labelWidth)}`;
  const available = Math.max(10, width - prefix.length - meta.length - 4);
  const summary = truncate(activity.summary, available);

  return (
    <Box flexDirection="column" marginY={0}>
      <Box>
        <Text color={status.color}>{status.char} </Text>
        <Text color={kind} bold>{padEnd(label, labelWidth)}</Text>
        <Text color={theme.fg}> {summary}</Text>
        <Text color={theme.fgSubtle}>  {meta}</Text>
      </Box>
      {showDetail && activity.detail && (
        <Box marginLeft={9}>
          <Text color={theme.fgMuted}>{truncate(activity.detail, Math.max(20, width - 12))}</Text>
        </Box>
      )}
    </Box>
  );
};

// ─── Specialized activity cards ───────────────────────────────

/**
 * ReadActivity — shows file path + line count
 */
export const ReadActivity: React.FC<{ activity: Activity; width?: number; frame?: number }> = ({
  activity,
  width = 100,
  frame = 0,
}) => {
  const status = statusGlyph(activity.status, frame);
  const meta = activity.meta ?? {};
  const args = (meta.args as any) ?? {};
  const fp = (args.file_path ?? args.path ?? activity.summary) as string;
  const lines = (meta.lines ?? meta.lineCount) as number | undefined;
  const summary = lines ? `read ${fp} (${lines} lines)` : `read ${fp}`;
  return (
    <Box>
      <Text color={status.color}>{status.char} </Text>
      <Text color={theme.sky} bold>READ   </Text>
      <Text color={theme.fg}>{truncate(summary, width - 20)}</Text>
      <Text color={theme.fgSubtle}>  {formatTime(activity.start_ts)}</Text>
    </Box>
  );
};

/**
 * WriteActivity — shows file path + bytes/lines written
 */
export const WriteActivity: React.FC<{ activity: Activity; width?: number; frame?: number }> = ({
  activity,
  width = 100,
  frame = 0,
}) => {
  const status = statusGlyph(activity.status, frame);
  const args = (activity.meta?.args as any) ?? {};
  const fp = (args.file_path ?? args.path ?? activity.summary) as string;
  return (
    <Box>
      <Text color={status.color}>{status.char} </Text>
      <Text color={theme.accent} bold>WRITE  </Text>
      <Text color={theme.fg}>{truncate(`write ${fp}`, width - 20)}</Text>
      <Text color={theme.fgSubtle}>  {formatTime(activity.start_ts)}</Text>
    </Box>
  );
};

/**
 * EditActivity — shows search/replace diff
 */
export const EditActivity: React.FC<{ activity: Activity; width?: number; frame?: number }> = ({
  activity,
  width = 100,
  frame = 0,
}) => {
  const status = statusGlyph(activity.status, frame);
  const args = (activity.meta?.args as any) ?? {};
  const fp = (args.file_path ?? args.path ?? activity.summary) as string;
  return (
    <Box>
      <Text color={status.color}>{status.char} </Text>
      <Text color={theme.lavender} bold>EDIT   </Text>
      <Text color={theme.fg}>{truncate(`edit ${fp}`, width - 20)}</Text>
      <Text color={theme.fgSubtle}>  {formatTime(activity.start_ts)}</Text>
    </Box>
  );
};

/**
 * BashActivity — shows command + intent
 */
export const BashActivity: React.FC<{ activity: Activity; width?: number; frame?: number }> = ({
  activity,
  width = 100,
  frame = 0,
}) => {
  const status = statusGlyph(activity.status, frame);
  const args = (activity.meta?.args as any) ?? {};
  const cmd = (args.command ?? activity.summary) as string;
  const exit = activity.meta?.exitCode as number | undefined;
  const dur = activity.durationMs !== undefined ? formatDuration(activity.durationMs) : '';
  const exitText = exit !== undefined ? ` exit=${exit}` : '';
  return (
    <Box>
      <Text color={status.color}>{status.char} </Text>
      <Text color={theme.mint} bold>BASH   </Text>
      <Text color={theme.fg}>$ {truncate(cmd, width - 30)}</Text>
      <Text color={theme.fgSubtle}>{exitText} {dur}</Text>
    </Box>
  );
};

/**
 * SubagentActivity — shows subagent name, task, status
 */
export const SubagentActivity: React.FC<{ activity: Activity; width?: number; frame?: number; progress?: number }> = ({
  activity,
  width = 100,
  frame = 0,
  progress,
}) => {
  const status = statusGlyph(activity.status, frame);
  const name = (activity.meta?.name as string) ?? 'agent';
  const task = (activity.meta?.task as string) ?? activity.summary;
  const pct = progress !== undefined ? ` ${Math.round(progress * 100)}%` : '';
  return (
    <Box>
      <Text color={status.color}>{status.char} </Text>
      <Text color={theme.primary} bold>AGENT  </Text>
      <Text color={theme.accent}>{name}</Text>
      <Text color={theme.fg}> {truncate(task, width - 30)}</Text>
      <Text color={theme.fgSubtle}>{pct}</Text>
    </Box>
  );
};

/**
 * VerifyActivity — shows test command + pass/fail
 */
export const VerifyActivity: React.FC<{ activity: Activity; width?: number; frame?: number }> = ({
  activity,
  width = 100,
  frame = 0,
}) => {
  const status = statusGlyph(activity.status, frame);
  const cmd = (activity.meta?.command as string) ?? activity.summary;
  const dur = activity.durationMs !== undefined ? formatDuration(activity.durationMs) : '';
  return (
    <Box>
      <Text color={status.color}>{status.char} </Text>
      <Text color={theme.success} bold>TEST   </Text>
      <Text color={theme.fg}>{truncate(cmd, width - 25)}</Text>
      <Text color={activity.status === 'success' ? theme.success : theme.danger} bold>
        {activity.status === 'success' ? ' PASS' : activity.status === 'error' ? ' FAIL' : ''}
      </Text>
      <Text color={theme.fgSubtle}> {dur}</Text>
    </Box>
  );
};

// ─── Helpers ──────────────────────────────────────────────────
function formatTime(ts: number): string {
  const d = new Date(ts);
  const h = d.getHours().toString().padStart(2, '0');
  const m = d.getMinutes().toString().padStart(2, '0');
  const s = d.getSeconds().toString().padStart(2, '0');
  return `${h}:${m}:${s}`;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m${Math.floor((ms % 60_000) / 1000)}s`;
}
