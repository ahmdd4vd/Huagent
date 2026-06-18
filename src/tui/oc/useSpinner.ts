/**
 * useSpinnerFrame — cycles through braille spinner frames.
 * Shared across all TUI components.
 */

import { useState, useEffect } from 'react';

export const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'] as const;

export function useSpinnerFrame(intervalMs: number = 80): number {
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setFrame((f) => (f + 1) % SPINNER_FRAMES.length), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return frame;
}
