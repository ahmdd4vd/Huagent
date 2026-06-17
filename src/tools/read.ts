// File reading tool with smart truncation
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { existsSync, statSync } from 'node:fs';
import type { Tool } from '../types/index.js';

const MAX_LINES = 500;

export const readTool: Tool & { workdir: string } = {
  name: 'read',
  description: 'Read a file from the filesystem. Supports line ranges. Returns content with line numbers.',
  workdir: process.cwd(),
  schema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Path to the file (relative to workdir or absolute)' },
      startLine: { type: 'number', description: 'Start line (1-indexed, optional)' },
      endLine: { type: 'number', description: 'End line (1-indexed, optional)' },
    },
    required: ['path'],
  },
  async execute(args: { path: string; startLine?: number; endLine?: number }) {
    const fullPath = resolve(this.workdir, args.path);

    if (!existsSync(fullPath)) {
      throw new Error(`File not found: ${fullPath}`);
    }

    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      throw new Error(`Path is a directory, not a file. Use 'ls' or 'search' for directories.`);
    }

    const content = await readFile(fullPath, 'utf-8');
    const lines = content.split('\n');
    const totalLines = lines.length;

    const start = args.startLine ? Math.max(0, args.startLine - 1) : 0;
    const end = args.endLine ? Math.min(totalLines, args.endLine) : Math.min(totalLines, start + MAX_LINES);

    const slice = lines.slice(start, end);
    const numbered = slice.map((line, i) => `${String(start + i + 1).padStart(4)}│ ${line}`).join('\n');

    return {
      path: fullPath,
      totalLines,
      startLine: start + 1,
      endLine: end,
      truncated: end < totalLines,
      content: numbered,
    };
  },
};
