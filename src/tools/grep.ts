// Grep tool - search file contents using ripgrep
import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

export const grepTool = {
  name: 'grep',
  description: 'Search for a regex pattern in file contents. Returns matching lines with file:line:content format.',
  schema: {
    type: 'object',
    properties: {
      pattern: { type: 'string', description: 'Regex pattern to search for' },
      path: { type: 'string', description: 'Directory or file to search (default: cwd)' },
      include: { type: 'string', description: 'File glob to include (e.g., "*.ts")' },
      maxResults: { type: 'number', description: 'Max results (default 50)' },
      caseSensitive: { type: 'boolean', description: 'Case sensitive (default false)' },
    },
    required: ['pattern'],
  },
  async execute(args: { pattern: string; path?: string; include?: string; maxResults?: number; caseSensitive?: boolean }) {
    const target = args.path || '.';
    const max = args.maxResults || 50;
    const include = args.include || '*';
    const caseFlag = args.caseSensitive ? '' : '-i';

    // Use rg if available, fallback to grep
    let cmd = `rg ${caseFlag} --line-number --no-heading --max-count=${max} -g '${include}' "${args.pattern.replace(/"/g, '\\"')}" "${target}"`;

    try {
      const { stdout } = await execAsync(cmd, { maxBuffer: 5_000_000 });
      const lines = stdout.trim().split('\n').filter(Boolean);
      return {
        pattern: args.pattern,
        count: lines.length,
        truncated: lines.length >= max,
        matches: lines.slice(0, max).map((line) => {
          const [file, lineNum, ...rest] = line.split(':');
          return { file, line: parseInt(lineNum, 10), content: rest.join(':') };
        }),
      };
    } catch (err: any) {
      // rg returns exit 1 when no matches
      if (err.code === 1) {
        return { pattern: args.pattern, count: 0, matches: [] };
      }
      // Fallback to grep
      const fallback = `grep -rn ${caseFlag} -E --include='${include}' "${args.pattern.replace(/"/g, '\\"')}" "${target}" | head -${max}`;
      try {
        const { stdout } = await execAsync(fallback, { maxBuffer: 5_000_000 });
        const lines = stdout.trim().split('\n').filter(Boolean);
        return {
          pattern: args.pattern,
          count: lines.length,
          matches: lines.slice(0, max).map((line) => {
            const m = line.match(/^([^:]+):(\d+):(.*)$/);
            return m ? { file: m[1], line: parseInt(m[2], 10), content: m[3] } : { file: line, line: 0, content: '' };
          }),
        };
      } catch (e: any) {
        return { pattern: args.pattern, count: 0, matches: [], error: e.message };
      }
    }
  },
};
