/**
 * Progress Indicator — Real-time progress tracking.
 * 
 * Phase 3: TUI Polish
 * 
 * Features:
 * - Visual progress bar
 * - Percentage display
 * - Step count (current/total)
 * - ETA calculation
 * - Elapsed time
 * - Token count + cost
 * - Status message
 */

import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';
import { theme } from './theme.js';

export interface ProgressIndicatorProps {
  /** Current step */
  current: number;
  /** Total steps */
  total: number;
  /** Status message */
  message?: string;
  /** Show ETA */
  showETA?: boolean;
  /** Show elapsed time */
  showElapsed?: boolean;
  /** Show token count */
  showTokens?: boolean;
  /** Token count */
  tokens?: number;
  /** Cost in USD */
  cost?: number;
  /** Start time (for elapsed calculation) */
  startTime?: number;
  /** Max width */
  width?: number;
}

/**
 * Format milliseconds to human-readable time.
 */
function formatTime(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(0)}s`;
  const mins = Math.floor(ms / 60000);
  const secs = Math.floor((ms % 60000) / 1000);
  return `${mins}m ${secs}s`;
}

/**
 * Format cost in USD.
 */
function formatCost(cost: number): string {
  if (cost < 0.01) return `$${cost.toFixed(4)}`;
  if (cost < 1) return `$${cost.toFixed(3)}`;
  return `$${cost.toFixed(2)}`;
}

/**
 * Calculate ETA based on progress.
 */
function calculateETA(current: number, total: number, elapsed: number): number {
  if (current === 0 || elapsed === 0) return 0;
  const avgTimePerStep = elapsed / current;
  const remainingSteps = total - current;
  return remainingSteps * avgTimePerStep;
}

/**
 * ProgressIndicator component.
 */
export const ProgressIndicator: React.FC<ProgressIndicatorProps> = ({
  current,
  total,
  message = 'Processing...',
  showETA = true,
  showElapsed = true,
  showTokens = true,
  tokens = 0,
  cost = 0,
  startTime = Date.now(),
  width,
}) => {
  const [now, setNow] = useState(Date.now());

  // Update every second for elapsed time
  useEffect(() => {
    const interval = setInterval(() => {
      setNow(Date.now());
    }, 1000);

    return () => clearInterval(interval);
  }, []);

  const percentage = Math.round((current / total) * 100);
  const elapsed = now - startTime;
  const eta = calculateETA(current, total, elapsed);

  // Progress bar (25 chars wide)
  const barWidth = 25;
  const filled = Math.round((current / total) * barWidth);
  const empty = barWidth - filled;
  const bar = '█'.repeat(filled) + '░'.repeat(empty);

  // Color based on progress
  const barColor = percentage >= 100 ? theme.success : percentage >= 50 ? theme.info : theme.warning;

  return (
    <Box flexDirection="column" marginY={1} width={width}>
      {/* Progress bar */}
      <Box>
        <Text color={barColor}>[{bar}]</Text>
        <Text color={theme.fg}> {percentage}%</Text>
        <Text color={theme.fgSubtle}> ({current}/{total} steps)</Text>
      </Box>

      {/* Status message */}
      <Box marginTop={0}>
        <Text color={theme.fg}>⠋ {message}</Text>
        {showETA && current < total && (
          <Text color={theme.fgSubtle}> (ETA: {formatTime(eta)})</Text>
        )}
      </Box>

      {/* Stats */}
      <Box marginTop={0}>
        <Text color={theme.fgSubtle}>
          {showElapsed && <Text>Elapsed: {formatTime(elapsed)}</Text>}
          {showElapsed && showTokens && <Text> | </Text>}
          {showTokens && tokens > 0 && <Text>Tokens: {tokens.toLocaleString()}</Text>}
          {showTokens && cost > 0 && <Text> | </Text>}
          {cost > 0 && <Text>Cost: {formatCost(cost)}</Text>}
        </Text>
      </Box>
    </Box>
  );
};

/**
 * Simple progress bar (no stats).
 */
export const SimpleProgressBar: React.FC<{
  current: number;
  total: number;
  color?: string;
}> = ({ current, total, color = theme.info }) => {
  const percentage = Math.round((current / total) * 100);
  const filled = Math.round((current / total) * 25);
  const empty = 25 - filled;
  const bar = '█'.repeat(filled) + '░'.repeat(empty);

  return (
    <Box>
      <Text color={color}>[{bar}]</Text>
      <Text color={theme.fg}> {percentage}%</Text>
    </Box>
  );
};

/**
 * Step indicator (e.g., "Step 3 of 5").
 */
export const StepIndicator: React.FC<{
  current: number;
  total: number;
  label?: string;
}> = ({ current, total, label = 'Step' }) => {
  return (
    <Box>
      <Text color={theme.fg}>
        {label} {current} of {total}
      </Text>
      <Text color={theme.fgSubtle}>
        {' '}({Math.round((current / total) * 100)}%)
      </Text>
    </Box>
  );
};

/**
 * Spinner with message.
 */
export const SpinnerMessage: React.FC<{
  message: string;
  elapsed?: number;
}> = ({ message, elapsed }) => {
  return (
    <Box>
      <Text color={theme.fg}>⠋ {message}</Text>
      {elapsed !== undefined && (
        <Text color={theme.fgSubtle}> ({formatTime(elapsed)})</Text>
      )}
    </Box>
  );
};

/**
 * Stats display (tokens, cost, time).
 */
export const StatsDisplay: React.FC<{
  tokens?: number;
  cost?: number;
  elapsed?: number;
  requests?: number;
}> = ({ tokens, cost, elapsed, requests }) => {
  return (
    <Box>
      <Text color={theme.fgSubtle}>
        {elapsed !== undefined && <Text>Time: {formatTime(elapsed)}</Text>}
        {elapsed !== undefined && tokens !== undefined && <Text> | </Text>}
        {tokens !== undefined && <Text>Tokens: {tokens.toLocaleString()}</Text>}
        {tokens !== undefined && cost !== undefined && <Text> | </Text>}
        {cost !== undefined && <Text>Cost: {formatCost(cost)}</Text>}
        {cost !== undefined && requests !== undefined && <Text> | </Text>}
        {requests !== undefined && <Text>Requests: {requests}</Text>}
      </Text>
    </Box>
  );
};
