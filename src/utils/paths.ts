// Path utilities - lexical path normalization (no filesystem access)
// Inspired by claw-code's is_within_workspace

import { sep } from 'node:path';

export function lexicallyNormalize(p: string): string {
  if (!p) return '';

  const isAbsolute = p.startsWith('/') || /^[a-zA-Z]:[\\\/]/.test(p);
  const parts = p.split(/[\\\/]/).filter(Boolean);
  const result: string[] = [];

  for (const part of parts) {
    if (part === '.') continue;
    if (part === '..') {
      result.pop();
      continue;
    }
    result.push(part);
  }

  const normalized = result.join(sep);
  return isAbsolute ? sep + normalized : normalized;
}

export function isWithinWorkspace(path: string, workspaceRoot: string): boolean {
  const combined = path.startsWith('/') ? path : `${workspaceRoot}/${path}`;
  const normalized = lexicallyNormalize(combined);
  const root = lexicallyNormalize(workspaceRoot);
  const rootWithSep = root.endsWith(sep) ? root : root + sep;

  return normalized === root || normalized.startsWith(rootWithSep);
}
