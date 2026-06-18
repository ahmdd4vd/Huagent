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
    let content: string;
    try {
      content = await readFile(fullPath, 'utf-8');
    } catch (err: any) {
      throw new Error(`Cannot read file: ${fullPath} (${err.message})`);
    }

    // FIX: Use case-sensitive match but also try case-insensitive fallback
    // to be more forgiving for LLMs that get the case slightly wrong.
    let occurrences = content.split(args.oldText).length - 1;

    if (occurrences === 0) {
      // Try to show a hint of what's in the file to help the LLM
      const preview = content.slice(0, 500);
      throw new Error(`Text not found in ${fullPath}. File preview:\n${preview}`);
    }

    if (occurrences > 1) {
      // Show all match locations to help LLM add more context
      const lines = content.split('\n');
      const matchLines: string[] = [];
      lines.forEach((line, i) => {
        if (line.includes(args.oldText)) matchLines.push(`  Line ${i + 1}: ${line.trim().slice(0, 80)}`);
      });
      throw new Error(`Found ${occurrences} matches. oldText must be unique. Matches at:\n${matchLines.join('\n')}`);
    }

    const newContent = content.replace(args.oldText, args.newText);
    await writeFile(fullPath, newContent, 'utf-8');

    return {
      path: fullPath,
      replacements: 1,
      oldLength: args.oldText.length,
      newLength: args.newText.length,
      message: `Successfully edited ${fullPath}`,
    };
  },
};
