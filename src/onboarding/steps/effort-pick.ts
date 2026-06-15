/**
 * steps/effort-pick.ts — Final step: confirm effort tier (keypress-driven).
 */
import {
  detectEffort,
  EFFORT_DESCRIPTIONS,
  EFFORT_TIERS,
  type EffortTier,
} from '../effort-detector.js';
import { fg, gradient, glyph } from '../../tui/theme.js';
import { listenForKeys, isUp, isDown, isEnter, isEscape, isCtrlC, type KeyEvent } from '../keypress.js';

export async function pickEffort(sampleTask?: string): Promise<EffortTier> {
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

  if (!process.stdin.isTTY) return detected;

  let cursor = EFFORT_TIERS.indexOf(detected);
  if (cursor < 0) cursor = 1; // medium
  // +1 because of the header at rows[0]
  let rowCursor = cursor + 1;

  const render = () => {
    process.stdout.write('\x1b[2J\x1b[H');
    process.stdout.write('\n');
    process.stdout.write('  ' + gradient('Step 4: Confirm Effort Level', '#FF6B9D', '#C589E8') + '\n');
    process.stdout.write('  ' + fg('#565F89', '─'.repeat(78)) + '\n');
    if (sampleTask) {
      process.stdout.write('  ' + fg('#9AA5CE', 'Detected from your task: ') + fg('#FFD700', detected) + '\n');
    } else {
      process.stdout.write('  ' + fg('#9AA5CE', 'Default: ') + fg('#FFD700', 'medium') + '\n');
    }
    process.stdout.write('\n');

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      if (r.kind === 'header') {
        process.stdout.write('  ' + fg('#FFC75F', r.text) + '\n');
      } else {
        const isCursor = i === rowCursor;
        const prefix = isCursor ? fg('#FF6B9D', glyph.arrow + ' ') : '   ';
        process.stdout.write('  ' + prefix + r.text + '\n');
      }
    }
    process.stdout.write('\n');
    process.stdout.write('  ' + fg('#565F89', '★ = auto-detected  ·  ↑/↓ change  ·  Enter confirm') + '\n');
  };

  return new Promise<EffortTier>((resolve, reject) => {
    render();

    listenForKeys({
      onKey: (k: KeyEvent) => {
        if (isCtrlC(k) || isEscape(k)) {
          reject(new Error('cancelled'));
          return true;
        }
        if (isUp(k)) {
          rowCursor = Math.max(1, rowCursor - 1); // skip header at rows[0]
          render();
          return false;
        }
        if (isDown(k)) {
          rowCursor = Math.min(rows.length - 1, rowCursor + 1);
          render();
          return false;
        }
        if (isEnter(k)) {
          const r = rows[rowCursor];
          if (r.kind === 'item' && r.tier) {
            process.stdout.write('\n');
            process.stdout.write(
              '  ' + fg('#7BC74D', '✓') + ' ' + fg('#C0CAF5', 'Effort: ') + fg('#FF6B9D', r.tier) + '\n\n',
            );
            resolve(r.tier);
            return true;
          }
          return false;
        }
        return false;
      },
    }).catch(reject);
  });
}
