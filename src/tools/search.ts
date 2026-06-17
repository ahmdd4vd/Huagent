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

        // SECURITY: Exclude all dotfiles (including .env, .npmrc, .aws,
        // .ssh, etc.) from search results. The previous code had a
        // special-case exception for `.env` which exposed secrets —
        // search results would list `.env` files, which typically
        // contain API keys and other credentials.
        if (entry.name.startsWith('.')) continue;
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
  // Convert glob to regex. Escape ALL regex special chars first, THEN
  // convert glob metachars (*, ?, [..]) back to regex syntax. The
  // previous code only escaped `.` and converted `*`/`?`, so globs
  // containing `+`, `(`, `)`, `[`, `]`, `{`, `}`, `^`, `$`, `|` produced
  // wrong regexes (e.g. `*.ts` worked, but `test_(unit).ts` matched
  // incorrectly or threw on invalid group syntax).
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  // Now convert glob-specific metachars. `*` → `.*`, `?` → `.`.
  // (`[..]` is already a regex char class after escaping — keep it.)
  const pattern = escaped
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');
  return new RegExp(`^${pattern}$`, 'i');
}
