// Path utilities - lexical path normalization (no filesystem access)
// Inspired by claw-code's is_within_workspace

import { sep } from 'node:path';

export function lexicallyNormalize(p: string): string {
  if (!p) return '';

  // Detect Windows drive letter (e.g. C:\ or C:/)
  const driveMatch = p.match(/^([a-zA-Z]:)[\\/]/);
  const drivePrefix = driveMatch ? driveMatch[1] : '';

  const isAbs = p.startsWith('/') || !!driveMatch;
  const parts = p.split(/[\\/]/).filter(Boolean);
  const result: string[] = [];

  for (const part of parts) {
    if (part === '.') continue;
    // Skip the drive letter as a part (e.g. "C:")
    if (drivePrefix && part === drivePrefix) continue;
    if (part === '..') {
      result.pop();
      continue;
    }
    result.push(part);
  }

  const normalized = result.join(sep);
  if (drivePrefix) {
    return drivePrefix + sep + normalized;
  }
  return isAbs ? sep + normalized : normalized;
}

export function isWithinWorkspace(path: string, workspaceRoot: string): boolean {
  const combined = path.startsWith('/') ? path : `${workspaceRoot}/${path}`;
  const normalized = lexicallyNormalize(combined);
  const root = lexicallyNormalize(workspaceRoot);
  const rootWithSep = root.endsWith(sep) ? root : root + sep;

  return normalized === root || normalized.startsWith(rootWithSep);
}
