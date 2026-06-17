// Mascot glyphs — subtle, modern, non-lebay.
// "Hua" is the agent's spirit; here she's represented as minimal ASCII + a few
// status glyphs. No kaomoji, no emoji, no "senpai".

export const mascots = {
  // Wordmark — used by /help and the banner
  hua: `
       .
      /|\\
     / | \\
    /  |  \\
   /___|___\\
      [_]
      Hua`,

  // Mood glyphs — single chars, no faces
  huaHappy:    '◆',
  huaThinking: '◇',
  huaCoding:   '▣',
  huaCasting:  '◇',
  huaSuccess:  '✓',
  huaError:    '✗',

  // Single-line mascots (for status bar / toasts)
  smallHua:    '◆',
  winkHua:     '◆',
  sleepHua:    '◇',
  excitedHua:  '◆',

  // Borders
  border1: '╭─────────────────────────────────────────────╮',
  border2: '│  huagent by huanime                          │',
  border3: '╰─────────────────────────────────────────────╯',

  // Spinner frames (braille, no emoji)
  loadFrames:   ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'],
  sakuraFrames: ['◆', '◇', '◈', '◉', '○'],
  magicFrames:  ['◆', '◇', '◈', '◉', '○'],
};

// Status glyphs — minimal, semantic
export const statusEmojis = {
  ready:     '◆',
  thinking:  '◇',
  coding:    '▣',
  searching: '○',
  success:   '✓',
  error:     '✗',
  warning:   '!',
  info:      'i',
  magic:     '◆',
  save:      'S',
  load:      'L',
  quest:     'Q',
  level:     '★',
};

// Tool icons — minimal ASCII/unicode (no emoji)
export const toolIcons: Record<string, string> = {
  read:    'R',
  write:   'W',
  edit:    'E',
  bash:    '$',
  search:  '/',
  grep:    'G',
  web:     '@',
  fetch:   'F',
  memory:  'M',
  plan:    'P',
  default: '*',
};

export const getToolIcon = (name: string): string => {
  return toolIcons[name] || toolIcons.default;
};
