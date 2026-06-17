/**
 * steps/provider-pick.ts — Interactive provider picker (keypress-driven).
 *
 * Shows a scrollable list of providers grouped by API format.
 * ↑/↓ (or k/j) to navigate, Enter to select, Esc/Ctrl+C to cancel.
 */
import { listProviders, PROVIDERS, type ProviderId } from '../../providers/registry.js';
import { fg, gradient, glyph } from '../../tui/theme.js';
import { listenForKeys, isUp, isDown, isEnter, isEscape, isCtrlC, type KeyEvent } from '../keypress.js';

export async function pickProvider(): Promise<ProviderId> {
  const providers = listProviders();

  // Group by apiFormat
  const groups: Record<string, typeof providers> = {};
  for (const p of providers) {
    if (!groups[p.apiFormat]) groups[p.apiFormat] = [];
    groups[p.apiFormat].push(p);
  }

  // Flatten into a single navigable list
  const rows: Array<{ kind: 'header' | 'item'; text: string; id?: ProviderId }> = [];
  for (const [format, ps] of Object.entries(groups)) {
    rows.push({ kind: 'header', text: format.toUpperCase() });
    for (const p of ps) {
      const hasKey = process.env[p.apiKeyEnv] ? fg('#7BC74D', '✓') : fg('#565F89', '○');
      rows.push({
        kind: 'item',
        id: p.id,
        text: `  ${hasKey}  ${p.emoji}  ${p.displayName.padEnd(22)}  ${fg('#565F89', p.id)}`,
      });
    }
  }

  // Non-TTY: use default
  if (!process.stdin.isTTY) {
    return providers[0]?.id || 'anthropic';
  }

  let cursor = rows.findIndex((r) => r.kind === 'item');
  if (cursor < 0) cursor = 0;
  let offset = 0;
  const maxVisible = 12;
  const totalWidth = Math.max(60, (process.stdout.columns || 100) - 4);

  const render = () => {
    process.stdout.write('\x1b[2J\x1b[H');
    process.stdout.write('\n');
    process.stdout.write(
      '  ' +
        gradient('Choose Your LLM Provider', '#FF6B9D', '#C589E8') +
        '\n',
    );
    process.stdout.write('  ' + fg('#565F89', '─'.repeat(totalWidth - 4)) + '\n');
    process.stdout.write(
      '  ' +
        fg('#9AA5CE', `${providers.length} providers · ↑/↓ navigate · Enter select · Esc cancel`) +
        '\n\n',
    );

    const visible = rows.slice(offset, offset + maxVisible);
    for (let i = 0; i < visible.length; i++) {
      const r = visible[i];
      const absIdx = i + offset;
      const isCursor = absIdx === cursor;
      if (r.kind === 'header') {
        process.stdout.write(
          '  ' + (isCursor ? fg('#FFD700', glyph.arrow + ' ') : '  ') + fg('#FFC75F', r.text) + '\n',
        );
      } else {
        const prefix = isCursor ? fg('#FF6B9D', glyph.arrow + ' ') : '   ';
        const text = isCursor ? fg('#C0CAF5', r.text) : r.text;
        process.stdout.write('  ' + prefix + text + '\n');
      }
    }
  };

  return new Promise<ProviderId>((resolve, reject) => {
    render();

    listenForKeys({
      onKey: (k: KeyEvent) => {
        if (isCtrlC(k) || isEscape(k)) {
          reject(new Error('cancelled'));
          return true;
        }
        if (isUp(k)) {
          // Find previous item
          let next = cursor - 1;
          while (next >= 0 && rows[next].kind !== 'item') next--;
          if (next < 0) {
            // Wrap to last
            next = rows.length - 1;
            while (next > 0 && rows[next].kind !== 'item') next--;
          }
          cursor = next;
          if (cursor < offset) offset = cursor;
          if (cursor >= offset + maxVisible) offset = cursor - maxVisible + 1;
          render();
          return false;
        }
        if (isDown(k)) {
          // Find next item
          let next = cursor + 1;
          while (next < rows.length && rows[next].kind !== 'item') next++;
          if (next >= rows.length) {
            // Wrap to first
            next = rows.findIndex((r) => r.kind === 'item');
          }
          cursor = next;
          if (cursor >= offset + maxVisible) offset = cursor - maxVisible + 1;
          render();
          return false;
        }
        if (isEnter(k)) {
          const r = rows[cursor];
          if (r.kind === 'item' && r.id) {
            process.stdout.write('\n');
            process.stdout.write(
              '  ' + fg('#7BC74D', '✓') + ' ' + fg('#C0CAF5', `Provider: `) + fg('#FF6B9D', PROVIDERS[r.id].displayName) + '\n\n',
            );
            resolve(r.id);
            return true;
          }
          return false;
        }
        return false;
      },
    }).catch(reject);
  });
}
