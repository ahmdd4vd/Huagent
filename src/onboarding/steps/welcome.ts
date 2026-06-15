/**
 * steps/welcome.ts — First onboarding step: brand intro + press Enter.
 *
 * Runs in raw mode, NOT in Ink. Writes to stdout directly.
 */
import { fg, gradient, glyph } from '../../tui/theme.js';

export async function showWelcome(version: string): Promise<void> {
  const lines: string[] = [
    '',
    gradient('╭──────────────────────────────────────────────────────────╮', '#FF6B9D', '#C589E8'),
    gradient('│                                                          │', '#FF6B9D', '#C589E8'),
    gradient('│', '#FF6B9D', '#C589E8') + '   ' + fg('#FFD700', '✦') + '  ' + gradient('huagent v' + version, '#FF6B9D', '#C589E8') + '                                    ' + gradient('│', '#FF6B9D', '#C589E8'),
    gradient('│', '#FF6B9D', '#C589E8') + '   ' + fg('#87CEEB', 'AI coding agent CLI') + '                              ' + gradient('│', '#FF6B9D', '#C589E8'),
    gradient('│', '#FF6B9D', '#C589E8') + '   ' + fg('#FFC75F', '22 providers · 101 models · MIT') + '                  ' + gradient('│', '#FF6B9D', '#C589E8'),
    gradient('│                                                          │', '#FF6B9D', '#C589E8'),
    gradient('╰──────────────────────────────────────────────────────────╯', '#FF6B9D', '#C589E8'),
    '',
    '  ' + fg('#C0CAF5', 'Welcome! Let\'s get you set up in 30 seconds.'),
    '',
    '  ' + fg('#9AA5CE', glyph.bullet + ' Step 1/4  ') + fg('#C0CAF5', 'Choose your LLM provider'),
    '  ' + fg('#9AA5CE', glyph.bullet + ' Step 2/4  ') + fg('#C0CAF5', 'Enter your API key (masked)'),
    '  ' + fg('#9AA5CE', glyph.bullet + ' Step 3/4  ') + fg('#C0CAF5', 'Pick a model for that provider'),
    '  ' + fg('#9AA5CE', glyph.bullet + ' Step 4/4  ') + fg('#C0CAF5', 'Confirm effort level'),
    '',
    '  ' + fg('#7BC74D', 'Press ') + fg('#FFD700', 'Enter') + fg('#7BC74D', ' to begin, ') + fg('#FFD700', 'Ctrl+C') + fg('#7BC74D', ' to exit'),
    '',
  ];
  process.stdout.write(lines.join('\n') + '\n');
  await waitForEnter();
}

async function waitForEnter(): Promise<void> {
  return new Promise((resolve) => {
    const stdin = process.stdin;
    if (!stdin.isTTY) {
      // Non-interactive: just proceed
      resolve();
      return;
    }
    const wasRaw = stdin.isRaw || false;
    stdin.setRawMode(true);
    stdin.resume();
    const onData = (chunk: Buffer) => {
      const s = chunk.toString('utf8');
      stdin.removeListener('data', onData);
      stdin.setRawMode(wasRaw);
      stdin.pause();
      if (s === '\x03') {
        process.exit(0);
      }
      // Any key (Enter or otherwise) proceeds
      resolve();
    };
    stdin.on('data', onData);
  });
}
