/**
 * useSpinnerFrame — cycles through braille spinner frames.
 *
 * Shared between MessageList, Prompt, and other components that need a
 * braille spinner animation. Extracted to a single file so we don't have
 * three copies of the same useState + setInterval pattern.
 *
 * @param intervalMs Frame interval in milliseconds (default 80ms).
 * @returns The current frame index (0-9). Use SPINNER_FRAMES[frame] to
 *         get the actual character.
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
