/**
 * steps/model-pick.ts — Interactive model picker (raw mode).
 *
 * Shows all models for the chosen provider, grouped by tier.
 * ↑/↓ to navigate, Enter to select, Esc to cancel.
 */
import { getModels } from '../../providers/models.js';
import { PROVIDERS, type ProviderId } from '../../providers/registry.js';
import { fg, gradient, glyph } from '../../tui/theme.js';

export interface ModelChoice {
  id: string;
  label: string;
  tier: string;
  cost: string;
  ctx: string;
}

export async function pickModel(providerId: ProviderId): Promise<ModelChoice> {
  const provider = PROVIDERS[providerId];
  const allModels = getModels(providerId);
  if (allModels.length === 0) {
    throw new Error(`No models found for ${provider.displayName}`);
  }

  // Build flat list of models grouped by tier
  const tiers: Array<{ key: string; label: string }> = [
    { key: 'flagship', label: 'Flagship' },
    { key: 'reasoning', label: 'Reasoning' },
    { key: 'fast', label: 'Fast' },
    { key: 'code', label: 'Code' },
    { key: 'local', label: 'Local' },
    { key: 'legacy', label: 'Legacy' },
  ];

  const rows: Array<{ kind: 'header' | 'item'; text: string; model?: ModelChoice }> = [];
  for (const t of tiers) {
    const tierModels = allModels.filter((m) => m.tier === t.key);
    if (tierModels.length === 0) continue;
    rows.push({ kind: 'header', text: t.label.toUpperCase() });
    for (const m of tierModels) {
      const ctx =
        m.context >= 1_000_000
          ? Math.round(m.context / 1_000_000) + 'M'
          : m.context >= 1000
            ? Math.round(m.context / 1000) + 'k'
            : String(m.context);
      const cost =
        m.cost.input === 0 && m.cost.output === 0
          ? 'free'
          : `$${m.cost.input}/$${m.cost.output}`;
      const isDefault = m.id === provider.defaultModel;
      const marker = isDefault ? fg('#7BC74D', '●') : fg('#565F89', '○');
      rows.push({
        kind: 'item',
        model: { id: m.id, label: m.label, tier: t.key, cost, ctx },
        text: `  ${marker}  ${m.label.padEnd(38)}  ${fg('#9AA5CE', (ctx + 'ctx').padStart(7))}  ${fg('#565F89', cost.padStart(12))}${isDefault ? fg('#7BC74D', '  default') : ''}`,
      });
    }
  }

  // Find default model position
  let defaultIdx = rows.findIndex(
    (r) => r.kind === 'item' && r.model?.id === provider.defaultModel,
  );
  if (defaultIdx < 0) defaultIdx = rows.findIndex((r) => r.kind === 'item');

  return new Promise<ModelChoice>((resolve, reject) => {
    const stdin = process.stdin;
    if (!stdin.isTTY) {
      // Non-interactive: use default
      const def = allModels.find((m) => m.id === provider.defaultModel) || allModels[0];
      resolve({
        id: def.id,
        label: def.label,
        tier: def.tier,
        cost:
          def.cost.input === 0 && def.cost.output === 0
            ? 'free'
            : `$${def.cost.input}/$${def.cost.output}`,
        ctx: def.context >= 1000 ? Math.round(def.context / 1000) + 'k' : String(def.context),
      });
      return;
    }
    stdin.setRawMode(true);
    stdin.resume();

    let cursor = defaultIdx;
    let offset = 0;
    const maxVisible = 14;

    const render = () => {
      process.stdout.write('\x1b[2J\x1b[H');
      process.stdout.write('\n');
      process.stdout.write(
        '  ' +
          gradient(`Step 3: Pick a ${provider.displayName} Model`, '#FF6B9D', '#C589E8') +
          '\n',
      );
      process.stdout.write('  ' + fg('#565F89', '─'.repeat(78)) + '\n');
      process.stdout.write('  ' + fg('#9AA5CE', `${allModels.length} models · ↑/↓ to navigate · Enter to select`) + '\n\n');

      const visible = rows.slice(offset, offset + maxVisible);
      for (let i = 0; i < visible.length; i++) {
        const r = visible[i];
        const absIdx = i + offset;
        const isCursor = absIdx === cursor;
        if (r.kind === 'header') {
          process.stdout.write('  ' + fg('#FFC75F', r.text) + '\n');
        } else {
          const prefix = isCursor ? fg('#FF6B9D', glyph.arrow + ' ') : '   ';
          process.stdout.write('  ' + prefix + r.text + '\n');
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
      if (s === '\x03' || s === '\x1b') {
        cleanup();
        reject(new Error('cancelled'));
        return;
      }
      if (s === '\x1b[A' || s === 'k') {
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
        if (r.kind === 'item' && r.model) {
          cleanup();
          process.stdout.write('\n');
          process.stdout.write(
            '  ' + fg('#7BC74D', '✓') + ' ' + fg('#C0CAF5', 'Model: ') + fg('#FF6B9D', r.model.label) + '\n\n',
          );
          resolve(r.model);
        }
        return;
      }
    };

    stdin.on('data', onData);
  });
}
