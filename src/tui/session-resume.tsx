/**
 * SessionResume — OpenCode-style session browser.
 *
 * Lists all saved sessions (newest first) with metadata:
 *   - start time
 *   - message count
 *   - project path
 *   - summary
 *
 * User picks one to resume. Filtering by typing matches against
 * summary and project path.
 */

import React, { useState, useMemo } from 'react';
import { Box, Text, useInput } from 'ink';
import { theme, glyph, fg } from './theme.js';
import { Picker, type PickerItem } from './picker.js';

export interface SessionView {
  id: string;
  startTime: number;
  endTime?: number;
  projectPath: string;
  summary?: string;
  messageCount: number;
  /** Optional model/provider info stored in session */
  model?: string;
  provider?: string;
}

export interface SessionResumeProps {
  sessions: SessionView[];
  currentSessionId?: string;
  onSelect: (id: string) => void;
  onCancel: () => void;
  width?: number;
}

function formatRelativeTime(ts: number): string {
  const now = Date.now();
  const diff = now - ts;
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)}d ago`;
  return new Date(ts).toLocaleDateString();
}

function formatProjectPath(p: string): string {
  if (!p) return 'unknown';
  const parts = p.split('/').filter(Boolean);
  if (parts.length <= 3) return p;
  return '…/' + parts.slice(-2).join('/');
}

export function buildSessionItems(sessions: SessionView[], currentId?: string): PickerItem[] {
  return sessions.map((s) => {
    const isCurrent = s.id === currentId;
    const projectName = formatProjectPath(s.projectPath);
    const time = formatRelativeTime(s.startTime);
    const summary = s.summary || '(no summary)';
    return {
      id: s.id,
      label: summary.slice(0, 60),
      detail: `${time} · ${s.messageCount} msgs · ${projectName}`,
      description: `${s.model || '?'} · ${s.provider || '?'} · ${new Date(s.startTime).toISOString().slice(0, 19).replace('T', ' ')}`,
      meta: isCurrent ? 'current' : '',
      current: isCurrent,
    };
  });
}

export const SessionResume: React.FC<SessionResumeProps> = ({
  sessions,
  currentSessionId,
  onSelect,
  onCancel,
  width = 100,
}) => {
  const items = useMemo(() => buildSessionItems(sessions, currentSessionId), [sessions, currentSessionId]);

  if (sessions.length === 0) {
    return (
      <Box flexDirection="column" borderStyle="round" borderColor={theme.borderActive} paddingX={1} width={width}>
        <Text color={theme.primary} bold>Resume Session</Text>
        <Box marginTop={1}>
          <Text color={theme.fgMuted}>No saved sessions yet. Start chatting and your session will be auto-saved.</Text>
        </Box>
        <Box marginTop={1}>
          <Text color={theme.fgSubtle} dimColor>esc close</Text>
        </Box>
      </Box>
    );
  }

  return (
    <Picker
      title="Resume Session"
      items={items}
      onSelect={onSelect}
      onCancel={onCancel}
      width={width}
      maxVisible={10}
    />
  );
};

export default SessionResume;
