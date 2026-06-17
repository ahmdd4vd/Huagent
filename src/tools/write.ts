// File writing tool with auto-directory creation
import { writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';

export const writeTool = {
  name: 'write',
  description: 'Write content to a file. Creates directories as needed. Overwrites existing files.',
  workdir: process.cwd(),
  schema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Path to the file' },
      content: { type: 'string', description: 'Content to write' },
    },
    required: ['path', 'content'],
  },
  async execute(args: { path: string; content: string }) {
    const fullPath = resolve(this.workdir, args.path);
    const dir = dirname(fullPath);

    await mkdir(dir, { recursive: true });
    await writeFile(fullPath, args.content, 'utf-8');

    return {
      path: fullPath,
      bytes: args.content.length,
      lines: args.content.split('\n').length,
    };
  },
};
