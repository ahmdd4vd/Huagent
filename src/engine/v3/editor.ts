// ✦ Editor — Stage 4: Smart File Editing ✦
// Inspired by Aider's SEARCH/REPLACE format
// Innovation: Auto-detect best edit format based on file size

import { readFileSync, existsSync, statSync } from 'node:fs';

export type EditFormat = 'write_full' | 'search_replace' | 'multi_replace';

export interface EditPlan {
  format: EditFormat;
  filePath: string;
  // For write_full
  fullContent?: string;
  // For search_replace
  searchBlocks?: Array<{ search: string; replace: string }>;
  // Reasoning
  reason: string;
}

export class SmartEditor {
  private fuzzyThreshold = 0.7; // 70% similarity

  /**
   * Decide best edit format for a file operation.
   */
  decideFormat(filePath: string, newContent: string, currentContent?: string): EditPlan {
    const exists = existsSync(filePath);
    if (!exists) {
      return {
        format: 'write_full',
        filePath,
        fullContent: newContent,
        reason: 'File does not exist — write full content',
      };
    }

    const oldContent = currentContent ?? readFileSync(filePath, 'utf8');
    const oldSize = oldContent.split('\n').length;
    const newSize = newContent.split('\n').length;

    // File is small: write full
    if (oldSize < 50 && newSize < 50) {
      return {
        format: 'write_full',
        filePath,
        fullContent: newContent,
        reason: `Small file (${oldSize} lines) — write full`,
      };
    }

    // Try to find small targeted changes
    const blocks = this.findReplaceBlocks(oldContent, newContent);

    if (blocks.length === 0) {
      // Total rewrite
      if (oldSize < 300) {
        return {
          format: 'write_full',
          filePath,
          fullContent: newContent,
          reason: `Medium file (${oldSize} lines) with major rewrite`,
        };
      }
      // Big file with major rewrite: use multiple replaces
      return {
        format: 'multi_replace',
        filePath,
        searchBlocks: blocks.length > 0 ? blocks : [{ search: oldContent, replace: newContent }],
        reason: `Large file (${oldSize} lines) — using ${blocks.length} targeted blocks`,
      };
    }

    // Small targeted changes: SEARCH/REPLACE
    if (blocks.length <= 5) {
      return {
        format: 'search_replace',
        filePath,
        searchBlocks: blocks,
        reason: `${blocks.length} targeted change(s) in ${oldSize}-line file`,
      };
    }

    return {
      format: 'multi_replace',
      filePath,
      searchBlocks: blocks,
      reason: `${blocks.length} changes in ${oldSize}-line file — multi-replace mode`,
    };
  }

  /**
   * Apply an edit plan to file content.
   * Returns the new content (does not write to disk — caller does that).
   */
  apply(plan: EditPlan, currentContent: string): { content: string; applied: boolean; errors: string[] } {
    const errors: string[] = [];

    if (plan.format === 'write_full') {
      return { content: plan.fullContent || '', applied: true, errors };
    }

    let content = currentContent;
    const blocks = plan.searchBlocks || [];

    for (let i = 0; i < blocks.length; i++) {
      const block = blocks[i];
      const exactMatch = content.indexOf(block.search);

      if (exactMatch >= 0) {
        // Exact match
        content = content.slice(0, exactMatch) + block.replace + content.slice(exactMatch + block.search.length);
      } else {
        // Try fuzzy match
        const fuzzyMatch = this.fuzzyFind(content, block.search);
        if (fuzzyMatch.match && fuzzyMatch.similarity >= this.fuzzyThreshold) {
          content = content.slice(0, fuzzyMatch.index!) + block.replace + content.slice(fuzzyMatch.index! + fuzzyMatch.match.length);
        } else {
          errors.push(`Block ${i + 1}: no match (best similarity: ${(fuzzyMatch.similarity * 100).toFixed(0)}%)`);
        }
      }
    }

    return {
      content,
      applied: errors.length === 0,
      errors,
    };
  }

  /**
   * Find replace blocks by diffing old and new content.
   * Uses simple LCS-like algorithm.
   */
  private findReplaceBlocks(old: string, newContent: string): Array<{ search: string; replace: string }> {
    const oldLines = old.split('\n');
    const newLines = newContent.split('\n');
    const blocks: Array<{ search: string; replace: string }> = [];

    // Find first differing line
    let firstDiff = 0;
    while (firstDiff < oldLines.length && firstDiff < newLines.length && oldLines[firstDiff] === newLines[firstDiff]) {
      firstDiff++;
    }

    // Find last differing line
    let lastOldDiff = oldLines.length - 1;
    let lastNewDiff = newLines.length - 1;
    while (lastOldDiff >= firstDiff && lastNewDiff >= firstDiff && oldLines[lastOldDiff] === newLines[lastNewDiff]) {
      lastOldDiff--;
      lastNewDiff--;
    }

    if (firstDiff > lastOldDiff) {
      // Pure addition
      const added = newLines.slice(firstDiff, lastNewDiff + 1).join('\n');
      const anchor = oldLines[Math.max(0, firstDiff - 1)] || '';
      blocks.push({
        search: anchor,
        replace: anchor + '\n' + added,
      });
      return blocks;
    }

    if (firstDiff > lastNewDiff) {
      // Pure deletion
      const removed = oldLines.slice(firstDiff, lastOldDiff + 1).join('\n');
      const anchor = oldLines[Math.max(0, firstDiff - 1)] || '';
      blocks.push({
        search: anchor + '\n' + removed,
        replace: anchor,
      });
      return blocks;
    }

    // Mixed change
    const oldBlock = oldLines.slice(firstDiff, lastOldDiff + 1).join('\n');
    const newBlock = newLines.slice(firstDiff, lastNewDiff + 1).join('\n');
    blocks.push({ search: oldBlock, replace: newBlock });

    return blocks;
  }

  /**
   * Fuzzy find a string in content (for cases like trailing whitespace, indentation diffs).
   */
  private fuzzyFind(content: string, search: string): { match: string | null; index: number; similarity: number } {
    if (!search) return { match: null, index: -1, similarity: 0 };

    const searchLines = search.split('\n').map((l) => l.trim()).filter(Boolean);
    if (searchLines.length === 0) return { match: null, index: -1, similarity: 0 };

    const firstLine = searchLines[0];
    const contentLines = content.split('\n');

    let bestMatch: { match: string; index: number; similarity: number } | null = null;

    for (let i = 0; i < contentLines.length; i++) {
      if (contentLines[i].trim() !== firstLine) continue;

      // Found a potential first line match
      const window = contentLines.slice(i, i + searchLines.length).join('\n');
      const similarity = this.similarity(search, window);

      if (similarity > (bestMatch?.similarity || 0)) {
        bestMatch = {
          match: window,
          index: content.split('\n').slice(0, i).join('\n').length + (i > 0 ? 1 : 0),
          similarity,
        };
      }
    }

    return bestMatch
      ? { match: bestMatch.match, index: bestMatch.index, similarity: bestMatch.similarity }
      : { match: null, index: -1, similarity: 0 };
  }

  /**
   * Compute similarity between two strings (Jaccard-like, line-based).
   */
  private similarity(a: string, b: string): number {
    const aLines = new Set(a.split('\n').map((l) => l.trim()));
    const bLines = new Set(b.split('\n').map((l) => l.trim()));
    if (aLines.size === 0 || bLines.size === 0) return 0;
    let intersect = 0;
    for (const l of aLines) if (bLines.has(l)) intersect++;
    return intersect / Math.max(aLines.size, bLines.size);
  }
}
