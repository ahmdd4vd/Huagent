/**
 * v4 Theme — Modern, restrained, anime-inspired.
 *
 * Design principles (Fable-5 inspired, but our own):
 *   1. LESS EMOJI. Most status uses text + color, not emoji.
 *   2. Generous whitespace for readability.
 *   3. Subtle anime aesthetic via accent colors, not mascot overload.
 *   4. Modern dark palette (Tokyo Night inspired).
 *   5. Status semantics: success=green, warn=amber, danger=red, info=blue.
 *   6. Spinner uses braille (⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏) for elegance.
 *
 * Inspired by opencode's `packages/tui/src/theme` — but lighter.
 */

// ─── Semantic tokens (the public API) ──────────────────────────
export const theme = {
  // Backgrounds
  bg:           '#1A1B26',  // base
  bgElevated:   '#24283B',  // raised surface
  bgSubtle:     '#16161E',  // recessed
  bgOverlay:    '#1F2335',  // modals

  // Foregrounds
  fg:           '#C0CAF5',  // primary text
  fgMuted:      '#9AA5CE',  // secondary
  /** @deprecated use fgMuted */
  fgDim:        '#9AA5CE',
  fgSubtle:     '#565F89',  // tertiary
  fgDisabled:   '#414868',

  // Borders
  border:       '#292E42',
  borderActive: '#7AA2F7',
  borderSubtle: '#1F2335',

  // Accent palette (anime touches, used sparingly)
  sakura:       '#FFB7C5',  // soft pink
  sky:          '#87CEEB',  // sky blue
  lavender:     '#E6BBFF',  // magical purple
  mint:         '#B5EAD7',  // mint green
  peach:        '#FFDAC1',
  gold:         '#FFD700',

  // Semantic
  primary:      '#FF6B9D',  // hot pink (love)
  secondary:    '#C589E8',  // mystic purple
  accent:       '#FFC75F',  // sparkle gold
  success:      '#7BC74D',
  warning:      '#FFB347',
  danger:       '#FF6B6B',
  info:         '#6BCBFF',

  // Mode chips
  chipOn:       '#7BC74D',  // active mode (autonomous, scope)
  chipOff:      '#565F89',  // inactive
  chipWarn:     '#FFB347',  // warning (autonomous on)

  // Text
  reset:        '\x1b[0m',
  bold:         '\x1b[1m',
  dim:          '\x1b[2m',
  italic:       '\x1b[3m',
  underline:    '\x1b[4m',
  inverse:      '\x1b[7m',

  // Legacy aliases for backward compat with existing code
  sparkle:      '✦',
} as const;

/**
 * Legacy helper: wrap text in a sparkle (✦) prefix.
 * Kept for backward compat with old cli.tsx banner code.
 */
export function sparkleText(text: string): string {
  return `${theme.sparkle} ${text}`;
}

// ─── Spinner frames (braille, elegant) ─────────────────────────
export const SPINNER_FRAMES = [
  '⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏',
];

export const SPINNER_DOTS = ['·', '•', '·', ' '];

// ─── Glyph tokens (used sparingly, not as emoji) ───────────────
export const glyph = {
  // Status — text, not emoji
  pending:   '·',
  running:   '⠋',  // braille
  success:   '✓',
  fail:      '✗',
  warn:      '!',
  skip:      '—',
  arrow:     '▸',
  arrowR:    '→',
  bullet:    '·',
  ellipsis:  '…',
  // Tree
  branch:    '├',
  branchL:   '└',
  branchT:   '├',
  vert:      '│',
  horz:      '─',
  // Box
  boxH:      '─',
  boxV:      '│',
  // Activity kinds (text labels, no emoji)
  read:      'READ',
  write:     'WRITE',
  edit:      'EDIT',
  bash:      'BASH',
  grep:      'GREP',
  search:    'WEB',
  fetch:     'FETCH',
  subagent:  'AGENT',
  verify:    'TEST',
  plan:      'PLAN',
  observe:   'OBS',
  diagnose:  'DIAG',
  ground:    'GRND',
} as const;

// ─── Helpers ───────────────────────────────────────────────────
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

export function gradient(text: string, from: string, to: string): string {
  const fr = parseInt(from.slice(1, 3), 16);
  const fg_ = parseInt(from.slice(3, 5), 16);
  const fb = parseInt(from.slice(5, 7), 16);
  const tr = parseInt(to.slice(1, 3), 16);
  const tg = parseInt(to.slice(3, 5), 16);
  const tb = parseInt(to.slice(5, 7), 16);
  const chars = Array.from(text);
  const n = chars.length;
  return chars
    .map((c, i) => {
      const t = n > 1 ? i / (n - 1) : 0;
      const r = Math.round(fr + (tr - fr) * t);
      const g = Math.round(fg_ + (tg - fg_) * t);
      const b = Math.round(fb + (tb - fb) * t);
      return `\x1b[38;2;${r};${g};${b}m${c}\x1b[0m`;
    })
    .join('');
}

/**
 * Render a horizontal progress bar.
 *   [████████░░] 80%
 */
export function bar(value: number, max: number, width: number = 20, color: string = theme.success): string {
  const pct = Math.max(0, Math.min(1, value / Math.max(1, max)));
  const filled = Math.round(pct * width);
  const empty = width - filled;
  return fg(color, '█'.repeat(filled)) + fg(theme.fgSubtle, '░'.repeat(empty)) + ` ${Math.round(pct * 100)}%`;
}

/**
 * Truncate a string to fit terminal width with ellipsis.
 */
export function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, Math.max(0, max - 1)) + glyph.ellipsis;
}

/**
 * Pad a string to a fixed width (right-padded with spaces).
 */
export function padEnd(s: string, width: number, char: string = ' '): string {
  if (s.length >= width) return s;
  return s + char.repeat(width - s.length);
}

/**
 * Pad a string to a fixed width (left-padded with spaces).
 */
export function padStart(s: string, width: number, char: string = ' '): string {
  if (s.length >= width) return s;
  return char.repeat(width - s.length) + s;
}

/**
 * Pad a string to a fixed width (center-padded with spaces).
 */
export function padCenter(s: string, width: number, char: string = ' '): string {
  if (s.length >= width) return s;
  const total = width - s.length;
  const left = Math.floor(total / 2);
  const right = total - left;
  return char.repeat(left) + s + char.repeat(right);
}

// ─── Mode chip helpers ─────────────────────────────────────────
export interface ModeChip {
  label: string;
  on: boolean;
  warn?: boolean;
  detail?: string;
}

export function renderModeChips(chips: ModeChip[]): string {
  return chips
    .map((c) => {
      const color = c.on ? (c.warn ? theme.chipWarn : theme.chipOn) : theme.chipOff;
      const marker = c.on ? '●' : '○';
      return fg(color, `[${marker} ${c.label}${c.detail ? `: ${c.detail}` : ''}]`);
    })
    .join(' ');
}
