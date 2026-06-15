/**
 * steps/provider-pick.ts — Interactive provider picker (raw mode).
 *
 * Shows a scrollable list of providers grouped by API format.
 * ↑/↓ to navigate, Enter to select, Esc to cancel.
 */
import { listProviders, PROVIDERS, type ProviderId } from '../../providers/registry.js';
import { fg, gradient, glyph } from '../../tui/theme.js';

export async function pickProvider(): Promise<ProviderId> {
  const providers = listProviders();
  const current = providers[0]?.id || 'anthropic';

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

  return new Promise<ProviderId>((resolve, reject) => {
    const stdin = process.stdin;
    if (!stdin.isTTY) {
      // Non-interactive: use default
      resolve(current);
      return;
    }
    stdin.setRawMode(true);
    stdin.resume();

    // Find first selectable row
    let cursor = rows.findIndex((r) => r.kind === 'item');
    let offset = 0;
    const maxVisible = 12;
    const totalWidth = Math.max(60, (process.stdout.columns || 100) - 4);

    const render = () => {
      // Clear screen
      process.stdout.write('\x1b[2J\x1b[H');
      process.stdout.write('\n');
      process.stdout.write(
        '  ' +
          gradient('Choose Your LLM Provider', '#FF6B9D', '#C589E8') +
          '\n',
      );
      process.stdout.write('  ' + fg('#565F89', '─'.repeat(totalWidth - 4)) + '\n');
      process.stdout.write('  ' + fg('#9AA5CE', `${providers.length} providers · ↑/↓ to navigate · Enter to select · Esc to cancel`) + '\n\n');

      const visible = rows.slice(offset, offset + maxVisible);
      for (let i = 0; i < visible.length; i++) {
        const r = visible[i];
        const absIdx = i + offset;
        const isCursor = absIdx === cursor;
        if (r.kind === 'header') {
          process.stdout.write(
            '  ' +
              (isCursor ? fg('#FFD700', glyph.arrow + ' ') : '  ') +
              fg('#FFC75F', r.text) +
              '\n',
          );
        } else {
          const prefix = isCursor ? fg('#FF6B9D', glyph.arrow + ' ') : '   ';
          const text = isCursor ? fg('#C0CAF5', r.text) : r.text;
          process.stdout.write('  ' + prefix + text + '\n');
        }
      }
    };

    render();

    const cleanup = () => {
      stdin.removeListener('data', onData);
      stdin.setRawMode(false);
      stdin.pause();
    };

    const onData = (chunk: Buffer) => {
      const s = chunk.toString('utf8');
      if (s === '\x03') {
        cleanup();
        reject(new Error('cancelled'));
        return;
      }
      if (s === '\x1b') {
        cleanup();
        reject(new Error('cancelled'));
        return;
      }
      // Arrow keys: \x1b[A (up), \x1b[B (down)
      if (s === '\x1b[A' || s === 'k') {
        // Find previous item
        let next = cursor - 1;
        while (next >= 0 && rows[next].kind !== 'item') next--;
        if (next < 0) next = rows.length - 1;
        while (rows[next].kind !== 'item') next--;
        cursor = next;
        if (cursor < offset) offset = cursor;
        if (cursor >= offset + maxVisible) offset = cursor - maxVisible + 1;
        render();
        return;
      }
      if (s === '\x1b[B' || s === 'j') {
        let next = cursor + 1;
        while (next < rows.length && rows[next].kind !== 'item') next++;
        if (next >= rows.length) next = rows.findIndex((r) => r.kind === 'item');
        cursor = next;
        if (cursor >= offset + maxVisible) offset = cursor - maxVisible + 1;
        render();
        return;
      }
      if (s === '\r' || s === '\n') {
        const r = rows[cursor];
        if (r.kind === 'item' && r.id) {
          cleanup();
          process.stdout.write('\n');
          process.stdout.write(
            '  ' + fg('#7BC74D', '✓') + ' ' + fg('#C0CAF5', `Provider: `) + fg('#FF6B9D', PROVIDERS[r.id].displayName) + '\n\n',
          );
          resolve(r.id);
        }
        return;
      }
    };

    stdin.on('data', onData);
  });
}
