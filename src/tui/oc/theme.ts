/**
 * OpenCode-inspired theme for Huagent's TUI.
 *
 * Ported from packages/tui/src/theme/assets/opencode.json in the OpenCode
 * repo, but adapted to Huagent's React+Ink stack (which uses hex strings
 * instead of {dark, light} pairs since Ink only renders the active palette).
 *
 * The palette is a 12-step grayscale ("darkStep1" through "darkStep12")
 * plus semantic colors (primary, secondary, accent, error, warning, etc.).
 * The semantic tokens map to specific step indices, so swapping themes
 * later is a matter of regenerating this file from a different theme.json.
 *
 * Design philosophy (from OpenCode):
 *   - Less emoji, more text + color.
 *   - Generous whitespace.
 *   - Single-side borders, not full boxes.
 *   - Spinner uses braille (already in Huagent's theme.ts).
 *   - Status semantics: success=green, warn=orange, error=red, info=cyan.
 */

// ─── 12-step grayscale + semantic palette (dark variant) ──────────
export const palette = {
  // Grayscale steps (1 = darkest bg, 12 = brightest text)
  step1:  '#0a0a0a',  // background
  step2:  '#141414',  // backgroundPanel
  step3:  '#1e1e1e',  // backgroundElement
  step4:  '#282828',
  step5:  '#323232',
  step6:  '#3c3c3c',  // borderSubtle
  step7:  '#484848',  // border
  step8:  '#606060',  // borderActive
  step9:  '#fab283',  // primary (warm orange)
  step10: '#ffc09f',
  step11: '#808080',  // textMuted
  step12: '#eeeeee',  // text

  // Semantic
  secondary: '#5c9cf5',  // blue
  accent:    '#9d7cd8',  // purple
  red:       '#e06c75',
  orange:    '#f5a742',
  green:     '#7fd88f',
  cyan:      '#56b6c2',
  yellow:    '#e5c07b',

  // Diff (port of OpenCode diff tokens)
  diffAdded:           '#4fd6be',
  diffRemoved:         '#c53b53',
  diffContext:         '#828bb8',
  diffHunkHeader:      '#828bb8',
  diffHighlightAdded:  '#b8db87',
  diffHighlightRemoved:'#e26a75',
  diffAddedBg:         '#20303b',
  diffRemovedBg:       '#37222c',
  diffContextBg:        '#141414',
  diffLineNumber:      '#8f8f8f',
} as const;

// ─── Public semantic API (mirrors OpenCode's `theme` object) ──────
export const theme = {
  // Backgrounds
  background:          palette.step1,
  backgroundPanel:     palette.step2,
  backgroundElement:   palette.step3,

  // Text
  text:                palette.step12,
  textMuted:           palette.step11,

  // Borders
  border:              palette.step7,
  borderActive:        palette.step8,
  borderSubtle:        palette.step6,

  // Semantic accents
  primary:             palette.step9,
  secondary:           palette.secondary,
  accent:              palette.accent,
  error:               palette.red,
  warning:             palette.orange,
  success:             palette.green,
  info:                palette.cyan,

  // Diff
  diffAdded:           palette.diffAdded,
  diffRemoved:         palette.diffRemoved,
  diffContext:         palette.diffContext,
  diffHunkHeader:      palette.diffHunkHeader,
  diffHighlightAdded:  palette.diffHighlightAdded,
  diffHighlightRemoved:palette.diffHighlightRemoved,
  diffAddedBg:         palette.diffAddedBg,
  diffRemovedBg:       palette.diffRemovedBg,
  diffContextBg:       palette.diffContextBg,
  diffLineNumber:      palette.diffLineNumber,

  // Legacy aliases — keep so existing Huagent components don't break
  // during the migration. New code should use the canonical names above.
  bg:           palette.step1,
  bgElevated:   palette.step3,
  bgSubtle:     palette.step2,
  bgOverlay:    palette.step3,
  fg:           palette.step12,
  fgMuted:      palette.step11,
  fgDim:        palette.step11,
  fgSubtle:     '#565F89',
  fgDisabled:   '#414868',
  sakura:       palette.step10,
  sky:          palette.secondary,
  lavender:     palette.accent,
  mint:         palette.green,
  peach:        palette.step10,
  gold:         palette.yellow,
  chipOn:       palette.green,
  chipOff:      palette.step11,
  chipWarn:     palette.orange,
  danger:       palette.red,

  // Text decoration escapes (kept for legacy callers that build strings)
  reset:        '\x1b[0m',
  bold:         '\x1b[1m',
  dim:          '\x1b[2m',
  italic:       '\x1b[3m',
  underline:    '\x1b[4m',
  inverse:      '\x1b[7m',
} as const;

// ─── Spinner frames (braille — matches OpenCode's default spinner) ──
export const SPINNER_FRAMES = [
  '⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏',
] as const;

// ─── Glyph tokens (text-only, no emoji — matches OpenCode's aesthetic) ──
export const glyph = {
  // Status
  pending:   '·',
  running:   '⠋',
  success:   '✓',
  fail:      '✗',
  warn:      '△',
  skip:      '—',
  arrow:     '▸',
  arrowR:    '→',
  bullet:    '•',
  ellipsis:  '…',

  // Connection status (matches OpenCode footer)
  connected:    '•',
  disconnected: '○',
  mcp:          '⊙',

  // Tree
  branch:    '├',
  branchL:   '└',
  vert:      '│',
  horz:      '─',

  // Box (used by SplitBorder)
  boxH:      '─',
  boxV:      '│',

  // Activity kinds (text labels)
  read:      'read',
  write:     'write',
  edit:      'edit',
  bash:      'bash',
  grep:      'grep',
  search:    'web',
  fetch:     'fetch',
  subagent:  'agent',
  verify:    'test',
  plan:      'plan',
  observe:   'obs',
  diagnose:  'diag',
  ground:    'grnd',
} as const;

// ─── Color helpers (kept from old theme.ts for legacy callers) ────
export function hexToRgb(hex: string): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `${r};${g};${b}`;
}

export function fg(color: string, text: string): string {
  return `\x1b[38;2;${hexToRgb(color)}m${text}\x1b[0m`;
}

export function bg(color: string, text: string): string {
  return `\x1b[48;2;${hexToRgb(color)}m${text}\x1b[0m`;
}

// ─── Layout helpers ───────────────────────────────────────────────
export function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, Math.max(0, max - 1)) + glyph.ellipsis;
}

export function padEnd(s: string, width: number, char: string = ' '): string {
  if (s.length >= width) return s;
  return s + char.repeat(width - s.length);
}

export function padStart(s: string, width: number, char: string = ' '): string {
  if (s.length >= width) return s;
  return char.repeat(width - s.length) + s;
}
