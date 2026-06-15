/**
 * wizard.ts — Orchestrates the 4-step first-run onboarding flow.
 *
 * Step 1: Welcome
 * Step 2: Provider selection
 * Step 3: API key input (masked)
 * Step 4: Model selection (filtered by provider)
 * Step 5: Effort tier (auto-detected, overridable)
 *
 * On success, returns a Config object that cli.tsx can save to disk.
 */
import { showWelcome } from './steps/welcome.js';
import { pickProvider } from './steps/provider-pick.js';
import { inputApiKey } from './steps/api-key-input.js';
import { pickModel, type ModelChoice } from './steps/model-pick.js';
import { pickEffort } from './steps/effort-pick.js';
import type { ProviderId } from '../providers/registry.js';
import { fg, gradient, glyph } from '../tui/theme.js';
import type { EffortTier } from './effort-detector.js';

export interface OnboardingResult {
  provider: ProviderId;
  apiKey: string;
  model: string;
  modelLabel: string;
  effort: EffortTier;
}

export async function runOnboarding(version: string, sampleTask?: string): Promise<OnboardingResult> {
  // Step 1: Welcome
  await showWelcome(version);

  // Step 2: Provider selection
  const provider = await pickProvider();

  // Step 3: API key (masked)
  const apiKey = await inputApiKey(provider);

  // Step 4: Model selection
  const model: ModelChoice = await pickModel(provider);

  // Step 5: Effort (auto-detect from sample if provided)
  const effort = await pickEffort(sampleTask);

  // Final success screen
  await showSuccess(provider, model, effort);

  return { provider, apiKey, model: model.id, modelLabel: model.label, effort };
}

async function showSuccess(
  provider: ProviderId,
  model: ModelChoice,
  effort: EffortTier,
): Promise<void> {
  const lines: string[] = [
    '',
    gradient('╭──────────────────────────────────────────────────────────╮', '#7BC74D', '#6BCBFF'),
    gradient('│', '#7BC74D', '#6BCBFF') + '   ' + fg('#FFD700', '✦') + '  ' + gradient('You\'re all set!', '#7BC74D', '#6BCBFF') + '                                  ' + gradient('│', '#7BC74D', '#6BCBFF'),
    gradient('│                                                          │', '#7BC74D', '#6BCBFF'),
    gradient('│', '#7BC74D', '#6BCBFF') + '   ' + fg('#9AA5CE', 'Provider: ') + fg('#FF6B9D', provider.padEnd(20)) + '        ' + gradient('│', '#7BC74D', '#6BCBFF'),
    gradient('│', '#7BC74D', '#6BCBFF') + '   ' + fg('#9AA5CE', 'Model:    ') + fg('#FF6B9D', model.label.slice(0, 20).padEnd(20)) + '        ' + gradient('│', '#7BC74D', '#6BCBFF'),
    gradient('│', '#7BC74D', '#6BCBFF') + '   ' + fg('#9AA5CE', 'Effort:   ') + fg('#FFD700', ('✦ ' + effort).padEnd(20)) + '        ' + gradient('│', '#7BC74D', '#6BCBFF'),
    gradient('│                                                          │', '#7BC74D', '#6BCBFF'),
    gradient('╰──────────────────────────────────────────────────────────╯', '#7BC74D', '#6BCBFF'),
    '',
    '  ' + fg('#7BC74D', 'Type a request to begin, or ') + fg('#FFD700', '/help') + fg('#7BC74D', ' for commands'),
    '',
  ];
  process.stdout.write(lines.join('\n') + '\n');
  // Brief pause so user sees the success message
  await new Promise((r) => setTimeout(r, 800));
}
