// Edit tool - surgical find-and-replace
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

export const editTool = {
  name: 'edit',
  description: 'Find and replace text in a file. The old_text must be unique in the file.',
  workdir: process.cwd(),
  schema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Path to the file' },
      oldText: { type: 'string', description: 'Text to find (must be unique in file)' },
      newText: { type: 'string', description: 'Replacement text' },
    },
    required: ['path', 'oldText', 'newText'],
  },
  async execute(args: { path: string; oldText: string; newText: string }) {
    const fullPath = resolve(this.workdir, args.path);
    const content = await readFile(fullPath, 'utf-8');

    const occurrences = content.split(args.oldText).length - 1;

    if (occurrences === 0) {
      throw new Error(`Text not found in file. Make sure oldText matches exactly.`);
    }

    if (occurrences > 1) {
      throw new Error(`Found ${occurrences} matches. oldText must be unique. Add more context.`);
    }

    const newContent = content.replace(args.oldText, args.newText);
    await writeFile(fullPath, newContent, 'utf-8');

    return {
      path: fullPath,
      replacements: 1,
      oldLength: args.oldText.length,
      newLength: args.newText.length,
    };
  },
};
