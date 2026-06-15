// Search tool - find files by glob pattern
import { readdir, stat } from 'node:fs/promises';
import { resolve, relative, join, basename } from 'node:path';
import { existsSync } from 'node:fs';

const MAX_RESULTS = 100;
const MAX_DEPTH = 8;

const IGNORE_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', '.next', '.nuxt', '.cache',
  'coverage', '.turbo', '.parcel-cache', '__pycache__', 'target',
  '.venv', 'venv', '.idea', '.vscode',
]);

export const searchTool = {
  name: 'search',
  description: 'Find files by name pattern (glob). Returns paths relative to the search root.',
  schema: {
    type: 'object',
    properties: {
      pattern: { type: 'string', description: 'Glob pattern (e.g., "*.ts", "test_*", "**/*.json")' },
      path: { type: 'string', description: 'Directory to search in (default: cwd)' },
      maxResults: { type: 'number', description: 'Max results to return (default 100)' },
    },
    required: ['pattern'],
  },
  async execute(args: { pattern: string; path?: string; maxResults?: number }) {
    const root = resolve(process.cwd(), args.path || '.');
    const maxResults = args.maxResults || MAX_RESULTS;
    const results: string[] = [];

    if (!existsSync(root)) {
      throw new Error(`Path not found: ${root}`);
    }

    // Convert glob to regex
    const regex = globToRegex(args.pattern);

    async function walk(dir: string, depth: number) {
      if (depth > MAX_DEPTH || results.length >= maxResults) return;

      let entries;
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }

      for (const entry of entries) {
        if (results.length >= maxResults) break;

        if (entry.name.startsWith('.') && entry.name !== '.env') continue;
        if (IGNORE_DIRS.has(entry.name)) continue;

        const fullPath = join(dir, entry.name);
        const relPath = relative(root, fullPath);

        if (regex.test(entry.name) || regex.test(relPath)) {
          results.push(relPath);
        }

        if (entry.isDirectory()) {
          await walk(fullPath, depth + 1);
        }
      }
    }

    await walk(root, 0);

    return {
      pattern: args.pattern,
      root,
      count: results.length,
      truncated: results.length >= maxResults,
      files: results,
    };
  },
};

function globToRegex(glob: string): RegExp {
  // Simple glob to regex conversion
  let pattern = glob
    .replace(/\./g, '\\.')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');
  return new RegExp(`^${pattern}$`, 'i');
}
