/**
 * Custom border characters for OpenCode-style TUI.
 *
 * OpenCode uses "single-side" borders — instead of drawing a full box
 * around a panel, it draws just the left edge (or just the bottom edge).
 * This gives the UI a much lighter, less "boxy" feel.
 *
 * Ported from packages/tui/src/ui/border.ts in the OpenCode repo.
 *
 * Ink's `borderStyle` prop accepts either a built-in name ("single",
 * "round", "bold", "double", etc.) or a custom object with these
 * properties:
 *
 *   {
 *     topLeft, topRight, bottomLeft, bottomRight,
 *     top, bottom, left, right,
 *   }
 *
 * To draw a single-side border with Ink, we set the sides we don't
 * want to a space (' '). Ink still allocates a cell for them, so the
 * interior content area is unchanged.
 */

import type { BoxStyle } from 'cli-boxes';

/**
 * Standard split-border characters (rounded corners, single line).
 * Used when we want a real visible border on one side only.
 */
export const SplitBorder: BoxStyle = {
  topLeft: '╭',
  topRight: '╮',
  bottomLeft: '╰',
  bottomRight: '╯',
  top: '─',
  bottom: '─',
  left: '│',
  right: '│',
};

/**
 * Empty/invisible border. All chars are spaces. Used to add padding
 * without drawing any visible border chars.
 */
export const EmptyBorder: BoxStyle = {
  topLeft: ' ',
  topRight: ' ',
  bottomLeft: ' ',
  bottomRight: ' ',
  top: ' ',
  bottom: ' ',
  left: ' ',
  right: ' ',
};

/**
 * Left-only border. Only the left edge is visible; top/bottom/right are
 * spaces. This is the canonical OpenCode "prompt" border style.
 *
 * Note: Ink doesn't have a "draw only left" option — we have to use
 * borderStyle + custom chars. The top/bottom corners on the left will
 * be visible as part of the left edge, so we use the bottom-left and
 * top-left chars from SplitBorder.
 */
export const LeftBorder: BoxStyle = {
  topLeft: ' ',
  topRight: ' ',
  bottomLeft: '╰',
  bottomRight: ' ',
  top: ' ',
  bottom: ' ',
  left: '│',
  right: ' ',
};

/**
 * Top-only border (a horizontal line above the content).
 */
export const TopBorder: BoxStyle = {
  topLeft: '╭',
  topRight: '╮',
  bottomLeft: ' ',
  bottomRight: ' ',
  top: '─',
  bottom: ' ',
  left: ' ',
  right: ' ',
};

/**
 * Bottom-only border (a horizontal line below the content).
 */
export const BottomBorder: BoxStyle = {
  topLeft: ' ',
  topRight: ' ',
  bottomLeft: '╰',
  bottomRight: '╯',
  top: ' ',
  bottom: '─',
  left: ' ',
  right: ' ',
};

/**
 * A rounded full border. Used for modal dialogs and pickers.
 */
export const RoundedBorder: BoxStyle = SplitBorder;
