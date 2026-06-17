// Grep tool - search file contents using ripgrep
//
// SECURITY: We use execFile (not exec) with an argument array so the
// pattern/path/include values are NEVER interpreted by a shell. This
// eliminates command-injection via backticks, $(), etc.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

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
    const max = args.maxResults ?? 50;
    const include = args.include || '*';
    const caseFlag = args.caseSensitive ? [] : ['-i'];

    // Build rg args as an array — execFile passes them straight to the
    // child without shell interpretation, so backticks/$()/; are safe.
    const rgArgs = [
      ...caseFlag,
      '--line-number',
      '--no-heading',
      `--max-count=${max}`,
      '-g', include,
      args.pattern,  // raw pattern, rg interprets as regex
      target,
    ];

    try {
      const { stdout } = await execFileAsync('rg', rgArgs, { maxBuffer: 5_000_000 });
      return parseGrepOutput(stdout, args.pattern, max);
    } catch (err: any) {
      // rg exits 1 when no matches — that's not an error.
      if (err.code === 1) {
        return { pattern: args.pattern, count: 0, matches: [] };
      }
      // rg not installed or other error — fall back to grep with the same
      // execFile-based argument array.
      const grepArgs = [
        '-rn',
        ...caseFlag,
        '-E',
        `--include=${include}`,
        args.pattern,
        target,
      ];
      try {
        const { stdout } = await execFileAsync('grep', grepArgs, { maxBuffer: 5_000_000 });
        // `grep | head` would require a shell — instead we slice in JS.
        return parseGrepOutput(stdout, args.pattern, max);
      } catch (e: any) {
        // grep also exits 1 on no matches.
        if (e.code === 1) {
          return { pattern: args.pattern, count: 0, matches: [] };
        }
        return { pattern: args.pattern, count: 0, matches: [], error: e.message };
      }
    }
  },
};

function parseGrepOutput(stdout: string, pattern: string, max: number) {
  const lines = stdout.trim().split('\n').filter(Boolean);
  return {
    pattern,
    count: lines.length,
    truncated: lines.length >= max,
    matches: lines.slice(0, max).map((line) => {
      const [file, lineNum, ...rest] = line.split(':');
      return { file, line: parseInt(lineNum, 10) || 0, content: rest.join(':') };
    }),
  };
}
