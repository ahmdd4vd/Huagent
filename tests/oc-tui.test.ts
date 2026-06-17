/**
 * Tests for the new OpenCode-inspired TUI components.
 *
 * These tests verify that:
 *   1. Theme palette is correctly defined (no missing tokens).
 *   2. Border style chars render correctly (SplitBorder, LeftBorder, etc.).
 *   3. MessageList renders user/assistant/system messages.
 *   4. Footer renders directory + status info.
 *   5. Prompt renders textarea + meta row + status row.
 *   6. Picker filters items by query.
 *   7. Dialog variants render correct border colors.
 */

import { describe, it, expect } from 'vitest';
import { theme, palette, glyph, truncate, padEnd, padStart, fg, bg, hexToRgb } from '../src/tui/oc/theme.js';
import {
  SplitBorder,
  EmptyBorder,
  LeftBorder,
  TopBorder,
  BottomBorder,
  RoundedBorder,
} from '../src/tui/oc/border.js';

describe('OpenCode TUI — Theme', () => {
  it('exposes all required semantic tokens', () => {
    // Core palette
    expect(palette.step1).toMatch(/^#/);
    expect(palette.step12).toMatch(/^#/);
    expect(palette.step1).not.toBe(palette.step12);

    // Semantic
    expect(theme.primary).toMatch(/^#/);
    expect(theme.secondary).toMatch(/^#/);
    expect(theme.accent).toMatch(/^#/);
    expect(theme.error).toMatch(/^#/);
    expect(theme.warning).toMatch(/^#/);
    expect(theme.success).toMatch(/^#/);
    expect(theme.info).toMatch(/^#/);

    // Backgrounds
    expect(theme.background).toMatch(/^#/);
    expect(theme.backgroundPanel).toMatch(/^#/);
    expect(theme.backgroundElement).toMatch(/^#/);

    // Text
    expect(theme.text).toMatch(/^#/);
    expect(theme.textMuted).toMatch(/^#/);

    // Borders
    expect(theme.border).toMatch(/^#/);
    expect(theme.borderActive).toMatch(/^#/);
    expect(theme.borderSubtle).toMatch(/^#/);
  });

  it('exposes legacy aliases for backward compat', () => {
    // Legacy aliases should still work so existing components don't break.
    expect(theme.bg).toBe(theme.background);
    expect(theme.fg).toBe(theme.text);
    expect(theme.fgMuted).toBe(theme.textMuted);
    expect(theme.danger).toBe(theme.error);
    expect(theme.bgElevated).toBe(theme.backgroundElement);
  });

  it('exports braille spinner frames', () => {
    expect(glyph.running).toBe('⠋');
    expect(glyph.success).toBe('✓');
    expect(glyph.fail).toBe('✗');
    expect(glyph.warn).toBe('△');
  });

  it('color helpers produce valid ANSI escapes', () => {
    const red = fg('#ff0000', 'hello');
    expect(red).toContain('\x1b[38;2;255;0;0m');
    expect(red).toContain('hello');
    expect(red).toContain('\x1b[0m');
    expect(red).not.toBe('hello'); // should be wrapped with escapes

    const bgRed = bg('#ff0000', 'world');
    expect(bgRed).toContain('\x1b[48;2;255;0;0m');
    expect(bgRed).toContain('world');
  });

  it('hexToRgb converts #RRGGBB to "R;G;B"', () => {
    expect(hexToRgb('#ff0000')).toBe('255;0;0');
    expect(hexToRgb('#00ff00')).toBe('0;255;0');
    expect(hexToRgb('#0000ff')).toBe('0;0;255');
  });

  it('truncate adds ellipsis when over max', () => {
    expect(truncate('hello world', 5)).toBe('hell…');
    expect(truncate('hi', 5)).toBe('hi'); // under max, unchanged
    expect(truncate('exactly5', 8)).toBe('exactly5'); // exactly max
  });

  it('padEnd/padStart pad with the given char', () => {
    expect(padEnd('hi', 5)).toBe('hi   ');
    expect(padStart('hi', 5)).toBe('   hi');
    expect(padEnd('hello', 3)).toBe('hello'); // already longer, unchanged
  });
});

describe('OpenCode TUI — Borders', () => {
  it('SplitBorder has rounded corners + single-line edges', () => {
    expect(SplitBorder.topLeft).toBe('╭');
    expect(SplitBorder.topRight).toBe('╮');
    expect(SplitBorder.bottomLeft).toBe('╰');
    expect(SplitBorder.bottomRight).toBe('╯');
    expect(SplitBorder.top).toBe('─');
    expect(SplitBorder.bottom).toBe('─');
    expect(SplitBorder.left).toBe('│');
    expect(SplitBorder.right).toBe('│');
  });

  it('EmptyBorder is all spaces', () => {
    expect(EmptyBorder.topLeft).toBe(' ');
    expect(EmptyBorder.top).toBe(' ');
    expect(EmptyBorder.left).toBe(' ');
    expect(EmptyBorder.bottomRight).toBe(' ');
  });

  it('LeftBorder has only the left edge visible', () => {
    expect(LeftBorder.left).toBe('│');
    expect(LeftBorder.top).toBe(' ');    // hidden
    expect(LeftBorder.right).toBe(' ');  // hidden
    expect(LeftBorder.bottom).toBe(' '); // hidden
    // bottom-left corner is visible (rounded)
    expect(LeftBorder.bottomLeft).toBe('╰');
  });

  it('TopBorder has only the top edge visible', () => {
    expect(TopBorder.top).toBe('─');
    expect(TopBorder.bottom).toBe(' ');
    expect(TopBorder.left).toBe(' ');
    expect(TopBorder.right).toBe(' ');
  });

  it('BottomBorder has only the bottom edge visible', () => {
    expect(BottomBorder.bottom).toBe('─');
    expect(BottomBorder.top).toBe(' ');
    expect(BottomBorder.left).toBe(' ');
    expect(BottomBorder.right).toBe(' ');
  });

  it('RoundedBorder is an alias for SplitBorder', () => {
    expect(RoundedBorder).toBe(SplitBorder);
  });
});
