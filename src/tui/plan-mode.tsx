/**
 * PlanMode — OpenCode-style plan review overlay.
 *
 * Shows the generated plan (steps, tool calls, parallel groups) and
 * asks the user to approve / reject / edit before execution.
 *
 * Key bindings:
 *   ↑/↓     navigate steps
 *   a       approve
 *   r       reject (triggers replan)
 *   e       edit (sends back to planner with feedback)
 *   esc     reject
 */

import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { theme, glyph, fg } from './theme.js';

export interface PlanStepView {
  id?: string;
  description?: string;
  tool?: string;
  args?: any;
  parallel_group?: number;
  status?: string;
}

export interface PlanView {
  goal?: string;
  steps: PlanStepView[];
  taskType?: string;
  complexity?: string;
}

export interface PlanModeProps {
  plan: PlanView;
  onApprove: () => void;
  onReject: () => void;
  onEdit: (feedback: string) => void;
  width?: number;
}

export const PlanMode: React.FC<PlanModeProps> = ({
  plan,
  onApprove,
  onReject,
  onEdit,
  width = 90,
}) => {
  const [cursor, setCursor] = useState(0);
  const [editing, setEditing] = useState(false);
  const [feedback, setFeedback] = useState('');

  useInput((input, key) => {
    if (editing) {
      if (key.escape) {
        setEditing(false);
        setFeedback('');
        return;
      }
      if (key.return && feedback.trim()) {
        onEdit(feedback.trim());
        setEditing(false);
        setFeedback('');
        return;
      }
      if (key.backspace || key.delete) {
        setFeedback((f) => f.slice(0, -1));
        return;
      }
      if (input && !key.ctrl && !key.meta) {
        setFeedback((f) => f + input);
      }
      return;
    }
    if (key.escape) {
      onReject();
      return;
    }
    if (input === 'a') {
      onApprove();
      return;
    }
    if (input === 'r') {
      onReject();
      return;
    }
    if (input === 'e') {
      setEditing(true);
      return;
    }
    if (key.upArrow) {
      setCursor((c) => Math.max(0, c - 1));
      return;
    }
    if (key.downArrow) {
      setCursor((c) => Math.min(plan.steps.length - 1, c + 1));
      return;
    }
  });

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={theme.warning} paddingX={1} width={width}>
      {/* Title */}
      <Box>
        <Text color={theme.warning} bold>
          {glyph.bullet} Plan Review
        </Text>
        <Text color={theme.fgMuted}> — {plan.steps.length} steps · {plan.complexity ?? '?'} · {plan.taskType ?? '?'}</Text>
      </Box>
      <Box>
        <Text color={theme.fgSubtle}>{glyph.horz.repeat(width - 4)}</Text>
      </Box>

      {/* Goal */}
      {plan.goal && (
        <Box marginBottom={1}>
          <Text color={theme.fgMuted} dimColor>Goal: </Text>
          <Text color={theme.fg}>{plan.goal}</Text>
        </Box>
      )}

      {/* Steps */}
      <Box flexDirection="column">
        {plan.steps.map((step, i) => {
          const isCursor = i === cursor;
          const group = step.parallel_group ?? 0;
          return (
            <Box key={i} flexDirection="column" marginBottom={0}>
              <Box>
                <Text color={isCursor ? theme.primary : theme.fgSubtle} bold={isCursor}>
                  {isCursor ? ' ▸ ' : '   '}
                  {String(i + 1).padStart(2, '0')}.{' '}
                </Text>
                <Text color={isCursor ? theme.fg : theme.fgMuted} bold={isCursor}>
                  {step.description ?? step.id ?? `step ${i + 1}`}
                </Text>
                {step.tool && (
                  <Text color={theme.info}> [{step.tool}]</Text>
                )}
                {group > 0 && (
                  <Text color={theme.accent} dimColor> · ∥group {group}</Text>
                )}
              </Box>
              {/* Args preview */}
              {isCursor && step.args && Object.keys(step.args).length > 0 && (
                <Box marginLeft={6}>
                  <Text color={theme.fgSubtle} dimColor>
                    {Object.entries(step.args)
                      .slice(0, 3)
                      .map(([k, v]) => {
                        const val = typeof v === 'string' ? v.slice(0, 40) : JSON.stringify(v).slice(0, 40);
                        return `${k}=${val}`;
                      })
                      .join(' · ')}
                  </Text>
                </Box>
              )}
            </Box>
          );
        })}
      </Box>

      <Box marginTop={1}>
        <Text color={theme.fgSubtle}>{glyph.horz.repeat(width - 4)}</Text>
      </Box>

      {/* Edit mode */}
      {editing ? (
        <Box flexDirection="column">
          <Box>
            <Text color={theme.accent} bold>Edit feedback:</Text>
          </Box>
          <Box>
            <Text color={theme.fg}>› {feedback}</Text>
            <Text color={theme.accent}>▌</Text>
          </Box>
        </Box>
      ) : (
        <Box>
          <Text color={theme.fgSubtle} dimColor>
            <Text color={theme.success} bold>a</Text> approve ·{' '}
            <Text color={theme.danger} bold>r</Text> reject (replan) ·{' '}
            <Text color={theme.info} bold>e</Text> edit ·{' '}
            <Text color={theme.fgSubtle}>↑↓</Text> step ·{' '}
            <Text color={theme.fgSubtle}>esc</Text> reject
          </Text>
        </Box>
      )}
    </Box>
  );
};

export default PlanMode;
