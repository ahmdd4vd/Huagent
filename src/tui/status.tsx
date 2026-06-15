/**
 * v4 Status Components — ModeChips, SubagentPanel, StatusBar, Toasts.
 *
 * Inspired by opencode's footer + sidebar.
 * Width-aware: each component fits within its given width, no overflow.
 */

import React from 'react';
import { Box, Text } from 'ink';
import { theme, glyph, padEnd, padStart, truncate } from './theme.js';
import type { SubagentState } from './activity-store.js';

// ─── ModeChips: top compact mode indicator (single line) ─────

export interface ModeChipsProps {
  autonomous: boolean;
  scope: string | null;
  permissionMode: string;
  model: string;
  width?: number;
}

export const ModeChips: React.FC<ModeChipsProps> = ({
  autonomous,
  scope,
  permissionMode,
  model,
  width = 100,
}) => {
  // Adaptive: drop the model chip and shrink detail text as width shrinks
  const includeModel = width >= 80;
  const includeScopeDetail = width >= 60 ? 28 : width >= 40 ? 16 : 8;
  const includeModelDetail = width >= 100 ? 18 : width >= 80 ? 12 : 6;

  const chips: { label: string; on: boolean; warn?: boolean; detail?: string }[] = [
    { label: 'autonomous', on: autonomous, warn: autonomous, detail: autonomous ? 'on' : 'off' },
    { label: 'scope', on: !!scope, detail: scope ? truncate(scope, includeScopeDetail) : 'none' },
    { label: 'perm', on: permissionMode === 'allow', detail: permissionMode },
  ];
  if (includeModel) {
    chips.push({ label: 'model', on: false, detail: truncate(model, includeModelDetail) });
  }

  const items = chips.map((c, i) => {
    const color = c.on ? (c.warn ? theme.chipWarn : theme.chipOn) : theme.chipOff;
    const marker = c.on ? '●' : '○';
    return (
      <React.Fragment key={c.label}>
        <Text color={color}>{marker} {c.label}</Text>
        {c.detail && <Text color={c.on ? theme.fg : theme.fgSubtle}> {c.detail}</Text>}
        {i < chips.length - 1 && <Text color={theme.fgSubtle}>  </Text>}
      </React.Fragment>
    );
  });

  return (
    <Box flexDirection="row" width={width}>
      {items}
    </Box>
  );
};

// ─── SubagentPanel: shows running subagents with progress ─────

export interface SubagentPanelProps {
  subagents: SubagentState[];
  width?: number;
}

export const SubagentPanel: React.FC<SubagentPanelProps> = ({ subagents, width = 60 }) => {
  if (subagents.length === 0) return null;
  const running = subagents.filter((s) => s.status === 'running');
  const recent = subagents.filter((s) => s.status !== 'running').slice(-3);

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={theme.border} paddingX={1} width={width}>
      <Text color={theme.primary} bold> subagents ({running.length} running)</Text>
      {running.length > 0 && (
        <Box flexDirection="column" marginTop={0}>
          {running.map((s) => (
            <SubagentRow key={s.id} sub={s} width={width - 4} />
          ))}
        </Box>
      )}
      {running.length > 0 && recent.length > 0 && (
        <Text color={theme.fgSubtle}>  ── recent ──</Text>
      )}
      {recent.length > 0 && (
        <Box flexDirection="column" marginTop={0}>
          {recent.map((s) => (
            <SubagentRow key={s.id} sub={s} width={width - 4} compact />
          ))}
        </Box>
      )}
    </Box>
  );
};

const SubagentRow: React.FC<{ sub: SubagentState; width: number; compact?: boolean }> = ({ sub, width, compact }) => {
  const isRunning = sub.status === 'running';
  const isDone = sub.status === 'success';
  const isError = sub.status === 'error';
  const marker = isRunning ? '⠋' : isDone ? '✓' : isError ? '✗' : '·';
  const markerColor = isRunning ? theme.primary : isDone ? theme.success : isError ? theme.danger : theme.fgSubtle;
  const nameWidth = 12;
  const nameStr = padEnd(sub.name, nameWidth);
  const pctStr = `${Math.round(sub.progress * 100)}%`;
  const pctWidth = 5;
  const taskMaxWidth = Math.max(8, width - nameWidth - pctWidth - 8);
  const taskStr = truncate(sub.task, taskMaxWidth);

  return (
    <Box>
      <Text color={markerColor}>{marker} </Text>
      <Text color={theme.accent} bold>{nameStr}</Text>
      <Text color={theme.fg}> {taskStr}</Text>
      {!compact && <Text color={isRunning ? theme.lavender : isDone ? theme.success : theme.danger}> {padStart(pctStr, pctWidth)}</Text>}
    </Box>
  );
};

