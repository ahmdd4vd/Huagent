/**
 * Enhanced Loading States — Rich progress tracking with actions.
 * 
 * Phase 4: UX Polish
 * 
 * Features:
 * - Visual progress bar
 * - Current step description
 * - File/step count
 * - Time tracking + ETA
 * - Action buttons (Cancel, Details, Background)
 * - Cancellable operations
 */

import React, { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import { theme } from './theme.js';

export interface LoadingAction {
  label: string;
  key: string;
  action: () => void;
  color?: string;
}

export interface EnhancedLoadingProps {
  /** Title */
  title: string;
  /** Current step description */
  currentStep?: string;
  /** Current step number */
  current: number;
  /** Total steps */
  total: number;
  /** Start time */
  startTime?: number;
  /** Show ETA */
  showETA?: boolean;
  /** Available actions */
  actions?: LoadingAction[];
  /** Callback when cancelled */
  onCancel?: () => void;
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
 * Calculate ETA based on progress.
 */
function calculateETA(current: number, total: number, elapsed: number): number {
  if (current === 0 || elapsed === 0) return 0;
  const avgTimePerStep = elapsed / current;
  const remainingSteps = total - current;
  return remainingSteps * avgTimePerStep;
}

/**
 * EnhancedLoading component.
 */
export const EnhancedLoading: React.FC<EnhancedLoadingProps> = ({
  title,
  currentStep,
  current,
  total,
  startTime = Date.now(),
  showETA = true,
  actions = [],
  onCancel,
}) => {
  const [now, setNow] = useState(Date.now());

  // Update every second
  useEffect(() => {
    const interval = setInterval(() => {
      setNow(Date.now());
    }, 1000);

    return () => clearInterval(interval);
  }, []);

  useInput((input, key) => {
    // Handle action keys
    for (const action of actions) {
      if (input === action.key) {
        action.action();
        return;
      }
    }

    // Handle Esc for cancel
    if (key.escape && onCancel) {
      onCancel();
    }
  });

  const percentage = Math.round((current / total) * 100);
  const elapsed = now - startTime;
  const eta = calculateETA(current, total, elapsed);

  // Progress bar (30 chars wide)
  const barWidth = 30;
  const filled = Math.round((current / total) * barWidth);
  const empty = barWidth - filled;
  const bar = '█'.repeat(filled) + '░'.repeat(empty);

  // Color based on progress
  const barColor = percentage >= 100 ? theme.success : percentage >= 50 ? theme.info : theme.warning;

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={theme.border}
      paddingX={1}
      marginY={1}
    >
      {/* Title */}
      <Box>
        <Text color={theme.primary} bold>
          🔍 {title}
        </Text>
      </Box>

      {/* Current step */}
      {currentStep && (
        <Box marginTop={0}>
          <Text color={theme.fg}>
            Current: {currentStep}
          </Text>
        </Box>
      )}

      {/* Progress bar */}
      <Box marginTop={1}>
        <Text color={barColor}>[{bar}]</Text>
        <Text color={theme.fg}> {percentage}%</Text>
      </Box>

      {/* Stats */}
      <Box marginTop={0}>
        <Text color={theme.fgSubtle}>
          Progress: {current}/{total}
          {current < total && showETA && ` | ETA: ${formatTime(eta)}`}
          {' | '}Time: {formatTime(elapsed)}
        </Text>
      </Box>

      {/* Actions */}
      {actions.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          <Text color={theme.fgSubtle}>Actions:</Text>
          <Box marginTop={0}>
            {actions.map((action, i) => (
              <React.Fragment key={i}>
                <Text color={action.color || theme.info}>
                  [{action.key.toUpperCase()}] {action.label}
                </Text>
                {i < actions.length - 1 && (
                  <Text color={theme.fgSubtle}> | </Text>
                )}
              </React.Fragment>
            ))}
          </Box>
        </Box>
      )}

      {/* Cancel hint */}
      {onCancel && (
        <Box marginTop={1}>
          <Text color={theme.fgSubtle}>
            Press Esc to cancel
          </Text>
        </Box>
      )}
    </Box>
  );
};

/**
 * Simple loading with spinner.
 */
export const SimpleLoading: React.FC<{
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
 * Loading with progress bar (no actions).
 */
export const LoadingProgress: React.FC<{
  message: string;
  current: number;
  total: number;
  startTime?: number;
}> = ({ message, current, total, startTime = Date.now() }) => {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const interval = setInterval(() => {
      setNow(Date.now());
    }, 1000);

    return () => clearInterval(interval);
  }, []);

  const percentage = Math.round((current / total) * 100);
  const elapsed = now - startTime;
  const filled = Math.round((current / total) * 25);
  const empty = 25 - filled;
  const bar = '█'.repeat(filled) + '░'.repeat(empty);

  return (
    <Box flexDirection="column">
      <Box>
        <Text color={theme.fg}>⠋ {message}</Text>
      </Box>
      <Box marginTop={0}>
        <Text color={theme.info}>[{bar}]</Text>
        <Text color={theme.fg}> {percentage}%</Text>
        <Text color={theme.fgSubtle}> ({current}/{total})</Text>
      </Box>
      <Box marginTop={0}>
        <Text color={theme.fgSubtle}>Time: {formatTime(elapsed)}</Text>
      </Box>
    </Box>
  );
};

/**
 * Cancellable operation.
 */
export const CancellableOperation: React.FC<{
  title: string;
  message: string;
  onCancel: () => void;
}> = ({ title, message, onCancel }) => {
  useInput((input, key) => {
    if (key.escape || input === 'c' || input === 'C') {
      onCancel();
    }
  });

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={theme.warning} paddingX={1}>
      <Box>
        <Text color={theme.warning} bold>
          ⚠️ {title}
        </Text>
      </Box>
      <Box marginTop={0}>
        <Text color={theme.fg}>{message}</Text>
      </Box>
      <Box marginTop={1}>
        <Text color={theme.fgSubtle}>
          Press Esc or C to cancel
        </Text>
      </Box>
    </Box>
  );
};

/**
 * Success completion message.
 */
export const SuccessMessage: React.FC<{
  message: string;
  elapsed?: number;
  stats?: Record<string, number | string>;
}> = ({ message, elapsed, stats }) => {
  return (
    <Box flexDirection="column" marginY={1}>
      <Box>
        <Text color={theme.success} bold>
          ✓ {message}
        </Text>
      </Box>
      {elapsed !== undefined && (
        <Box marginTop={0}>
          <Text color={theme.fgSubtle}>
            Completed in {formatTime(elapsed)}
          </Text>
        </Box>
      )}
      {stats && Object.keys(stats).length > 0 && (
        <Box marginTop={0}>
          <Text color={theme.fgSubtle}>
            {Object.entries(stats).map(([key, value], i) => (
              <React.Fragment key={key}>
                {i > 0 && <Text> | </Text>}
                <Text>{key}: {value}</Text>
              </React.Fragment>
            ))}
          </Text>
        </Box>
      )}
    </Box>
  );
};
