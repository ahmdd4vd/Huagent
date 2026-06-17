/**
 * effort-detector.ts — Auto-detect effort tier from task text.
 *
 * Used by:
 *   - Onboarding wizard (suggest initial effort)
 *   - /effort slash command (suggest tier for current request)
 *   - Header chip (display current effort)
 *
 * Pure function — no I/O, fully testable.
 *
 * Heuristics (deliberately simple + transparent):
 *   1. Base tier = word-count bucket:
 *        0-5  words → low
 *        6-15 words → medium
 *        16-40 words → high
 *        41-100 words → xhigh
 *        101-250 words → max
 *        251+ words → max (base)
 *   2. Booster keywords escalate one tier:
 *        "build", "implement", "design", "architect", "migrate",
 *        "rewrite", "overhaul", "rebuild", "redesign", "refactor"
 *   3. Ultramax requires: 251+ words AND 2+ booster keywords
 *
 * Why these thresholds? Calibrated against typical user requests:
 *   - Low:    "what is X?" / "fix typo" (1-5 words)
 *   - Medium: "add a button" (6-15 words)
 *   - High:   "implement user auth" (16-40 words)
 *   - XHigh:  "design distributed system" (41-100 words)
 *   - Max:    "migrate codebase" (101-250 words)
 *   - Ultra:  "build enterprise SaaS" (251+ words + boosters)
 */

export type EffortTier = 'low' | 'medium' | 'high' | 'xhigh' | 'max' | 'ultramax';

export const EFFORT_TIERS: EffortTier[] = [
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
  'ultramax',
];

export function listTiers(): EffortTier[] {
  return [...EFFORT_TIERS];
}

/** Public: human-readable description for each tier. */
export const EFFORT_DESCRIPTIONS: Record<EffortTier, string> = {
  low: 'Quick answer or one-liner — minimal reasoning',
  medium: 'Short task or simple feature — focused work',
  high: 'Multi-step implementation — full attention',
  xhigh: 'Complex system or architecture — deep reasoning',
  max: 'Large migration or rebuild — extended session',
  ultramax: 'Enterprise-scale project — marathon mode',
};

const BOOSTERS = new Set([
  'build',
  'implement',
  'design',
  'architect',
  'migrate',
  'rewrite',
  'overhaul',
  'rebuild',
  'redesign',
  'refactor',
  'construct',
  'create',
]);

const TIER_INDEX: Record<EffortTier, number> = {
  low: 0,
  medium: 1,
  high: 2,
  xhigh: 3,
  max: 4,
  ultramax: 5,
};

function tierFromWordCount(words: number): EffortTier {
  if (words <= 5) return 'low';
  if (words <= 15) return 'medium';
  if (words <= 40) return 'high';
  if (words <= 100) return 'xhigh';
  return 'max'; // 101+
}

function countBoosters(text: string): number {
  const tokens = text.toLowerCase().split(/\s+/);
  let count = 0;
  for (const t of tokens) {
    // Strip punctuation
    const clean = t.replace(/[^a-z]/g, '');
    if (BOOSTERS.has(clean)) count++;
  }
  return count;
}

export function detectEffort(input: string): EffortTier {
  const text = (input || '').trim();
  if (!text) return 'medium';

  const words = text.split(/\s+/).filter(Boolean);
  const wordCount = words.length;

  let tier = tierFromWordCount(wordCount);
  const boosterCount = countBoosters(text);

  // Escalate one tier if there's at least one booster keyword
  if (boosterCount >= 1 && tier !== 'ultramax') {
    const next = EFFORT_TIERS[TIER_INDEX[tier] + 1];
    if (next) tier = next;
  }

  // Ultramax: requires 251+ words AND 2+ boosters
  if (wordCount >= 251 && boosterCount >= 2) {
    tier = 'ultramax';
  }

  return tier;
}

/**
 * Format an effort tier for display in the UI chip.
 *   formatEffortChip("xhigh") → "✦ xhigh"
 */
export function formatEffortChip(tier: EffortTier): string {
  return `✦ ${tier}`;
}
