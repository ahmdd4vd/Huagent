// Memory pressure detection - when context is filling up, compact
// Inspired by OpenClaude memoryPressure.ts

export interface MemoryStats {
  totalTokens: number;
  maxTokens: number;
  percentUsed: number;
  systemPromptTokens: number;
  messagesTokens: number;
  toolResultsTokens: number;
  messageCount: number;
}

export interface CompactionStrategy {
  // When to start compacting
  warningThreshold: number;  // 0-1, default 0.7
  criticalThreshold: number; // 0-1, default 0.9

  // What to keep
  keepRecentMessages: number;  // default 10
  keepSystemPrompt: boolean;   // default true

  // What to summarize
  summarizeOlder: boolean;     // default true
  summarizeToolResults: boolean; // default false (keep recent)
}

// Default strategy
export const DEFAULT_STRATEGY: CompactionStrategy = {
  warningThreshold: 0.7,
  criticalThreshold: 0.9,
  keepRecentMessages: 10,
  keepSystemPrompt: true,
  summarizeOlder: true,
  summarizeToolResults: false,
};

// Rough token estimation (1 token ≈ 4 chars for English, 1-2 for code)
export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

// Estimate total memory usage
export function estimateMemory(
  messages: Array<{ role: string; content: string; toolCalls?: any[]; toolResults?: any[] }>,
  systemPrompt: string = '',
  maxTokens: number = 100000
): MemoryStats {
  const systemPromptTokens = estimateTokens(systemPrompt);
  let messagesTokens = 0;
  let toolResultsTokens = 0;

  for (const msg of messages) {
    messagesTokens += estimateTokens(msg.content || '');
    if (msg.toolCalls) {
      for (const tc of msg.toolCalls) {
        messagesTokens += estimateTokens(JSON.stringify(tc));
      }
    }
    if (msg.toolResults) {
      for (const tr of msg.toolResults) {
        toolResultsTokens += estimateTokens(JSON.stringify(tr));
      }
    }
  }

  const totalTokens = systemPromptTokens + messagesTokens + toolResultsTokens;
  return {
    totalTokens,
    maxTokens,
    percentUsed: totalTokens / maxTokens,
    systemPromptTokens,
    messagesTokens,
    toolResultsTokens,
    messageCount: messages.length,
  };
}

// Determine if we need to compact
export function shouldCompact(stats: MemoryStats, strategy: CompactionStrategy = DEFAULT_STRATEGY): 'none' | 'warning' | 'critical' {
  if (stats.percentUsed >= strategy.criticalThreshold) return 'critical';
  if (stats.percentUsed >= strategy.warningThreshold) return 'warning';
  return 'none';
}

// Estimate tokens saved by compacting
export function compactionSavings(
  messages: Array<{ role: string; content: string }>,
  strategy: CompactionStrategy = DEFAULT_STRATEGY
): { saved: number; percentReduction: number } {
  const totalBefore = estimateTokens(messages.map(m => m.content).join('\n'));

  if (messages.length <= strategy.keepRecentMessages) {
    return { saved: 0, percentReduction: 0 };
  }

  const toCompress = messages.slice(0, messages.length - strategy.keepRecentMessages);
  // Assume 80% reduction after summarization
  const beforeCompress = estimateTokens(toCompress.map(m => m.content).join('\n'));
  const afterCompress = Math.floor(beforeCompress * 0.2);

  return {
    saved: beforeCompress - afterCompress,
    percentReduction: ((beforeCompress - afterCompress) / totalBefore) * 100,
  };
}
