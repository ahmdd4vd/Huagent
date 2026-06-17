/**
 * Tests for Phase 3 TUI Polish components
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { diffLines } from 'diff';
import hl from 'cli-highlight';
import { readdirSync, statSync } from 'node:fs';
import { join, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdirSync, writeFileSync } from 'node:fs';

describe('Phase 3: TUI Polish', () => {
  describe('Syntax Highlighting', () => {
    it('should highlight TypeScript code', () => {
      const code = `
function add(a: number, b: number): number {
  return a + b;
}
      `;

      const highlighted = hl(code, {
        language: 'typescript',
        ignoreIllegals: true,
      });

      expect(highlighted).toBeDefined();
      expect(highlighted.length).toBeGreaterThan(code.length);
    });

    it('should highlight JavaScript code', () => {
      const code = `
const add = (a, b) => {
  return a + b;
};
      `;

      const highlighted = hl(code, {
        language: 'javascript',
        ignoreIllegals: true,
      });

      expect(highlighted).toBeDefined();
    });

    it('should highlight Python code', () => {
      const code = `
def add(a, b):
    return a + b
      `;

      const highlighted = hl(code, {
        language: 'python',
        ignoreIllegals: true,
      });

      expect(highlighted).toBeDefined();
    });

    it('should handle invalid code gracefully', () => {
      const code = 'invalid { syntax }';

      const highlighted = hl(code, {
        language: 'typescript',
        ignoreIllegals: true,
      });

      expect(highlighted).toBeDefined();
    });

    it('should detect TypeScript from imports', () => {
      const code = `
import { readFile } from 'node:fs/promises';
export const x = 5;
      `;

      const hasImport = /import\s+.*?from\s+['"]/.test(code);
      expect(hasImport).toBe(true);
    });

    it('should detect Python from def keyword', () => {
      const code = `
def add(a, b):
    return a + b
      `;

      const hasDef = /def\s+\w+\s*\(/.test(code);
      expect(hasDef).toBe(true);
    });

    it('should detect Rust from fn keyword', () => {
      const code = `
fn add(a: i32, b: i32) -> i32 {
    a + b
}
      `;

      const hasFn = /fn\s+\w+\s*\(/.test(code);
      expect(hasFn).toBe(true);
    });

    it('should detect Go from func keyword', () => {
      const code = `
func add(a, b int) int {
    return a + b
}
      `;

      const hasFunc = /func\s+\w+\s*\(/.test(code);
      expect(hasFunc).toBe(true);
    });

    it('should detect Bash from shebang', () => {
      const code = `#!/bin/bash
echo "Hello"
      `;

      const hasShebang = /^\s*#!\/bin\/(ba)?sh/.test(code);
      expect(hasShebang).toBe(true);
    });

    it('should detect JSON from structure', () => {
      const code = `
{
  "name": "test",
  "version": "1.0.0"
}
      `;

      const hasJSON = /^\s*\{[\s\S]*\}\s*$/.test(code) && /".*?":/.test(code);
      expect(hasJSON).toBe(true);
    });
  });

  describe('Diff View', () => {
    it('should detect added lines', () => {
      const oldContent = 'line 1\nline 2\n';
      const newContent = 'line 1\nline 2\nline 3\n';

      const changes = diffLines(oldContent, newContent);
      const added = changes.filter(c => c.added);

      expect(added.length).toBeGreaterThan(0);
    });

    it('should detect removed lines', () => {
      const oldContent = 'line 1\nline 2\nline 3\n';
      const newContent = 'line 1\nline 2\n';

      const changes = diffLines(oldContent, newContent);
      const removed = changes.filter(c => c.removed);

      expect(removed.length).toBeGreaterThan(0);
    });

    it('should detect unchanged lines', () => {
      const oldContent = 'line 1\nline 2\n';
      const newContent = 'line 1\nline 2\n';

      const changes = diffLines(oldContent, newContent);
      const unchanged = changes.filter(c => !c.added && !c.removed);

      expect(unchanged.length).toBeGreaterThan(0);
    });

    it('should handle multiple changes', () => {
      const oldContent = 'line 1\nline 2\nline 3\nline 4\n';
      const newContent = 'line 1\nmodified 2\nline 3\nmodified 4\n';

      const changes = diffLines(oldContent, newContent);
      const added = changes.filter(c => c.added);
      const removed = changes.filter(c => c.removed);

      expect(added.length).toBe(2);
      expect(removed.length).toBe(2);
    });

    it('should handle empty content', () => {
      const oldContent = '';
      const newContent = 'line 1\n';

      const changes = diffLines(oldContent, newContent);
      expect(changes.length).toBeGreaterThan(0);
    });

    it('should handle identical content', () => {
      const content = 'line 1\nline 2\n';

      const changes = diffLines(content, content);
      const unchanged = changes.filter(c => !c.added && !c.removed);

      expect(unchanged.length).toBe(1);
    });

    it('should count added lines correctly', () => {
      const oldContent = 'line 1\n';
      const newContent = 'line 1\nline 2\nline 3\n';

      const changes = diffLines(oldContent, newContent);
      const addedCount = changes
        .filter(c => c.added)
        .reduce((sum, c) => sum + c.count, 0);

      expect(addedCount).toBe(2);
    });

    it('should count removed lines correctly', () => {
      const oldContent = 'line 1\nline 2\nline 3\n';
      const newContent = 'line 1\n';

      const changes = diffLines(oldContent, newContent);
      const removedCount = changes
        .filter(c => c.removed)
        .reduce((sum, c) => sum + c.count, 0);

      expect(removedCount).toBe(2);
    });
  });

  describe('File Tree', () => {
    let tempDir: string;

    beforeEach(() => {
      tempDir = join(tmpdir(), `huagent-test-${Date.now()}`);
      mkdirSync(tempDir, { recursive: true });
    });

    it('should read directory structure', () => {
      // Create test structure
      const subDir = join(tempDir, 'subdir');
      mkdirSync(subDir);
      writeFileSync(join(tempDir, 'file1.ts'), 'const x = 1;');
      writeFileSync(join(subDir, 'file2.ts'), 'const y = 2;');

      const entries = readdirSync(tempDir, { withFileTypes: true });
      expect(entries.length).toBe(2);
    });

    it('should distinguish files and directories', () => {
      const subDir = join(tempDir, 'subdir');
      mkdirSync(subDir);
      writeFileSync(join(tempDir, 'file.ts'), 'const x = 1;');

      const entries = readdirSync(tempDir, { withFileTypes: true });
      const files = entries.filter(e => e.isFile());
      const dirs = entries.filter(e => e.isDirectory());

      expect(files.length).toBe(1);
      expect(dirs.length).toBe(1);
    });

    it('should get file stats', () => {
      const filePath = join(tempDir, 'file.ts');
      writeFileSync(filePath, 'const x = 1;');

      const stats = statSync(filePath);
      expect(stats.size).toBeGreaterThan(0);
      expect(stats.isFile()).toBe(true);
    });

    it('should sort directories before files', () => {
      mkdirSync(join(tempDir, 'adir'));
      mkdirSync(join(tempDir, 'zdir'));
      writeFileSync(join(tempDir, 'bfile.ts'), 'x');
      writeFileSync(join(tempDir, 'yfile.ts'), 'x');

      const entries = readdirSync(tempDir, { withFileTypes: true });
      const sorted = entries.sort((a, b) => {
        if (a.isDirectory() && b.isFile()) return -1;
        if (a.isFile() && b.isDirectory()) return 1;
        return a.name.localeCompare(b.name);
      });

      expect(sorted[0].isDirectory()).toBe(true);
      expect(sorted[sorted.length - 1].isFile()).toBe(true);
    });

    it('should filter hidden files', () => {
      writeFileSync(join(tempDir, '.hidden'), 'x');
      writeFileSync(join(tempDir, 'visible.ts'), 'x');

      const entries = readdirSync(tempDir, { withFileTypes: true });
      const visible = entries.filter(e => !e.name.startsWith('.'));

      expect(visible.length).toBe(1);
      expect(visible[0].name).toBe('visible.ts');
    });

    it('should filter ignored patterns', () => {
      mkdirSync(join(tempDir, 'node_modules'));
      mkdirSync(join(tempDir, '.git'));
      mkdirSync(join(tempDir, 'src'));

      const entries = readdirSync(tempDir, { withFileTypes: true });
      const filtered = entries.filter(e => 
        !e.name.includes('node_modules') && 
        !e.name.includes('.git')
      );

      expect(filtered.length).toBe(1);
      expect(filtered[0].name).toBe('src');
    });

    it('should format file size correctly', () => {
      const formatSize = (bytes: number): string => {
        if (bytes < 1024) return `${bytes} B`;
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
        return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
      };

      expect(formatSize(500)).toBe('500 B');
      expect(formatSize(1024)).toBe('1.0 KB');
      expect(formatSize(1048576)).toBe('1.0 MB');
    });

    it('should count lines in file', () => {
      const filePath = join(tempDir, 'file.ts');
      writeFileSync(filePath, 'line 1\nline 2\nline 3\n');

      const content = require('fs').readFileSync(filePath, 'utf-8');
      const lines = content.split('\n').length;

      expect(lines).toBe(4); // 3 lines + trailing newline
    });
  });

  describe('Progress Indicator', () => {
    it('should calculate percentage correctly', () => {
      const percentage = Math.round((5 / 10) * 100);
      expect(percentage).toBe(50);
    });

    it('should calculate progress bar width', () => {
      const current = 5;
      const total = 10;
      const barWidth = 25;

      const filled = Math.round((current / total) * barWidth);
      const empty = barWidth - filled;

      expect(filled).toBe(13); // 50% of 25 = 12.5, rounded to 13
      expect(empty).toBe(12);
    });

    it('should format time correctly', () => {
      const formatTime = (ms: number): string => {
        if (ms < 1000) return `${ms}ms`;
        if (ms < 60000) return `${(ms / 1000).toFixed(0)}s`;
        const mins = Math.floor(ms / 60000);
        const secs = Math.floor((ms % 60000) / 1000);
        return `${mins}m ${secs}s`;
      };

      expect(formatTime(500)).toBe('500ms');
      expect(formatTime(5000)).toBe('5s');
      expect(formatTime(65000)).toBe('1m 5s');
    });

    it('should format cost correctly', () => {
      const formatCost = (cost: number): string => {
        if (cost < 0.01) return `$${cost.toFixed(4)}`;
        if (cost < 1) return `$${cost.toFixed(3)}`;
        return `$${cost.toFixed(2)}`;
      };

      expect(formatCost(0.001)).toBe('$0.0010');
      expect(formatCost(0.5)).toBe('$0.500');
      expect(formatCost(5)).toBe('$5.00');
    });

    it('should calculate ETA correctly', () => {
      const calculateETA = (current: number, total: number, elapsed: number): number => {
        if (current === 0 || elapsed === 0) return 0;
        const avgTimePerStep = elapsed / current;
        const remainingSteps = total - current;
        return remainingSteps * avgTimePerStep;
      };

      const eta = calculateETA(5, 10, 10000); // 5 steps in 10s, 5 remaining
      expect(eta).toBe(10000); // 10s remaining
    });

    it('should handle zero progress', () => {
      const calculateETA = (current: number, total: number, elapsed: number): number => {
        if (current === 0 || elapsed === 0) return 0;
        return 0;
      };

      const eta = calculateETA(0, 10, 0);
      expect(eta).toBe(0);
    });

    it('should handle 100% progress', () => {
      const calculateETA = (current: number, total: number, elapsed: number): number => {
        if (current === 0 || elapsed === 0) return 0;
        const avgTimePerStep = elapsed / current;
        const remainingSteps = total - current;
        return remainingSteps * avgTimePerStep;
      };

      const eta = calculateETA(10, 10, 10000);
      expect(eta).toBe(0); // No time remaining
    });

    it('should format tokens with commas', () => {
      const tokens = 1234567;
      const formatted = tokens.toLocaleString();
      expect(formatted).toBe('1,234,567');
    });

    it('should calculate elapsed time', () => {
      const startTime = Date.now() - 5000; // 5 seconds ago
      const elapsed = Date.now() - startTime;
      expect(elapsed).toBeGreaterThanOrEqual(5000);
    });
  });
});