// ─── StatusBar: bottom 1-line status (no emoji, never wraps) ───

export interface StatusBarProps {
  stats: { tokens: number; cost: number; requests: number; steps: number };
  permissionMode: string;
  engine: string;
  width?: number;
  autonomous?: boolean;
}

export const StatusBar: React.FC<StatusBarProps> = ({
  stats,
  permissionMode,
  engine,
  width = 100,
  autonomous = false,
}) => {
  const fmtTokens = (n: number) =>
    n < 1000 ? `${n}` : n < 1_000_000 ? `${(n / 1000).toFixed(1)}k` : `${(n / 1_000_000).toFixed(1)}M`;
  const fmtCost = (c: number) => `$${c.toFixed(4)}`;

  // Reserve 2 chars for borders + 2 chars for padding
  const innerWidth = Math.max(40, width - 4);

  // Left segments joined as one Text. We measure the approximate display width
  // and pad with spaces so the right segments stick to the right edge.
  const engineStr = engine || 'v4';
  const tokStr = `${fmtTokens(stats.tokens)} (${fmtCost(stats.cost)})`;
  const permColor = permissionMode === 'allow' ? theme.warning : theme.info;
  const leftText = `${engineStr} │ tok ${tokStr} │ steps ${stats.steps} │ perm ${permissionMode}`;

  // Right text — drop hints progressively when narrow. We render it as ONE
  // Text element (with optional autonomous prefix) to avoid Ink wrapping
  // individual segments across multiple lines.
  const showAuto = autonomous && innerWidth >= 60;
  let rightText = '';
  if (innerWidth >= 80) {
    rightText = 'ctrl+l status · tab complete · ctrl+c exit';
  } else if (innerWidth >= 60) {
    rightText = 'ctrl+l · tab · ctrl+c';
  } else if (innerWidth >= 40) {
    rightText = 'ctrl+c exit';
  } else {
    rightText = '';
  }
  const rightFull = (showAuto ? '● autonomous  ' : '') + rightText;

  // Pad left to push right to the end
  const padding = rightText ? Math.max(1, innerWidth - leftText.length - rightFull.length) : 0;
  const pad = ' '.repeat(padding);

  return (
    <Box borderStyle="round" borderColor={theme.border} paddingX={1} flexDirection="row" width={width}>
      <Text>
        <Text color={theme.fgMuted}>{engineStr}</Text>
        <Text color={theme.fgSubtle}> │</Text>
        <Text color={theme.fg}> tok </Text>
        <Text color={theme.gold}>{tokStr}</Text>
        <Text color={theme.fgSubtle}> │</Text>
        <Text color={theme.fg}> steps </Text>
        <Text color={theme.accent}>{stats.steps}</Text>
        <Text color={theme.fgSubtle}> │</Text>
        <Text color={theme.fg}> perm </Text>
        <Text color={permColor}>{permissionMode}</Text>
        <Text color={theme.fg}>{pad}</Text>
        {showAuto && <Text color={theme.chipWarn}>● autonomous  </Text>}
        {rightText && <Text color={theme.fgSubtle}>{rightText}</Text>}
      </Text>
    </Box>
  );
};

// ─── Toasts: top-right notifications (success/warn/error) ─────

export interface ToastItem {
  id: string;
  level: 'info' | 'success' | 'warn' | 'error';
  message: string;
  createdAt: number;
}

export { ToastItem as ExportedToastItem };

export interface ToastsProps {
  toasts: ToastItem[];
  width?: number;
}

export const Toasts: React.FC<ToastsProps> = ({ toasts, width = 60 }) => {
  if (toasts.length === 0) return null;
  return (
    <Box flexDirection="column" marginY={0} width={width}>
      {toasts.slice(-3).map((t) => {
        const color =
          t.level === 'success' ? theme.success :
          t.level === 'warn'    ? theme.warning :
          t.level === 'error'   ? theme.danger :
                                  theme.info;
        const marker =
          t.level === 'success' ? glyph.success :
          t.level === 'warn'    ? glyph.warn :
          t.level === 'error'   ? glyph.fail :
                                  glyph.bullet;
        return (
          <Box key={t.id} borderStyle="round" borderColor={color} paddingX={1} width={width}>
            <Text color={color} bold>{marker} </Text>
            <Text color={theme.fg}>{truncate(t.message, width - 6)}</Text>
          </Box>
        );
      })}
    </Box>
  );
};
