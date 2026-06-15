/**
 * steps/effort-pick.ts — Final step: confirm effort tier (raw mode).
 *
 * Auto-detects from a sample task description, but user can override.
 * Shows 6 tiers: low / medium / high / xhigh / max / ultramax
 */
import {
  detectEffort,
  EFFORT_DESCRIPTIONS,
  EFFORT_TIERS,
  type EffortTier,
} from '../effort-detector.js';
import { fg, gradient, glyph } from '../../tui/theme.js';

export async function pickEffort(sampleTask?: string): Promise<EffortTier> {
  // Auto-detect from sample (if provided)
  const detected = sampleTask ? detectEffort(sampleTask) : 'medium';

  const rows: Array<{ kind: 'header' | 'item'; text: string; tier?: EffortTier }> = [
    { kind: 'header', text: 'EFFORT TIER' },
  ];
  for (const t of EFFORT_TIERS) {
    const isDetected = t === detected;
    const marker = isDetected ? fg('#FFD700', '★') : ' ';
    rows.push({
      kind: 'item',
      tier: t,
      text: `${marker}  ${t.padEnd(10)}  ${fg('#9AA5CE', EFFORT_DESCRIPTIONS[t])}`,
    });
  }

  let cursor = EFFORT_TIERS.indexOf(detected);
  if (cursor < 0) cursor = 1; // medium

  return new Promise<EffortTier>((resolve, reject) => {
    const stdin = process.stdin;
    if (!stdin.isTTY) {
      resolve(detected);
      return;
    }
    stdin.setRawMode(true);
    stdin.resume();

    const render = () => {
      process.stdout.write('\x1b[2J\x1b[H');
      process.stdout.write('\n');
      process.stdout.write(
        '  ' + gradient('Step 4: Confirm Effort Level', '#FF6B9D', '#C589E8') + '\n',
      );
      process.stdout.write('  ' + fg('#565F89', '─'.repeat(78)) + '\n');
      if (sampleTask) {
        process.stdout.write(
          '  ' + fg('#9AA5CE', 'Detected from your task: ') + fg('#FFD700', detected) + '\n',
        );
      } else {
        process.stdout.write(
          '  ' + fg('#9AA5CE', 'Default: ') + fg('#FFD700', 'medium') + '\n',
        );
      }
      process.stdout.write('\n');

      for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        if (r.kind === 'header') {
          process.stdout.write('  ' + fg('#FFC75F', r.text) + '\n');
        } else {
          const isCursor = i === cursor;
          const prefix = isCursor ? fg('#FF6B9D', glyph.arrow + ' ') : '   ';
          process.stdout.write('  ' + prefix + r.text + '\n');
        }
      }
      process.stdout.write('\n');
      process.stdout.write(
        '  ' + fg('#565F89', '★ = auto-detected  ·  ↑/↓ to change  ·  Enter to confirm') + '\n',
      );
    };

    render();

    const cleanup = () => {
      stdin.removeListener('data', onData);
      stdin.setRawMode(false);
      stdin.pause();
    };

    const onData = (chunk: Buffer) => {
      const s = chunk.toString('utf8');
      if (s === '\x03' || s === '\x1b') {
        cleanup();
        reject(new Error('cancelled'));
        return;
      }
      if (s === '\x1b[A' || s === 'k') {
        cursor = Math.max(1, cursor - 1); // skip header
        render();
        return;
      }
      if (s === '\x1b[B' || s === 'j') {
        cursor = Math.min(rows.length - 1, cursor + 1);
        render();
        return;
      }
      if (s === '\r' || s === '\n') {
        const r = rows[cursor];
        if (r.kind === 'item' && r.tier) {
          cleanup();
          process.stdout.write('\n');
          process.stdout.write(
            '  ' + fg('#7BC74D', '✓') + ' ' + fg('#C0CAF5', 'Effort: ') + fg('#FF6B9D', r.tier) + '\n\n',
          );
          resolve(r.tier);
        }
        return;
      }
    };

    stdin.on('data', onData);
  });
}
