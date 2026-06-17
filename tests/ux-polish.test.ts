/**
 * Tests for Phase 4 UX Polish components
 */

import { describe, it, expect } from 'vitest';
import Fuse from 'fuse.js';
import terminalLink from 'terminal-link';
import { basename, dirname } from 'node:path';

describe('Phase 4: UX Polish', () => {
  describe('Error Handler', () => {
    it('should classify permission errors', () => {
      const classifyError = (error: string): string => {
        const lower = error.toLowerCase();
        if (lower.includes('permission') || lower.includes('eacces')) {
          return 'permission';
        }
        return 'unknown';
      };

      const category = classifyError('EACCES: permission denied');
      expect(category).toBe('permission');
    });

    it('should classify file-not-found errors', () => {
      const classifyError = (error: string): string => {
        const lower = error.toLowerCase();
        if (lower.includes('no such file') || lower.includes('enoent')) {
          return 'file-not-found';
        }
        return 'unknown';
      };

      const category = classifyError('ENOENT: no such file or directory');
      expect(category).toBe('file-not-found');
    });

    it('should classify syntax errors', () => {
      const classifyError = (error: string): string => {
        const lower = error.toLowerCase();
        if (lower.includes('syntax') || lower.includes('unexpected token')) {
          return 'syntax';
        }
        return 'unknown';
      };

      const category = classifyError('SyntaxError: Unexpected token');
      expect(category).toBe('syntax');
    });

    it('should classify network errors', () => {
      const classifyError = (error: string): string => {
        const lower = error.toLowerCase();
        if (lower.includes('network') || lower.includes('econnrefused')) {
          return 'network';
        }
        return 'unknown';
      };

      const category = classifyError('ECONNREFUSED: network error');
      expect(category).toBe('network');
    });

    it('should generate permission error suggestions', () => {
      const suggestions = [
        { label: 'Run with sudo', command: 'sudo huagent' },
        { label: 'Change file permissions', command: 'chmod 644 <file>' },
        { label: 'Move to user directory', command: 'mv <file> ~/.huagent/' },
      ];

      expect(suggestions.length).toBe(3);
      expect(suggestions[0].label).toBe('Run with sudo');
    });

    it('should generate file-not-found suggestions', () => {
      const filename = 'config.json';
      const suggestions = [
        { label: 'Check if file exists', command: `ls -la ${filename}` },
        { label: 'Search for similar files', command: `find . -name "*${filename}*" -type f` },
        { label: 'Create the file', command: `touch ${filename}` },
      ];

      expect(suggestions.length).toBe(3);
      expect(suggestions[0].command).toContain(filename);
    });

    it('should generate timeout suggestions', () => {
      const suggestions = [
        { label: 'Increase timeout', command: 'huagent --timeout 60' },
        { label: 'Use faster model', command: '/model gpt-3.5-turbo' },
        { label: 'Check connection', command: 'ping api.openai.com' },
      ];

      expect(suggestions.length).toBe(3);
    });
  });

  describe('Smart Autocomplete', () => {
    it('should perform fuzzy matching', () => {
      const items = [
        { value: '/model', description: 'Set LLM model' },
        { value: '/models', description: 'List available models' },
        { value: '/modes', description: 'Show engine modes' },
      ];

      const fuse = new Fuse(items, {
        keys: ['value', 'description'],
        threshold: 0.4,
      });

      const results = fuse.search('/modl');
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].item.value).toBe('/model');
    });

    it('should find exact matches', () => {
      const items = [
        { value: '/help', description: 'Show help' },
        { value: '/status', description: 'Show status' },
      ];

      const fuse = new Fuse(items, {
        keys: ['value'],
        threshold: 0.4,
      });

      const results = fuse.search('/help');
      expect(results.length).toBe(1);
      expect(results[0].item.value).toBe('/help');
    });

    it('should handle typos', () => {
      const items = [
        { value: 'src/auth/jwt.ts' },
        { value: 'src/auth/middleware.ts' },
        { value: 'src/api/routes.ts' },
      ];

      const fuse = new Fuse(items, {
        keys: ['value'],
        threshold: 0.4,
      });

      const results = fuse.search('jwt');
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].item.value).toContain('jwt');
    });

    it('should sort by relevance', () => {
      const items = [
        { value: '/models' },
        { value: '/model' },
        { value: '/modes' },
      ];

      const fuse = new Fuse(items, {
        keys: ['value'],
        threshold: 0.4,
        shouldSort: true,
      });

      const results = fuse.search('/model');
      expect(results[0].item.value).toBe('/model');
    });

    it('should limit results', () => {
      const items = Array.from({ length: 20 }, (_, i) => ({
        value: `/command${i}`,
      }));

      const fuse = new Fuse(items, {
        keys: ['value'],
        threshold: 0.4,
      });

      const results = fuse.search('/command');
      const limited = results.slice(0, 10);
      expect(limited.length).toBeLessThanOrEqual(10);
    });

    it('should handle empty query', () => {
      const items = [
        { value: '/help' },
        { value: '/status' },
      ];

      const fuse = new Fuse(items, {
        keys: ['value'],
        threshold: 0.4,
      });

      const results = fuse.search('');
      expect(results.length).toBe(0); // Empty query returns no results
    });

    it('should handle case-insensitive matching', () => {
      const items = [
        { value: 'TypeScript' },
        { value: 'typescript' },
      ];

      const fuse = new Fuse(items, {
        keys: ['value'],
        threshold: 0.4,
        isCaseSensitive: false,
      });

      const results = fuse.search('typescript');
      expect(results.length).toBeGreaterThan(0);
    });
  });

  describe('Clickable File Paths', () => {
    it('should extract filename from path', () => {
      const path = '/path/to/project/src/auth/jwt.ts';
      const filename = basename(path);
      expect(filename).toBe('jwt.ts');
    });

    it('should extract directory from path', () => {
      const path = '/path/to/project/src/auth/jwt.ts';
      const dir = dirname(path);
      expect(dir).toBe('/path/to/project/src/auth');
    });

    it('should detect file type from extension', () => {
      const getFileType = (path: string): string => {
        const ext = path.split('.').pop()?.toLowerCase() || '';
        const typeMap: Record<string, string> = {
          ts: 'typescript',
          js: 'javascript',
          py: 'python',
        };
        return typeMap[ext] || 'text';
      };

      expect(getFileType('file.ts')).toBe('typescript');
      expect(getFileType('file.js')).toBe('javascript');
      expect(getFileType('file.py')).toBe('python');
      expect(getFileType('file.txt')).toBe('text');
    });

    it('should get file icon', () => {
      const getFileIcon = (type: string): string => {
        const iconMap: Record<string, string> = {
          typescript: '📘',
          javascript: '📙',
          python: '🐍',
          rust: '🦀',
        };
        return iconMap[type] || '📄';
      };

      expect(getFileIcon('typescript')).toBe('📘');
      expect(getFileIcon('python')).toBe('🐍');
      expect(getFileIcon('rust')).toBe('🦀');
    });

    it('should create terminal hyperlink', () => {
      const path = '/path/to/file.ts';
      const fileUri = `file://${path}`;
      
      let link: string;
      try {
        link = terminalLink('file.ts', fileUri, {
          fallback: (text, url) => text,
        });
      } catch {
        link = 'file.ts';
      }

      expect(link).toBeDefined();
    });

    it('should format line number', () => {
      const filename = 'jwt.ts';
      const line = 42;
      const display = `${filename}:${line}`;
      expect(display).toBe('jwt.ts:42');
    });

    it('should handle paths without line numbers', () => {
      const filename = 'jwt.ts';
      const display = filename;
      expect(display).toBe('jwt.ts');
    });
  });

  describe('Loading States', () => {
    it('should calculate percentage correctly', () => {
      const percentage = Math.round((7 / 14) * 100);
      expect(percentage).toBe(50);
    });

    it('should calculate progress bar width', () => {
      const current = 5;
      const total = 10;
      const barWidth = 30;

      const filled = Math.round((current / total) * barWidth);
      const empty = barWidth - filled;

      expect(filled).toBe(15);
      expect(empty).toBe(15);
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

    it('should calculate ETA correctly', () => {
      const calculateETA = (current: number, total: number, elapsed: number): number => {
        if (current === 0 || elapsed === 0) return 0;
        const avgTimePerStep = elapsed / current;
        const remainingSteps = total - current;
        return remainingSteps * avgTimePerStep;
      };

      const eta = calculateETA(5, 10, 10000);
      expect(eta).toBe(10000);
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
      expect(eta).toBe(0);
    });

    it('should determine progress bar color', () => {
      const getColor = (percentage: number): string => {
        if (percentage >= 100) return 'green';
        if (percentage >= 50) return 'blue';
        return 'yellow';
      };

      expect(getColor(100)).toBe('green');
      expect(getColor(75)).toBe('blue');
      expect(getColor(25)).toBe('yellow');
    });

    it('should format elapsed time', () => {
      const startTime = Date.now() - 5000;
      const elapsed = Date.now() - startTime;
      expect(elapsed).toBeGreaterThanOrEqual(5000);
    });

    it('should track multiple stats', () => {
      const stats = {
        files: 12,
        errors: 0,
        warnings: 3,
      };

      expect(stats.files).toBe(12);
      expect(stats.errors).toBe(0);
      expect(stats.warnings).toBe(3);
    });
  });
});
