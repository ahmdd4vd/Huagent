// Summary compression for memory (inspired by claw-code Rust)
// Removes duplicates, truncates lines, limits total size

export interface CompressionBudget {
  maxChars: number;
  maxLines: number;
  maxLineChars: number;
}

export interface CompressionResult {
  summary: string;
  originalChars: number;
  compressedChars: number;
  originalLines: number;
  compressedLines: number;
  removedDuplicates: number;
  omittedLines: number;
  truncated: boolean;
}

const DEFAULT_BUDGET: CompressionBudget = {
  maxChars: 1200,
  maxLines: 24,
  maxLineChars: 160,
};

export function compressSummary(input: string, budget: CompressionBudget = DEFAULT_BUDGET): CompressionResult {
  const originalChars = input.length;
  const originalLines = input.split('\n').length;

  // Normalize: remove duplicate lines
  const seen = new Set<string>();
  const uniqueLines: string[] = [];
  let removedDuplicates = 0;

  for (const line of input.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '') continue;
    if (seen.has(trimmed)) {
      removedDuplicates++;
      continue;
    }
    seen.add(trimmed);
    uniqueLines.push(truncateLine(trimmed, budget.maxLineChars));
  }

  // Take first N lines that fit
  const selected: string[] = [];
  let charCount = 0;

  for (const line of uniqueLines) {
    if (selected.length >= budget.maxLines) break;
    if (charCount + line.length + 1 > budget.maxChars) break;
    selected.push(line);
    charCount += line.length + 1;
  }

  const omittedLines = uniqueLines.length - selected.length;
  let summary = selected.join('\n');

  // Track whether we actually truncated content. The previous code used
  // `summary.length < originalChars`, which is WRONG: appending
  // "... (N more lines omitted)" can make summary LONGER than the
  // original (e.g. for a 50-char input with 30 omitted lines), so
  // `truncated` was false even though truncation happened.
  const didTruncate = omittedLines > 0 || removedDuplicates > 0 ||
    selected.some((line, i) => line !== uniqueLines[i]) ||
    selected.length < uniqueLines.length;

  if (omittedLines > 0) {
    summary += `\n... (${omittedLines} more lines omitted)`;
  }

  return {
    summary,
    originalChars,
    compressedChars: summary.length,
    originalLines,
    compressedLines: selected.length,
    removedDuplicates,
    omittedLines,
    truncated: didTruncate,
  };
}

function truncateLine(line: string, maxChars: number): string {
  if (line.length <= maxChars) return line;
  return line.slice(0, maxChars - 3) + '...';
}

// Compress a long conversation into a short summary
export function summarizeConversation(messages: Array<{ role: string; content: string }>): string {
  if (messages.length === 0) return '';

  const lines: string[] = [];
  let userCount = 0;
  let assistantCount = 0;

  for (const m of messages) {
    if (m.role === 'user') {
      userCount++;
      const preview = m.content.replace(/\s+/g, ' ').slice(0, 80);
      lines.push(`U${userCount}: ${preview}`);
    } else if (m.role === 'assistant') {
      assistantCount++;
      const preview = m.content.replace(/\s+/g, ' ').slice(0, 100);
      lines.push(`A${assistantCount}: ${preview}`);
    }
  }

  return compressSummary(lines.join('\n')).summary;
}
