/**
 * steps/api-key-input.ts — Masked API key input (raw mode).
 *
 * Uses readKeyWithMask from key-reader.ts. Saves to process.env.
 */
import { readKeyWithMask } from '../key-reader.js';
import { PROVIDERS } from '../../providers/registry.js';
import { fg, gradient, glyph } from '../../tui/theme.js';

export async function inputApiKey(providerId: string): Promise<string> {
  const provider = PROVIDERS[providerId as keyof typeof PROVIDERS];
  if (!provider) throw new Error(`Unknown provider: ${providerId}`);

  process.stdout.write('\n');
  process.stdout.write(
    '  ' +
      gradient(`Step 2: Enter Your ${provider.displayName} API Key`, '#FF6B9D', '#C589E8') +
      '\n',
  );
  process.stdout.write('  ' + fg('#565F89', '─'.repeat(60)) + '\n');
  process.stdout.write(
    '  ' +
      fg('#9AA5CE', 'Env var: ') +
      fg('#FFD700', provider.apiKeyEnv) +
      '\n',
  );
  process.stdout.write(
    '  ' + fg('#9AA5CE', `${provider.emoji}  Get one at: `) + fg('#87CEEB', provider.baseUrl) + '\n',
  );
  process.stdout.write('\n');
  process.stdout.write('  ' + fg('#C0CAF5', 'API key: '));

  const key = await readKeyWithMask({
    write: (s) => process.stdout.write(s),
  });

  // Save to process.env so the rest of the app picks it up
  process.env[provider.apiKeyEnv] = key;

  process.stdout.write('\n');
  process.stdout.write(
    '  ' + fg('#7BC74D', '✓') + ' ' + fg('#C0CAF5', 'Key saved to ') + fg('#FFD700', provider.apiKeyEnv) + '\n\n',
  );

  return key;
}
